"""Tests for the collector module."""

import json
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from claude_telemetry.collector import (
    collect_daily_usage,
    collect_session_usage,
    collect_rate_limits,
    trim_statusline_log,
    _fetch_oauth_model_limits,
    _oauth_credential_sources,
    _read_oauth_token,
    _read_oauth_tokens,
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
    @pytest.fixture(autouse=True)
    def _no_oauth_fetch(self):
        # collect_rate_limits best-effort-fetches the OAuth usage API for
        # model_limits; never let tests hit the Keychain/network for it.
        with patch(
            "claude_telemetry.collector._fetch_oauth_model_limits",
            return_value=None,
        ):
            yield

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
            "record_ts": 1781080000,
        }

        result = collect_rate_limits()
        assert result is not None
        assert result[0].window_5h_percent == 66
        assert result[0].window_1w_percent == 16
        assert result[0].session_cost_usd == 1.25
        assert result[0].weekly_reset_at is not None

    @patch("claude_telemetry.collector._read_statusline_rate_limit")
    def test_statusline_row_stamped_with_reading_time(self, mock_sl: MagicMock) -> None:
        # The row must carry the statusline record's own time, not the sync
        # time — otherwise an idle machine's daemon re-sync launders an old
        # reading into a "fresh" row that outranks genuinely newer readings
        # from other machines (the off-cycle-reset bug, dashboard-side).
        mock_sl.return_value = {
            "five_hour_pct": 66,
            "seven_day_pct": 16,
            "five_hour_reset": 1781086200,
            "seven_day_reset": 1781406000,
            "session_cost": 1.25,
            "record_ts": 1781080000,
        }

        result = collect_rate_limits()
        assert result is not None
        ts = datetime.fromisoformat(result[0].timestamp)
        assert ts.timestamp() == 1781080000
        # The 5h countdown reconstructs the real reset from the same stamp:
        # timestamp + 5h - duration == five_hour_reset.
        assert (
            ts.timestamp() + 5 * 3600 - result[0].session_duration_seconds
            == 1781086200
        )

    @patch("claude_telemetry.collector._read_statusline_rate_limit")
    def test_statusline_missing_record_ts_falls_back_to_now(self, mock_sl: MagicMock) -> None:
        mock_sl.return_value = {
            "five_hour_pct": 66,
            "seven_day_pct": 16,
            "five_hour_reset": None,
            "seven_day_reset": None,
            "session_cost": None,
            "record_ts": None,
        }

        before = datetime.now(timezone.utc)
        result = collect_rate_limits()
        after = datetime.now(timezone.utc)
        assert result is not None
        ts = datetime.fromisoformat(result[0].timestamp)
        assert before <= ts <= after


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


