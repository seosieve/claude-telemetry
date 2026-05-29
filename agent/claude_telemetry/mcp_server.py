"""MCP Server for claude-telemetry — query aggregated usage data from all machines.

Exposes tools that Claude Code can call via natural language:
  "How much did I spend this week?"
  "What's my most expensive project?"
  "Are any machines hitting rate limits?"

Run: python -m claude_telemetry.mcp_server
Transport: stdio (default for Claude Code)
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import httpx
from mcp.server.fastmcp import FastMCP

from .config import INGEST_BASE_URL

mcp = FastMCP("cc-telemetry")


def _api_get(path: str, params: dict[str, Any] | None = None) -> Any:
    """GET a dashboard Functions read endpoint and return parsed JSON.

    Read endpoints run in guest mode (no auth), so no Authorization header is
    needed. None-valued params are dropped so optional filters can be omitted.
    """
    resp = httpx.get(
        f"{INGEST_BASE_URL}{path}",
        params={k: v for k, v in (params or {}).items() if v is not None},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def _machine_names() -> dict[str, str]:
    """Build a machine_id -> name map from /api/machines (all machines)."""
    rows = _api_get("/api/machines", {"active_only": "false"}) or []
    return {r.get("id"): r.get("name") for r in rows if r.get("id")}


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
    end = date.today().isoformat()
    start = (date.today() - timedelta(days=days)).isoformat()

    rows = _api_get(
        "/api/usage-summary",
        {"start_date": start, "end_date": end, "machine_id": machine_id},
    ) or []

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
    rows = _api_get("/api/weekly-estimate", {"machine_id": machine_id}) or []

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
    rows = _api_get("/api/blocks", {"active_only": "true"}) or []

    if not rows:
        return "No active billing blocks right now."

    # /api/blocks returns raw block rows without the machines(name) join, so
    # resolve machine names separately via /api/machines.
    names = _machine_names()

    lines = [f"{len(rows)} active block(s)\n"]
    for r in rows:
        machine_name = names.get(r.get("machine_id"), "unknown")
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
    rows = _api_get(
        "/api/rate-limits",
        {"machine_id": machine_id, "limit": "20"},
    ) or []

    if not rows:
        return "No rate limit data available. Make sure ccost is installed and setup-statusline is configured."

    # /api/rate-limits returns raw rows without the machines(name) join, so
    # resolve machine names separately via /api/machines.
    names = _machine_names()

    # Group by machine, show latest per machine
    seen: dict[str, dict] = {}
    for r in rows:
        mid = r.get("machine_id", "")
        if mid not in seen:
            seen[mid] = r

    lines = ["Rate limit status\n"]
    for mid, r in seen.items():
        machine_name = names.get(mid) or (mid[:8] if mid else "unknown")
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
    rows = _api_get(
        "/api/machine-summary",
        {"start_date": "2020-01-01", "end_date": date.today().isoformat()},
    ) or []

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
    end = date.today().isoformat()
    start = (date.today() - timedelta(days=days)).isoformat()

    rows = _api_get(
        "/api/project-costs",
        {"start_date": start, "end_date": end, "machine_id": machine_id},
    ) or []
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
    # Get plan info from user_preferences (single object response)
    prefs = _api_get("/api/preferences") or {}
    plan_cost = prefs.get("plan_cost")
    plan_name = prefs.get("plan_name", "unknown")

    if not plan_cost:
        return "No plan configured. Set your plan in Dashboard → Settings → Your Plan."

    # Get usage cost (API equivalent)
    end = date.today().isoformat()
    start = (date.today() - timedelta(days=days)).isoformat()

    rows = _api_get("/api/usage-summary", {"start_date": start, "end_date": end}) or []
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
# Analytics tools
# ---------------------------------------------------------------------------


def _resolve_period(name: str) -> tuple[str, str, str]:
    """Resolve a named period to (start, end, label)."""
    today = date.today()
    periods: dict[str, tuple[str, str, str]] = {
        "today": (today.isoformat(), today.isoformat(), "Today"),
        "yesterday": ((today - timedelta(days=1)).isoformat(), (today - timedelta(days=1)).isoformat(), "Yesterday"),
        "this_week": ((today - timedelta(days=today.weekday())).isoformat(), today.isoformat(), "This week"),
        "last_week": (
            (today - timedelta(days=today.weekday() + 7)).isoformat(),
            (today - timedelta(days=today.weekday() + 1)).isoformat(),
            "Last week",
        ),
        "this_month": (today.replace(day=1).isoformat(), today.isoformat(), "This month"),
        "last_month": (
            (today.replace(day=1) - timedelta(days=1)).replace(day=1).isoformat(),
            (today.replace(day=1) - timedelta(days=1)).isoformat(),
            "Last month",
        ),
    }
    if name not in periods:
        raise ValueError(f"Unknown period '{name}'. Use: {', '.join(periods)}")
    return periods[name]


def _sum_usage(rows: list[dict]) -> tuple[float, int]:
    """Sum cost and tokens from usage rows."""
    cost = sum(float(r.get("total_cost", 0) or 0) for r in rows)
    tokens = sum(int(r.get("total_tokens", 0) or 0) for r in rows)
    return cost, tokens


def _pct_change(old: float, new: float) -> str:
    if old == 0:
        return "+100%" if new > 0 else "0%"
    pct = ((new - old) / old) * 100
    return f"{pct:+.1f}%"


@mcp.tool()
def compare_periods(
    period_a: str = "last_week",
    period_b: str = "this_week",
    machine_id: str | None = None,
) -> str:
    """Compare usage between two time periods.

    Shows cost and token differences, percentage changes, and which
    projects changed the most between periods.

    Args:
        period_a: First period (today, yesterday, this_week, last_week, this_month, last_month)
        period_b: Second period (same options)
        machine_id: Optional UUID to filter to a specific machine
    """
    start_a, end_a, label_a = _resolve_period(period_a)
    start_b, end_b, label_b = _resolve_period(period_b)

    rows_a = _api_get(
        "/api/usage-summary",
        {"start_date": start_a, "end_date": end_a, "machine_id": machine_id},
    ) or []
    rows_b = _api_get(
        "/api/usage-summary",
        {"start_date": start_b, "end_date": end_b, "machine_id": machine_id},
    ) or []

    cost_a, tokens_a = _sum_usage(rows_a)
    cost_b, tokens_b = _sum_usage(rows_b)
    diff_cost = cost_b - cost_a
    diff_tokens = tokens_b - tokens_a

    lines = [
        f"Period comparison: {label_a} vs {label_b}\n",
        f"{'':20s} {label_a:>14s} {label_b:>14s} {'Change':>10s}",
        "-" * 62,
        f"{'Cost':<20s} ${cost_a:>13,.2f} ${cost_b:>13,.2f} {_pct_change(cost_a, cost_b):>10s}",
        f"{'Tokens':<20s} {tokens_a:>14,} {tokens_b:>14,} {_pct_change(tokens_a, tokens_b):>10s}",
    ]

    # Top movers by project
    projs_a = _api_get(
        "/api/project-costs",
        {"start_date": start_a, "end_date": end_a, "machine_id": machine_id},
    ) or []
    projs_b = _api_get(
        "/api/project-costs",
        {"start_date": start_b, "end_date": end_b, "machine_id": machine_id},
    ) or []

    cost_map_a = {p["project"]: float(p.get("total_cost", 0) or 0) for p in projs_a}
    cost_map_b = {p["project"]: float(p.get("total_cost", 0) or 0) for p in projs_b}
    all_projects = set(cost_map_a) | set(cost_map_b)

    movers = []
    for proj in all_projects:
        ca = cost_map_a.get(proj, 0)
        cb = cost_map_b.get(proj, 0)
        movers.append((proj, cb - ca, ca, cb))

    movers.sort(key=lambda x: abs(x[1]), reverse=True)

    if movers:
        lines.append(f"\nTop movers:")
        for proj, diff, ca, cb in movers[:5]:
            arrow = "+" if diff >= 0 else ""
            lines.append(f"  {proj:<30s} ${ca:>8,.2f} -> ${cb:>8,.2f} ({arrow}${diff:,.2f})")

    return "\n".join(lines)


@mcp.tool()
def get_trends(days: int = 30, machine_id: str | None = None) -> str:
    """Analyze usage trends over time.

    Calculates trend direction (up/down/stable), average daily cost,
    and a 7-day projection based on recent patterns.

    Args:
        days: Number of days to analyze (default 30)
        machine_id: Optional UUID to filter to a specific machine
    """
    import statistics

    end = date.today().isoformat()
    start = (date.today() - timedelta(days=days)).isoformat()

    rows = _api_get(
        "/api/usage-summary",
        {"start_date": start, "end_date": end, "machine_id": machine_id},
    ) or []

    if len(rows) < 3:
        return f"Not enough data for trend analysis (need 3+ days, have {len(rows)})."

    daily_costs = [float(r.get("total_cost", 0) or 0) for r in rows]
    avg = statistics.mean(daily_costs)
    stdev = statistics.stdev(daily_costs) if len(daily_costs) > 1 else 0

    # Simple linear regression: y = mx + b
    n = len(daily_costs)
    x_vals = list(range(n))
    x_mean = statistics.mean(x_vals)
    y_mean = avg
    numerator = sum((x - x_mean) * (y - y_mean) for x, y in zip(x_vals, daily_costs))
    denominator = sum((x - x_mean) ** 2 for x in x_vals)
    slope = numerator / denominator if denominator else 0
    intercept = y_mean - slope * x_mean

    # Trend direction
    if abs(slope) < avg * 0.02:
        direction = "STABLE"
    elif slope > 0:
        direction = "UP"
    else:
        direction = "DOWN"

    # 7-day projection
    projected = [slope * (n + i) + intercept for i in range(7)]
    proj_total = sum(max(0, p) for p in projected)

    # Recent vs earlier comparison
    mid = n // 2
    first_half_avg = statistics.mean(daily_costs[:mid]) if mid > 0 else 0
    second_half_avg = statistics.mean(daily_costs[mid:])

    lines = [
        f"Usage trend — last {days} days\n",
        f"Direction:       {direction} ({slope:+.4f} $/day)",
        f"Avg daily cost:  ${avg:,.2f}",
        f"Std deviation:   ${stdev:,.2f}",
        f"First half avg:  ${first_half_avg:,.2f}/day",
        f"Second half avg: ${second_half_avg:,.2f}/day ({_pct_change(first_half_avg, second_half_avg)})",
        f"\n7-day projection: ${proj_total:,.2f} total (${proj_total / 7:,.2f}/day avg)",
    ]

    return "\n".join(lines)


@mcp.tool()
def detect_anomalies(days: int = 14, threshold_std: float = 2.0) -> str:
    """Detect days with unusually high or low spending.

    Flags days where cost deviates more than N standard deviations
    from the mean. Useful for catching unexpected spikes.

    Args:
        days: Number of days to analyze (default 14)
        threshold_std: Number of standard deviations to flag (default 2.0)
    """
    import statistics

    end = date.today().isoformat()
    start = (date.today() - timedelta(days=days)).isoformat()

    rows = _api_get("/api/usage-summary", {"start_date": start, "end_date": end}) or []

    if len(rows) < 3:
        return f"Not enough data (need 3+ days, have {len(rows)})."

    daily_costs = [(r.get("date", "?"), float(r.get("total_cost", 0) or 0)) for r in rows]
    costs = [c for _, c in daily_costs]
    avg = statistics.mean(costs)
    stdev = statistics.stdev(costs)

    if stdev == 0:
        return f"No variation in daily costs over the last {days} days (avg: ${avg:,.2f}/day)."

    anomalies = []
    for dt, cost in daily_costs:
        z = (cost - avg) / stdev
        if abs(z) >= threshold_std:
            diff = cost - avg
            anomalies.append((dt, cost, diff, z))

    if not anomalies:
        return (
            f"No anomalies detected in the last {days} days.\n"
            f"Average: ${avg:,.2f}/day, StdDev: ${stdev:,.2f}, Threshold: {threshold_std}x"
        )

    lines = [
        f"Anomalies detected — last {days} days (avg: ${avg:,.2f}/day, threshold: {threshold_std}x StdDev)\n",
        f"{'Date':<12s} {'Cost':>10s} {'vs Avg':>10s} {'Z-score':>8s}",
        "-" * 44,
    ]
    for dt, cost, diff, z in anomalies:
        arrow = "+" if diff >= 0 else ""
        lines.append(f"{dt:<12s} ${cost:>9,.2f} {arrow}${diff:>8,.2f} {z:>+8.1f}")

    return "\n".join(lines)


@mcp.tool()
def compare_projects(project_a: str, project_b: str, days: int = 30) -> str:
    """Compare two projects side by side.

    Shows cost, tokens, and percentage difference for each metric.

    Args:
        project_a: First project name
        project_b: Second project name
        days: Look-back period in days (default 30)
    """
    end = date.today().isoformat()
    start = (date.today() - timedelta(days=days)).isoformat()

    rows = _api_get("/api/project-costs", {"start_date": start, "end_date": end}) or []

    proj_map = {r["project"]: r for r in rows}
    a = proj_map.get(project_a)
    b = proj_map.get(project_b)

    if not a and not b:
        return f"Neither '{project_a}' nor '{project_b}' found in the last {days} days."
    if not a:
        return f"Project '{project_a}' not found. '{project_b}' cost: ${float(b.get('total_cost', 0) or 0):,.2f}"
    if not b:
        return f"Project '{project_b}' not found. '{project_a}' cost: ${float(a.get('total_cost', 0) or 0):,.2f}"

    cost_a = float(a.get("total_cost", 0) or 0)
    cost_b = float(b.get("total_cost", 0) or 0)
    tokens_a = int(a.get("total_tokens", 0) or 0)
    tokens_b = int(b.get("total_tokens", 0) or 0)
    model_a = a.get("primary_model") or "—"
    model_b = b.get("primary_model") or "—"
    machines_a = a.get("machines_used", 0)
    machines_b = b.get("machines_used", 0)

    lines = [
        f"Project comparison — last {days} days\n",
        f"{'':15s} {project_a:>20s} {project_b:>20s} {'Diff':>10s}",
        "-" * 68,
        f"{'Cost':<15s} ${cost_a:>19,.2f} ${cost_b:>19,.2f} {_pct_change(cost_a, cost_b):>10s}",
        f"{'Tokens':<15s} {tokens_a:>20,} {tokens_b:>20,} {_pct_change(tokens_a, tokens_b):>10s}",
        f"{'Primary model':<15s} {model_a:>20s} {model_b:>20s}",
        f"{'Machines':<15s} {machines_a:>20} {machines_b:>20}",
    ]

    if cost_a + cost_b > 0:
        winner = project_a if cost_a < cost_b else project_b
        lines.append(f"\n{winner} is cheaper by ${abs(cost_b - cost_a):,.2f}")

    return "\n".join(lines)


@mcp.tool()
def get_cost_forecast(days_ahead: int = 7) -> str:
    """Forecast future costs based on recent usage patterns.

    Uses a 14-day moving average with trend adjustment to project
    costs for the next N days.

    Args:
        days_ahead: Number of days to forecast (default 7)
    """
    import statistics

    lookback = 14
    end = date.today().isoformat()
    start = (date.today() - timedelta(days=lookback)).isoformat()

    rows = _api_get("/api/usage-summary", {"start_date": start, "end_date": end}) or []

    if len(rows) < 3:
        return f"Not enough data for forecast (need 3+ days, have {len(rows)})."

    daily_costs = [float(r.get("total_cost", 0) or 0) for r in rows]
    n = len(daily_costs)
    avg = statistics.mean(daily_costs)
    stdev = statistics.stdev(daily_costs) if n > 1 else 0

    # Linear regression for trend
    x_vals = list(range(n))
    x_mean = statistics.mean(x_vals)
    numerator = sum((x - x_mean) * (y - avg) for x, y in zip(x_vals, daily_costs))
    denominator = sum((x - x_mean) ** 2 for x in x_vals)
    slope = numerator / denominator if denominator else 0
    intercept = avg - slope * x_mean

    # Project forward
    forecasts = []
    for i in range(days_ahead):
        day_idx = n + i
        predicted = max(0, slope * day_idx + intercept)
        forecasts.append(predicted)

    total = sum(forecasts)
    avg_forecast = total / days_ahead if days_ahead > 0 else 0
    low = sum(max(0, f - stdev) for f in forecasts)
    high = sum(f + stdev for f in forecasts)

    lines = [
        f"Cost forecast — next {days_ahead} days (based on last {n} days)\n",
        f"Predicted total:  ${total:,.2f}",
        f"Daily average:    ${avg_forecast:,.2f}/day",
        f"Confidence range: ${low:,.2f} — ${high:,.2f}",
        f"Trend:            {slope:+.4f} $/day",
        f"\nRecent average:   ${avg:,.2f}/day (last {n} days)",
    ]

    # Day-by-day forecast
    lines.append(f"\n{'Day':<5s} {'Date':<12s} {'Predicted':>10s}")
    lines.append("-" * 30)
    for i, cost in enumerate(forecasts):
        d = date.today() + timedelta(days=i + 1)
        lines.append(f"{i + 1:<5d} {d.isoformat():<12s} ${cost:>9,.2f}")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
