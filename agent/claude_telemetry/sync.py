"""Sync module — POST collected data to the dashboard ingest endpoint.

Agents no longer talk to the database directly. Each sync_* function ships its
rows to POST /api/ingest authenticated with the machine's api_key; the endpoint
resolves machine_id from the key and performs the upsert (plus sync_log /
last_sync_at bookkeeping) server-side. The DB credential never leaves the server.
"""

from __future__ import annotations

import logging
import time
from dataclasses import asdict
from datetime import datetime, timezone

import httpx

from .config import update_last_sync, get_last_sync, INGEST_BASE_URL
from .models import (
    DailyUsage,
    SessionUsage,
    RateLimit,
    StatsExtra,
    BlockUsage,
    SyncResult,
)

logger = logging.getLogger("claude-telemetry")

_INGEST_TIMEOUT = 60


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _post_ingest(api_key: str, kind: str, rows: list[dict]) -> dict:
    """POST rows to the ingest endpoint. Raises on non-2xx."""
    resp = httpx.post(
        f"{INGEST_BASE_URL}/api/ingest",
        headers={"Authorization": f"Bearer {api_key}"},
        json={"kind": kind, "rows": rows},
        timeout=_INGEST_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()


def sync_daily_usage(
    records: list[DailyUsage], api_key: str, force: bool = False
) -> SyncResult:
    start = time.monotonic()
    errors: list[str] = []
    upserted = 0

    last_sync = None if force else get_last_sync("daily_usage")

    rows: list[dict] = []
    for record in records:
        if last_sync and record.date < last_sync[:10]:
            continue
        rows.append(asdict(record))

    # Deduplicate by (date, project, model) keeping highest cost — a multi-row
    # upsert can't touch the same ON CONFLICT key twice.
    seen: dict[tuple, dict] = {}
    for row in rows:
        key = (row["date"], row["project"], row["model"])
        if key not in seen or row.get("cost_usd", 0) > seen[key].get("cost_usd", 0):
            seen[key] = row
    rows = list(seen.values())

    if rows:
        try:
            res = _post_ingest(api_key, "daily_usage", rows)
            upserted = res.get("upserted", len(rows))
        except Exception as e:
            errors.append(f"daily_usage: {e}")

    elapsed = int((time.monotonic() - start) * 1000)
    if not errors:
        update_last_sync("daily_usage", _now_iso())
    return SyncResult("daily_usage", upserted, errors, elapsed)


def sync_sessions(
    records: list[SessionUsage], api_key: str, force: bool = False
) -> SyncResult:
    start = time.monotonic()
    errors: list[str] = []
    upserted = 0

    rows = [asdict(r) for r in records]
    seen: dict[str, dict] = {}
    for row in rows:
        key = row["session_id"]
        if key not in seen or row.get("cost_usd", 0) > seen[key].get("cost_usd", 0):
            seen[key] = row
    rows = list(seen.values())

    if rows:
        try:
            res = _post_ingest(api_key, "sessions", rows)
            upserted = res.get("upserted", len(rows))
        except Exception as e:
            errors.append(f"sessions: {e}")

    elapsed = int((time.monotonic() - start) * 1000)
    if not errors:
        update_last_sync("sessions", _now_iso())
    return SyncResult("sessions", upserted, errors, elapsed)


def sync_rate_limits(records: list[RateLimit], api_key: str) -> SyncResult:
    start = time.monotonic()
    errors: list[str] = []
    upserted = 0

    rows = [asdict(r) for r in records]
    if rows:
        try:
            res = _post_ingest(api_key, "rate_limits", rows)
            upserted = res.get("upserted", len(rows))
        except Exception as e:
            errors.append(f"rate_limits: {e}")

    elapsed = int((time.monotonic() - start) * 1000)
    if not errors:
        update_last_sync("rate_limits", _now_iso())
    return SyncResult("rate_limits", upserted, errors, elapsed)


def sync_stats_extra(stats: StatsExtra, api_key: str) -> SyncResult:
    start = time.monotonic()
    errors: list[str] = []
    upserted = 0

    try:
        res = _post_ingest(api_key, "stats_extra", [asdict(stats)])
        upserted = res.get("upserted", 1)
    except Exception as e:
        errors.append(f"stats_extra: {e}")

    elapsed = int((time.monotonic() - start) * 1000)
    if not errors:
        update_last_sync("stats_extra", _now_iso())
    return SyncResult("stats_extra", upserted, errors, elapsed)


def sync_blocks(records: list[BlockUsage], api_key: str) -> SyncResult:
    start = time.monotonic()
    errors: list[str] = []
    upserted = 0

    rows = [asdict(r) for r in records]
    # Deduplicate by block_start. The "deactivate stale active blocks" step now
    # lives server-side in the ingest handler.
    seen: dict[str, dict] = {}
    for row in rows:
        key = row["block_start"]
        if key not in seen or row.get("cost_usd", 0) > seen[key].get("cost_usd", 0):
            seen[key] = row
    rows = list(seen.values())

    if rows:
        try:
            res = _post_ingest(api_key, "blocks", rows)
            upserted = res.get("upserted", len(rows))
        except Exception as e:
            errors.append(f"blocks: {e}")

    elapsed = int((time.monotonic() - start) * 1000)
    return SyncResult("blocks", upserted, errors, elapsed)
