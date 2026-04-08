"""MCP Server for claude-telemetry — query aggregated usage data from all machines.

Exposes tools that Claude Code can call via natural language:
  "How much did I spend this week?"
  "What's my most expensive project?"
  "Are any machines hitting rate limits?"

Run: python -m claude_telemetry.mcp_server
Transport: stdio (default for Claude Code)
"""

from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Any

from mcp.server.fastmcp import FastMCP

from .config import load_config

mcp = FastMCP("claude-telemetry")


def _get_client() -> Any:
    """Create Supabase client from agent config."""
    from supabase import create_client

    config = load_config()
    return create_client(config["supabase_url"], config["supabase_service_key"])


def _fmt(val: Any) -> str:
    """Format a value for display — handle Decimal, None, etc."""
    if val is None:
        return "—"
    if isinstance(val, (int, float)):
        return f"{val:,.2f}" if isinstance(val, float) else f"{val:,}"
    return str(val)


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------


@mcp.tool()
def get_daily_usage(days: int = 7, machine_id: str | None = None) -> str:
    """Get daily token usage and costs across all machines.

    Returns per-day breakdown with total cost, tokens, and model-level costs
    (Opus, Sonnet, Haiku). Useful for tracking spending trends.

    Args:
        days: Number of days to look back (default 7)
        machine_id: Optional UUID to filter to a specific machine
    """
    client = _get_client()
    end = date.today().isoformat()
    start = (date.today() - timedelta(days=days)).isoformat()

    params: dict[str, Any] = {"p_start_date": start, "p_end_date": end}
    if machine_id:
        params["p_machine_id"] = machine_id

    result = client.rpc("get_usage_summary", params).execute()
    rows = result.data or []

    if not rows:
        return f"No usage data found for the last {days} days."

    total_cost = sum(float(r.get("total_cost", 0) or 0) for r in rows)
    total_tokens = sum(int(r.get("total_tokens", 0) or 0) for r in rows)

    lines = [f"Daily usage — last {days} days (total: ${total_cost:,.2f}, {total_tokens:,} tokens)\n"]
    lines.append(f"{'Date':<12} {'Cost':>10} {'Tokens':>14} {'Opus':>10} {'Sonnet':>10} {'Haiku':>10}")
    lines.append("-" * 70)
    for r in rows:
        lines.append(
            f"{r['date']:<12} "
            f"${float(r.get('total_cost', 0) or 0):>9,.2f} "
            f"{int(r.get('total_tokens', 0) or 0):>13,} "
            f"${float(r.get('opus_cost', 0) or 0):>9,.2f} "
            f"${float(r.get('sonnet_cost', 0) or 0):>9,.2f} "
            f"${float(r.get('haiku_cost', 0) or 0):>9,.2f}"
        )

    return "\n".join(lines)


@mcp.tool()
def get_weekly_usage(weeks: int = 4, machine_id: str | None = None) -> str:
    """Get weekly usage summaries with cost projections.

    Shows per-week cost, tokens, average daily cost, and projected weekly cost.

    Args:
        weeks: Number of weeks to show (default 4)
        machine_id: Optional UUID to filter to a specific machine
    """
    client = _get_client()

    params: dict[str, Any] = {}
    if machine_id:
        params["p_machine_id"] = machine_id

    result = client.rpc("get_weekly_rate_estimate", params).execute()
    rows = result.data or []

    # Limit to requested weeks
    rows = rows[:weeks]

    if not rows:
        return "No weekly usage data available."

    lines = ["Weekly usage summary\n"]
    lines.append(f"{'Week Start':<12} {'Cost':>10} {'Tokens':>14} {'Avg/Day':>10} {'Projected':>10} {'Days':>5}")
    lines.append("-" * 65)
    for r in rows:
        lines.append(
            f"{r['week_start']:<12} "
            f"${float(r.get('week_cost', 0) or 0):>9,.2f} "
            f"{int(r.get('week_tokens', 0) or 0):>13,} "
            f"${float(r.get('avg_daily_cost', 0) or 0):>9,.2f} "
            f"${float(r.get('projected_weekly_cost', 0) or 0):>9,.2f} "
            f"{r.get('days_active', 0):>5}"
        )

    return "\n".join(lines)


