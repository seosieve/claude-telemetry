"""Tests for the extras module."""

from pathlib import Path

from claude_tracker.extras import read_stats_cache, read_history_index

FIXTURES = Path(__file__).parent / "fixtures"


class TestReadStatsCache:
    def test_reads_stats_cache(self) -> None:
        result = read_stats_cache(FIXTURES)

        assert result is not None
        assert result.total_sessions == 42
        assert result.total_messages == 1500
        assert result.longest_session_messages == 350
        assert result.longest_session_duration_ms == 7200000
        assert result.first_session_date == "2026-01-01T00:00:00Z"

    def test_reads_hour_counts(self) -> None:
        result = read_stats_cache(FIXTURES)

        assert result is not None
        assert result.hour_counts is not None
        assert result.hour_counts["14"] == 80

    def test_reads_daily_activity(self) -> None:
        result = read_stats_cache(FIXTURES)

        assert result is not None
        assert result.daily_activity is not None
        assert len(result.daily_activity) == 2
        assert result.daily_activity[0]["messageCount"] == 200

    def test_reads_model_usage(self) -> None:
        result = read_stats_cache(FIXTURES)

        assert result is not None
        assert result.model_usage is not None
        assert len(result.model_usage) == 1

    def test_returns_none_for_missing_dir(self, tmp_path: Path) -> None:
        result = read_stats_cache(tmp_path / "nonexistent")
        assert result is None

    def test_returns_none_for_missing_file(self, tmp_path: Path) -> None:
        result = read_stats_cache(tmp_path)
        assert result is None


class TestReadHistoryIndex:
    def test_reads_history_jsonl(self) -> None:
        entries = read_history_index(FIXTURES)

        assert len(entries) == 3
        assert entries[0]["sessionId"] == "abc123"
        assert entries[1]["project"] == "other-project"
        assert entries[2]["startedAt"] == "2026-04-02T09:00:00Z"

    def test_returns_empty_for_missing_file(self, tmp_path: Path) -> None:
        entries = read_history_index(tmp_path)
        assert entries == []

    def test_skips_invalid_json_lines(self, tmp_path: Path) -> None:
        history_file = tmp_path / "history.jsonl"
        history_file.write_text(
            '{"sessionId": "valid"}\n'
            'not json at all\n'
            '{"sessionId": "also-valid"}\n'
        )

        entries = read_history_index(tmp_path)
        assert len(entries) == 2
        assert entries[0]["sessionId"] == "valid"
        assert entries[1]["sessionId"] == "also-valid"

    def test_skips_blank_lines(self, tmp_path: Path) -> None:
        history_file = tmp_path / "history.jsonl"
        history_file.write_text(
            '{"sessionId": "one"}\n'
            '\n'
            '   \n'
            '{"sessionId": "two"}\n'
        )

        entries = read_history_index(tmp_path)
        assert len(entries) == 2
