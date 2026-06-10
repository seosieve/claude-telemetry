import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useUsageData } from "../hooks/useUsageData";
import { useAlertThresholds } from "../hooks/useAlertThresholds";
import { usePreferences } from "../hooks/usePreferences";
import { useMachineFilter } from "../hooks/useMachineFilter";
import { EmptyState } from "../components/EmptyState";
import { EmptyInsights } from "../components/illustrations/EmptyInsights";
import { Spinner } from "../components/Spinner";
import { fetchRateLimits, fetchTrends, fetchComparePeriods, type TrendsData, type ComparePeriodsData } from "../lib/api";
import { accountWeeklyPct } from "../lib/rateLimits";
import { daysAgo, today, formatTokens } from "../lib/dateUtils";
import { calculateUsagePace } from "../lib/burnRate";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceDot, ReferenceLine,
} from "recharts";

// --- Insight card (existing) ---

interface InsightCardProps {
  icon: string;
  title: string;
  text: string;
  color: "amber" | "rose" | "sky" | "emerald" | "violet";
}

function InsightCard({ icon, title, text, color }: InsightCardProps) {
  const colorMap = {
    amber: "border-amber-500/20 bg-amber-500/5 text-amber-400",
    rose: "border-rose-500/20 bg-rose-500/5 text-rose-400",
    sky: "border-sky-500/20 bg-sky-500/5 text-sky-400",
    emerald: "border-emerald-500/20 bg-emerald-500/5 text-emerald-400",
    violet: "border-violet-500/20 bg-violet-500/5 text-violet-400",
  };
  return (
    <div className={`rounded-xl border p-4 ${colorMap[color]}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">{icon}</span>
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      <p className="text-xs text-slate-400 leading-relaxed">{text}</p>
    </div>
  );
}

// --- Trend Card ---

function TrendCard({ trends }: { trends: TrendsData }) {
  if (trends.error) return null;

  const dirColor = trends.direction === "up" ? "text-rose-400" : trends.direction === "down" ? "text-emerald-400" : "text-slate-400";
  const dirBg = trends.direction === "up" ? "border-rose-500/20 bg-rose-500/5" : trends.direction === "down" ? "border-emerald-500/20 bg-emerald-500/5" : "border-white/[0.06] bg-white/[0.02]";
  const dirLabel = trends.direction === "up" ? "Trending Up" : trends.direction === "down" ? "Trending Down" : "Stable";
  const arrow = trends.direction === "up" ? "\u2191" : trends.direction === "down" ? "\u2193" : "\u2192";

  return (
    <div className={`rounded-xl border p-5 ${dirBg}`}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className={`text-sm font-semibold ${dirColor}`}>{arrow} {dirLabel}</h3>
          <p className="text-[10px] text-slate-500 mt-0.5">Last {trends.days} days</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold font-mono">${trends.avg.toFixed(2)}<span className="text-xs text-slate-500">/day</span></p>
          <p className="text-[10px] text-slate-500">{trends.slope >= 0 ? "+" : ""}{trends.slope.toFixed(4)} $/day</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4 text-xs">
        <div>
          <p className="text-slate-500">First half avg</p>
          <p className="font-mono font-medium">${trends.first_half_avg.toFixed(2)}/day</p>
        </div>
        <div>
          <p className="text-slate-500">Second half avg</p>
          <p className="font-mono font-medium">${trends.second_half_avg.toFixed(2)}/day</p>
        </div>
        <div>
          <p className="text-slate-500">Change</p>
          <p className={`font-mono font-medium ${trends.half_change_pct > 0 ? "text-rose-400" : trends.half_change_pct < 0 ? "text-emerald-400" : ""}`}>
            {trends.half_change_pct > 0 ? "+" : ""}{trends.half_change_pct.toFixed(1)}%
          </p>
        </div>
      </div>
    </div>
  );
}

// --- Cost Chart with anomalies + forecast ---

function CostChartWithForecast({ trends }: { trends: TrendsData }) {
  if (trends.error || !trends.daily_data?.length) return null;

  const chartData = [
    ...trends.daily_data.map((d) => ({
      date: d.date.slice(5),
      cost: d.cost,
      isAnomaly: d.is_anomaly,
      type: "actual" as const,
    })),
    ...trends.forecast.map((f) => {
      const d = new Date();
      d.setDate(d.getDate() + f.day);
      return {
        date: d.toISOString().slice(5, 10),
        forecast: f.predicted,
        type: "forecast" as const,
      };
    }),
  ];

  const anomalies = trends.daily_data.filter((d) => d.is_anomaly);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <h3 className="mb-4 text-sm font-medium">Daily Cost + Forecast</h3>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} />
          <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(v: number) => `$${v}`} />
          <Tooltip
            contentStyle={{ backgroundColor: "#0f172a", border: "1px solid rgb(51,65,85)", borderRadius: 8, fontSize: 12 }}
            formatter={(v: number, name: string) => [`$${v.toFixed(2)}`, name === "forecast" ? "Forecast" : "Cost"]}
          />
          <Area type="monotone" dataKey="cost" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.2} strokeWidth={2} />
          <Area type="monotone" dataKey="forecast" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.1} strokeWidth={2} strokeDasharray="6 3" />
          <ReferenceLine y={trends.avg} stroke="#64748b" strokeDasharray="3 3" label={{ value: "avg", fill: "#64748b", fontSize: 10, position: "right" }} />
          {anomalies.map((a) => (
            <ReferenceDot key={a.date} x={a.date.slice(5)} y={a.cost} r={5} fill="#ef4444" stroke="#ef4444" />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      {anomalies.length > 0 && (
        <p className="mt-2 text-[10px] text-rose-400">
          {anomalies.length} anomal{anomalies.length === 1 ? "y" : "ies"} detected (red dots = &gt;2 std deviations from mean)
        </p>
      )}
    </div>
  );
}

// --- Week-over-Week comparison ---

function WeekComparisonCard({ comparison }: { comparison: ComparePeriodsData }) {
  const a = comparison.period_a;
  const b = comparison.period_b;
  const costPct = comparison.cost_change_pct;
  const costColor = costPct > 10 ? "text-rose-400" : costPct < -10 ? "text-emerald-400" : "text-slate-300";

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <h3 className="mb-3 text-sm font-medium">Week-over-Week</h3>
      <div className="grid grid-cols-3 gap-4 text-xs">
        <div />
        <div className="text-center">
          <p className="text-slate-500">{a.label}</p>
          <p className="text-lg font-bold font-mono">${a.cost.toFixed(2)}</p>
          <p className="text-[10px] text-slate-500">{formatTokens(a.tokens)} tokens</p>
        </div>
        <div className="text-center">
          <p className="text-slate-500">{b.label}</p>
          <p className="text-lg font-bold font-mono">${b.cost.toFixed(2)}</p>
          <p className="text-[10px] text-slate-500">{formatTokens(b.tokens)} tokens</p>
        </div>
      </div>
      <div className="mt-3 text-center">
        <span className={`text-sm font-semibold font-mono ${costColor}`}>
          {costPct > 0 ? "+" : ""}{costPct.toFixed(1)}%
        </span>
        <span className="text-xs text-slate-500 ml-1">cost change</span>
      </div>
      {comparison.movers.length > 0 && (
        <div className="mt-3 border-t border-white/[0.06] pt-3">
          <p className="text-[10px] text-slate-500 mb-1.5">Top movers</p>
          {comparison.movers.slice(0, 3).map((m) => (
            <div key={m.project} className="flex items-center justify-between text-xs py-0.5">
              <span className="truncate max-w-[150px]">{m.project}</span>
              <span className={`font-mono ${m.diff > 0 ? "text-rose-400" : "text-emerald-400"}`}>
                {m.diff > 0 ? "+" : ""}${m.diff.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Forecast Card ---

function ForecastCard({ trends }: { trends: TrendsData }) {
  if (trends.error) return null;

  return (
    <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
      <h3 className="text-sm font-medium text-violet-400 mb-3">7-Day Forecast</h3>
      <div className="grid grid-cols-3 gap-4 text-xs">
        <div>
          <p className="text-slate-500">Predicted</p>
          <p className="text-lg font-bold font-mono text-white">${trends.forecast_total.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-slate-500">Low</p>
          <p className="font-mono font-medium text-emerald-400">${trends.forecast_low.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-slate-500">High</p>
          <p className="font-mono font-medium text-rose-400">${trends.forecast_high.toFixed(2)}</p>
        </div>
      </div>
      <div className="mt-3">
        <ResponsiveContainer width="100%" height={60}>
          <BarChart data={trends.forecast} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <Bar dataKey="predicted" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[10px] text-slate-500">
        ${(trends.forecast_total / 7).toFixed(2)}/day avg | Based on {trends.days}-day trend
      </p>
    </div>
  );
}

// --- Anomalies Table ---

function AnomaliesTable({ trends }: { trends: TrendsData }) {
  const anomalies = trends.daily_data?.filter((d) => d.is_anomaly) || [];
  if (anomalies.length === 0) return null;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <h3 className="mb-3 text-sm font-medium">Anomalies Detected</h3>
      <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/[0.06] text-slate-500">
            <th className="pb-2 text-left font-medium">Date</th>
            <th className="pb-2 text-right font-medium">Cost</th>
            <th className="pb-2 text-right font-medium">vs Avg</th>
            <th className="pb-2 text-right font-medium">Z-score</th>
          </tr>
        </thead>
        <tbody>
          {anomalies.map((a) => {
            const diff = a.cost - trends.avg;
            return (
              <tr key={a.date} className="border-b border-white/[0.03]">
                <td className="py-1.5 font-mono">{a.date}</td>
                <td className="py-1.5 text-right font-mono font-medium">${a.cost.toFixed(2)}</td>
                <td className={`py-1.5 text-right font-mono ${diff > 0 ? "text-rose-400" : "text-emerald-400"}`}>
                  {diff > 0 ? "+" : ""}${diff.toFixed(2)}
                </td>
                <td className="py-1.5 text-right font-mono text-rose-400">{a.z_score > 0 ? "+" : ""}{a.z_score}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

// --- MCP hint footer ---

function McpHint() {
  const [copied, setCopied] = useState<string | null>(null);
  const examples = [
    "How much did I spend this week vs last week?",
    "Any anomalies in my spending this month?",
    "What's my cost forecast for the next 7 days?",
  ];

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <p className="text-xs text-slate-400 mb-2">Want deeper analysis? Ask Claude in Claude Code:</p>
      <div className="space-y-1">
        {examples.map((ex) => (
          <button
            key={ex}
            onClick={() => { navigator.clipboard.writeText(ex); setCopied(ex); setTimeout(() => setCopied(null), 1500); }}
            className="block w-full text-left rounded px-2 py-1 text-[11px] font-mono text-sky-400 hover:bg-white/[0.04] transition-colors"
          >
            "{ex}" {copied === ex && <span className="text-emerald-400 ml-1">copied!</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

// --- Main Insights page ---

export function Insights() {
  const dateRange14 = useMemo(() => ({ start: daysAgo(14), end: today() }), []);
  const { summary, projects, machines, weeklyRates, loading } = useUsageData(dateRange14);
  const thresholdAlerts = useAlertThresholds(summary);
  const { prefs } = usePreferences();
  const { machineId } = useMachineFilter();

  const [trendDays, setTrendDays] = useState(30);

  // Rate limits are account-shared, so aggregate across all machines rather than
  // the active machine filter. 1w uses the min of per-machine latest readings
  // (accountWeeklyPct, which drops pre-reset peaks); 5h takes the max so the
  // warning stays conservative.
  const { data: rateLimitsArr } = useQuery({
    queryKey: ["rate-limits", undefined, "50"],
    queryFn: () => fetchRateLimits(undefined, "50") as Promise<Array<Record<string, unknown>>>,
  });
  const rateLimits = useMemo(() => {
    const arr = rateLimitsArr;
    if (!arr || arr.length === 0) return null;
    const latest5h = new Map<string, number>();
    for (const r of arr) {
      const mid = r.machine_id as string | undefined;
      const pct = r.window_5h_percent as number | null;
      if (mid == null || pct == null) continue;
      if (!latest5h.has(mid)) latest5h.set(mid, pct);
    }
    return {
      window_5h_percent: latest5h.size > 0 ? Math.max(...latest5h.values()) : undefined,
      window_1w_percent: accountWeeklyPct(arr) ?? undefined,
    };
  }, [rateLimitsArr]);

  const { data: trends = null } = useQuery<TrendsData | null>({
    queryKey: ["trends", trendDays, machineId],
    queryFn: () => fetchTrends(trendDays, machineId) as Promise<TrendsData>,
  });

  const { data: comparison = null } = useQuery<ComparePeriodsData | null>({
    queryKey: ["compare-periods", "last_week", "this_week", machineId],
    queryFn: () => fetchComparePeriods("last_week", "this_week", machineId) as Promise<ComparePeriodsData>,
  });

  // Build insight cards (existing logic)
  const insights: InsightCardProps[] = [];

  if (prefs.plan_cost != null && prefs.plan_cost > 0) {
    const activeDays14 = summary.length;
    const totalCost14 = summary.reduce((s, r) => s + r.total_cost, 0);
    const apiEquiv = activeDays14 > 0 ? (totalCost14 / activeDays14) * 30 : totalCost14;
    const savings = apiEquiv - prefs.plan_cost;
    const savingsPct = apiEquiv > 0 ? (savings / apiEquiv) * 100 : 0;
    if (savingsPct > 50) {
      insights.push({ icon: "\uD83D\uDCB0", title: "Great Plan Value", text: `Saving ${savingsPct.toFixed(0)}% vs API pricing ($${apiEquiv.toFixed(0)} API equiv vs $${prefs.plan_cost}/mo plan).`, color: "emerald" });
    } else if (savingsPct > 20) {
      insights.push({ icon: "\uD83D\uDCCA", title: "Decent Plan Value", text: `Saving ${savingsPct.toFixed(0)}% vs API pricing. Your plan is paying off.`, color: "sky" });
    } else if (savings > 0) {
      insights.push({ icon: "\uD83D\uDCA1", title: "Low Plan Utilization", text: `Only saving ${savingsPct.toFixed(0)}% vs API. Consider if your plan tier matches your usage.`, color: "amber" });
    } else {
      insights.push({ icon: "\uD83D\uDCC9", title: "Under Plan Cost", text: `API equivalent ($${apiEquiv.toFixed(0)}/mo) is less than your plan ($${prefs.plan_cost}/mo). Consider downgrading.`, color: "rose" });
    }
  }

  if (rateLimits) {
    if (rateLimits.window_5h_percent != null && rateLimits.window_5h_percent > 70) {
      insights.push({ icon: "\u26A0\uFE0F", title: "5-Hour Limit Warning", text: `5-hour rate limit at ${rateLimits.window_5h_percent.toFixed(0)}%. Consider switching to Sonnet for routine tasks.`, color: rateLimits.window_5h_percent > 90 ? "rose" : "amber" });
    }
    if (rateLimits.window_1w_percent != null && rateLimits.window_1w_percent > 80) {
      insights.push({ icon: "\uD83D\uDEA8", title: "Weekly Limit Critical", text: `Weekly rate limit at ${rateLimits.window_1w_percent.toFixed(0)}%. Reduce Opus usage to avoid throttling.`, color: "rose" });
    }
  } else {
    insights.push({ icon: "\uD83D\uDCA1", title: "Enable Rate Limit Tracking", text: "Run cc-telemetry setup-statusline to enable 5-hour and weekly rate limit monitoring.", color: "sky" });
  }

  for (const alert of thresholdAlerts) {
    insights.push({ icon: "\u26A0\uFE0F", title: alert.type === "daily" ? "Daily Cost Alert" : "Weekly Cost Alert", text: alert.message, color: "rose" });
  }

  const pace = calculateUsagePace(summary);
  if (pace) {
    const trendIcon = pace.trend === "increasing" ? "\uD83D\uDCC8" : pace.trend === "decreasing" ? "\uD83D\uDCC9" : "\uD83D\uDCCA";
    const trendLabel = pace.trend === "increasing" ? `up ${pace.trendPct.toFixed(0)}%` : pace.trend === "decreasing" ? `down ${Math.abs(pace.trendPct).toFixed(0)}%` : "steady";
    insights.push({ icon: trendIcon, title: "Usage Pace", text: `$${pace.avgDailyCost.toFixed(2)}/day avg | ~${formatTokens(pace.avgDailyTokens)} tokens/day | Projected: $${pace.projectedWeeklyCost.toFixed(0)}/week | Trend: ${trendLabel}`, color: pace.trend === "increasing" ? "amber" : pace.trend === "decreasing" ? "emerald" : "sky" });
  }

  if (prefs.project_budgets && Object.keys(prefs.project_budgets).length > 0) {
    for (const proj of projects) {
      const budget = prefs.project_budgets[proj.project];
      if (!budget) continue;
      const pct = (proj.total_cost / budget) * 100;
      if (pct > 100) {
        insights.push({ icon: "\u274C", title: "Over Budget", text: `${proj.project} over budget by $${(proj.total_cost - budget).toFixed(2)} ($${proj.total_cost.toFixed(2)}/$${budget})`, color: "rose" });
      } else if (pct > 90) {
        insights.push({ icon: "\uD83D\uDEA8", title: "Budget Warning", text: `${proj.project} at ${pct.toFixed(0)}% of monthly budget ($${proj.total_cost.toFixed(2)}/$${budget})`, color: "amber" });
      }
    }
  }

  const opusCost = summary.reduce((s, r) => s + r.opus_cost, 0);
  const totalCost14 = summary.reduce((s, r) => s + r.total_cost, 0);
  const opusPct = totalCost14 > 0 ? (opusCost / totalCost14) * 100 : 0;
  const activeDays14 = summary.length;
  if (opusPct > 70 && activeDays14 > 0) {
    const weeklySavings = (opusCost / activeDays14) * 7 * 0.5 * 0.8;
    insights.push({ icon: "\uD83D\uDCA1", title: "Model Optimization", text: `Opus accounts for ${opusPct.toFixed(0)}% of costs. Use /model sonnet for routine tasks. Est. savings: $${weeklySavings.toFixed(2)}/week.`, color: "amber" });
  }

  if (machines.length > 1) {
    const sorted = [...machines].sort((a, b) => b.total_cost - a.total_cost);
    const top = sorted[0];
    const active = machines.filter((m) => m.days_active > 0);
    const daily = active.reduce((s, m) => s + m.total_cost / Math.max(1, m.days_active), 0);
    insights.push({ icon: "\uD83D\uDDA5\uFE0F", title: "Cross-Machine Usage", text: `$${daily.toFixed(2)}/day across ${active.length} machines. Top: "${top.machine_name}" ($${top.total_cost.toFixed(2)}).`, color: "sky" });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Insights</h2>
          <p className="text-xs text-slate-500">Analytics, trends, and recommendations</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-white/[0.06] bg-white/[0.02] p-1">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setTrendDays(d)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${trendDays === d ? "bg-white/[0.08] text-white" : "text-slate-400 hover:text-slate-200"}`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Spinner />
          Analyzing...
        </div>
      )}

      {/* Trend Card */}
      {trends && !trends.error && <TrendCard trends={trends} />}

      {/* Cost Chart with anomalies + forecast line */}
      {trends && !trends.error && <CostChartWithForecast trends={trends} />}

      {/* Week-over-Week + Forecast side by side */}
      {(comparison || (trends && !trends.error)) && (
        <div className="grid gap-4 md:grid-cols-2">
          {comparison && <WeekComparisonCard comparison={comparison} />}
          {trends && !trends.error && <ForecastCard trends={trends} />}
        </div>
      )}

      {/* Anomalies table */}
      {trends && <AnomaliesTable trends={trends} />}

      {/* Rate limit progress bars */}
      {weeklyRates.length > 0 && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <h3 className="mb-2 text-sm font-medium">Weekly Rate Estimate</h3>
          <div className="space-y-2">
            {weeklyRates.slice(0, 4).map((w) => (
              <div key={w.week_start} className="flex items-center gap-3">
                <span className="w-20 text-xs font-mono text-slate-500">{w.week_start.slice(5)}</span>
                <div className="flex-1 h-3 rounded-full bg-white/[0.04]">
                  <div
                    className={`h-3 rounded-full ${w.week_cost > 150 ? "bg-fuchsia-500" : w.week_cost > 100 ? "bg-amber-500" : "bg-violet-500"}`}
                    style={{ width: `${Math.min(100, (w.week_cost / 200) * 100)}%` }}
                  />
                </div>
                <span className="w-16 text-right text-xs font-mono">${w.week_cost.toFixed(0)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Insight cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {insights.map((insight, i) => (
          <InsightCard key={i} {...insight} />
        ))}
      </div>

      {insights.length === 0 && !loading && !trends && (
        <EmptyState
          illustration={<EmptyInsights />}
          title="Insights coming soon"
          description="Available after 3+ days of usage data. Keep syncing and check back."
        />
      )}

      {/* MCP hint */}
      <McpHint />
    </div>
  );
}
