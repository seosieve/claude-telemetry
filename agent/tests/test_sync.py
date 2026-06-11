"""Tests for ingest 401 handling and the daemon's self-decommission path."""

from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

import claude_telemetry.daemon as daemon
from claude_telemetry.models import RateLimit
from claude_telemetry.sync import IngestAuthError, _post_ingest, sync_rate_limits


def _rate_limit() -> RateLimit:
    return RateLimit(timestamp="2026-06-11T00:00:00+00:00", window_1w_percent=40)


class TestIngestAuthError:
    @patch("claude_telemetry.sync.httpx.post")
    def test_post_ingest_raises_on_401(self, mock_post: MagicMock) -> None:
        mock_post.return_value = MagicMock(status_code=401)

        with pytest.raises(IngestAuthError):
            _post_ingest("ct_dead_key", "rate_limits", [{"timestamp": "x"}])

    @patch("claude_telemetry.sync._post_ingest", side_effect=IngestAuthError("rejected"))
    def test_sync_flags_auth_failure(self, _mock: MagicMock) -> None:
        res = sync_rate_limits([_rate_limit()], "ct_dead_key")
        assert res.auth_failed is True
        assert res.errors

    @patch("claude_telemetry.sync._post_ingest", side_effect=RuntimeError("boom"))
    def test_generic_error_is_not_auth_failure(self, _mock: MagicMock) -> None:
        # Transient failures (network, 5xx) must never advance the
        # decommission counter.
        res = sync_rate_limits([_rate_limit()], "ct_key")
        assert res.auth_failed is False
        assert res.errors


class TestSelfDecommission:
    def test_auth_fail_counter_roundtrip(self, tmp_path: Path, monkeypatch) -> None:
        monkeypatch.setattr(daemon, "AUTH_FAIL_COUNT_FILE", tmp_path / ".auth_fail_count")
        assert daemon._read_auth_fail_count() == 0  # missing file → 0
        daemon._write_auth_fail_count(2)
        assert daemon._read_auth_fail_count() == 2

    def test_writes_flag_and_skips_service_teardown_off_macos(
        self, tmp_path: Path, monkeypatch
    ) -> None:
        flag = tmp_path / ".decommissioned"
        monkeypatch.setattr(daemon, "DECOMMISSION_FLAG", flag)
        monkeypatch.setattr(daemon.platform, "system", lambda: "Linux")

        with patch("claude_telemetry.daemon.subprocess.run") as mock_run:
            daemon._self_decommission()

        assert flag.exists()
        assert "api_key rejected" in flag.read_text()
        mock_run.assert_not_called()  # launchctl teardown is macOS-only

    def test_macos_teardown_removes_plists_and_boots_out(
        self, tmp_path: Path, monkeypatch
    ) -> None:
        flag = tmp_path / ".decommissioned"
        monkeypatch.setattr(daemon, "DECOMMISSION_FLAG", flag)
        monkeypatch.setattr(daemon.platform, "system", lambda: "Darwin")
        agents = tmp_path / "Library/LaunchAgents"
        agents.mkdir(parents=True)
        (agents / "com.cc-telemetry.plist").write_text("x")
        (agents / "com.cc-telemetry.auto-upgrade.plist").write_text("x")
        monkeypatch.setattr(daemon.Path, "home", classmethod(lambda cls: tmp_path))

        with patch("claude_telemetry.daemon.subprocess.run") as mock_run:
            daemon._self_decommission()

        assert flag.exists()
        assert not (agents / "com.cc-telemetry.plist").exists()
        assert not (agents / "com.cc-telemetry.auto-upgrade.plist").exists()
        booted = [c.args[0][2] for c in mock_run.call_args_list]
        # auto-upgrade goes first — otherwise tomorrow's run reinstalls us;
        # our own job last, since its bootout kills the daemon process.
        assert [b.split("/")[-1] for b in booted] == [
            "com.cc-telemetry.auto-upgrade",
            "com.cc-telemetry",
        ]
