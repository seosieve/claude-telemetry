"""Daemon mode — auto-sync loop with backoff, signal handling, and logging."""

from __future__ import annotations

import logging
import os
import platform
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import CONFIG_DIR, DECOMMISSION_FLAG, load_config
from .collector import collect_daily_usage, collect_session_usage, collect_rate_limits, collect_blocks_usage, trim_statusline_log
from .extras import read_stats_cache
from .logging_config import get_rotating_handler, LOG_FMT

logger = logging.getLogger("claude-telemetry-daemon")

# Consecutive all-401 cycles before the daemon decommissions itself. 401 is a
# deliberate server answer ("this machine is not in the fleet"), never a
# transient fault, so a small threshold only guards against a mistaken delete
# being reverted within a couple of hours.
AUTH_FAIL_LIMIT = 3
AUTH_FAIL_COUNT_FILE = CONFIG_DIR / ".auth_fail_count"


def _setup_logging(verbose: bool = False) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logger.setLevel(level)

    try:
        logger.addHandler(get_rotating_handler("daemon.log"))
    except Exception:
        pass

    # Stream handler only if not running windowless (pythonw)
    if sys.executable and not sys.executable.endswith("pythonw.exe"):
        stream_handler = logging.StreamHandler()
        stream_handler.setFormatter(logging.Formatter(LOG_FMT))
        logger.addHandler(stream_handler)


def _run_sync_cycle(config: dict[str, Any]) -> tuple[dict[str, int], str | None, bool]:
    """Run one full sync cycle.

    Returns ({source: records_upserted}, weekly_reset_at|None, auth_failed).
    The weekly reset timestamp lets the daemon wake right after the weekly
    window rolls over; auth_failed is True when the ingest endpoint rejected
    our api_key (machine removed from the fleet — see run_daemon).
    """
    from .sync import sync_daily_usage, sync_sessions, sync_rate_limits, sync_stats_extra, sync_blocks

    api_key = config["api_key"]
    results: dict[str, int] = {}
    auth_failed = False
    # Machine registration / last_sync_at are handled server-side by the ingest
    # endpoint (resolved from api_key), so no DB write here.

    # Daily usage
    since = None
    last = config.get("last_sync", {}).get("daily_usage")
    if last:
        since = last[:10].replace("-", "")
    daily = collect_daily_usage(since=since)
    r = sync_daily_usage(daily, api_key)
    results["daily_usage"] = r.records_upserted
    auth_failed = auth_failed or r.auth_failed
    if r.errors:
        for err in r.errors:
            logger.warning("daily_usage error: %s", err)

    # Sessions
    sessions = collect_session_usage()
    r = sync_sessions(sessions, api_key)
    results["sessions"] = r.records_upserted
    auth_failed = auth_failed or r.auth_failed
    if r.errors:
        for err in r.errors:
            logger.warning("sessions error: %s", err)

    # Keep the statusline feed bounded (statusline.sh only ever appends).
    try:
        dropped = trim_statusline_log(config.get("claude_data_dir"))
        if dropped:
            logger.info("statusline.jsonl: dropped %d old records", dropped)
    except Exception as e:
        logger.warning("statusline trim failed: %s", e)

    # Rate limits (optional). Capture weekly_reset_at so the daemon can wake
    # right after the weekly window rolls over (see run_daemon).
    weekly_reset_at: str | None = None
    if config.get("features", {}).get("ccost_installed"):
        rate_data = collect_rate_limits(
            ccost_path=config.get("features", {}).get("ccost_path"),
            claude_dir=config.get("claude_data_dir"),
        )
        if rate_data:
            r = sync_rate_limits(rate_data, api_key)
            results["rate_limits"] = r.records_upserted
            auth_failed = auth_failed or r.auth_failed
            weekly_reset_at = rate_data[0].weekly_reset_at

    # Stats extra
    claude_dir = Path(config.get("claude_data_dir", str(Path.home() / ".claude")))
    stats = read_stats_cache(claude_dir)
    if stats:
        r = sync_stats_extra(stats, api_key)
        results["stats_extra"] = r.records_upserted
        auth_failed = auth_failed or r.auth_failed

    # Blocks
    blocks = collect_blocks_usage()
    if blocks:
        r = sync_blocks(blocks, api_key)
        results["blocks"] = r.records_upserted
        auth_failed = auth_failed or r.auth_failed

    return results, weekly_reset_at, auth_failed


def _seconds_until_reset(weekly_reset_at: str | None, buffer: float = 90.0) -> float | None:
    """Seconds from now until `buffer` seconds after the weekly reset.

    Returns None when no reset timestamp is known or dateutil is unavailable,
    so the caller falls back to the regular interval.
    """
    if not weekly_reset_at:
        return None
    try:
        from dateutil.parser import isoparse
    except ImportError:
        return None
    try:
        reset_dt = isoparse(weekly_reset_at)
    except (ValueError, TypeError):
        return None
    return (reset_dt - datetime.now(timezone.utc)).total_seconds() + buffer


def _read_auth_fail_count() -> int:
    try:
        return int(AUTH_FAIL_COUNT_FILE.read_text().strip())
    except (OSError, ValueError):
        return 0


def _write_auth_fail_count(n: int) -> None:
    try:
        AUTH_FAIL_COUNT_FILE.parent.mkdir(parents=True, exist_ok=True)
        AUTH_FAIL_COUNT_FILE.write_text(str(n))
    except OSError:
        pass


