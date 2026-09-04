"""Collector module — calls ccusage/ccost CLI tools and parses JSON output."""

from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone

from .models import DailyUsage, SessionUsage, RateLimit, BlockUsage


logger = logging.getLogger("claude-telemetry")


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


def _rows(data, key: str) -> list:
    """ccusage returns {key: rows} normally; tolerate a bare top-level list."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get(key), list):
        return data[key]
    return []


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
    cmd = ["npx", "-y", "ccusage@19.0.3", "claude", "daily", "--json", "--instances", "--no-color"]
    if since:
        cmd.extend(["--since", since])

    raw = _run_command(cmd)
    data = json.loads(raw)

    results: list[DailyUsage] = []

    # `claude daily --instances` normally returns {"projects": {id: [day…]}},
    # but at least one machine got a flat form instead — {"daily": [day…]} or
    # a bare top-level list with no project grouping. Accept every shape so a
    # ccusage quirk on one machine can't kill its entire sync.
    if isinstance(data, dict) and isinstance(data.get("projects"), dict):
        grouped = data["projects"].items()
    elif isinstance(data, dict):
        grouped = [(None, data.get("daily", []))]
    else:
        grouped = [(None, data if isinstance(data, list) else [])]

    for project_id, days in grouped:
        project_name = _session_id_to_project(project_id) if project_id else "(unknown)"
        for day in days:
            if not isinstance(day, dict) or "date" not in day:
                continue
            # Flat day records may lack modelBreakdowns — synthesize one from
            # the day-level totals so the usage still lands in the dashboard.
            breakdowns = day.get("modelBreakdowns") or [{
                "modelName": ", ".join(day.get("modelsUsed", [])) or "unknown",
                "inputTokens": day.get("inputTokens", 0),
                "outputTokens": day.get("outputTokens", 0),
                "cacheCreationTokens": day.get("cacheCreationTokens", 0),
                "cacheReadTokens": day.get("cacheReadTokens", 0),
                "cost": day.get("totalCost", 0.0),
            }]
            for breakdown in breakdowns:
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
    cmd = ["npx", "-y", "ccusage@19.0.3", "claude", "session", "--json", "--no-color"]
    raw = _run_command(cmd)
    data = json.loads(raw)

    results: list[SessionUsage] = []
    for s in _rows(data, "sessions"):
        if not isinstance(s, dict) or "sessionId" not in s:
            continue
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
            "record_ts": rec.get("ts"),
        }
    return None


_OAUTH_USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
_OAUTH_CACHE_TTL = 900  # weekly gauges move slowly — refetch after 15 min
_OAUTH_RETRY_INTERVAL = 300  # after a failed attempt, back off for 5 min
_WEEK_SECONDS = 7 * 86400
_ANCHOR_TOLERANCE = 600  # weekly resets sit on the hour; entries of one account differ by <1s


def _own_profile_service(claude_dir: os.PathLike[str] | str | None = None) -> str:
    """The Keychain service name Claude Code uses for the profile we watch.

    The default config dir (~/.claude) keeps its credentials under the
    documented "Claude Code-credentials"; a CLAUDE_CONFIG_DIR profile gets
    "Claude Code-credentials-<sha256(dir)[:8]>" — undocumented, but verified
    2026-08-29: the item written by ~/.claude-max5 carried exactly that
    suffix. The path is hashed as configured (not resolved), since that is
    the string Claude Code sees.
    """
    import hashlib
    from pathlib import Path

    default = Path.home() / ".claude"
    path = Path(claude_dir) if claude_dir else default
    try:
        is_default = path.resolve() == default.resolve()
    except OSError:
        is_default = path == default
    if is_default:
        return "Claude Code-credentials"
    return "Claude Code-credentials-" + hashlib.sha256(str(path).encode("utf-8")).hexdigest()[:8]


def _account_weekly_reset(body: dict) -> float | None:
    """The account-wide weekly reset in a usage-API response, as epoch seconds."""
    for entry in body.get("limits") or []:
        if isinstance(entry, dict) and entry.get("kind") == "weekly_all":
            ts = _parse_iso_utc(entry.get("resets_at"))
            if ts is not None:
                return ts
    seven = body.get("seven_day")
    return _parse_iso_utc(seven.get("resets_at")) if isinstance(seven, dict) else None


def _same_weekly_anchor(a: float, b: float) -> bool:
    """Whether two weekly reset times can belong to the same account.

    Weekly limits reset at a fixed weekday+time assigned per account, so two
    readings of one account differ by a whole number of weeks (the newest
    statusline record may predate a reset the API has already rolled past)
    plus at most a second of jitter between its entries. Two accounts land
    hours apart — or on the same anchor, in which case nothing here can tell
    them apart and nothing here needs to.
    """
    rem = abs(a - b) % _WEEK_SECONDS
    return min(rem, _WEEK_SECONDS - rem) <= _ANCHOR_TOLERANCE


def _weekday_label(ts: float) -> str:
    """A weekly anchor as "Sun 03:00Z" — rounded to the minute, since the
    API's entries carry sub-second jitter (02:59:59.79) around the hour."""
    return datetime.fromtimestamp(round(ts / 60) * 60, timezone.utc).strftime("%a %H:%MZ")


