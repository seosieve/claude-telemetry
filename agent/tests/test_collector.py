"""Tests for the collector module."""

import json
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from claude_telemetry.collector import (
    collect_daily_usage,
    collect_session_usage,
    collect_rate_limits,
    trim_statusline_log,
    _detect_subagent,
    _session_id_to_project,
    CollectorError,
)

FIXTURES = Path(__file__).parent / "fixtures"


def _load_fixture(name: str) -> str:
    return (FIXTURES / name).read_text()


class TestCollectDailyUsage:
    @patch("claude_telemetry.collector._run_command")
    def test_parses_daily_instances(self, mock_run: MagicMock) -> None:
        mock_run.return_value = _load_fixture("daily_instances.json")

        records = collect_daily_usage()

        # 2 models for day 1 of project 1, 1 model for day 2, 1 model for paperclip
        assert len(records) == 4

        # Check first record (sonnet on day 1)
        sonnet = [r for r in records if r.model == "claude-sonnet-4-6" and r.date == "2026-04-01"]
        assert len(sonnet) == 1
        assert sonnet[0].input_tokens == 1235
        assert sonnet[0].output_tokens == 23586
        assert sonnet[0].cost_usd == 5.7333

        # Check opus record
        opus = [r for r in records if r.model == "claude-opus-4-6" and r.date == "2026-04-01" and r.project != "Paperclip"]
        assert len(opus) == 1
        assert opus[0].cost_usd == 3.1182

    @patch("claude_telemetry.collector._run_command")
    def test_paperclip_grouped_as_project(self, mock_run: MagicMock) -> None:
        mock_run.return_value = _load_fixture("daily_instances.json")

        records = collect_daily_usage()
        paperclip = [r for r in records if r.project == "Paperclip"]
        assert len(paperclip) == 1
        assert paperclip[0].cost_usd == 0.25

    @patch("claude_telemetry.collector._run_command")
    def test_passes_since_flag(self, mock_run: MagicMock) -> None:
        mock_run.return_value = '{"projects": {}}'

        collect_daily_usage(since="20260401")

        call_args = mock_run.call_args[0][0]
        assert "--since" in call_args
        assert "20260401" in call_args

    @patch("claude_telemetry.collector._run_command")
    def test_calculates_total_tokens(self, mock_run: MagicMock) -> None:
        mock_run.return_value = _load_fixture("daily_instances.json")

        records = collect_daily_usage()
        for r in records:
            expected = r.input_tokens + r.output_tokens + r.cache_creation_tokens + r.cache_read_tokens
            assert r.total_tokens == expected

    @patch("claude_telemetry.collector._run_command")
    def test_raises_on_command_failure(self, mock_run: MagicMock) -> None:
        mock_run.side_effect = CollectorError("ccusage daily failed")

        with pytest.raises(CollectorError):
            collect_daily_usage()


class TestCollectSessionUsage:
    @patch("claude_telemetry.collector._run_command")
    def test_parses_sessions(self, mock_run: MagicMock) -> None:
        mock_run.return_value = _load_fixture("session_output.json")

        records = collect_session_usage()

        assert len(records) == 2
        assert records[0].session_id == "C--Users-RyanS-Documents-my-project"
        assert records[0].total_tokens == 623000
        assert records[0].cost_usd == 4.5
        assert records[0].models == ["claude-opus-4-6", "claude-sonnet-4-6"]

    @patch("claude_telemetry.collector._run_command")
    def test_detects_subagent(self, mock_run: MagicMock) -> None:
        mock_run.return_value = _load_fixture("session_output.json")

        records = collect_session_usage()

        regular = records[0]
        paperclip = records[1]
        assert regular.is_subagent is False
        assert paperclip.is_subagent is True
        assert paperclip.project == "Paperclip"

    @patch("claude_telemetry.collector._run_command")
    def test_preserves_last_activity(self, mock_run: MagicMock) -> None:
        mock_run.return_value = _load_fixture("session_output.json")

        records = collect_session_usage()
        assert records[0].last_activity_at == "2026-04-01"


