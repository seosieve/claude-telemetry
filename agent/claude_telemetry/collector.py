"""Collector module — calls ccusage/ccost CLI tools and parses JSON output."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

from .models import DailyUsage, SessionUsage, RateLimit, BlockUsage


class CollectorError(Exception):
    pass


def _run_command(cmd: list[str], timeout: int = 120) -> str:
    """Run a CLI command and return stdout."""
    # On Windows, npx needs shell=True to resolve .cmd wrappers
    use_shell = sys.platform == "win32"
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
        shell=use_shell,
    )
    if result.returncode != 0:
        raise CollectorError(f"Command failed: {' '.join(cmd)}\n{result.stderr}")
    return result.stdout


def _detect_subagent(session_id: str) -> bool:
    """Detect if session is a Paperclip subagent by path pattern."""
    return "paperclip-instances-default-" in session_id


def _session_id_to_project(session_id: str) -> str:
    """Extract a readable project name from the session ID path encoding."""
    # ccusage encodes paths as C--Users-RyanS-Documents-project-name

    # Handle Paperclip workspaces/projects
    if "paperclip-instances" in session_id:
        return "Paperclip"

    # Try to extract the last meaningful segment
    # e.g. "c--Users-RyanS-Documents-konta-paperclip" -> "konta-paperclip"
    # Find the last path-like segment (after common prefixes)
    id_lower = session_id.lower()
    for prefix in ["documents-", "projects-", "repos-", "dev-", "code-"]:
        idx = id_lower.find(prefix)
        if idx != -1:
            return session_id[idx + len(prefix):]

    # Fallback: use last segment after the user directory
    # c--Users-RyanS-my-project -> my-project
    segments = session_id.split("-")
    if len(segments) > 3:
        # Skip drive letter and user path segments
        return "-".join(segments[3:])

    return session_id


def collect_daily_usage(since: str | None = None) -> list[DailyUsage]:
    """
    Call `npx ccusage@19.0.3 daily --json --instances` and flatten
    the per-project, per-model breakdowns into DailyUsage records.
    """
    # ccusage v2 split the top-level commands into per-agent subcommands; the
    # old `ccusage daily --instances` now returns a flat list without
    # project/model breakdowns, so we must call the `claude daily` subcommand.
    cmd = ["npx", "ccusage@19.0.3", "claude", "daily", "--json", "--instances", "--no-color"]
    if since:
        cmd.extend(["--since", since])

    raw = _run_command(cmd)
    data = json.loads(raw)

    results: list[DailyUsage] = []
    projects = data.get("projects", {})

    for project_id, days in projects.items():
        project_name = _session_id_to_project(project_id)
        for day in days:
            for breakdown in day.get("modelBreakdowns", []):
                results.append(DailyUsage(
                    date=day["date"],
                    project=project_name,
                    model=breakdown["modelName"],
                    input_tokens=breakdown.get("inputTokens", 0),
                    output_tokens=breakdown.get("outputTokens", 0),
                    cache_creation_tokens=breakdown.get("cacheCreationTokens", 0),
                    cache_read_tokens=breakdown.get("cacheReadTokens", 0),
                    total_tokens=(
                        breakdown.get("inputTokens", 0)
                        + breakdown.get("outputTokens", 0)
                        + breakdown.get("cacheCreationTokens", 0)
                        + breakdown.get("cacheReadTokens", 0)
                    ),
                    cost_usd=breakdown.get("cost", 0.0),
                ))

    return results


def collect_session_usage() -> list[SessionUsage]:
    """Call `npx ccusage@19.0.3 claude session --json` and parse into SessionUsage records."""
    cmd = ["npx", "ccusage@19.0.3", "claude", "session", "--json", "--no-color"]
    raw = _run_command(cmd)
    data = json.loads(raw)

    results: list[SessionUsage] = []
    for s in data.get("sessions", []):
        session_id = s["sessionId"]
        results.append(SessionUsage(
            session_id=session_id,
            project=_session_id_to_project(session_id),
            project_path=s.get("projectPath"),
            models=s.get("modelsUsed", []),
            is_subagent=_detect_subagent(session_id),
            input_tokens=s.get("inputTokens", 0),
            output_tokens=s.get("outputTokens", 0),
            cache_creation_tokens=s.get("cacheCreationTokens", 0),
            cache_read_tokens=s.get("cacheReadTokens", 0),
            total_tokens=s.get("totalTokens", 0),
            cost_usd=s.get("totalCost", 0.0),
            last_activity_at=s.get("lastActivity"),
        ))

    return results


def _find_ccost() -> str:
    """Find ccost binary: check venv first, then PATH."""
    import shutil
    from pathlib import Path

    # Check venv/Scripts (Windows) or venv/bin (Unix)
    venv_dir = Path(sys.prefix)
    if sys.platform == "win32":
        venv_ccost = venv_dir / "Scripts" / "ccost.exe"
    else:
        venv_ccost = venv_dir / "bin" / "ccost"
    if venv_ccost.exists():
        return str(venv_ccost)

    # Fall back to PATH
    found = shutil.which("ccost")
    if found:
        return found

    raise FileNotFoundError("ccost not found")


def _ccost_view(ccost_bin: str, per: str) -> dict | None:
    """Run `ccost sl --per <per> --output json` and return parsed JSON dict."""
    tmp_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False,
        ) as f:
            tmp_path = f.name
        _run_command(
            [ccost_bin, "sl", "--per", per, "--output", "json", "--filename", tmp_path],
            timeout=60,
        )
        with open(tmp_path, encoding="utf-8") as f:
            return json.load(f)
    except (CollectorError, FileNotFoundError, json.JSONDecodeError, OSError):
        return None
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def _tail_lines(path: os.PathLike[str] | str, n: int) -> list[str]:
    """Return up to the last n lines of a (possibly large) file efficiently."""
    with open(path, "rb") as f:
        f.seek(0, 2)
        size = f.tell()
        data = b""
        block = 8192
        while size > 0 and data.count(b"\n") <= n:
            step = min(block, size)
            size -= step
            f.seek(size)
            data = f.read(step) + data
        return data.decode("utf-8", errors="replace").splitlines()


def _read_statusline_rate_limit(
    claude_dir: os.PathLike[str] | str | None = None,
) -> dict | None:
    """Read the newest live rate-limit reading from ~/.claude/statusline.jsonl.

    Claude Code passes the account's *current* usage to the statusline command on
    stdin; statusline.sh appends each call as {"ts": <epoch>, "data": <json>}. The
    latest record's data.rate_limits reflects the API's live 5h / 7d usage — with
    no peak/min window aggregation — so a rate-limit reset shows up immediately,
    even on a single machine. Returns None when the file or the rate_limits feed
    is absent (e.g. plans where the API doesn't report usage).
    """
    from pathlib import Path

    base = Path(claude_dir) if claude_dir else (Path.home() / ".claude")
    path = base / "statusline.jsonl"
    if not path.exists():
        return None
    try:
        lines = _tail_lines(path, 500)
    except OSError:
        return None
    for line in reversed(lines):
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        data = rec.get("data") or {}
        rl = data.get("rate_limits") or {}
        five_hour = rl.get("five_hour") or {}
        seven_day = rl.get("seven_day") or {}
        if (
            five_hour.get("used_percentage") is None
            and seven_day.get("used_percentage") is None
        ):
            continue
        return {
            "five_hour_pct": five_hour.get("used_percentage"),
            "seven_day_pct": seven_day.get("used_percentage"),
            "five_hour_reset": five_hour.get("resets_at"),
            "seven_day_reset": seven_day.get("resets_at"),
            "session_cost": (data.get("cost") or {}).get("total_cost_usd"),
        }
    return None


def collect_rate_limits(
    ccost_path: str | None = None,
    claude_dir: os.PathLike[str] | str | None = None,
) -> list[RateLimit] | None:
    """Collect the current 5h / weekly rate-limit usage.

    Primary source: the live values Claude Code reports to the statusline
    (~/.claude/statusline.jsonl). These are the API's *current* usage figures, so
    a reset is reflected immediately and a single machine reads correctly —
    unlike ccost's per-window peak, which can stay stale across a reset that
    doesn't align with a window boundary.

    Fallback (statusline feed lacks rate_limits, e.g. on plans where the API
    doesn't report usage): ccost's 5h + 1w views. The active 5h window gives
    windowStart (→ session_duration_seconds, so reset_at = timestamp + 5h -
    duration ≡ windowEnd); the weekly % is the min of both active windows'
    maxSevenDayPct (a peak, so the fresher window wins) and the 1w window's
    windowEnd is weekly_reset_at. Returns None if neither source is available.
    """
    now = datetime.now(timezone.utc)

    sl = _read_statusline_rate_limit(claude_dir)
    if sl is not None:
        weekly_reset_at: str | None = None
        if sl["seven_day_reset"]:
            try:
                weekly_reset_at = datetime.fromtimestamp(
                    sl["seven_day_reset"], timezone.utc
                ).isoformat()
            except (ValueError, TypeError, OSError):
                pass
        # Encode the 5h reset as session_duration_seconds so the dashboard's
        # "resets in" countdown (timestamp + 5h - duration) lands on the real
        # five_hour reset time.
        duration_seconds: int | None = None
        if sl["five_hour_reset"]:
            try:
                duration_seconds = int(
                    5 * 3600 - (sl["five_hour_reset"] - now.timestamp())
                )
            except (ValueError, TypeError):
                pass
        return [RateLimit(
            timestamp=now.isoformat(),
            window_5h_percent=sl["five_hour_pct"],
            window_1w_percent=sl["seven_day_pct"],
            session_cost_usd=sl["session_cost"],
            session_duration_seconds=duration_seconds,
            weekly_reset_at=weekly_reset_at,
        )]

    try:
        ccost_bin = ccost_path or _find_ccost()
    except FileNotFoundError:
        return None

    try:
        from dateutil.parser import isoparse
    except ImportError:
        return None

    data_5h = _ccost_view(ccost_bin, "5h")
    if not data_5h:
        return None

    entries = data_5h.get("data") if isinstance(data_5h, dict) else None
    if not entries:
        return None

    active = None
    latest_start = None
    for entry in entries:
        ws = entry.get("windowStart")
        we = entry.get("windowEnd")
        if not ws or not we:
            continue
        try:
            ws_dt = isoparse(ws)
            we_dt = isoparse(we)
        except (ValueError, TypeError):
            continue
        if ws_dt <= now < we_dt and (latest_start is None or ws_dt > latest_start):
            active = entry
            latest_start = ws_dt
    if active is None:
        active = entries[-1]

    ws = active.get("windowStart")
    try:
        window_start = isoparse(ws) if ws else None
    except (ValueError, TypeError):
        window_start = None

    duration_seconds = (
        int((now - window_start).total_seconds())
        if window_start
        else None
    )

    # Weekly window: read the reset time (windowEnd) from the active 1w window,
    # and the weekly percentage from whichever active window is *fresher*.
    #
    # ccost's maxSevenDayPct is a per-window PEAK, not the current value: a window
    # that opened before a rate-limit reset keeps the pre-reset peak until it
    # closes. Which view is stale depends on when the reset landed:
    #   * a regular weekly reset aligns with the 1w window boundary, so the 1w
    #     active window is fresh — but the 5h window straddling the reset stays
    #     peaked for up to ~5h;
    #   * an off-cycle reset (e.g. a mid-week limit refresh) lands *inside* the
    #     fixed weekly window, so the 1w window keeps its pre-reset peak while the
    #     post-reset 5h window is already fresh.
    # A reset only pushes true usage DOWN, so the fresher active window always
    # reports the smaller peak. Take the min of both active windows' maxSevenDayPct
    # (falling back to whichever view is available).
    weekly_reset_at: str | None = None
    weekly_percent = active.get("maxSevenDayPct")
    data_1w = _ccost_view(ccost_bin, "1w")
    w_entries = data_1w.get("data") if isinstance(data_1w, dict) else None
    if w_entries:
        active_1w = None
        for entry in w_entries:
            we = entry.get("windowEnd")
            ws = entry.get("windowStart")
            if not we or not ws:
                continue
            try:
                we_dt = isoparse(we)
                ws_dt = isoparse(ws)
            except (ValueError, TypeError):
                continue
            if ws_dt <= now < we_dt:
                weekly_reset_at = we_dt.isoformat()
                active_1w = entry
                break
        if active_1w is None:
            active_1w = w_entries[-1]
            we = active_1w.get("windowEnd")
            if we:
                try:
                    weekly_reset_at = isoparse(we).isoformat()
                except (ValueError, TypeError):
                    weekly_reset_at = None
        pct_1w = active_1w.get("maxSevenDayPct")
        if pct_1w is not None:
            weekly_percent = (
                pct_1w if weekly_percent is None else min(weekly_percent, pct_1w)
            )

    return [RateLimit(
        timestamp=now.isoformat(),
        window_5h_percent=active.get("maxFiveHourPct"),
        window_1w_percent=weekly_percent,
        session_cost_usd=active.get("totalCost"),
        session_duration_seconds=duration_seconds,
        weekly_reset_at=weekly_reset_at,
    )]


def collect_blocks_usage() -> list[BlockUsage]:
    """Call `npx ccusage@19.0.3 claude blocks --json --recent` and parse into BlockUsage records."""
    cmd = ["npx", "ccusage@19.0.3", "claude", "blocks", "--json", "--recent", "--no-color"]
    try:
        raw = _run_command(cmd)
    except CollectorError:
        return []

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []

    results: list[BlockUsage] = []
    for b in data.get("blocks", []):
        tc = b.get("tokenCounts", {})
        start = b.get("startTime", "")
        end = b.get("endTime", "")

        # Calculate duration in minutes
        duration = 0
        if start and end:
            try:
                from dateutil.parser import isoparse
                dt_start = isoparse(start)
                actual_end = b.get("actualEndTime") or end
                dt_end = isoparse(actual_end)
                duration = max(0, int((dt_end - dt_start).total_seconds() / 60))
            except Exception:
                pass

        results.append(BlockUsage(
            block_start=start,
            block_end=end,
            is_active=b.get("isActive", False),
            is_gap=b.get("isGap", False),
            input_tokens=tc.get("inputTokens", 0),
            output_tokens=tc.get("outputTokens", 0),
            cache_creation_tokens=tc.get("cacheCreationInputTokens", 0),
            cache_read_tokens=tc.get("cacheReadInputTokens", 0),
            total_tokens=b.get("totalTokens", 0),
            cost_usd=b.get("costUSD", 0.0),
            models=b.get("models", []),
            duration_minutes=duration,
            entries=b.get("entries", 0),
        ))

    return results