def _oauth_credential_sources(
    claude_dir: os.PathLike[str] | str | None = None,
    notes: list[str] | None = None,
) -> list[dict]:
    """Every place Claude Code may keep its credentials.

    Each entry: {"source": label, "raw": JSON text, "acct": Keychain account or
    None, "mdat": Keychain modification time (ISO) or None, and either
    "service": the Keychain service name or "dir": the config dir the
    .credentials.json came from} — the last two let _read_oauth_tokens tell
    the profile this agent watches from every other profile on the machine.

    macOS: the documented Keychain item is "Claude Code-credentials", but
    "Claude Code-credentials-<hash>" items exist too (one per profile / config
    dir — seen in the wild, not in the docs), and the same service name can
    appear under several accounts. The daemon runs without the user's shell
    env, so rather than trusting CLAUDE_CONFIG_DIR it enumerates every such
    (service, account) pair from dump-keychain (attributes only, never secrets)
    and reads each secret individually. Everywhere: .credentials.json under
    CLAUDE_CONFIG_DIR, the configured claude dir, and ~/.claude.

    `notes`, when given, collects one line per source that yielded nothing —
    the `security` exit code and message tell "item missing" (44) apart from
    "Keychain not reachable from this session" (36, e.g. over SSH) and from a
    permission prompt that timed out, which `cc-telemetry doctor` then shows.
    """
    from pathlib import Path

    def _note(msg: str) -> None:
        if notes is not None:
            notes.append(msg)

    sources: list[dict] = []
    if sys.platform == "darwin":
        items: list[tuple[str, str | None, str | None]] = []
        try:
            dump = subprocess.run(
                ["security", "dump-keychain"],
                capture_output=True,
                text=True,
                timeout=20,
            ).stdout
            for block in dump.split("keychain: ")[1:]:
                svc = re.search(r'"svce"<blob>="(Claude Code-credentials[^"]*)"', block)
                if not svc:
                    continue
                acct = re.search(r'"acct"<blob>="([^"]*)"', block)
                mdat = re.search(r'"mdat"<timedate>=0x[0-9A-Fa-f]+\s+"(\d{14})Z', block)
                mdat_iso = None
                if mdat:
                    d = mdat.group(1)
                    mdat_iso = f"{d[0:4]}-{d[4:6]}-{d[6:8]}T{d[8:10]}:{d[10:12]}:{d[12:14]}+00:00"
                items.append((svc.group(1), acct.group(1) if acct else None, mdat_iso))
        except (OSError, subprocess.TimeoutExpired) as e:
            _note(f"keychain listing failed: {type(e).__name__}")
        if not any(svc == "Claude Code-credentials" for svc, _, _ in items):
            items.insert(0, ("Claude Code-credentials", None, None))  # documented name; try anyway
        if len(items) == 1:
            _note("no Claude Code-credentials-<hash> items in the Keychain")
        seen: set[tuple[str, str | None]] = set()
        for name, acct, mdat_iso in items:
            if (name, acct) in seen:
                continue
            seen.add((name, acct))
            cmd = ["security", "find-generic-password", "-w", "-s", name]
            if acct:
                cmd += ["-a", acct]
            label = f"keychain:{name}" + (f" (acct {acct})" if acct else "")
            try:
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            except subprocess.TimeoutExpired:
                _note(f"{label}: timed out after 10s (a Keychain permission prompt? "
                      "answer it with Always Allow)")
                continue
            except OSError as e:
                _note(f"{label}: {e}")
                continue
            if result.returncode == 0 and result.stdout.strip():
                sources.append({"source": label, "raw": result.stdout.strip(),
                                "acct": acct, "mdat": mdat_iso, "service": name})
            else:
                msg = (result.stderr or "").strip().splitlines()
                _note(f"{label}: rc={result.returncode}" + (f" {msg[-1]}" if msg else ""))
    dirs = [os.environ.get("CLAUDE_CONFIG_DIR"), str(claude_dir) if claude_dir else None,
            str(Path.home() / ".claude")]
    for d in dict.fromkeys(x for x in dirs if x):
        path = Path(d) / ".credentials.json"
        try:
            sources.append({"source": f"file:{path}", "raw": path.read_text(encoding="utf-8"),
                            "acct": None, "mdat": None, "dir": d})
        except OSError:
            _note(f"no {path}")
    return sources


