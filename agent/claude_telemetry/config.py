"""Configuration management for Claude Usage Tracker."""

from __future__ import annotations

import json
import os
import platform
import uuid
from pathlib import Path
from typing import Any


CONFIG_DIR = Path.home() / ".claude-telemetry"
CONFIG_FILE = CONFIG_DIR / "config.json"

# Agents POST telemetry to the dashboard's ingest endpoint instead of writing to
# the database directly. Hardcoded here (not in config.json) so swapping the DB
# never requires touching each PC's config — auth is the machines.api_key that
# is already stored in config.json.
INGEST_BASE_URL = "https://claude-ricegang.pages.dev"

DEFAULT_CONFIG: dict[str, Any] = {
    "machine_id": None,
    "machine_name": None,
    "api_key": None,
    "claude_data_dir": str(Path.home() / ".claude"),
    "sync_interval_minutes": 15,
    "last_sync": {
        "daily_usage": None,
        "sessions": None,
        "rate_limits": None,
        "stats_extra": None,
    },
    "features": {
        "ccost_installed": False,
    },
}


def detect_os() -> str:
    system = platform.system()
    if system == "Windows":
        return f"Windows {platform.version()}"
    elif system == "Darwin":
        return f"macOS {platform.mac_ver()[0]}"
    return f"Linux {platform.release()}"


def detect_claude_data_dir() -> Path:
    return Path.home() / ".claude"


def generate_api_key() -> str:
    return f"ct_{uuid.uuid4().hex}"


def load_config() -> dict[str, Any]:
    if not CONFIG_FILE.exists():
        raise FileNotFoundError(
            f"Config not found at {CONFIG_FILE}. Run 'cc-telemetry setup' first."
        )
    with open(CONFIG_FILE) as f:
        return json.load(f)


def save_config(config: dict[str, Any]) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    # config.json holds the api_key, so keep the
    # directory and file owner-only (0700/0600). No-op on Windows.
    try:
        os.chmod(CONFIG_DIR, 0o700)
    except OSError:
        pass
    # Write to a temp file then atomically replace, so a crash mid-write can't
    # leave a truncated config.json that breaks every subsequent sync.
    tmp = CONFIG_FILE.with_name(CONFIG_FILE.name + ".tmp")
    with open(tmp, "w") as f:
        json.dump(config, f, indent=2)
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    os.replace(tmp, CONFIG_FILE)


def update_last_sync(source: str, timestamp: str) -> None:
    config = load_config()
    config["last_sync"][source] = timestamp
    save_config(config)


def get_last_sync(source: str) -> str | None:
    config = load_config()
    return config.get("last_sync", {}).get(source)
