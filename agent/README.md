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
cc-telemetry setup

# Non-interactive (from Deploy page)
cc-telemetry setup --non-interactive \
  --name "My PC" \
  --supabase-url "https://xxx.supabase.co" \
  --supabase-key "eyJ..." \
  --machine-id "uuid"
```

## Commands

| Command | Description |
|---|---|
| `cc-telemetry setup` | Configure agent |
| `cc-telemetry sync` | Manual sync |
| `cc-telemetry sync --verbose` | Sync with details |
| `cc-telemetry sync --force` | Re-sync all data |
| `cc-telemetry daemon` | Auto-sync foreground |
| `cc-telemetry daemon --interval 10` | Custom interval |
| `cc-telemetry daemon --background` | Run detached |
| `cc-telemetry install-service` | Install as system service |
| `cc-telemetry uninstall-service` | Remove service |
| `cc-telemetry service-status` | Check daemon status |
| `cc-telemetry status` | Show config info |
| `cc-telemetry local --daily` | View data locally |
| `cc-telemetry local --sessions` | View sessions locally |
| `cc-telemetry local --projects` | View project summary |

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
