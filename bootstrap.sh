#!/bin/sh
# RiceGang cc-telemetry bootstrap.
#
# Usage (run once on each machine):
#   curl -fsSL https://raw.githubusercontent.com/seosieve/claude-telemetry/main/bootstrap.sh | sh
#
# What this does:
#   1. Replaces the upstream cc-telemetry pipx install with the RiceGang fork
#      (git+https://github.com/seosieve/claude-telemetry@main).
#   2. Restarts the cc-telemetry launchd daemon so the new code takes effect.
#   3. Installs an auto-upgrade LaunchAgent (com.cc-telemetry.auto-upgrade)
#      that re-runs `pipx install --force` daily at 05:10 and restarts the
#      daemon. After bootstrap, every machine stays in sync with main without
#      further manual intervention.

set -eu

FORK_URL="git+https://github.com/seosieve/claude-telemetry@main"
DAEMON_PLIST="$HOME/Library/LaunchAgents/com.cc-telemetry.plist"
UPGRADE_PLIST="$HOME/Library/LaunchAgents/com.cc-telemetry.auto-upgrade.plist"
UPGRADE_LABEL="com.cc-telemetry.auto-upgrade"
LOG_DIR="$HOME/.cc-telemetry"
PIPX_BIN="$HOME/.local/bin/pipx"

if [ "$(uname)" != "Darwin" ]; then
    echo "bootstrap.sh: only macOS is supported (uname=$(uname))." >&2
    exit 1
fi

if [ ! -x "$PIPX_BIN" ]; then
    if command -v pipx >/dev/null 2>&1; then
        PIPX_BIN="$(command -v pipx)"
    else
        echo "bootstrap.sh: pipx not found. Install with 'brew install pipx' first." >&2
        exit 1
    fi
fi

mkdir -p "$LOG_DIR"

echo "[1/3] Installing cc-telemetry from RiceGang fork..."
"$PIPX_BIN" install --force "$FORK_URL"

echo "[2/3] Restarting cc-telemetry daemon..."
if [ -f "$DAEMON_PLIST" ]; then
    launchctl unload "$DAEMON_PLIST" 2>/dev/null || true
    launchctl load "$DAEMON_PLIST"
else
    echo "  (no existing daemon plist found; run 'cc-telemetry install' once to register it)"
fi

echo "[3/3] Installing auto-upgrade LaunchAgent..."
cat > "$UPGRADE_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${UPGRADE_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/sh</string>
        <string>-c</string>
        <string>${PIPX_BIN} install --force ${FORK_URL} &amp;&amp; (launchctl unload ${DAEMON_PLIST} 2&gt;/dev/null; launchctl load ${DAEMON_PLIST})</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>5</integer>
        <key>Minute</key>
        <integer>10</integer>
    </dict>
    <key>RunAtLoad</key>
    <false/>
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/auto-upgrade.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/auto-upgrade.log</string>
</dict>
</plist>
PLIST

launchctl unload "$UPGRADE_PLIST" 2>/dev/null || true
launchctl load "$UPGRADE_PLIST"

echo ""
echo "Done. This machine will auto-upgrade daily at 05:10 from $FORK_URL."
echo "Logs: $LOG_DIR/auto-upgrade.log"
