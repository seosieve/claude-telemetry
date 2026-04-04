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
  return (
    <div className="rounded-lg border border-white/[0.1] bg-slate-900 p-3 shadow-xl">
      <p className="mb-1 text-xs text-slate-400">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 text-xs">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: p.color }}
          />
          <span className="text-slate-300">{p.name}</span>
          <span className="ml-auto font-mono font-medium">
            ${p.value.toFixed(2)}
          </span>
        </div>
      ))}
      <div className="mt-1 border-t border-white/[0.06] pt-1 text-xs font-medium">
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
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: "#64748b" }}
            tickFormatter={(v: string) => v.slice(5)}
            axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "#64748b" }}
            tickFormatter={(v: number) => `$${v}`}
            axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            iconType="circle"
            iconSize={8}
          />
          <Bar
            dataKey="opus_cost"
            name="Opus"
            stackId="cost"
            fill="#f43f5e"
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="sonnet_cost"
            name="Sonnet"
            stackId="cost"
            fill="#38bdf8"
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="haiku_cost"
            name="Haiku"
            stackId="cost"
            fill="#34d399"
            radius={[2, 2, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