def _self_decommission() -> None:
    """Go permanently quiet: this machine was removed from the fleet.

    The ingest endpoint rejected our api_key for AUTH_FAIL_LIMIT consecutive
    cycles — a deliberate server answer (machine deleted/deactivated on the
    dashboard), so retrying forever only knocks on a closed door. Writes the
    decommission flag (silences hook_sync and any restarted daemon), then on
    macOS removes both LaunchAgents: auto-upgrade first so tomorrow's run
    can't reinstall us, our own job last — its bootout SIGTERMs this very
    process, which is the intended exit.

    Revival after a mistaken delete: re-register on the dashboard, delete the
    flag, re-run bootstrap.sh (or cc-telemetry install).
    """
    try:
        DECOMMISSION_FLAG.parent.mkdir(parents=True, exist_ok=True)
        DECOMMISSION_FLAG.write_text(
            f"{datetime.now(timezone.utc).isoformat()} "
            f"api_key rejected {AUTH_FAIL_LIMIT} cycles in a row\n"
        )
    except OSError:
        pass
    logger.warning(
        "Machine removed from the fleet (%d consecutive 401s) — decommissioning.",
        AUTH_FAIL_LIMIT,
    )
    if platform.system() != "Darwin":
        return  # the flag alone silences both sync paths; service stays for manual cleanup

    agents_dir = Path.home() / "Library/LaunchAgents"
    uid = os.getuid()
    for label in ("com.cc-telemetry.auto-upgrade", "com.cc-telemetry"):
        try:
            (agents_dir / f"{label}.plist").unlink(missing_ok=True)
        except OSError:
            pass
        # Plist removed first so launchd can't respawn the job (KeepAlive).
        subprocess.run(
            ["launchctl", "bootout", f"gui/{uid}/{label}"],
            capture_output=True,
        )


def run_daemon(interval_minutes: int = 15, verbose: bool = False) -> None:
    """Main daemon loop with exponential backoff on failures."""
    _setup_logging(verbose)

    if DECOMMISSION_FLAG.exists():
        # Removed from the fleet earlier. Re-run the teardown (covers a respawn
        # by a leftover KeepAlive job) and exit without touching the network.
        _self_decommission()
        return

    config = load_config()
    machine_name = config.get("machine_name", "unknown")

    # If hooks are configured, use 60-minute backup interval
    if config.get("features", {}).get("hooks_configured"):
        effective_interval = max(interval_minutes, 60)
        if effective_interval != interval_minutes:
            logger.info(
                "Hooks detected — using %dm backup interval (was %dm)",
                effective_interval, interval_minutes,
            )
            interval_minutes = effective_interval

    logger.info(
        "Daemon starting: machine=%s interval=%dm",
        machine_name, interval_minutes,
    )

    shutdown_requested = False

    def _handle_signal(signum: int, _frame: Any) -> None:
        nonlocal shutdown_requested
        sig_name = signal.Signals(signum).name
        logger.info("Received %s, shutting down gracefully...", sig_name)
        shutdown_requested = True

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    consecutive_failures = 0
    max_backoff = 3600  # 1 hour max

    while not shutdown_requested:
        try:
            # Reload config each cycle (picks up changes)
            config = load_config()
            logger.info("Starting sync cycle...")

            results, weekly_reset_at, auth_failed = _run_sync_cycle(config)

            total = sum(results.values())
            logger.info(
                "Sync complete: %d records (%s)",
                total,
                ", ".join(f"{k}={v}" for k, v in results.items()),
            )
            consecutive_failures = 0

            # Self-decommission on persistent 401s. Other failures (network,
            # 5xx) raise above or land in r.errors without the auth flag, so
            # they never advance this counter.
            if auth_failed:
                fails = _read_auth_fail_count() + 1
                _write_auth_fail_count(fails)
                logger.warning(
                    "ingest rejected api_key (%d/%d consecutive cycles)",
                    fails, AUTH_FAIL_LIMIT,
                )
                if fails >= AUTH_FAIL_LIMIT:
                    _self_decommission()
                    return
            elif total > 0 and _read_auth_fail_count() != 0:
                _write_auth_fail_count(0)

        except Exception as e:
            consecutive_failures += 1
            backoff = min(
                interval_minutes * 60 * (2 ** (consecutive_failures - 1)),
                max_backoff,
            )
            logger.error(
                "Sync failed (attempt %d): %s. Retrying in %ds",
                consecutive_failures, e, backoff,
            )
            _sleep_interruptible(backoff, lambda: shutdown_requested)
            continue

        # Sleep until next cycle. If the weekly rate-limit window rolls over
        # before (or just after) the next regular cycle, wake ~90s past the
        # reset instead, so the refreshed weekly % lands in the dashboard right
        # away. This fires at most once per week — after the reset sync,
        # weekly_reset_at jumps to the next window and we revert to the interval.
        sleep_seconds = interval_minutes * 60
        reset_wake = _seconds_until_reset(weekly_reset_at)
        if reset_wake is not None and 0 < reset_wake <= sleep_seconds + 600:
            logger.info(
                "Weekly reset at %s — scheduling refresh in %ds",
                weekly_reset_at, int(reset_wake),
            )
            sleep_seconds = reset_wake
        else:
            logger.debug("Next sync in %dm", interval_minutes)
        _sleep_interruptible(sleep_seconds, lambda: shutdown_requested)

    logger.info("Daemon stopped.")


def _sleep_interruptible(seconds: float, should_stop: Any) -> None:
    """Sleep in 1-second increments to allow graceful shutdown."""
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if should_stop():
            break
        time.sleep(min(1.0, end - time.monotonic()))


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("interval", type=int, nargs="?", default=15)
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()
    run_daemon(interval_minutes=args.interval, verbose=args.verbose)
