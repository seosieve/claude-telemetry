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
claude-tracker setup

# Non-interactive (from Deploy page)
claude-tracker setup --non-interactive \
  --name "My PC" \
  --supabase-url "https://xxx.supabase.co" \
  --supabase-key "eyJ..." \
  --machine-id "uuid"
```

## Commands

| Command | Description |
|---|---|
| `claude-tracker setup` | Configure agent |
| `claude-tracker sync` | Manual sync |
| `claude-tracker sync --verbose` | Sync with details |
| `claude-tracker sync --force` | Re-sync all data |
| `claude-tracker daemon` | Auto-sync foreground |
| `claude-tracker daemon --interval 10` | Custom interval |
| `claude-tracker daemon --background` | Run detached |
| `claude-tracker install-service` | Install as system service |
| `claude-tracker uninstall-service` | Remove service |
| `claude-tracker service-status` | Check daemon status |
| `claude-tracker status` | Show config info |
| `claude-tracker local --daily` | View data locally |
| `claude-tracker local --sessions` | View sessions locally |
| `claude-tracker local --projects` | View project summary |

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