class TestFetchOauthModelLimits:
    """The OAuth model-limits cache: what gets served when the fetch fails."""

    FUTURE = "2099-01-01T03:00:00+00:00"
    PAST = "2000-01-01T03:00:00+00:00"

    def _seed(self, tmp_path: Path, *, resets_at: str, fetched_at: str = "2000-01-01T00:00:00+00:00") -> Path:
        cache = tmp_path / ".cc-telemetry-model-limits.json"
        cache.write_text(json.dumps({
            "fetched_at": 1.0,  # long past the 15-min TTL
            "attempted_at": 1.0,  # and the 5-min backoff
            "model_limits": {"fable": {"pct": 100, "resets_at": resets_at, "fetched_at": fetched_at}},
        }))
        return cache

    @patch("claude_telemetry.collector._read_oauth_tokens", return_value=[])
    def test_drops_entry_past_its_reset_when_fetch_fails(self, _tok: MagicMock, tmp_path: Path) -> None:
        # The 2026-08-23~28 incident: a machine whose fetch broke kept re-sending
        # last week's 100% on fresh rows, and the dashboard read it as "newest
        # reading, window rolled over → 0%" while the account sat at 65%.
        cache = self._seed(tmp_path, resets_at=self.PAST)

        assert _fetch_oauth_model_limits(tmp_path) is None
        saved = json.loads(cache.read_text())
        assert saved["last_error"].startswith("no OAuth token")
        assert saved["fetched_at"] == 1.0  # a failure never counts as a fetch

    @patch("claude_telemetry.collector._read_oauth_tokens", return_value=[])
    def test_serves_in_window_entry_when_fetch_fails(self, _tok: MagicMock, tmp_path: Path) -> None:
        self._seed(tmp_path, resets_at=self.FUTURE, fetched_at="2026-08-25T18:00:00+00:00")

        result = _fetch_oauth_model_limits(tmp_path)
        assert result == {"fable": {"pct": 100, "resets_at": self.FUTURE,
                                    "fetched_at": "2026-08-25T18:00:00+00:00"}}

    @patch("claude_telemetry.collector._read_oauth_tokens", return_value=[{"token": "tok", "source": "keychain:test", "expires": 0}])
    def test_http_error_is_recorded_and_cached_entry_kept(self, _tok: MagicMock, tmp_path: Path) -> None:
        import urllib.error

        cache = self._seed(tmp_path, resets_at=self.FUTURE)
        err = urllib.error.HTTPError("https://x", 429, "Too Many Requests", {}, None)  # type: ignore[arg-type]
        with patch("urllib.request.urlopen", side_effect=err):
            result = _fetch_oauth_model_limits(tmp_path)

        assert result is not None and result["fable"]["pct"] == 100
        saved = json.loads(cache.read_text())
        assert saved["last_error"].startswith("HTTP 429")
        assert saved["attempted_at"] > saved["fetched_at"]

    def test_rejected_token_falls_through_to_the_next_candidate(self, tmp_path: Path) -> None:
        # 정섭's machine, 2026-08-28: the item with the latest expiresAt was a
        # signed-out profile (401); the live session's token sat in another.
        import urllib.error

        cache = self._seed(tmp_path, resets_at=self.PAST)
        creds = [
            {"token": "stale", "source": "keychain:Claude Code-credentials-38964a7f", "expires": 9e9},
            {"token": "live", "source": "keychain:Claude Code-credentials", "expires": 1.0},
        ]
        body = json.dumps({"limits": [
            {"kind": "weekly_scoped", "percent": 71, "resets_at": self.FUTURE,
             "scope": {"model": {"display_name": "Fable"}}},
        ]}).encode()
        used: list[str] = []

        def fake_urlopen(req, timeout=0):
            used.append(req.get_header("Authorization"))
            if req.get_header("Authorization") == "Bearer stale":
                raise urllib.error.HTTPError("https://x", 401, "Unauthorized", {}, None)  # type: ignore[arg-type]
            resp = MagicMock()
            resp.__enter__.return_value.read.return_value = body
            return resp

        with patch("claude_telemetry.collector._read_oauth_tokens", return_value=creds), \
                patch("urllib.request.urlopen", side_effect=fake_urlopen):
            result = _fetch_oauth_model_limits(tmp_path)

        assert used == ["Bearer stale", "Bearer live"]
        assert result is not None and result["fable"]["pct"] == 71
        saved = json.loads(cache.read_text())
        assert saved["token_source"] == "keychain:Claude Code-credentials"
        assert saved["last_error"] is None

    def test_all_tokens_rejected_names_each(self, tmp_path: Path) -> None:
        import urllib.error

        cache = self._seed(tmp_path, resets_at=self.FUTURE)
        creds = [{"token": "a", "source": "keychain:A", "expires": 2.0},
                 {"token": "b", "source": "file:B", "expires": 1.0}]
        err = urllib.error.HTTPError("https://x", 401, "Unauthorized", {}, None)  # type: ignore[arg-type]
        with patch("claude_telemetry.collector._read_oauth_tokens", return_value=creds), \
                patch("urllib.request.urlopen", side_effect=err):
            result = _fetch_oauth_model_limits(tmp_path)

        assert result is not None and result["fable"]["pct"] == 100  # in-window cache still served
        assert json.loads(cache.read_text())["last_error"] == \
            "every token rejected — HTTP 401 for keychain:A; HTTP 401 for file:B"

    @patch("claude_telemetry.collector._read_oauth_tokens", return_value=[{"token": "tok", "source": "keychain:test", "expires": 0}])
    def test_success_stamps_fetched_at_and_clears_error(self, _tok: MagicMock, tmp_path: Path) -> None:
        cache = self._seed(tmp_path, resets_at=self.PAST)
        body = json.dumps({"limits": [
            {"kind": "weekly_all", "percent": 40, "resets_at": self.FUTURE, "scope": None},
            {"kind": "weekly_scoped", "percent": 65, "resets_at": self.FUTURE,
             "scope": {"model": {"id": None, "display_name": "Fable"}, "surface": None}},
        ]}).encode()
        resp = MagicMock()
        resp.__enter__.return_value.read.return_value = body
        with patch("urllib.request.urlopen", return_value=resp):
            result = _fetch_oauth_model_limits(tmp_path)

        assert result is not None
        fable = result["fable"]
        assert (fable["pct"], fable["resets_at"]) == (65, self.FUTURE)
        # fetched_at is the reading's own time — the dashboard ranks by it, so a
        # cached entry re-sent later must keep the original, not the sync time.
        fetched = datetime.fromisoformat(fable["fetched_at"])
        assert abs((datetime.now(timezone.utc) - fetched).total_seconds()) < 60
        saved = json.loads(cache.read_text())
        assert saved["last_error"] is None
        assert saved["fetched_at"] == saved["attempted_at"]

    @patch("claude_telemetry.collector._read_oauth_token")
    def test_backoff_skips_fetch_but_still_filters_expired(self, tok: MagicMock, tmp_path: Path) -> None:
        cache = tmp_path / ".cc-telemetry-model-limits.json"
        import time as _time
        cache.write_text(json.dumps({
            "fetched_at": 1.0,
            "attempted_at": _time.time() - 10,  # failed 10s ago → inside the backoff
            "model_limits": {"fable": {"pct": 100, "resets_at": self.PAST}},
        }))

        assert _fetch_oauth_model_limits(tmp_path) is None
        tok.assert_not_called()


