"""CLI interface for Claude Usage Tracker."""

from __future__ import annotations

import copy
import json
import platform
import shutil
import subprocess
import sys
import textwrap
import time
from pathlib import Path

import click

from . import __version__
from .config import (
    CONFIG_DIR,
    CONFIG_FILE,
    DEFAULT_CONFIG,
    detect_claude_data_dir,
    detect_os,
    generate_api_key,
    generate_machine_id,
    load_config,
    save_config,
)
from .collector import collect_daily_usage, collect_session_usage, collect_rate_limits, collect_blocks_usage
from .extras import read_stats_cache, read_history_index


def _migrate_legacy_config() -> None:
    """Migrate from claude_tracker → claude_telemetry naming automatically."""
    legacy_dir = Path.home() / ".claude-tracker"
    new_dir = Path.home() / ".claude-telemetry"

    # 1. Move config directory
    if legacy_dir.exists() and not new_dir.exists():
        import shutil as _shutil
        _shutil.move(str(legacy_dir), str(new_dir))
        click.echo(f"Migrated config: {legacy_dir} → {new_dir}")

    # 2. Update hooks in ~/.claude/settings.json
    settings_path = Path.home() / ".claude" / "settings.json"
    if settings_path.exists():
        try:
            data = json.loads(settings_path.read_text(encoding="utf-8"))
            raw = json.dumps(data)
            if "claude_tracker" in raw:
                updated = raw.replace("claude_tracker", "claude_telemetry")
                settings_path.write_text(
                    json.dumps(json.loads(updated), indent=2), encoding="utf-8"
                )
                click.echo(f"Migrated hooks in {settings_path}")
        except Exception:
            pass

    # 3. Update MCP server in ~/.claude.json
    claude_json = Path.home() / ".claude.json"
    if claude_json.exists():
        try:
            data = json.loads(claude_json.read_text(encoding="utf-8"))
            raw = json.dumps(data)
            if "claude_tracker" in raw:
                updated = raw.replace("claude_tracker", "claude_telemetry")
                claude_json.write_text(
                    json.dumps(json.loads(updated), indent=2), encoding="utf-8"
                )
                click.echo(f"Migrated MCP config in {claude_json}")
        except Exception:
            pass

    # 4. Update hook scripts (.ps1 / .sh) that still reference claude_tracker
    claude_dir = Path.home() / ".claude"
    for script_name in ("hook-session-sync.ps1", "hook-session-sync.sh"):
        script = claude_dir / script_name
        if script.exists():
            try:
                content = script.read_text(encoding="utf-8")
                if "claude_tracker" in content:
                    script.write_text(
                        content.replace("claude_tracker", "claude_telemetry"),
                        encoding="utf-8",
                    )
                    click.echo(f"Migrated hook script: {script}")
            except Exception:
                pass


@click.group()
@click.version_option(version=__version__)
def main() -> None:
    """Claude Telemetry — centralized token usage tracking for Claude Code."""
    _migrate_legacy_config()


# ---------------------------------------------------------------------------
# setup
# ---------------------------------------------------------------------------