@mcp.tool()
def get_active_blocks() -> str:
    """Get currently active 5-hour billing blocks across all machines.

    Shows which machines have active blocks, their cost, duration, and
    token usage. Useful for checking real-time spending.
    """
    client = _get_client()

    result = (
        client.table("blocks")
        .select("*, machines(name)")
        .eq("is_active", True)
        .order("block_start", desc=True)
        .execute()
    )
    rows = result.data or []

    if not rows:
        return "No active billing blocks right now."

    lines = [f"{len(rows)} active block(s)\n"]
    for r in rows:
        machine_name = r.get("machines", {}).get("name", "unknown") if r.get("machines") else "unknown"
        cost = float(r.get("cost_usd", 0) or 0)
        duration = r.get("duration_minutes", 0)
        tokens = int(r.get("total_tokens", 0) or 0)
        models = ", ".join(r.get("models", []))
        lines.append(
            f"Machine: {machine_name}\n"
            f"  Started: {r.get('block_start', '?')}\n"
            f"  Duration: {duration} min | Cost: ${cost:.2f} | Tokens: {tokens:,}\n"
            f"  Models: {models or '—'}"
        )

    return "\n".join(lines)


@mcp.tool()
def get_rate_limits(machine_id: str | None = None) -> str:
    """Get current rate limit status (5-hour and weekly windows).

    Shows the latest rate limit percentages for each machine.
    High values (>80%) indicate approaching the limit.

    Args:
        machine_id: Optional UUID to filter to a specific machine
    """
    client = _get_client()

    query = (
        client.table("rate_limits")
        .select("*, machines(name)")
        .order("timestamp", desc=True)
        .limit(20)
    )
    if machine_id:
        query = query.eq("machine_id", machine_id)

    result = query.execute()
    rows = result.data or []

    if not rows:
        return "No rate limit data available. Make sure ccost is installed and setup-statusline is configured."

    # Group by machine, show latest per machine
    seen: dict[str, dict] = {}
    for r in rows:
        mid = r.get("machine_id", "")
        if mid not in seen:
            seen[mid] = r

    lines = ["Rate limit status\n"]
    for mid, r in seen.items():
        machine_name = r.get("machines", {}).get("name", mid[:8]) if r.get("machines") else mid[:8]
        w5h = r.get("window_5h_percent")
        w1w = r.get("window_1w_percent")
        w5h_str = f"{w5h:.1f}%" if w5h is not None else "—"
        w1w_str = f"{w1w:.1f}%" if w1w is not None else "—"
        warning = " ⚠" if (w5h and w5h > 80) or (w1w and w1w > 80) else ""
        lines.append(f"{machine_name}: 5h={w5h_str}, weekly={w1w_str}{warning}")

    return "\n".join(lines)


@mcp.tool()
def get_machines() -> str:
    """List all registered machines with their usage stats.

    Shows machine name, total cost, tokens, days active, last activity,
    and top project for each machine.
    """
    client = _get_client()

    result = client.rpc("get_machine_summary", {
        "p_start_date": "2020-01-01",
        "p_end_date": date.today().isoformat(),
    }).execute()
    rows = result.data or []

    if not rows:
        return "No machines registered. Deploy an agent first."

    lines = [f"{len(rows)} machine(s)\n"]
    lines.append(f"{'Name':<20} {'Cost':>10} {'Tokens':>14} {'Days':>5} {'Last Active':<12} {'Top Project'}")
    lines.append("-" * 80)
    for r in rows:
        lines.append(
            f"{(r.get('machine_name') or '?'):<20} "
            f"${float(r.get('total_cost', 0) or 0):>9,.2f} "
            f"{int(r.get('total_tokens', 0) or 0):>13,} "
            f"{r.get('days_active', 0):>5} "
            f"{str(r.get('last_activity', '—')):<12} "
            f"{r.get('top_project') or '—'}"
        )

    return "\n".join(lines)