def _read_oauth_tokens(
    claude_dir: os.PathLike[str] | str | None = None,
    notes: list[str] | None = None,
) -> list[dict]:
    """Every Claude Code OAuth access token on this machine, likeliest-right first.

    Each entry: {"token", "source", "expires" (epoch s or 0), "subscription",
    "tier" (rateLimitTier), "scopes", "acct", "mdat", "own"}.

    Order: the profile this agent watches (`own` — the Keychain item or
    .credentials.json belonging to claude_dir) first, then the rest by
    expiresAt, latest first. Own-first because every other figure on the row
    (statusline %, ccusage cost) comes from that profile, so its account is
    the one the model gauges must describe: on 2026-08-29 a second account
    signed in under ~/.claude-max5 had the fresher token, the usage API
    happily accepted it, and the fleet's Fable gauge showed that account's 6%
    while the shared one sat at 82%. Freshest-first only ever told a live
    token from a dead one. The other profiles stay in the list: a profile
    signed out elsewhere can carry an unexpired token the usage API rejects,
    so callers try in order rather than trusting the first entry. A missing
    token is not an error — the caller just skips this cycle.
    """
    from pathlib import Path

    own_service = _own_profile_service(claude_dir)
    own_dir = str(Path(claude_dir) if claude_dir else Path.home() / ".claude")
    found: list[dict] = []
    for src in _oauth_credential_sources(claude_dir, notes):
        try:
            oauth = json.loads(src["raw"]).get("claudeAiOauth") or {}
        except (json.JSONDecodeError, AttributeError):
            if notes is not None:
                notes.append(f"{src['source']}: not credentials JSON")
            continue
        token = oauth.get("accessToken") if isinstance(oauth, dict) else None
        if not token:
            if notes is not None:
                notes.append(f"{src['source']}: no claudeAiOauth.accessToken (API-key login?)")
            continue
        expires = oauth.get("expiresAt")
        found.append({
            "token": str(token),
            "source": src["source"],
            "expires": float(expires) / 1000 if isinstance(expires, (int, float)) else 0.0,
            "subscription": oauth.get("subscriptionType"),
            "tier": oauth.get("rateLimitTier"),
            "scopes": oauth.get("scopes") if isinstance(oauth.get("scopes"), list) else None,
            "acct": src.get("acct"),
            "mdat": src.get("mdat"),
            "own": src.get("service") == own_service
                   or (bool(src.get("dir")) and str(Path(src["dir"])) == own_dir),
        })
    found.sort(key=lambda c: (not c["own"], -c["expires"]))
    return found


def _parse_iso_utc(value: object) -> float | None:
    """ISO-8601 timestamp → epoch seconds, or None when absent/unparseable."""
    if not isinstance(value, str) or not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()


def _current_model_limits(cache: dict, now: float) -> dict | None:
    """The cached per-model entries that still describe the current window.

    A cached reading is served across fetch failures, which is fine for a
    weekly gauge right up to the weekly reset — after it, the reading describes
    the *previous* window. Attached to a fresh row it then outranks every
    machine's live value on the dashboard as "the newest reading, and its
    window already rolled over → 0%". That is exactly what happened on
    2026-08-23~28: one machine's fetch broke on 08-22 and its 100% /
    resets-08-23 Fable entry rode along on new rows for five days while the
    account was really at 65%. An entry past its own resets_at is therefore
    dropped rather than served — an empty column is honest, a stale one lies.

    An entry with no resets_at at all is dropped for the same reason: a cache
    written before 0.3.14 can hold the 0% / resets-null gauge of an account
    whose weekly window had not opened (2026-09-04, see
    _fetch_oauth_model_limits), and served across failures it would zero the
    fleet gauge again.
    """
    limits = cache.get("model_limits")
    if not isinstance(limits, dict):
        return None
    live: dict = {}
    for name, entry in limits.items():
        if not isinstance(entry, dict):
            continue
        resets = _parse_iso_utc(entry.get("resets_at"))
        if resets is None or resets <= now:
            continue
        live[name] = entry
    return live or None


