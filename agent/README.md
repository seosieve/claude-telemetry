# Claude Telemetry Agent

Lightweight Python agent that collects Claude Code usage data and syncs to Supabase.

## Prerequisites

- Python 3.11+
- Node.js 18+ (for `npx ccusage`)
- Supabase project (see [supabase/README.md](../supabase/README.md))

## Install

```bash
cd agent
python3 -m venv venv
source venv/bin/activate  # Windows: .\venv\Scripts\Activate
pip install -e .
```

## Setup

```bash
# Interactive
claude-telemetry setup

# Non-interactive (from Deploy page)
claude-telemetry setup --non-interactive \
  --name "My PC" \
  --supabase-url "https://xxx.supabase.co" \
  --supabase-key "eyJ..." \
  --machine-id "uuid"
```

## Commands

| Command | Description |
|---|---|
| `claude-telemetry setup` | Configure agent |
| `claude-telemetry sync` | Manual sync |
| `claude-telemetry sync --verbose` | Sync with details |
| `claude-telemetry sync --force` | Re-sync all data |
| `claude-telemetry daemon` | Auto-sync foreground |
| `claude-telemetry daemon --interval 10` | Custom interval |
| `claude-telemetry daemon --background` | Run detached |
| `claude-telemetry install-service` | Install as system service |
| `claude-telemetry uninstall-service` | Remove service |
| `claude-telemetry service-status` | Check daemon status |
| `claude-telemetry status` | Show config info |
| `claude-telemetry local --daily` | View data locally |
| `claude-telemetry local --sessions` | View sessions locally |
| `claude-telemetry local --projects` | View project summary |

## How It Works

The agent does **not** parse JSONL files directly. It calls `ccusage` as the parsing layer:

1. `npx ccusage@latest daily --json --instances` — daily usage by project and model
2. `npx ccusage@latest session --json` — session-level usage
3. Reads `~/.claude/stats-cache.json` — hour counts, activity data
4. Adds `machine_id` to all records
5. UPSERTs to Supabase with incremental sync

## Tests

```bash
pip install -e ".[dev]"
pytest -v
```
