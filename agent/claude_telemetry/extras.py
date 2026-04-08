"""Read extra data sources that ccusage/ccost don't cover."""

from __future__ import annotations

import json
from pathlib import Path

from .models import StatsExtra


def read_stats_cache(claude_dir: Path) -> StatsExtra | None:
    """
    Read ~/.claude/stats-cache.json.
    Contains: hourCounts, longestSession, firstSessionDate,
    dailyActivity (messageCount, toolCallCount), modelUsage.
    """
    path = claude_dir / "stats-cache.json"
    if not path.exists():
        return None

    with open(path) as f:
        data = json.load(f)

    return StatsExtra(
        total_sessions=data.get("totalSessions"),
        total_messages=data.get("totalMessages"),
        longest_session_messages=data.get("longestSessionMessages"),
        longest_session_duration_ms=data.get("longestSessionDurationMs"),
        first_session_date=data.get("firstSessionDate"),
        hour_counts=data.get("hourCounts"),
        daily_activity=data.get("dailyActivity"),
        model_usage=data.get("dailyModelTokens"),
    )


def read_history_index(claude_dir: Path) -> list[dict]:
    """
    Read ~/.claude/history.jsonl — global session index.
    Each line is a JSON object with session metadata.
    """
    path = claude_dir / "history.jsonl"
    if not path.exists():
        return []

    entries: list[dict] = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                continue

    return entries
