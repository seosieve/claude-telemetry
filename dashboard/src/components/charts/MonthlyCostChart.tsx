import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { UsageSummaryRow } from "../../lib/queries";

interface MonthlyCostChartProps {
  data: UsageSummaryRow[];
}

interface MonthlyData {
  month: string;
  cost: number;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 p-3 shadow-xl">
      <p className="mb-1 text-xs text-slate-300">{label}</p>
      <p className="text-xs font-mono font-medium text-white">
        ${payload[0].value.toFixed(2)}
      </p>
    </div>
  );
}

export function MonthlyCostChart({ data }: MonthlyCostChartProps) {
  const monthMap = new Map<string, number>();
  for (const row of data) {
    const month = row.date.slice(0, 7);
    monthMap.set(month, (monthMap.get(month) ?? 0) + row.total_cost);
  }

  const monthly: MonthlyData[] = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, cost]) => ({ month, cost }));

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <h3 className="mb-4 text-sm font-medium">Monthly Cost</h3>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={monthly} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 10, fill: "#94a3b8" }}
            axisLine={{ stroke: "rgba(148,163,184,0.15)" }}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "#94a3b8" }}
            tickFormatter={(v: number) => `$${v}`}
            axisLine={{ stroke: "rgba(148,163,184,0.15)" }}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(148,163,184,0.08)" }} />
          <Bar dataKey="cost" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
