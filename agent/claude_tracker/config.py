"""Configuration management for Claude Usage Tracker."""

from __future__ import annotations

import json
import platform
import uuid
from pathlib import Path
from typing import Any


CONFIG_DIR = Path.home() / ".claude-tracker"
CONFIG_FILE = CONFIG_DIR / "config.json"

DEFAULT_CONFIG: dict[str, Any] = {
    "machine_id": None,
    "machine_name": None,
    "supabase_url": None,
    "supabase_service_key": None,
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


def generate_machine_id() -> str:
    return str(uuid.uuid4())


def generate_api_key() -> str:
    return f"ct_{uuid.uuid4().hex}"


def load_config() -> dict[str, Any]:
    if not CONFIG_FILE.exists():
        raise FileNotFoundError(
            f"Config not found at {CONFIG_FILE}. Run 'claude-tracker setup' first."
        )
    with open(CONFIG_FILE) as f:
        return json.load(f)


def save_config(config: dict[str, Any]) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_FILE, "w") as f:
        json.dump(config, f, indent=2)


def update_last_sync(source: str, timestamp: str) -> None:
    config = load_config()
    config["last_sync"][source] = timestamp
    save_config(config)


def get_last_sync(source: str) -> str | None:
    config = load_config()
    return config.get("last_sync", {}).get(source)