@mcp.tool()
def get_projects(days: int = 30, limit: int = 10, machine_id: str | None = None) -> str:
    """Get top projects ranked by cost.

    Shows project name, total cost, tokens, primary model, and number
    of machines using it.

    Args:
        days: Look-back period in days (default 30)
        limit: Max number of projects to return (default 10)
        machine_id: Optional UUID to filter to a specific machine
    """
    client = _get_client()
    end = date.today().isoformat()
    start = (date.today() - timedelta(days=days)).isoformat()

    params: dict[str, Any] = {"p_start_date": start, "p_end_date": end}
    if machine_id:
        params["p_machine_id"] = machine_id

    result = client.rpc("get_project_costs", params).execute()
    rows = result.data or []
    rows = rows[:limit]

    if not rows:
        return f"No project data found for the last {days} days."

    total = sum(float(r.get("total_cost", 0) or 0) for r in rows)
    lines = [f"Top {len(rows)} projects — last {days} days (total: ${total:,.2f})\n"]
    lines.append(f"{'#':<3} {'Project':<30} {'Cost':>10} {'Tokens':>14} {'Model':<15} {'Machines':>8}")
    lines.append("-" * 85)
    for i, r in enumerate(rows, 1):
        lines.append(
            f"{i:<3} "
            f"{(r.get('project') or '?'):<30} "
            f"${float(r.get('total_cost', 0) or 0):>9,.2f} "
            f"{int(r.get('total_tokens', 0) or 0):>13,} "
            f"{(r.get('primary_model') or '—'):<15} "
            f"{r.get('machines_used', 0):>8}"
        )

    return "\n".join(lines)


@mcp.tool()
def get_plan_savings(days: int = 30) -> str:
    """Calculate plan savings vs API equivalent cost.

    Compares your Claude subscription cost against what the same usage
    would cost via the API. Only works if a plan is configured in Settings.

    Args:
        days: Look-back period in days (default 30)
    """
    client = _get_client()

    # Get plan info from user_preferences
    prefs_result = client.table("user_preferences").select("plan_cost, plan_name").limit(1).execute()
    prefs = prefs_result.data[0] if prefs_result.data else {}
    plan_cost = prefs.get("plan_cost")
    plan_name = prefs.get("plan_name", "unknown")

    if not plan_cost:
        return "No plan configured. Set your plan in Dashboard → Settings → Your Plan."

    # Get usage cost (API equivalent)
    end = date.today().isoformat()
    start = (date.today() - timedelta(days=days)).isoformat()

    result = client.rpc("get_usage_summary", {"p_start_date": start, "p_end_date": end}).execute()
    rows = result.data or []
    api_cost = sum(float(r.get("total_cost", 0) or 0) for r in rows)

    # Scale to monthly if period != 30 days
    monthly_api_cost = api_cost * (30 / days) if days != 30 else api_cost

    savings = monthly_api_cost - float(plan_cost)
    roi = (savings / float(plan_cost) * 100) if float(plan_cost) > 0 else 0

    lines = [
        "Plan savings analysis\n",
        f"Plan:              {plan_name} (${float(plan_cost):,.0f}/mo)",
        f"API equivalent:    ${monthly_api_cost:,.2f}/mo (based on last {days} days)",
        f"Savings:           ${savings:,.2f}/mo ({roi:,.0f}% ROI)",
    ]

    if savings > 0:
        lines.append(f"\nYour plan saves you ${savings:,.2f} per month vs API pricing.")
    else:
        lines.append(f"\nYour usage (${monthly_api_cost:,.2f}/mo) is below the plan cost. Consider downgrading.")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