@main.command()
@click.option("--non-interactive", is_flag=True, help="Skip prompts, use flags")
@click.option("--name", "machine_name", default=None, help="Machine name")
@click.option("--supabase-url", default=None, help="Supabase project URL")
@click.option("--supabase-key", default=None, help="Supabase service_role key")
@click.option("--machine-id", default=None, help="Pre-generated machine UUID")
@click.option("--api-key", default=None, help="Pre-generated API key")
def setup(
    non_interactive: bool,
    machine_name: str | None,
    supabase_url: str | None,
    supabase_key: str | None,
    machine_id: str | None,
    api_key: str | None,
) -> None:
    """Configure machine, Supabase connection, and verify dependencies."""

    click.echo("=== Claude Usage Tracker — Setup ===\n")

    # Check Node.js / npx
    if not shutil.which("npx"):
        click.echo("ERROR: npx not found. Install Node.js 18+ first.")
        click.echo("  Windows: winget install OpenJS.NodeJS")
        click.echo("  macOS:   brew install node")
        click.echo("  Linux:   https://nodejs.org/")
        raise SystemExit(1)

    node_ver = subprocess.run(
        ["node", "--version"], capture_output=True, text=True
    ).stdout.strip()
    click.echo(f"  Node.js: {node_ver}")

    # Check ccost: venv first, then PATH
    try:
        from .collector import _find_ccost
        ccost_path = _find_ccost()
        ccost_ver = subprocess.run(
            [ccost_path, "--version"], capture_output=True, text=True
        ).stdout.strip()
        ccost_installed = True
        click.echo(f"  ccost:   {ccost_ver or 'installed'} (rate limit tracking enabled)")
    except FileNotFoundError:
        ccost_installed = False
        ccost_path = None
        click.echo("  ccost:   not found (rate limit tracking disabled)")
        click.echo("           Install from https://github.com/toolsu/ccost")

    claude_dir = detect_claude_data_dir()
    click.echo(f"  Claude dir: {claude_dir} ({'exists' if claude_dir.exists() else 'NOT FOUND'})")
    click.echo()

    # Load existing config or start fresh
    existing_config: dict | None = None
    if CONFIG_FILE.exists():
        existing_config = json.loads(CONFIG_FILE.read_text())
        existing_id = existing_config.get("machine_id")
        click.echo(f"Existing config found. Machine ID: {existing_id}")
        if not non_interactive:
            if not click.confirm("Update existing config?", default=True):
                click.echo("Setup cancelled.")
                return

    config = copy.deepcopy(DEFAULT_CONFIG)

    # Preserve existing machine_id and api_key when re-running setup
    if existing_config and existing_config.get("machine_id"):
        config["machine_id"] = existing_config["machine_id"]
        config["api_key"] = existing_config.get("api_key") or generate_api_key()
        # Preserve last_sync timestamps
        if existing_config.get("last_sync"):
            config["last_sync"] = existing_config["last_sync"]

    if non_interactive:
        if not machine_name or not supabase_url or not supabase_key:
            click.echo("ERROR: --name, --supabase-url, --supabase-key are required in non-interactive mode.")
            raise SystemExit(1)
        config["machine_name"] = machine_name
        config["supabase_url"] = supabase_url
        config["supabase_service_key"] = supabase_key
        # CLI flags override preserved values
        if machine_id:
            config["machine_id"] = machine_id
        elif not config.get("machine_id"):
            config["machine_id"] = generate_machine_id()
        if api_key:
            config["api_key"] = api_key
        elif not config.get("api_key"):
            config["api_key"] = generate_api_key()
    else:
        if existing_config:
            default_name = existing_config.get("machine_name", platform.node())
        else:
            default_name = platform.node()
        config["machine_name"] = click.prompt("Machine name", default=default_name)
        config["supabase_url"] = click.prompt(
            "Supabase URL",
            default=existing_config.get("supabase_url") if existing_config else None,
        )
        config["supabase_service_key"] = click.prompt(
            "Supabase service_role key",
            default=existing_config.get("supabase_service_key") if existing_config else None,
        )
        if not config.get("machine_id"):
            config["machine_id"] = generate_machine_id()
        if not config.get("api_key"):
            config["api_key"] = generate_api_key()

    config["claude_data_dir"] = str(claude_dir)
    config["features"]["ccost_installed"] = ccost_installed
    config["features"]["ccost_path"] = ccost_path if ccost_installed else None

    save_config(config)
    click.echo(f"\nConfig saved to {CONFIG_FILE}")

    # Register machine in Supabase
    try:
        from supabase import create_client

        client = create_client(config["supabase_url"], config["supabase_service_key"])
        client.table("machines").upsert({
            "id": config["machine_id"],
            "name": config["machine_name"],
            "api_key": config["api_key"],
            "os": detect_os(),
            "hostname": platform.node(),
        }, on_conflict="id").execute()
        click.echo(f"Machine registered in Supabase: {config['machine_name']}")
    except Exception as e:
        click.echo(f"WARNING: Could not register machine in Supabase: {e}")
        click.echo("You can retry with 'claude-telemetry sync' after fixing the connection.")

    click.echo(f"\nMachine ID: {config['machine_id']}")
    click.echo(f"API Key:    {config['api_key'][:10]}...{config['api_key'][-4:]}")
    click.echo("\nSetup complete! Run 'claude-telemetry sync' to start syncing.")


# ---------------------------------------------------------------------------
# sync
# ---------------------------------------------------------------------------


