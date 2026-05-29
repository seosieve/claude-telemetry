import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useUsageData } from "../hooks/useUsageData";
import { useMachineFilter } from "../hooks/useMachineFilter";
import { fetchStatsExtra } from "../lib/api";
import { rangeToDate, groupByWeek, fillDateGaps } from "../lib/dateUtils";
import { EmptyState } from "../components/EmptyState";
import { EmptyChart } from "../components/illustrations/EmptyChart";
import { Spinner } from "../components/Spinner";
import { usePreferences } from "../hooks/usePreferences";
import { DateRangePicker } from "../components/filters/DateRangePicker";
import { MODEL_COLORS } from "../lib/colors";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

export function Daily() {
  const [range, setRange] = useState("30d");
  const [view, setView] = useState<"daily" | "weekly">("daily");
  const dateRange = useMemo(() => rangeToDate(range), [range]);
  const { summary, loading } = useUsageData(dateRange);
  const { machineId } = useMachineFilter();
  const { prefs } = usePreferences();

  const filledSummary = useMemo(
    () =>
      fillDateGaps(summary, dateRange.start, dateRange.end, (date) => ({
        date,
        total_cost: 0,
        total_tokens: 0,
        opus_cost: 0,
        sonnet_cost: 0,
        haiku_cost: 0,
        machine_count: 0,
      })),
    [summary, dateRange],
  );

  const weeklyData = useMemo(
    () => groupByWeek(summary, prefs.week_start_day),
    [summary, prefs.week_start_day],
  );

  // Alert: current week vs average of last 4
  const weeklyAlert = useMemo(() => {
    if (weeklyData.length < 2) return null;
    const current = weeklyData[weeklyData.length - 1];
    const prev = weeklyData.slice(0, -1).slice(-4);
    const avg = prev.reduce((s, w) => s + w.totalCost, 0) / prev.length;
    if (current.totalCost > avg * 1.2) {
      return `This week ($${current.totalCost.toFixed(2)}) is ${((current.totalCost / avg - 1) * 100).toFixed(0)}% above your 4-week average ($${avg.toFixed(2)})`;
    }
    return null;
  }, [weeklyData]);

  const statsQ = useQuery({
    queryKey: ["stats-extra", machineId],
    queryFn: () => fetchStatsExtra(machineId) as Promise<Array<{ hour_counts?: Record<string, number> }>>,
  });
  const hourCounts = useMemo<Record<string, number> | null>(() => {
    const arr = statsQ.data;
    if (arr && arr.length > 0 && arr[0].hour_counts) return arr[0].hour_counts;
    return null;
  }, [statsQ.data]);
  const statsError = statsQ.error?.message ?? null;

  // Top 10 most expensive days
  const top10 = [...summary]
    .sort((a, b) => b.total_cost - a.total_cost)
    .slice(0, 10);

  // Hour heatmap data
  const heatmapData = useMemo(() => {
    if (!hourCounts) return [];
    return Array.from({ length: 24 }, (_, i) => ({
      hour: `${String(i).padStart(2, "0")}:00`,
      count: hourCounts[String(i)] || 0,
    }));
  }, [hourCounts]);

  const maxCount = Math.max(1, ...heatmapData.map((d) => d.count));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Usage</h2>
        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-lg border border-white/[0.06] bg-white/[0.02] p-1">
            {(["daily", "weekly"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  view === v
                    ? "bg-white/[0.08] text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
          <DateRangePicker value={range} onChange={setRange} />
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Spinner />
          Loading...
        </div>
      )}

      {/* Weekly alert */}
      {view === "weekly" && weeklyAlert && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
          <p className="text-xs text-amber-400">{"\u26A0\uFE0F"} {weeklyAlert}</p>
        </div>
      )}

      {/* Chart */}
      {!loading && summary.length === 0 && (
        <EmptyState
          illustration={<EmptyChart />}
          title="No daily usage yet"
          description="Daily charts will appear once your agent syncs data."
          action={{ label: "View install guide", href: "#deploy" }}
        />
      )}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4" style={!loading && summary.length === 0 ? { display: "none" } : {}}>
        <h3 className="mb-4 text-sm font-medium">
          {view === "daily" ? "Daily Cost by Model" : "Weekly Cost by Model"}
        </h3>
        {view === "daily" ? (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={filledSummary} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(v: string) => v.slice(5)} />
              <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(v: number) => `$${v}`} />
              <Tooltip
                contentStyle={{ backgroundColor: "#0f172a", border: "1px solid rgb(51,65,85)", borderRadius: 8, fontSize: 12 }}
                formatter={(v: number) => [`$${v.toFixed(2)}`, ""]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
              <Area type="monotone" dataKey="opus_cost" name="Opus" stackId="1" stroke={MODEL_COLORS.Opus} fill={MODEL_COLORS.Opus} fillOpacity={0.4} />
              <Area type="monotone" dataKey="sonnet_cost" name="Sonnet" stackId="1" stroke={MODEL_COLORS.Sonnet} fill={MODEL_COLORS.Sonnet} fillOpacity={0.4} />
              <Area type="monotone" dataKey="haiku_cost" name="Haiku" stackId="1" stroke={MODEL_COLORS.Haiku} fill={MODEL_COLORS.Haiku} fillOpacity={0.4} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={weeklyData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" />
              <XAxis dataKey="week" tick={{ fontSize: 10, fill: "#94a3b8" }} />
              <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(v: number) => `$${v}`} />
              <Tooltip
                contentStyle={{ backgroundColor: "#0f172a", border: "1px solid rgb(51,65,85)", borderRadius: 8, fontSize: 12, color: "white" }}
                formatter={(v: number) => [`$${v.toFixed(2)}`, ""]}
                labelStyle={{ color: "#cbd5e1" }}
                cursor={{ fill: "rgba(148,163,184,0.08)" }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
              <Bar dataKey="opusCost" name="Opus" stackId="1" fill={MODEL_COLORS.Opus} />
              <Bar dataKey="sonnetCost" name="Sonnet" stackId="1" fill={MODEL_COLORS.Sonnet} />
              <Bar dataKey="haikuCost" name="Haiku" stackId="1" fill={MODEL_COLORS.Haiku} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Top 10 days */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <h3 className="mb-3 text-sm font-medium">Top 10 Most Expensive Days</h3>
          <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/[0.06] text-slate-500">
                <th className="pb-2 text-left font-medium">#</th>
                <th className="pb-2 text-left font-medium">Date</th>
                <th className="pb-2 text-right font-medium">Cost</th>
                <th className="pb-2 text-right font-medium">Tokens</th>
              </tr>
            </thead>
            <tbody>
              {top10.map((day, i) => (
                <tr
                  key={day.date}
                  className="border-b border-white/[0.03] hover:bg-white/[0.02]"
                >
                  <td className="py-1.5 text-slate-500">{i + 1}</td>
                  <td className="py-1.5 font-mono">{day.date}</td>
                  <td className="py-1.5 text-right font-mono font-medium">
                    ${day.total_cost.toFixed(2)}
                  </td>
                  <td className="py-1.5 text-right font-mono text-slate-400">
                    {(day.total_tokens / 1_000_000).toFixed(1)}M
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>

        {/* Hour heatmap */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <h3 className="mb-3 text-sm font-medium">Activity by Hour</h3>
          {heatmapData.length > 0 ? (
            <div className="grid grid-cols-6 gap-1">
              {heatmapData.map((d) => {
                const intensity = d.count / maxCount;
                return (
                  <div
                    key={d.hour}
                    className="flex flex-col items-center gap-1 rounded p-1.5"
                    title={`${d.hour}: ${d.count} messages`}
                  >
                    <div
                      className="h-6 w-full rounded"
                      style={{
                        backgroundColor: `rgba(56, 189, 248, ${0.1 + intensity * 0.8})`,
                      }}
                    />
                    <span className="text-[9px] text-slate-600">{d.hour.slice(0, 2)}</span>
                  </div>
                );
              })}
            </div>
          ) : statsError ? (
            <p className="text-xs text-rose-400">Failed to load: {statsError}</p>
          ) : (
            <p className="text-xs text-slate-600">
              No hour data available. Stats cache needed.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
