import { useState, useMemo, useEffect } from "react";
import { useUsageData } from "../hooks/useUsageData";
import { useMachineFilter } from "../hooks/useMachineFilter";
import { fetchStatsExtra } from "../lib/api";
import { DateRangePicker } from "../components/filters/DateRangePicker";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function rangeToDate(r: string) {
  const days = r === "7d" ? 7 : r === "90d" ? 90 : 30;
  return { start: daysAgo(days), end: today() };
}

export function Daily() {
  const [range, setRange] = useState("30d");
  const dateRange = useMemo(() => rangeToDate(range), [range]);
  const { summary, loading } = useUsageData(dateRange);
  const { machineId } = useMachineFilter();

  const [hourCounts, setHourCounts] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    fetchStatsExtra(machineId)
      .then((data) => {
        const arr = data as Array<{ hour_counts?: Record<string, number> }>;
        if (arr.length > 0 && arr[0].hour_counts) {
          setHourCounts(arr[0].hour_counts);
        }
      })
      .catch(() => {});
  }, [machineId]);

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
        <h2 className="text-xl font-semibold">Daily Usage</h2>
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-600 border-t-sky-400" />
          Loading...
        </div>
      )}

      {/* Stacked area chart */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <h3 className="mb-4 text-sm font-medium">Daily Cost by Model</h3>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={summary} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "#64748b" }}
              tickFormatter={(v: string) => v.slice(5)}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#64748b" }}
              tickFormatter={(v: number) => `$${v}`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#0f172a",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(v: number) => [`$${v.toFixed(2)}`, ""]}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
            <Area
              type="monotone"
              dataKey="opus_cost"
              name="Opus"
              stackId="1"
              stroke="#f43f5e"
              fill="#f43f5e"
              fillOpacity={0.4}
            />
            <Area
              type="monotone"
              dataKey="sonnet_cost"
              name="Sonnet"
              stackId="1"
              stroke="#38bdf8"
              fill="#38bdf8"
              fillOpacity={0.4}
            />
            <Area
              type="monotone"
              dataKey="haiku_cost"
              name="Haiku"
              stackId="1"
              stroke="#34d399"
              fill="#34d399"
              fillOpacity={0.4}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Top 10 days */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <h3 className="mb-3 text-sm font-medium">Top 10 Most Expensive Days</h3>
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