@main.command()
@click.option("--verbose", "-v", is_flag=True, help="Show detailed output")
@click.option("--daily-only", is_flag=True, help="Only sync daily usage data")
@click.option("--force", is_flag=True, help="Resend all data (ignore last_sync)")
def sync(verbose: bool, daily_only: bool, force: bool) -> None:
    """Collect data from ccusage and sync to Supabase."""
    from supabase import create_client
    from .sync import sync_daily_usage, sync_sessions, sync_rate_limits, sync_stats_extra, sync_blocks

    config = load_config()
    machine_id = config["machine_id"]
    client = create_client(config["supabase_url"], config["supabase_service_key"])

    click.echo(f"Syncing machine: {config['machine_name']} ({machine_id[:8]}...)")

    # Ensure machine is registered (fixes FK constraint failures)
    try:
        client.table("machines").upsert({
            "id": machine_id,
            "name": config["machine_name"],
            "api_key": config.get("api_key", ""),
            "os": detect_os(),
            "hostname": platform.node(),
        }, on_conflict="id").execute()
    except Exception as e:
        click.echo(f"\n  ERROR: Cannot register machine in Supabase: {e}", err=True)
        click.echo("  Check your supabase_url and supabase_service_key in config.", err=True)
        raise SystemExit(1)

    # Daily usage
    click.echo("\n  Collecting daily usage...", nl=False)
    since = None
    if not force:
        last = config.get("last_sync", {}).get("daily_usage")
        if last:
            since = last[:10].replace("-", "")
    daily = collect_daily_usage(since=since)
    click.echo(f" {len(daily)} records")
    if verbose:
        for d in daily[:5]:
            click.echo(f"    {d.date} | {d.project} | {d.model} | ${d.cost_usd:.4f}")
        if len(daily) > 5:
            click.echo(f"    ... and {len(daily) - 5} more")

    result = sync_daily_usage(daily, machine_id, client, force=force)
    click.echo(f"  Upserted: {result.records_upserted} ({result.duration_ms}ms)")
    if result.errors:
        for err in result.errors:
            click.echo(f"  ERROR: {err}", err=True)

    if daily_only:
        click.echo("\nDone (daily-only mode).")
        return

    # Sessions
    click.echo("\n  Collecting sessions...", nl=False)
    sessions = collect_session_usage()
    click.echo(f" {len(sessions)} sessions")
    if verbose:
        for s in sessions[:5]:
            click.echo(f"    {s.session_id[:40]} | {s.project} | ${s.cost_usd:.4f}")

    result = sync_sessions(sessions, machine_id, client, force=force)
    click.echo(f"  Upserted: {result.records_upserted} ({result.duration_ms}ms)")
    if result.errors:
        for err in result.errors:
            click.echo(f"  ERROR: {err}", err=True)

    # Rate limits (optional)
    if config.get("features", {}).get("ccost_installed"):
        click.echo("\n  Collecting rate limits...", nl=False)
        rate_data = collect_rate_limits(ccost_path=config.get("features", {}).get("ccost_path"))
        if rate_data:
            click.echo(f" {len(rate_data)} records")
            result = sync_rate_limits(rate_data, machine_id, client)
            click.echo(f"  Upserted: {result.records_upserted} ({result.duration_ms}ms)")
        else:
            click.echo(" skipped (ccost unavailable)")

    # Stats extra
    click.echo("\n  Reading stats cache...", nl=False)
    claude_dir = Path(config.get("claude_data_dir", str(Path.home() / ".claude")))
    stats = read_stats_cache(claude_dir)
    if stats:
        click.echo(" found")
        result = sync_stats_extra(stats, machine_id, client)
        click.echo(f"  Upserted: {result.records_upserted} ({result.duration_ms}ms)")
    else:
        click.echo(" not found")

    # Blocks
    click.echo("\n  Collecting blocks...", nl=False)
    blocks = collect_blocks_usage()
    click.echo(f" {len(blocks)} blocks")
    if blocks:
        result = sync_blocks(blocks, machine_id, client)
        click.echo(f"  Upserted: {result.records_upserted} ({result.duration_ms}ms)")
        if result.errors:
            for err in result.errors:
                click.echo(f"  ERROR: {err}", err=True)

    click.echo("\nSync complete!")


# ---------------------------------------------------------------------------
# daemon
# ---------------------------------------------------------------------------


