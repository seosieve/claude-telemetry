# Claude Telemetry Agent

Lightweight Python agent that collects Claude Code usage data and syncs it to the dashboard's ingest endpoint (backed by Neon Postgres).

## Features

- Auto-sync daemon with configurable interval
- **Real-time hooks** — instant sync on SessionEnd + Stop events
- **MCP server** with 12 tools — query usage data directly from Claude Code
- **Setup wizard** — one command configures hooks, MCP, statusline, daemon
- **Doctor** — 10-point health check for all components
- **Webhook notifications** — Discord/Slack alerts for budget and rate limit thresholds

## Prerequisites

- Python 3.11+
- Node.js 18+ (for `npx ccusage`)
- A deployed dashboard (provides the ingest endpoint the agent registers with — see the [root README](../README.md))

## Install

```bash
pip install cc-telemetry
```

<details>
<summary>Alternative: install from source</summary>

```bash
cd agent
python3 -m venv venv
source venv/bin/activate  # Windows: .\venv\Scripts\Activate
pip install -e .
```
</details>

## Setup

```bash
# Full setup wizard (configures hooks, MCP, statusline, daemon — all in one).
# Registers this machine with the dashboard and receives its api_key.
cc-telemetry setup

# Minimal setup (config + first sync only, no hooks/MCP/statusline)
cc-telemetry setup --minimal

# Non-interactive (the Deploy page generates this command with a pre-issued
# machine-id + api-key, so no DB credentials ever touch the agent)
cc-telemetry setup --non-interactive \
  --name "My PC" \
  --machine-id "uuid" \
  --api-key "ct_..."

# Verify everything is working
cc-telemetry doctor
```

## CLI Reference

**Setup**

| Command | Description |
|---|---|
| `cc-telemetry setup` | Setup wizard — configure everything in one command |
| `cc-telemetry doctor` | Health check — verify all components |
| `cc-telemetry setup-hooks` | Configure real-time sync hooks |
| `cc-telemetry setup-mcp` | Register MCP server with Claude Code |
| `cc-telemetry setup-statusline` | Configure rate limit tracking |

**Operation**

| Command | Description |
|---|---|
| `cc-telemetry sync` | Manual sync to the dashboard |
| `cc-telemetry sync --verbose` | Sync with detailed output |
| `cc-telemetry sync --force` | Re-sync all data |
| `cc-telemetry status` | Show config and last sync |
| `cc-telemetry local --daily` | View local data without syncing |

**Service**

| Command | Description |
|---|---|
| `cc-telemetry daemon` | Run auto-sync in foreground |
| `cc-telemetry install-service` | Install as system service |
| `cc-telemetry uninstall-service` | Remove system service |
| `cc-telemetry service-status` | Check daemon status |

**Cleanup**

| Command | Description |
|---|---|
| `cc-telemetry uninstall` | Remove agent config from this machine |

## How It Works

The agent does **not** parse JSONL files directly. It calls `ccusage` as the parsing layer:

1. `npx ccusage daily --json --instances` — daily usage by project and model
2. `npx ccusage session --json` — session-level usage
3. Reads `~/.claude/stats-cache.json` — hour counts, activity data
4. Adds `machine_id` to all records
5. POSTs to the dashboard ingest endpoint with incremental sync (the endpoint upserts into Neon)

When **hooks** are configured, sync also triggers automatically on session end (with 2-minute debounce).

## Tests

```bash
pip install -e ".[dev]"
pytest -v
```