class TestCollectRateLimits:
    @patch("claude_telemetry.collector._read_statusline_rate_limit", return_value=None)
    @patch("claude_telemetry.collector._run_command")
    def test_returns_none_when_not_installed(self, mock_run: MagicMock, _mock_sl: MagicMock) -> None:
        mock_run.side_effect = FileNotFoundError

        result = collect_rate_limits()
        assert result is None

    @patch("claude_telemetry.collector._read_statusline_rate_limit", return_value=None)
    @patch("claude_telemetry.collector._run_command")
    def test_returns_none_on_error(self, mock_run: MagicMock, _mock_sl: MagicMock) -> None:
        mock_run.side_effect = CollectorError("ccost failed")

        result = collect_rate_limits()
        assert result is None

    @patch("claude_telemetry.collector._read_statusline_rate_limit", return_value=None)
    @patch("claude_telemetry.collector._find_ccost", return_value="ccost")
    @patch("claude_telemetry.collector._ccost_view")
    def test_parses_rate_limit_data(self, mock_view: MagicMock, _mock_find: MagicMock, _mock_sl: MagicMock) -> None:
        # Wide windows so they're always "active" regardless of the current time.
        # maxSevenDayPct is a per-window PEAK. On a regular weekly reset the 5h
        # window straddling the reset stays peaked (90) while the 1w window is
        # already fresh (8.2). collect_rate_limits reports the min of the two
        # active windows, so the fresh value (8.2) wins.
        view_5h = {"data": [{
            "windowStart": "2020-01-01T00:00:00Z",
            "windowEnd": "2099-01-01T00:00:00Z",
            "maxFiveHourPct": 15.5,
            "maxSevenDayPct": 90.0,
            "totalCost": 1.50,
        }]}
        view_1w = {"data": [{
            "windowStart": "2020-01-01T00:00:00Z",
            "windowEnd": "2099-01-01T00:00:00Z",
            "maxSevenDayPct": 8.2,
        }]}
        mock_view.side_effect = lambda _bin, per: view_5h if per == "5h" else view_1w

        result = collect_rate_limits()
        assert result is not None
        assert len(result) == 1
        assert result[0].window_5h_percent == 15.5
        # weekly % is min(5h peak 90, 1w 8.2) → the fresh 1w value
        assert result[0].window_1w_percent == 8.2
        assert result[0].weekly_reset_at == "2099-01-01T00:00:00+00:00"
        assert result[0].session_cost_usd == 1.50

    @patch("claude_telemetry.collector._read_statusline_rate_limit", return_value=None)
    @patch("claude_telemetry.collector._find_ccost", return_value="ccost")
    @patch("claude_telemetry.collector._ccost_view")
    def test_weekly_pct_offcycle_reset_prefers_fresh_window(
        self, mock_view: MagicMock, _mock_find: MagicMock, _mock_sl: MagicMock
    ) -> None:
        # Off-cycle reset (e.g. a mid-week limit refresh that doesn't align with
        # the fixed weekly window): the 1w window keeps its pre-reset peak (43)
        # while the post-reset 5h window is fresh (6). min() must pick the fresh
        # 5h value so the dashboard reflects the reset immediately.
        view_5h = {"data": [{
            "windowStart": "2020-01-01T00:00:00Z",
            "windowEnd": "2099-01-01T00:00:00Z",
            "maxFiveHourPct": 13.0,
            "maxSevenDayPct": 6.0,
            "totalCost": 1.0,
        }]}
        view_1w = {"data": [{
            "windowStart": "2020-01-01T00:00:00Z",
            "windowEnd": "2099-01-01T00:00:00Z",
            "maxSevenDayPct": 43.0,
        }]}
        mock_view.side_effect = lambda _bin, per: view_5h if per == "5h" else view_1w

        result = collect_rate_limits()
        assert result is not None
        assert result[0].window_1w_percent == 6.0

    @patch("claude_telemetry.collector._read_statusline_rate_limit")
    def test_prefers_statusline_live_value(self, mock_sl: MagicMock) -> None:
        # The statusline feed carries the API's live usage. collect_rate_limits
        # uses it directly (no ccost window aggregation), so a reset is reflected
        # immediately even on a single machine.
        mock_sl.return_value = {
            "five_hour_pct": 66,
            "seven_day_pct": 16,
            "five_hour_reset": 1781086200,
            "seven_day_reset": 1781406000,
            "session_cost": 1.25,
        }

        result = collect_rate_limits()
        assert result is not None
        assert result[0].window_5h_percent == 66
        assert result[0].window_1w_percent == 16
        assert result[0].session_cost_usd == 1.25
        assert result[0].weekly_reset_at is not None


class TestHelpers:
    def test_detect_subagent_paperclip(self) -> None:
        assert _detect_subagent("C--Users-RyanS--paperclip-instances-default-workspaces-abc123") is True

    def test_detect_subagent_regular(self) -> None:
        assert _detect_subagent("C--Users-RyanS-Documents-my-project") is False

    def test_session_id_to_project_documents(self) -> None:
        result = _session_id_to_project("C--Users-RyanS-Documents-my-project")
        assert result == "my-project"

    def test_session_id_to_project_paperclip(self) -> None:
        result = _session_id_to_project("C--Users-RyanS--paperclip-instances-default-workspaces-abc123")
        assert result == "Paperclip"

    def test_session_id_to_project_projects_dir(self) -> None:
        result = _session_id_to_project("C--Users-RyanS-Projects-my-app")
        assert result == "my-app"


class TestTrimStatuslineLog:
    def _write(self, path: Path, ts_list: list[float], garbage: bool = False) -> None:
        lines = [json.dumps({"ts": ts, "data": {"n": i}}) for i, ts in enumerate(ts_list)]
        if garbage:
            lines.insert(1, "not json {{{")
        (path / "statusline.jsonl").write_text("\n".join(lines) + "\n")

    def test_skips_fresh_file(self, tmp_path: Path) -> None:
        import time
        now = time.time()
        self._write(tmp_path, [now - 3600, now])

        assert trim_statusline_log(tmp_path) is None
        assert len((tmp_path / "statusline.jsonl").read_text().splitlines()) == 2

    def test_drops_old_and_garbage_keeps_recent(self, tmp_path: Path) -> None:
        import time
        now = time.time()
        old = now - 20 * 86400
        self._write(tmp_path, [old, old + 60, now - 3600, now], garbage=True)

        dropped = trim_statusline_log(tmp_path, keep_days=8)
        assert dropped == 3  # two old records + one garbage line

        kept = (tmp_path / "statusline.jsonl").read_text().splitlines()
        assert len(kept) == 2
        assert all(json.loads(line)["ts"] >= now - 8 * 86400 for line in kept)

        # After the rewrite the head is fresh, so the next call is a no-op.
        assert trim_statusline_log(tmp_path, keep_days=8) is None

    def test_missing_or_empty_file(self, tmp_path: Path) -> None:
        assert trim_statusline_log(tmp_path) is None  # no file
        (tmp_path / "statusline.jsonl").write_text("")
        assert trim_statusline_log(tmp_path) is None  # empty file