@main.command()
@click.option("--interval", default=15, help="Sync interval in minutes (default: 15)")
@click.option("--verbose", "-v", is_flag=True, help="Verbose logging")
@click.option("--background", is_flag=True, help="Run detached in background")
def daemon(interval: int, verbose: bool, background: bool) -> None:
    """Run auto-sync daemon (like Elastic Agent)."""
    if background:
        _start_background_daemon(interval, verbose)
        return

    from .daemon import run_daemon
    run_daemon(interval_minutes=interval, verbose=verbose)


def _get_pythonw() -> str:
    """Get pythonw.exe path on Windows (no console window)."""
    if sys.platform == "win32":
        pythonw = Path(sys.executable).parent / "pythonw.exe"
        if pythonw.exists():
            return str(pythonw)
    return sys.executable


def _start_background_daemon(interval: int, verbose: bool) -> None:
    """Start daemon as a detached background process."""
    exe = _get_pythonw() if sys.platform == "win32" else sys.executable
    args = [exe, "-m", "claude_telemetry.daemon", str(interval)]
    if verbose:
        args.append("--verbose")

    if sys.platform == "win32":
        CREATE_NEW_PROCESS_GROUP = 0x00000200
        DETACHED_PROCESS = 0x00000008
        subprocess.Popen(
            args,
            creationflags=DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    else:
        subprocess.Popen(
            args,
            start_new_session=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    click.echo(f"Daemon started in background (interval: {interval}m)")
    click.echo(f"Log: {CONFIG_DIR / 'daemon.log'}")


# ---------------------------------------------------------------------------
# install-service / uninstall-service / service-status
# ---------------------------------------------------------------------------


@main.command("install-service")
def install_service() -> None:
    """Install daemon as a system service (Task Scheduler / systemd / launchd)."""
    system = platform.system()
    tracker_path = shutil.which("claude-telemetry") or f"{sys.executable} -m claude_telemetry.cli"

    if system == "Windows":
        _install_windows_service(tracker_path)
    elif system == "Darwin":
        _install_macos_service(tracker_path)
    else:
        _install_linux_service(tracker_path)


@main.command("uninstall-service")
def uninstall_service() -> None:
    """Remove the daemon system service."""
    system = platform.system()

    if system == "Windows":
        _uninstall_windows_service()
    elif system == "Darwin":
        _uninstall_macos_service()
    else:
        _uninstall_linux_service()


@main.command()
@click.option("--yes", "-y", is_flag=True, help="Skip confirmation prompt")
def uninstall(yes: bool) -> None:
    """Remove all claude-telemetry config from this machine."""
    if not yes:
        click.confirm(
            "This will remove all claude-telemetry config from this machine. "
            "Data in Supabase is NOT affected. Continue?",
            default=False,
            abort=True,
        )

    # Try to remove service first (may not exist)
    system = platform.system()
    try:
        if system == "Windows":
            _uninstall_windows_service()
        elif system == "Darwin":
            _uninstall_macos_service()
        else:
            _uninstall_linux_service()
    except Exception:
        pass  # Service may not be installed

    # Remove config directory
    if CONFIG_DIR.exists():
        shutil.rmtree(CONFIG_DIR)
        click.echo(f"Removed {CONFIG_DIR}")
    else:
        click.echo(f"Config directory not found: {CONFIG_DIR}")

    click.echo(
        "\nAgent removed from this machine.\n"
        "To also delete your data from the server, remove the machine from\n"
        "the dashboard Settings page or delete the Supabase project."
    )


@main.command("setup-statusline")
def setup_statusline() -> None:
    """Configure Claude Code statusline for rate limit tracking."""
    claude_dir = Path.home() / ".claude"
    claude_dir.mkdir(parents=True, exist_ok=True)
    system = platform.system()

    if system == "Windows":
        script_path = claude_dir / "statusline.ps1"
        script_path.write_text(textwrap.dedent("""\
            $input = $Input | Out-String
            $ts = [int](New-TimeSpan -Start (Get-Date '1970-01-01') -End (Get-Date).ToUniversalTime()).TotalSeconds
            $line = '{{"ts":' + $ts + ',"data":' + $input.Trim() + '}}'
            Add-Content -Path "$env:USERPROFILE\\.claude\\statusline.jsonl" -Value $line -Encoding UTF8
        """))
        click.echo(f"Created {script_path}")
    else:
        script_path = claude_dir / "statusline.sh"
        script_path.write_text(textwrap.dedent("""\
            #!/bin/bash
            input=$(cat)
            echo "{\\"ts\\":$(date +%s),\\"data\\":$input}" >> ~/.claude/statusline.jsonl
        """))
        script_path.chmod(0o755)
        click.echo(f"Created {script_path}")

    # Update settings.json
    settings_path = claude_dir / "settings.json"
    settings: dict = {}
    if settings_path.exists():
        import json as _json
        try:
            settings = _json.loads(settings_path.read_text())
        except Exception:
            pass

    settings.setdefault("hooks", {})
    settings["hooks"]["StatusLine"] = [
        {
            "type": "command",
            "command": str(script_path),
        }
    ]

    import json as _json
    settings_path.write_text(_json.dumps(settings, indent=2))
    click.echo(f"Updated {settings_path}")
    click.echo("\nStatusline configured! Rate limit tracking will start on next Claude Code session.")


@main.command("setup-hooks")
def setup_hooks() -> None:
    """Configure Claude Code hooks for real-time data sync on session end."""
    claude_dir = Path.home() / ".claude"
    claude_dir.mkdir(parents=True, exist_ok=True)
    system = platform.system()

    # Determine Python path (use pythonw on Windows for windowless execution)
    python_path = sys.executable
    if system == "Windows":
        pythonw = Path(sys.executable).parent / "pythonw.exe"
        if pythonw.exists():
            python_path = str(pythonw)

    if system == "Windows":
        script_path = claude_dir / "hook-session-sync.ps1"
        script_path.write_text(textwrap.dedent(f"""\
            Start-Process -FilePath "{python_path}" -ArgumentList "-m","claude_telemetry.hook_sync" -WindowStyle Hidden
        """))
        click.echo(f"Created {script_path}")
    else:
        script_path = claude_dir / "hook-session-sync.sh"
        script_path.write_text(textwrap.dedent(f"""\
            #!/bin/bash
            nohup "{python_path}" -m claude_telemetry.hook_sync > /dev/null 2>&1 &
            disown
        """))
        script_path.chmod(0o755)
        click.echo(f"Created {script_path}")

    # Update ~/.claude/settings.json — merge, don't overwrite existing hooks
    settings_path = claude_dir / "settings.json"
    settings: dict = {}
    if settings_path.exists():
        try:
            settings = json.loads(settings_path.read_text())
        except Exception:
            pass

    settings.setdefault("hooks", {})
    hook_entry = {"hooks": [{"type": "command", "command": str(script_path)}]}

    # SessionEnd — fires once when session ends (primary, guarantees final sync)
    settings["hooks"]["SessionEnd"] = [hook_entry]
    # Stop — fires after each response (secondary, incremental updates with debounce)
    settings["hooks"]["Stop"] = [hook_entry]

    settings_path.write_text(json.dumps(settings, indent=2))
    click.echo(f"Updated {settings_path}")

    # Mark hooks as configured in agent config
    try:
        config = load_config()
        config.setdefault("features", {})
        config["features"]["hooks_configured"] = True
        save_config(config)
    except FileNotFoundError:
        click.echo("WARNING: Agent not configured yet. Run 'claude-telemetry setup' first.")

    click.echo("\nHooks configured!")
    click.echo("  SessionEnd — syncs data when session ends")
    click.echo("  Stop       — incremental updates (debounced, max 1 per 2 min)")
    click.echo("The daemon (if running) will switch to a 60-minute backup interval.")


@main.command("hook-status")
def hook_status() -> None:
    """Show hook configuration status and recent sync info."""
    claude_dir = Path.home() / ".claude"
    settings_path = claude_dir / "settings.json"

    # Check if hooks are configured in settings.json
    session_end_ok = False
    stop_ok = False
    if settings_path.exists():
        try:
            settings = json.loads(settings_path.read_text())
            hooks = settings.get("hooks", {})
            for event_name, entries in [("SessionEnd", hooks.get("SessionEnd", [])), ("Stop", hooks.get("Stop", []))]:
                for entry in entries:
                    # Check nested hooks format
                    inner = entry.get("hooks", [entry])
                    for h in inner:
                        if "hook-session-sync" in h.get("command", ""):
                            if event_name == "SessionEnd":
                                session_end_ok = True
                            else:
                                stop_ok = True
        except Exception:
            pass

    click.echo(f"SessionEnd hook:  {'YES' if session_end_ok else 'NO'}")
    click.echo(f"Stop hook:        {'YES' if stop_ok else 'NO'}")

    # Check lock file for last sync time
    lock_file = CONFIG_DIR / ".hook_lock"
    if lock_file.exists():
        import datetime
        mtime = lock_file.stat().st_mtime
        last_sync = datetime.datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M:%S")
        ago = int(time.time() - mtime)
        if ago < 60:
            ago_str = f"{ago}s ago"
        elif ago < 3600:
            ago_str = f"{ago // 60}m ago"
        else:
            ago_str = f"{ago // 3600}h ago"
        click.echo(f"Last hook sync:   {last_sync} ({ago_str})")
    else:
        click.echo("Last hook sync:   never")

    # Show recent log entries
    log_file = CONFIG_DIR / "logs" / "hooks.log"
    if log_file.exists():
        lines = log_file.read_text().strip().splitlines()
        recent = lines[-5:] if len(lines) > 5 else lines
        click.echo(f"\nRecent log ({log_file}):")
        for line in recent:
            click.echo(f"  {line}")
    else:
        click.echo(f"\nNo hook log yet ({log_file})")


@main.command("setup-mcp")
def setup_mcp() -> None:
    """Register the claude-telemetry MCP server with Claude Code.

    Allows you to query usage data directly from Claude Code:
      "How much did I spend this week?"
      "What's my most expensive project?"
    """
    # Check that agent is configured
    try:
        load_config()
    except FileNotFoundError:
        click.echo("ERROR: Agent not configured. Run 'claude-telemetry setup' first.")
        raise SystemExit(1)

    # Determine Python path (same venv that has claude_telemetry installed)
    python_path = sys.executable

    # MCP servers go in ~/.claude.json (NOT ~/.claude/settings.json)
    config_path = Path.home() / ".claude.json"

    config_data: dict = {}
    if config_path.exists():
        try:
            config_data = json.loads(config_path.read_text(encoding="utf-8"))
        except Exception:
            pass

    # Add MCP server entry — preserve all other fields
    config_data.setdefault("mcpServers", {})
    config_data["mcpServers"]["claude-telemetry"] = {
        "command": python_path,
        "args": ["-m", "claude_telemetry.mcp_server"],
    }

    config_path.write_text(json.dumps(config_data, indent=2), encoding="utf-8")
    click.echo(f"Updated {config_path}")

    # Clean up stale entry from settings.json (old location)
    settings_path = Path.home() / ".claude" / "settings.json"
    if settings_path.exists():
        try:
            settings = json.loads(settings_path.read_text(encoding="utf-8"))
            if "mcpServers" in settings and "claude-telemetry" in settings["mcpServers"]:
                del settings["mcpServers"]["claude-telemetry"]
                if not settings["mcpServers"]:
                    del settings["mcpServers"]
                settings_path.write_text(json.dumps(settings, indent=2), encoding="utf-8")
                click.echo(f"Cleaned stale entry from {settings_path}")
        except Exception:
            pass
    click.echo("\nMCP server registered: claude-telemetry")
    click.echo("\nYou can now ask Claude Code things like:")
    click.echo('  "How much did I spend this week across all machines?"')
    click.echo('  "What are my top 5 projects by cost?"')
    click.echo('  "Show me the rate limit status"')
    click.echo("\nRestart Claude Code to activate the MCP server.")


@main.command("service-status")
def service_status() -> None:
    """Show daemon service status."""
    system = platform.system()

    if system == "Windows":
        result = subprocess.run(
            ["schtasks", "/Query", "/TN", "ClaudeUsageTracker", "/FO", "LIST"],
            capture_output=True, text=True,
        )
        if result.returncode == 0:
            click.echo("Service: INSTALLED (Windows Task Scheduler)")
            click.echo(result.stdout)
        else:
            click.echo("Service: NOT INSTALLED")

    elif system == "Darwin":
        plist = Path.home() / "Library/LaunchAgents/com.claude-telemetry.plist"
        if plist.exists():
            result = subprocess.run(
                ["launchctl", "list", "com.claude-telemetry"],
                capture_output=True, text=True,
            )
            if result.returncode == 0:
                click.echo("Service: RUNNING (launchd)")
                click.echo(result.stdout)
            else:
                click.echo("Service: INSTALLED but NOT RUNNING")
        else:
            click.echo("Service: NOT INSTALLED")

    else:
        result = subprocess.run(
            ["systemctl", "--user", "is-active", "claude-telemetry"],
            capture_output=True, text=True,
        )
        status = result.stdout.strip()
        click.echo(f"Service: {status.upper()} (systemd)")
        if status == "active":
            subprocess.run(
                ["systemctl", "--user", "status", "claude-telemetry", "--no-pager"],
            )

    # Show last sync info
    try:
        config = load_config()
        log_file = CONFIG_DIR / "daemon.log"
        click.echo(f"\nMachine: {config.get('machine_name')}")
        last_sync = config.get("last_sync", {})
        for source, ts in last_sync.items():
            click.echo(f"  {source:20s} {ts or 'never'}")
        if log_file.exists():
            click.echo(f"\nLog file: {log_file}")
    except FileNotFoundError:
        click.echo("\nNot configured. Run 'claude-telemetry setup' first.")


# --- Windows Task Scheduler ---

def _install_windows_service(tracker_path: str) -> None:
    exe = _get_pythonw()
    cmd_line = f'"{exe}" -m claude_telemetry.daemon 15'
    result = subprocess.run(
        [
            "schtasks", "/Create",
            "/TN", "ClaudeUsageTracker",
            "/TR", cmd_line,
            "/SC", "ONLOGON",
            "/RL", "LIMITED",
            "/F",
        ],
        capture_output=True, text=True,
    )
    if result.returncode == 0:
        click.echo("Windows Task Scheduler task created: ClaudeUsageTracker")
        click.echo("The daemon will start automatically on login.")
        # Also start it now
        subprocess.run(["schtasks", "/Run", "/TN", "ClaudeUsageTracker"])
        click.echo("Daemon started.")
    else:
        click.echo(f"ERROR: {result.stderr}")


def _uninstall_windows_service() -> None:
    subprocess.run(
        ["schtasks", "/Delete", "/TN", "ClaudeUsageTracker", "/F"],
        capture_output=True, text=True,
    )
    click.echo("Windows Task Scheduler task removed.")


# --- macOS LaunchAgent ---

def _install_macos_service(tracker_path: str) -> None:
    plist_dir = Path.home() / "Library/LaunchAgents"
    plist_dir.mkdir(parents=True, exist_ok=True)
    plist_path = plist_dir / "com.claude-telemetry.plist"

    plist_content = textwrap.dedent(f"""\
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
          "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
            <key>Label</key>
            <string>com.claude-telemetry</string>
            <key>ProgramArguments</key>
            <array>
                <string>{sys.executable}</string>
                <string>-m</string>
                <string>claude_telemetry.daemon</string>
                <string>15</string>
            </array>
            <key>RunAtLoad</key>
            <true/>
            <key>KeepAlive</key>
            <true/>
            <key>StandardOutPath</key>
            <string>{CONFIG_DIR / 'daemon.log'}</string>
            <key>StandardErrorPath</key>
            <string>{CONFIG_DIR / 'daemon.log'}</string>
        </dict>
        </plist>
    """)
    plist_path.write_text(plist_content)
    subprocess.run(["launchctl", "load", str(plist_path)])
    click.echo(f"LaunchAgent installed: {plist_path}")
    click.echo("Daemon started and will auto-start on login.")


def _uninstall_macos_service() -> None:
    plist_path = Path.home() / "Library/LaunchAgents/com.claude-telemetry.plist"
    if plist_path.exists():
        subprocess.run(["launchctl", "unload", str(plist_path)])
        plist_path.unlink()
        click.echo("LaunchAgent removed.")
    else:
        click.echo("LaunchAgent not found.")


# --- Linux systemd ---

def _install_linux_service(tracker_path: str) -> None:
    service_dir = Path.home() / ".config/systemd/user"
    service_dir.mkdir(parents=True, exist_ok=True)
    service_path = service_dir / "claude-telemetry.service"

    service_content = textwrap.dedent(f"""\
        [Unit]
        Description=Claude Usage Tracker Daemon
        After=network-online.target

        [Service]
        Type=simple
        ExecStart={sys.executable} -m claude_telemetry.daemon 15
        Restart=on-failure
        RestartSec=30

        [Install]
        WantedBy=default.target
    """)
    service_path.write_text(service_content)
    subprocess.run(["systemctl", "--user", "daemon-reload"])
    subprocess.run(["systemctl", "--user", "enable", "--now", "claude-telemetry"])
    click.echo(f"systemd service installed: {service_path}")
    click.echo("Daemon started and enabled on login.")


def _uninstall_linux_service() -> None:
    subprocess.run(["systemctl", "--user", "disable", "--now", "claude-telemetry"])
    service_path = Path.home() / ".config/systemd/user/claude-telemetry.service"
    if service_path.exists():
        service_path.unlink()
        subprocess.run(["systemctl", "--user", "daemon-reload"])
    click.echo("systemd service removed.")


# ---------------------------------------------------------------------------
# status
# ---------------------------------------------------------------------------


@main.command()
def status() -> None:
    """Show current machine status and sync info."""
    try:
        config = load_config()
    except FileNotFoundError:
        click.echo("Not configured. Run 'claude-telemetry setup' first.")
        return

    click.echo(f"Machine:     {config.get('machine_name', 'unknown')}")
    click.echo(f"Machine ID:  {config.get('machine_id', 'N/A')}")
    click.echo(f"Supabase:    {config.get('supabase_url', 'N/A')}")
    click.echo(f"Claude dir:  {config.get('claude_data_dir', 'N/A')}")
    click.echo(f"ccost:       {'yes' if config.get('features', {}).get('ccost_installed') else 'no'}")
    click.echo()

    last_sync = config.get("last_sync", {})
    click.echo("Last sync:")
    for source, ts in last_sync.items():
        click.echo(f"  {source:20s} {ts or 'never'}")


# ---------------------------------------------------------------------------
# local
# ---------------------------------------------------------------------------


@main.command()
@click.option("--daily", is_flag=True, help="Show daily usage data")
@click.option("--sessions", is_flag=True, help="Show session data")
@click.option("--projects", is_flag=True, help="Show project summary")
def local(daily: bool, sessions: bool, projects: bool) -> None:
    """Show local data without sending to Supabase."""
    if not (daily or sessions or projects):
        daily = True

    if daily:
        click.echo("=== Daily Usage (local) ===\n")
        records = collect_daily_usage()
        click.echo(f"{'Date':12s} {'Project':30s} {'Model':25s} {'Tokens':>12s} {'Cost':>10s}")
        click.echo("-" * 93)
        for r in records:
            click.echo(
                f"{r.date:12s} {r.project:30s} {r.model:25s} "
                f"{r.total_tokens:>12,d} ${r.cost_usd:>9.4f}"
            )
        total_cost = sum(r.cost_usd for r in records)
        total_tokens = sum(r.total_tokens for r in records)
        click.echo("-" * 93)
        click.echo(f"{'TOTAL':12s} {'':30s} {'':25s} {total_tokens:>12,d} ${total_cost:>9.4f}")

    if sessions:
        click.echo("\n=== Sessions (local) ===\n")
        records = collect_session_usage()
        click.echo(f"{'Session ID':40s} {'Project':25s} {'Models':20s} {'Cost':>10s}")
        click.echo("-" * 99)
        for s in records:
            models = ", ".join(m.split("-")[-1] for m in s.models) if s.models else "?"
            click.echo(
                f"{s.session_id[:40]:40s} {s.project[:25]:25s} "
                f"{models[:20]:20s} ${s.cost_usd:>9.4f}"
            )

    if projects:
        click.echo("\n=== Project Summary (local) ===\n")
        records = collect_daily_usage()
        project_totals: dict[str, dict] = {}
        for r in records:
            if r.project not in project_totals:
                project_totals[r.project] = {"cost": 0.0, "tokens": 0, "models": set()}
            project_totals[r.project]["cost"] += r.cost_usd
            project_totals[r.project]["tokens"] += r.total_tokens
            project_totals[r.project]["models"].add(r.model)

        click.echo(f"{'Project':35s} {'Tokens':>12s} {'Cost':>10s} {'Models'}")
        click.echo("-" * 90)
        for proj, data in sorted(project_totals.items(), key=lambda x: x[1]["cost"], reverse=True):
            models = ", ".join(m.split("-")[-1] for m in data["models"])
            click.echo(
                f"{proj[:35]:35s} {data['tokens']:>12,d} "
                f"${data['cost']:>9.4f} {models}"
            )


if __name__ == "__main__":
    main()
