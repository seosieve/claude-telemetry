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

export function MonthlyCostChart({ data }: MonthlyCostChartProps) {
  // Aggregate daily data into monthly buckets
  const monthMap = new Map<string, number>();
  for (const row of data) {
    const month = row.date.slice(0, 7); // YYYY-MM
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
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 10, fill: "#64748b" }}
            axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "#64748b" }}
            tickFormatter={(v: number) => `$${v}`}
            axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
          />
          <Tooltip
            formatter={(value: number) => [`$${value.toFixed(2)}`, "Cost"]}
            contentStyle={{
              backgroundColor: "#0f172a",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Bar dataKey="cost" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
