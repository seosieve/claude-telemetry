"""Sync module — sends collected data to Supabase."""

from __future__ import annotations

import time
from dataclasses import asdict
from datetime import datetime, timezone
from typing import Any

from supabase import create_client, Client

from .config import load_config, update_last_sync, get_last_sync
from .models import DailyUsage, SessionUsage, RateLimit, StatsExtra, SyncResult


def _get_client(config: dict[str, Any]) -> Client:
    return create_client(config["supabase_url"], config["supabase_service_key"])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def sync_daily_usage(
    records: list[DailyUsage],
    machine_id: str,
    client: Client,
    force: bool = False,
) -> SyncResult:
    """Upsert daily usage records to Supabase."""
    start = time.monotonic()
    errors: list[str] = []
    upserted = 0

    last_sync = None if force else get_last_sync("daily_usage")

    for record in records:
        if last_sync and record.date <= last_sync[:10]:
            continue
        row = {
            "machine_id": machine_id,
            "date": record.date,
            "project": record.project,
            "model": record.model,
            "input_tokens": record.input_tokens,
            "output_tokens": record.output_tokens,
            "cache_creation_tokens": record.cache_creation_tokens,
            "cache_read_tokens": record.cache_read_tokens,
            "total_tokens": record.total_tokens,
            "cost_usd": record.cost_usd,
        }
        try:
            client.table("daily_usage").upsert(
                row,
                on_conflict="machine_id,date,project,model",
            ).execute()
            upserted += 1
        except Exception as e:
            errors.append(f"daily_usage {record.date}/{record.project}/{record.model}: {e}")

    elapsed = int((time.monotonic() - start) * 1000)
    now = _now_iso()

    if not errors:
        update_last_sync("daily_usage", now)

    _log_sync(client, machine_id, "daily_usage", upserted, errors, elapsed)

    return SyncResult(
        source="daily_usage",
        records_upserted=upserted,
        errors=errors,
        duration_ms=elapsed,
    )


def sync_sessions(
    records: list[SessionUsage],
    machine_id: str,
    client: Client,
    force: bool = False,
) -> SyncResult:
    """Upsert session records to Supabase."""
    start = time.monotonic()
    errors: list[str] = []
    upserted = 0

    for record in records:
        row = {
            "machine_id": machine_id,
            "session_id": record.session_id,
            "project": record.project,
            "project_path": record.project_path,
            "models": record.models,
            "is_subagent": record.is_subagent,
            "input_tokens": record.input_tokens,
            "output_tokens": record.output_tokens,
            "cache_creation_tokens": record.cache_creation_tokens,
            "cache_read_tokens": record.cache_read_tokens,
            "total_tokens": record.total_tokens,
            "cost_usd": record.cost_usd,
            "last_activity_at": record.last_activity_at,
        }
        try:
            client.table("sessions").upsert(
                row,
                on_conflict="machine_id,session_id",
            ).execute()
            upserted += 1
        except Exception as e:
            errors.append(f"session {record.session_id}: {e}")

    elapsed = int((time.monotonic() - start) * 1000)
    now = _now_iso()

    if not errors:
        update_last_sync("sessions", now)

    _log_sync(client, machine_id, "sessions", upserted, errors, elapsed)

    return SyncResult(
        source="sessions",
        records_upserted=upserted,
        errors=errors,
        duration_ms=elapsed,
    )


def sync_rate_limits(
    records: list[RateLimit],
    machine_id: str,
    client: Client,
) -> SyncResult:
    """Upsert rate limit records to Supabase."""
    start = time.monotonic()
    errors: list[str] = []
    upserted = 0

    for record in records:
        row = {
            "machine_id": machine_id,
            "timestamp": record.timestamp,
            "window_5h_percent": record.window_5h_percent,
            "window_1w_percent": record.window_1w_percent,
            "session_cost_usd": record.session_cost_usd,
            "session_duration_seconds": record.session_duration_seconds,
        }
        try:
            client.table("rate_limits").upsert(
                row,
                on_conflict="machine_id,timestamp",
            ).execute()
            upserted += 1
        except Exception as e:
            errors.append(f"rate_limit {record.timestamp}: {e}")

    elapsed = int((time.monotonic() - start) * 1000)
    now = _now_iso()

    if not errors:
        update_last_sync("rate_limits", now)

    _log_sync(client, machine_id, "rate_limits", upserted, errors, elapsed)

    return SyncResult(
        source="rate_limits",
        records_upserted=upserted,
        errors=errors,
        duration_ms=elapsed,
    )


def sync_stats_extra(
    stats: StatsExtra,
    machine_id: str,
    client: Client,
) -> SyncResult:
    """Upsert stats_extra record to Supabase."""
    start = time.monotonic()
    errors: list[str] = []
    upserted = 0

    row = {
        "machine_id": machine_id,
        "total_sessions": stats.total_sessions,
        "total_messages": stats.total_messages,
        "longest_session_messages": stats.longest_session_messages,
        "longest_session_duration_ms": stats.longest_session_duration_ms,
        "first_session_date": stats.first_session_date,
        "hour_counts": stats.hour_counts,
        "daily_activity": stats.daily_activity,
        "model_usage": stats.model_usage,
    }
    try:
        client.table("stats_extra").insert(row).execute()
        upserted = 1
    except Exception as e:
        errors.append(f"stats_extra: {e}")

    elapsed = int((time.monotonic() - start) * 1000)
    now = _now_iso()

    if not errors:
        update_last_sync("stats_extra", now)

    _log_sync(client, machine_id, "stats_extra", upserted, errors, elapsed)

    return SyncResult(
        source="stats_extra",
        records_upserted=upserted,
        errors=errors,
        duration_ms=elapsed,
    )


def _log_sync(
    client: Client,
    machine_id: str,
    source: str,
    records_upserted: int,
    errors: list[str],
    duration_ms: int,
) -> None:
    """Write an entry to sync_log and update machine last_sync_at."""
    try:
        client.table("sync_log").insert({
            "machine_id": machine_id,
            "source": source,
            "records_upserted": records_upserted,
            "errors": errors if errors else None,
            "duration_ms": duration_ms,
        }).execute()

        client.table("machines").update({
            "last_sync_at": _now_iso(),
        }).eq("id", machine_id).execute()
    except Exception:
        pass  # Best-effort logging