class TestReadOauthToken:
    """Which of several Claude Code credential stores is the live one."""

    @staticmethod
    def _creds(token: str, expires_ms: int) -> str:
        return json.dumps({"claudeAiOauth": {"accessToken": token, "expiresAt": expires_ms}})

    def test_picks_the_token_with_the_latest_expiry(self) -> None:
        # A CLAUDE_CONFIG_DIR profile beside a stale default-dir item: only the
        # profile in use gets refreshed, so its expiresAt is the later one.
        sources = [
            {"source": "keychain:Claude Code-credentials", "raw": self._creds("stale", 1_000)},
            {"source": "keychain:Claude Code-credentials-2143f80a", "raw": self._creds("live", 2_000)},
            {"source": "file:/x/.credentials.json", "raw": "not json"},
        ]
        with patch("claude_telemetry.collector._oauth_credential_sources", return_value=sources):
            assert _read_oauth_token() == ("live", "keychain:Claude Code-credentials-2143f80a")
            # ...but every token stays available, likeliest-live first
            assert [c["token"] for c in _read_oauth_tokens()] == ["live", "stale"]

    def test_none_when_no_source_has_a_token(self) -> None:
        sources = [{"source": "keychain:Claude Code-credentials", "raw": json.dumps({"claudeAiOauth": {}})}]
        with patch("claude_telemetry.collector._oauth_credential_sources", return_value=sources):
            assert _read_oauth_token() is None

    def test_same_service_under_two_accounts_is_read_per_account(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        dump = (
            'keychain: "/Users/j/Library/Keychains/login.keychain-db"\n'
            '    "acct"<blob>="jimmy"\n    "mdat"<timedate>=0x32303236  "20260820051100Z\\000"\n'
            '    "svce"<blob>="Claude Code-credentials"\n'
            'keychain: "/Users/j/Library/Keychains/login.keychain-db"\n'
            '    "acct"<blob>="work"\n    "mdat"<timedate>=0x32303236  "20260828090000Z\\000"\n'
            '    "svce"<blob>="Claude Code-credentials"\n'
        )
        calls: list[list[str]] = []

        def fake_run(cmd, **_kw):
            calls.append(cmd)
            r = MagicMock()
            if cmd[1] == "dump-keychain":
                r.returncode, r.stdout = 0, dump
            else:
                r.returncode, r.stdout = 0, self._creds(cmd[-1], 1)
            return r

        monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)
        with patch("claude_telemetry.collector.sys") as fake_sys, \
                patch("claude_telemetry.collector.subprocess.run", side_effect=fake_run):
            fake_sys.platform = "darwin"
            sources = _oauth_credential_sources(tmp_path)

        # find-generic-password -s NAME alone returns whichever item comes first;
        # each account is addressed explicitly so neither shadows the other.
        assert [c[-3:] for c in calls if c[1] == "find-generic-password"] == [
            ["Claude Code-credentials", "-a", "jimmy"], ["Claude Code-credentials", "-a", "work"],
        ]
        assert [(x["acct"], x["mdat"]) for x in sources] == [
            ("jimmy", "2026-08-20T05:11:00+00:00"), ("work", "2026-08-28T09:00:00+00:00"),
        ]

    def test_darwin_enumerates_suffixed_keychain_items(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        dump = (
            'keychain: "/Users/j/Library/Keychains/login.keychain-db"\n'
            '    "svce"<blob>="Claude Code-credentials-2143f80a"\n'
            '    "svce"<blob>="Something else"\n'
        )
        calls: list[list[str]] = []

        def fake_run(cmd, **_kw):
            calls.append(cmd)
            r = MagicMock()
            if cmd[1] == "dump-keychain":
                r.returncode, r.stdout = 0, dump
            elif cmd[-1] == "Claude Code-credentials":
                r.returncode, r.stdout = 44, ""  # the default-dir item does not exist
            else:
                r.returncode, r.stdout = 0, self._creds("live", 5)
            return r

        monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)
        with patch("claude_telemetry.collector.sys") as fake_sys, \
                patch("claude_telemetry.collector.subprocess.run", side_effect=fake_run):
            fake_sys.platform = "darwin"
            sources = _oauth_credential_sources(tmp_path)

        assert [cmd[-1] for cmd in calls if cmd[1] == "find-generic-password"] == [
            "Claude Code-credentials", "Claude Code-credentials-2143f80a",
        ]
        assert [(x["source"], x["raw"]) for x in sources] == [
            ("keychain:Claude Code-credentials-2143f80a", self._creds("live", 5)),
        ]

    def test_notes_explain_every_empty_source(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        def fake_run(cmd, **_kw):
            r = MagicMock()
            if cmd[1] == "dump-keychain":
                r.returncode, r.stdout = 0, ""
            else:
                r.returncode, r.stdout = 44, ""
                r.stderr = "security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain."
            return r

        monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)
        notes: list[str] = []
        with patch("claude_telemetry.collector.sys") as fake_sys, \
                patch("claude_telemetry.collector.subprocess.run", side_effect=fake_run):
            fake_sys.platform = "darwin"
            assert _read_oauth_token(tmp_path, notes) is None
        joined = " | ".join(notes)
        assert "no Claude Code-credentials-<hash> items" in joined
        assert "keychain:Claude Code-credentials: rc=44" in joined and "could not be found" in joined
        assert f"no {tmp_path / '.credentials.json'}" in joined

    def test_reads_credentials_file_under_config_dir(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        cfg = tmp_path / "profile"
        cfg.mkdir()
        (cfg / ".credentials.json").write_text(self._creds("filetok", 9))
        monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(cfg))
        with patch("claude_telemetry.collector.sys") as fake_sys:
            fake_sys.platform = "linux"
            sources = _oauth_credential_sources(tmp_path)
        assert {"source": f"file:{cfg / '.credentials.json'}", "raw": self._creds("filetok", 9),
                "acct": None, "mdat": None} in sources
