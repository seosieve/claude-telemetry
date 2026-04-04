import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { UsageSummaryRow } from "../../lib/queries";

interface ModelBreakdownProps {
  data: UsageSummaryRow[];
}

const COLORS = {
  Opus: "#f43f5e",
  Sonnet: "#38bdf8",
  Haiku: "#34d399",
};

export function ModelBreakdown({ data }: ModelBreakdownProps) {
  const totals = data.reduce(
    (acc, row) => ({
      opus: acc.opus + row.opus_cost,
      sonnet: acc.sonnet + row.sonnet_cost,
      haiku: acc.haiku + row.haiku_cost,
    }),
    { opus: 0, sonnet: 0, haiku: 0 },
  );

  const pieData = [
    { name: "Opus", value: totals.opus, color: COLORS.Opus },
    { name: "Sonnet", value: totals.sonnet, color: COLORS.Sonnet },
    { name: "Haiku", value: totals.haiku, color: COLORS.Haiku },
  ].filter((d) => d.value > 0);

  const total = totals.opus + totals.sonnet + totals.haiku;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <h3 className="mb-4 text-sm font-medium">Model Distribution</h3>
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie
            data={pieData}
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={80}
            paddingAngle={2}
            dataKey="value"
          >
            {pieData.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: number) => [`$${value.toFixed(2)}`, ""]}
            contentStyle={{
              backgroundColor: "#0f172a",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11 }}
            iconType="circle"
            iconSize={8}
            formatter={(name: string) => {
              const item = pieData.find((d) => d.name === name);
              const pct = total > 0 && item ? ((item.value / total) * 100).toFixed(0) : "0";
              return `${name} (${pct}%)`;
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
