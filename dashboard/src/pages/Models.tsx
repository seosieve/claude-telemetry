import { useState, useMemo } from "react";
import { useUsageData } from "../hooks/useUsageData";
import { rangeToDate } from "../lib/dateUtils";
import { DateRangePicker } from "../components/filters/DateRangePicker";
import { MODEL_COLORS, MODEL_CARD_CLASS } from "../lib/colors";
import { Spinner } from "../components/Spinner";
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

export function Models() {
  const [range, setRange] = useState("30d");
  const dateRange = useMemo(() => rangeToDate(range), [range]);
  const { summary, loading } = useUsageData(dateRange);

  const totalCost = summary.reduce((s, r) => s + r.total_cost, 0);
  const opusCost = summary.reduce((s, r) => s + r.opus_cost, 0);
  const sonnetCost = summary.reduce((s, r) => s + r.sonnet_cost, 0);
  const haikuCost = summary.reduce((s, r) => s + r.haiku_cost, 0);

  const opusPct = totalCost > 0 ? (opusCost / totalCost) * 100 : 0;
  const sonnetPct = totalCost > 0 ? (sonnetCost / totalCost) * 100 : 0;
  const haikuPct = totalCost > 0 ? (haikuCost / totalCost) * 100 : 0;

  // Model mix over time (percentage per day)
  const mixData = useMemo(
    () =>
      summary.map((row) => {
        const dayTotal = row.opus_cost + row.sonnet_cost + row.haiku_cost;
        return {
          date: row.date,
          opus: dayTotal > 0 ? (row.opus_cost / dayTotal) * 100 : 0,
          sonnet: dayTotal > 0 ? (row.sonnet_cost / dayTotal) * 100 : 0,
          haiku: dayTotal > 0 ? (row.haiku_cost / dayTotal) * 100 : 0,
        };
      }),
    [summary],
  );

  // Savings alert: if Opus > 80%, estimate savings if 50% of Opus were Sonnet
  const showSavingsAlert = opusPct > 80;
  // sonnet/opus price ratio ~0.2
  const estimatedSavings = opusCost * 0.5 * (1 - 0.2);
  const weeklyDays = summary.length || 1;
  const weeklySavings = (estimatedSavings / weeklyDays) * 7;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Models</h2>
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Spinner />
          Loading...
        </div>
      )}

      {/* Model metric cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className={`rounded-xl border p-4 ${MODEL_CARD_CLASS.opus.border}`}>
          <p className={`text-xs font-medium ${MODEL_CARD_CLASS.opus.text}`}>Opus</p>
          <p className={`mt-1 font-mono text-2xl font-semibold ${MODEL_CARD_CLASS.opus.text}`}>
            ${opusCost.toFixed(2)}
          </p>
          <p className="mt-1 text-xs text-slate-500">{opusPct.toFixed(0)}% of total</p>
        </div>
        <div className={`rounded-xl border p-4 ${MODEL_CARD_CLASS.sonnet.border}`}>
          <p className={`text-xs font-medium ${MODEL_CARD_CLASS.sonnet.text}`}>Sonnet</p>
          <p className={`mt-1 font-mono text-2xl font-semibold ${MODEL_CARD_CLASS.sonnet.text}`}>
            ${sonnetCost.toFixed(2)}
          </p>
          <p className="mt-1 text-xs text-slate-500">{sonnetPct.toFixed(0)}% of total</p>
        </div>
        <div className={`rounded-xl border p-4 ${MODEL_CARD_CLASS.haiku.border}`}>
          <p className={`text-xs font-medium ${MODEL_CARD_CLASS.haiku.text}`}>Haiku</p>
          <p className={`mt-1 font-mono text-2xl font-semibold ${MODEL_CARD_CLASS.haiku.text}`}>
            ${haikuCost.toFixed(2)}
          </p>
          <p className="mt-1 text-xs text-slate-500">{haikuPct.toFixed(0)}% of total</p>
        </div>
      </div>

      {/* Savings alert */}
      {showSavingsAlert && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <h3 className="text-sm font-medium text-amber-400">
            Model Optimization Opportunity
          </h3>
          <p className="mt-1 text-xs text-slate-400">
            Opus accounts for {opusPct.toFixed(0)}% of your costs. If 50% of Opus tasks
            were handled by Sonnet, you could save approximately{" "}
            <span className="font-mono font-medium text-amber-400">
              ${weeklySavings.toFixed(2)}/week
            </span>
            . Use <code className="text-amber-300">/model sonnet</code> for routine tasks.
          </p>
        </div>
      )}

      {/* Model mix area chart */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <h3 className="mb-4 text-sm font-medium">Model Mix Over Time</h3>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={mixData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "#94a3b8" }}
              tickFormatter={(v: string) => v.slice(5)}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#94a3b8" }}
              tickFormatter={(v: number) => `${v}%`}
              domain={[0, 100]}
            />
            <Tooltip
              formatter={(v: number) => [`${v.toFixed(1)}%`, ""]}
              contentStyle={{
                backgroundColor: "#0f172a",
                border: "1px solid rgb(51,65,85)",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
            <Area
              type="monotone"
              dataKey="opus"
              name="Opus"
              stackId="1"
              stroke={MODEL_COLORS.Opus}
              fill={MODEL_COLORS.Opus}
              fillOpacity={0.6}
            />
            <Area
              type="monotone"
              dataKey="sonnet"
              name="Sonnet"
              stackId="1"
              stroke={MODEL_COLORS.Sonnet}
              fill={MODEL_COLORS.Sonnet}
              fillOpacity={0.6}
            />
            <Area
              type="monotone"
              dataKey="haiku"
              name="Haiku"
              stackId="1"
              stroke={MODEL_COLORS.Haiku}
              fill={MODEL_COLORS.Haiku}
              fillOpacity={0.6}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