def _scoped_gauges(body: dict, read_at: str) -> tuple[dict, int]:
    """The publishable weekly_scoped gauges in a usage response, and how many
    were dropped for carrying no window of their own.

    A gauge without a resets_at is not a reading of this week — the API opens
    a window on the first call against it — so it is never published. The
    count separates "this account has no model-scoped limits" (nothing to
    drop, a legitimate empty answer) from "every gauge it has is windowless"
    (the account has not called this week; the caller tries another token).
    """
    scoped: dict = {}
    dropped = 0
    for entry in body.get("limits") or []:
        if not isinstance(entry, dict) or entry.get("kind") != "weekly_scoped":
            continue
        model = ((entry.get("scope") or {}).get("model")) or {}
        name = model.get("display_name")
        if not name or entry.get("percent") is None:
            continue
        if _parse_iso_utc(entry.get("resets_at")) is None:
            dropped += 1
            continue
        scoped[str(name).lower()] = {
            "pct": entry.get("percent"),
            "resets_at": entry.get("resets_at"),
            "fetched_at": read_at,
        }
    return scoped, dropped


def _fetch_oauth_model_limits(
    claude_dir: os.PathLike[str] | str | None = None,
    expected_weekly_reset: float | None = None,
) -> dict | None:
    """Per-model weekly gauges (e.g. Fable's 50% cap) from the OAuth usage API.

    The statusline payload only carries the account-wide five_hour/seven_day
    buckets; model-scoped gauges exist only in the `limits[]` array of
    api.anthropic.com/api/oauth/usage as kind="weekly_scoped" entries. That
    endpoint rate-limits aggressively (429 with no Retry-After), so readings
    are cached in <claude_dir>/.cc-telemetry-model-limits.json with a 15-min
    TTL and a 5-min backoff after any failed attempt. A cached reading is
    served across failures only while it still describes the current weekly
    window (see _current_model_limits), and every entry carries the time it
    was actually read as `fetched_at`, so the dashboard can rank readings by
    their own age instead of by the row they happen to ride on.

    `expected_weekly_reset` is the account-wide weekly reset the statusline
    feed reports (epoch seconds) — i.e. the account the rest of the row
    describes. A token whose usage response resets on a different anchor
    belongs to another account signed in on this machine, and is skipped
    like a rejected one.

    A response with no weekly window is skipped too. The API opens a window
    on an account's first call of the week, so a windowless response comes
    from an account that has not called — which the statusline row, being an
    account with a window, is not. Without a statusline anchor to compare
    against, the same response is skipped once its gauges are read instead:
    every one of them windowless means there is nothing here to publish
    whoever it belongs to. (An account with no model-scoped limits at all is
    a different answer, and is still accepted.)

    On 2026-09-04 04:09Z one machine published Fable 0% / resets_at null and
    displaced the shared account's 90% on every dashboard for 76 minutes.
    The daemon log has no failure for that cycle, so the fetch succeeded and
    the response itself carried the 0%: the shared-account token had expired
    overnight (this agent cannot refresh tokens — only running `claude`
    does), the loop fell through to a side profile's live token, and that
    account had not called since its own Thursday reset, so it answered with
    no window and slipped past an anchor check that only compared the
    windows it could see.

    When nothing readable is left the fetch fails (cached in-window reading
    kept, `last_error` says what each token was) rather than publish a gauge
    for the wrong account or for no week at all.

    A scoped entry without a resets_at is never published either (see
    _scoped_gauges), as a second line of defence should a response carry a
    window account-wide but not for this model.

    The cost is real but small: the shared account answers without a window
    too, in the gap between its weekly reset and its first call of the new
    week (2026-08-30 03:36Z, 36 min after the Sunday reset, was one — the
    window was open again by 04:19Z). The column stays empty for that gap
    and fills in on its own; the dashboard reads 0% from the entries whose
    windows just expired, which is the truth right after a reset.

    Failures are recorded in the cache as `last_error` (shown by
    `cc-telemetry doctor`) and logged — a machine that silently never fetches
    contributes nothing and is otherwise indistinguishable from an account
    without scoped limits.

    Returns e.g. {"fable": {"pct": 9, "resets_at": "2026-08-02T03:00:00+00:00",
    "fetched_at": "2026-07-30T01:02:03+00:00"}}, or None when the account has
    no scoped limits or nothing current could be read.
    """
    from pathlib import Path

    base = Path(claude_dir) if claude_dir else (Path.home() / ".claude")
    cache_path = base / ".cc-telemetry-model-limits.json"
    cache: dict = {}
    try:
        loaded = json.loads(cache_path.read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            cache = loaded
    except (OSError, json.JSONDecodeError):
        pass
    now = time.time()

    fetched_at = cache.get("fetched_at")
    if isinstance(fetched_at, (int, float)) and now - fetched_at < _OAUTH_CACHE_TTL:
        return _current_model_limits(cache, now)
    attempted_at = cache.get("attempted_at")
    if (
        isinstance(attempted_at, (int, float))
        and now - attempted_at < _OAUTH_RETRY_INTERVAL
    ):
        return _current_model_limits(cache, now)

    def _save(updates: dict) -> None:
        cache.update(updates)
        try:
            base.mkdir(parents=True, exist_ok=True)
            cache_path.write_text(json.dumps(cache), encoding="utf-8")
        except OSError:
            pass

    def _fail(reason: str) -> dict | None:
        logger.warning("model limits: OAuth usage fetch failed: %s", reason)
        _save({"attempted_at": now, "last_error": reason})
        return _current_model_limits(cache, now)

    notes: list[str] = []
    creds = _read_oauth_tokens(base, notes)
    if not creds:
        return _fail("no OAuth token — " + "; ".join(notes))

    import urllib.error
    import urllib.request

    # A token the usage API rejects (401/403) is a stale profile, and one
    # whose weekly reset sits on another anchor is a different account's —
    # neither is a dead end: the profile this agent watches is tried first,
    # and the live session's token is usually the next candidate. Anything
    # else (429, 5xx, network) is about the endpoint, so stop and back off
    # rather than burn the remaining candidates on it.
    read_at = datetime.fromtimestamp(now, timezone.utc).isoformat()
    data = None
    token_source = ""
    token_tier = None
    anchor: float | None = None
    scoped: dict = {}
    rejected: list[str] = []
    mismatched: list[str] = []
    windowless: list[str] = []
    for cred in creds:
        req = urllib.request.Request(
            _OAUTH_USAGE_URL,
            headers={
                "Authorization": f"Bearer {cred['token']}",
                "anthropic-beta": "oauth-2025-04-20",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                body = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                rejected.append(f"HTTP {e.code} for {cred['source']}")
                continue
            return _fail(f"HTTP {e.code} (token from {cred['source']})")
        except urllib.error.URLError as e:
            return _fail(f"network: {e.reason}")
        except (OSError, json.JSONDecodeError, TimeoutError) as e:
            return _fail(f"{type(e).__name__}: {e}")
        if not isinstance(body, dict):
            return _fail("unexpected response shape")
        anchor = _account_weekly_reset(body)
        plan = cred.get("tier") or cred.get("subscription") or "unknown plan"
        if expected_weekly_reset is not None and (
            anchor is None or not _same_weekly_anchor(anchor, expected_weekly_reset)
        ):
            if anchor is None:
                windowless.append(f"{cred['source']} is {plan}")
            else:
                mismatched.append(
                    f"{cred['source']} is {plan}, weekly resets {_weekday_label(anchor)}"
                )
            continue
        gauges, dropped = _scoped_gauges(body, read_at)
        if dropped and not gauges:
            # Every gauge this account has is windowless, so there is nothing
            # here to publish whoever it belongs to — try the next token
            # rather than caching an empty answer over a good reading.
            windowless.append(f"{cred['source']} is {plan}")
            continue
        data, token_source, token_tier = body, cred["source"], cred.get("tier")
        scoped = gauges
        break
    if data is None:
        # Sources that could not be read at all belong in this verdict too —
        # "the only readable token is dead" reads very differently from "the
        # only token is dead" when a second item timed out on a prompt.
        idle = [f"{w}, no weekly window open" for w in windowless]
        if mismatched and expected_weekly_reset is not None:
            return _fail(
                f"account mismatch — statusline weekly resets {_weekday_label(expected_weekly_reset)}"
                " but " + "; ".join(mismatched + idle + rejected + notes)
            )
        if windowless:
            return _fail("no weekly window open — " + "; ".join(windowless + rejected + notes))
        return _fail("every token rejected — " + "; ".join(rejected + notes))

    result = scoped or None
    _save({
        "fetched_at": now, "attempted_at": now, "model_limits": result,
        "last_error": None, "token_source": token_source, "token_tier": token_tier,
        "account_weekly_reset": (
            datetime.fromtimestamp(anchor, timezone.utc).isoformat() if anchor is not None else None
        ),
    })
    return result


def trim_statusline_log(
    claude_dir: os.PathLike[str] | str | None = None,
    keep_days: int = 8,
) -> int | None:
    """Bound ~/.claude/statusline.jsonl by age — statusline.sh only ever appends.

    Consumers need recent history only: _read_statusline_rate_limit takes the
    newest record, and ccost's fallback views need at most the current weekly
    window, so keep_days=8 preserves both. Unparsable lines are dropped with
    the old records.

    Cheap when idle: only the first record is read, and the rewrite is skipped
    until that record is more than a day past the cutoff — so a steady-state
    file is rewritten about once a day, not on every sync. The rewrite is
    atomic (os.replace); ticks appended between read and replace are lost,
    which is fine — the next statusline tick re-supplies the live reading
    within seconds.

    Returns the number of dropped records, or None when nothing was done.
    """
    from pathlib import Path

    base = Path(claude_dir) if claude_dir else (Path.home() / ".claude")
    path = base / "statusline.jsonl"
    if not path.exists():
        return None
    cutoff = time.time() - keep_days * 86400
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            first = f.readline()
    except OSError:
        return None
    if not first.strip():
        return None
    try:
        first_ts = json.loads(first).get("ts")
        if isinstance(first_ts, (int, float)) and first_ts >= cutoff - 86400:
            return None
    except json.JSONDecodeError:
        pass  # corrupt head — rewrite below drops it, restoring the cheap path

    dropped = 0
    tmp_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", dir=base, suffix=".jsonl", delete=False,
        ) as tmp:
            tmp_name = tmp.name
            with open(path, encoding="utf-8", errors="replace") as f:
                for line in f:
                    if not line.strip():
                        continue
                    try:
                        ts = json.loads(line).get("ts")
                        keep = isinstance(ts, (int, float)) and ts >= cutoff
                    except json.JSONDecodeError:
                        keep = False
                    if keep:
                        tmp.write(line if line.endswith("\n") else line + "\n")
                    else:
                        dropped += 1
        os.replace(tmp_name, path)
    except OSError:
        if tmp_name:
            try:
                os.unlink(tmp_name)
            except OSError:
                pass
        return None
    return dropped


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

    # Model-scoped weekly gauges (Fable 50% cap etc.) only exist on the OAuth
    # usage API — neither statusline nor ccost carries them. Best-effort:
    # None simply leaves the column empty. The statusline's weekly reset is
    # the account the rest of this row describes; the fetch uses it to skip
    # tokens of any other account signed in on this machine.
    expected = sl.get("seven_day_reset") if sl else None
    model_limits = _fetch_oauth_model_limits(
        claude_dir,
        expected_weekly_reset=float(expected) if isinstance(expected, (int, float)) else None,
    )

    if sl is not None:
        # Stamp the row with the statusline record's own time, not the sync
        # time. A daemon re-sync on an idle machine would otherwise launder an
        # hours-old reading into a "fresh" row, letting it outrank genuinely
        # newer readings from other machines on the dashboard (which picks the
        # freshest in-window reading). Repeat syncs of the same reading hit
        # UNIQUE(machine_id, timestamp) and become an upsert that still
        # refreshes model_limits (the OAuth values are live at sync time).
        reading = now
        try:
            reading = datetime.fromtimestamp(sl.get("record_ts"), timezone.utc)
        except (ValueError, TypeError, OSError):
            pass
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
                    5 * 3600 - (sl["five_hour_reset"] - reading.timestamp())
                )
            except (ValueError, TypeError):
                pass
        return [RateLimit(
            timestamp=reading.isoformat(),
            window_5h_percent=sl["five_hour_pct"],
            window_1w_percent=sl["seven_day_pct"],
            session_cost_usd=sl["session_cost"],
            session_duration_seconds=duration_seconds,
            weekly_reset_at=weekly_reset_at,
            model_limits=model_limits,
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
        model_limits=model_limits,
    )]


def collect_blocks_usage() -> list[BlockUsage]:
    """Call `npx ccusage@19.0.3 claude blocks --json --recent` and parse into BlockUsage records."""
    cmd = ["npx", "-y", "ccusage@19.0.3", "claude", "blocks", "--json", "--recent", "--no-color"]
    try:
        raw = _run_command(cmd)
    except CollectorError:
        return []

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []

    results: list[BlockUsage] = []
    for b in _rows(data, "blocks"):
        if not isinstance(b, dict):
            continue
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
