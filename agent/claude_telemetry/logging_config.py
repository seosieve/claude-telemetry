"""Rotating file logging for claude-telemetry agent."""

from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

from .config import CONFIG_DIR

LOG_DIR = CONFIG_DIR / "logs"
LOG_FMT = "%(asctime)s [%(levelname)s] %(message)s"
MAX_BYTES = 10 * 1024 * 1024  # 10 MB
BACKUP_COUNT = 5


def get_rotating_handler(filename: str) -> RotatingFileHandler:
    """Create a RotatingFileHandler for the given log file name."""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(
        LOG_DIR / filename,
        maxBytes=MAX_BYTES,
        backupCount=BACKUP_COUNT,
        encoding="utf-8",
    )
    handler.setFormatter(logging.Formatter(LOG_FMT))
    return handler
