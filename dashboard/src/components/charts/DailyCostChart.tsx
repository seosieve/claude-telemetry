import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { UsageSummaryRow } from "../../lib/queries";
import { MODEL_COLORS } from "../../lib/colors";

interface DailyCostChartProps {
  data: UsageSummaryRow[];
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + p.value, 0);
  if (total === 0) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-900 p-3 shadow-xl">
        <p className="mb-1 text-xs text-slate-300">{label}</p>
        <p className="text-xs text-slate-500">사용 기록 없음</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 p-3 shadow-xl">
      <p className="mb-1 text-xs text-slate-300">{label}</p>
      {payload.filter((p) => p.value > 0).map((p) => (
        <div key={p.name} className="flex items-center gap-2 text-xs">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: p.color }}
          />
          <span className="text-white">{p.name}</span>
          <span className="ml-auto font-mono font-medium text-white">
            ${p.value.toFixed(2)}
          </span>
        </div>
      ))}
      <div className="mt-1 border-t border-slate-700 pt-1 text-xs font-medium text-white">
        Total: <span className="font-mono">${total.toFixed(2)}</span>
      </div>
    </div>
  );
}

export function DailyCostChart({ data }: DailyCostChartProps) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <h3 className="mb-4 text-sm font-medium">Daily Cost</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: "#94a3b8" }}
            tickFormatter={(v: string) => v.slice(5)}
            axisLine={{ stroke: "rgba(148,163,184,0.15)" }}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "#94a3b8" }}
            tickFormatter={(v: number) => `$${v}`}
            axisLine={{ stroke: "rgba(148,163,184,0.15)" }}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 8, color: "#cbd5e1" }}
            iconType="circle"
            iconSize={8}
          />
          <Bar
            dataKey="fable_cost"
            name="Fable"
            stackId="cost"
            fill={MODEL_COLORS.Fable}
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="opus_cost"
            name="Opus"
            stackId="cost"
            fill={MODEL_COLORS.Opus}
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="sonnet_cost"
            name="Sonnet"
            stackId="cost"
            fill={MODEL_COLORS.Sonnet}
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="haiku_cost"
            name="Haiku"
            stackId="cost"
            fill={MODEL_COLORS.Haiku}
            radius={[2, 2, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
