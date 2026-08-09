#!/bin/sh
# rice-gang cc-telemetry bootstrap.
#
# Usage (run once on each machine):
#   curl -fsSL https://raw.githubusercontent.com/seosieve/claude-telemetry/main/bootstrap.sh | sh
#
# What this does:
#   1. Replaces the upstream cc-telemetry pipx install with the rice-gang fork
#      (git+https://github.com/seosieve/claude-telemetry@main#subdirectory=agent).
#   2. Restarts the cc-telemetry launchd daemon so the new code takes effect.
#   3. Installs an auto-upgrade LaunchAgent (com.cc-telemetry.auto-upgrade)
#      that re-runs `pipx install --force` daily at 05:10 and restarts the
#      daemon. After bootstrap, every machine stays in sync with main without
#      further manual intervention.
#   4. Runs `cc-telemetry sync --force` once to backfill any historical days
#      that the last_sync gate previously skipped.

set -eu

# Track main so every machine converges on the latest fork code without a
# tag bump after each change. Trade-off: a push to main auto-deploys to
# every PC at the next 05:10 run — keep main always-deployable and do
# experimental work on a branch. The --help self-check below still aborts
# the daemon restart on a fully broken build.
FORK_REF="main"
FORK_URL="git+https://github.com/seosieve/claude-telemetry@${FORK_REF}#subdirectory=agent"
DAEMON_PLIST="$HOME/Library/LaunchAgents/com.cc-telemetry.plist"
UPGRADE_PLIST="$HOME/Library/LaunchAgents/com.cc-telemetry.auto-upgrade.plist"
UPGRADE_LABEL="com.cc-telemetry.auto-upgrade"
LOG_DIR="$HOME/.cc-telemetry"
UPGRADE_SCRIPT="$LOG_DIR/auto-upgrade.sh"
PIPX_BIN="$HOME/.local/bin/pipx"
CC_BIN="$HOME/.local/bin/cc-telemetry"

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

echo "[1/4] Installing cc-telemetry from rice-gang fork (${FORK_REF})..."
"$PIPX_BIN" install --force "$FORK_URL"

# Self-check: confirm the freshly installed CLI actually runs before we restart
# the daemon. A broken build (bad commit, dep conflict) should fail loudly here
# instead of silently taking this machine's collector offline.
if ! "$CC_BIN" --help >/dev/null 2>&1 && ! cc-telemetry --help >/dev/null 2>&1; then
    echo "bootstrap.sh: cc-telemetry failed to run after install — aborting before daemon restart." >&2
    exit 1
fi

echo "[2/4] Restarting cc-telemetry daemon..."
if [ -f "$DAEMON_PLIST" ]; then
    launchctl unload "$DAEMON_PLIST" 2>/dev/null || true
    launchctl load "$DAEMON_PLIST"
else
    echo "  (no existing daemon plist found; run 'cc-telemetry install' once to register it)"
fi

echo "[3/4] Installing auto-upgrade LaunchAgent..."

# The upgrade body lives in its own script rather than inline in the plist: the
# retry loop below would be unreadable once XML-escaped, and a real file can be
# run by hand to reproduce a failed night.
cat > "$UPGRADE_SCRIPT" <<UPGRADE
#!/bin/sh
# Installed by bootstrap.sh — re-run bootstrap.sh to update this file.
set -u

PIPX_BIN="${PIPX_BIN}"
CC_BIN="${CC_BIN}"
FORK_URL="${FORK_URL}"
DAEMON_PLIST="${DAEMON_PLIST}"

# 05:10 usually lands moments after the Mac wakes, before Wi-Fi reassociates,
# so the first attempt often dies in DNS/TCP. Git has no timeout of its own
# there: on 2026-08-09 one clone sat on a dead connection from 05:11 to 07:37
# before the OS gave up. These two abort a stalled transfer in 30s, which is
# also what makes the retry loop below reachable at all.
GIT_HTTP_LOW_SPEED_LIMIT=1000
GIT_HTTP_LOW_SPEED_TIME=30
export GIT_HTTP_LOW_SPEED_LIMIT GIT_HTTP_LOW_SPEED_TIME

log() { echo "[\$(date '+%Y-%m-%d %H:%M:%S')] \$*"; }

attempt=1
while [ \$attempt -le 5 ]; do
    log "upgrade attempt \$attempt/5"
    if "\$PIPX_BIN" install --force "\$FORK_URL"; then
        # Self-check before restarting: a broken build must not take this
        # machine's collector offline.
        if "\$CC_BIN" --help >/dev/null 2>&1; then
            launchctl unload "\$DAEMON_PLIST" 2>/dev/null
            launchctl load "\$DAEMON_PLIST"
            log "upgraded to \$("\$CC_BIN" --version 2>/dev/null) — daemon restarted"
            exit 0
        fi
        log "installed but the CLI won't run — leaving the daemon on the old build"
        exit 1
    fi
    log "attempt \$attempt failed (network likely not up yet)"
    attempt=\$((attempt + 1))
    [ \$attempt -le 5 ] && sleep 300
done
log "gave up after 5 attempts — run bootstrap.sh by hand"
exit 1
UPGRADE
chmod +x "$UPGRADE_SCRIPT"

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
        <string>${UPGRADE_SCRIPT}</string>
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

echo "[4/4] Backfilling historical data (cc-telemetry sync --force)..."
if command -v cc-telemetry >/dev/null 2>&1; then
    cc-telemetry sync --force || echo "  (backfill failed; run 'cc-telemetry sync --force' manually)"
else
    echo "  (cc-telemetry CLI not on PATH; run 'cc-telemetry sync --force' manually)"
fi

echo ""
echo "Done. This machine will auto-upgrade daily at 05:10 from $FORK_URL (pinned to $FORK_REF)."
echo "Logs: $LOG_DIR/auto-upgrade.log"
