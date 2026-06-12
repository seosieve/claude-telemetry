import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { UsageSummaryRow } from "../../lib/queries";
import { MODEL_COLORS as COLORS } from "../../lib/colors";

interface ModelBreakdownProps {
  data: UsageSummaryRow[];
}

function CustomPieTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; payload: { color: string } }>;
}) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 p-3 shadow-xl">
      <div className="flex items-center gap-2 text-xs">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: entry.payload.color }}
        />
        <span className="font-medium text-white">{entry.name}</span>
        <span className="ml-2 font-mono text-white">
          ${entry.value.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

export function ModelBreakdown({ data }: ModelBreakdownProps) {
  const totals = data.reduce(
    (acc, row) => ({
      fable: acc.fable + row.fable_cost,
      opus: acc.opus + row.opus_cost,
      sonnet: acc.sonnet + row.sonnet_cost,
      haiku: acc.haiku + row.haiku_cost,
    }),
    { fable: 0, opus: 0, sonnet: 0, haiku: 0 },
  );

  const pieData = [
    { name: "Fable", value: totals.fable, color: COLORS.Fable },
    { name: "Opus", value: totals.opus, color: COLORS.Opus },
    { name: "Sonnet", value: totals.sonnet, color: COLORS.Sonnet },
    { name: "Haiku", value: totals.haiku, color: COLORS.Haiku },
  ].filter((d) => d.value > 0);

  const total = totals.fable + totals.opus + totals.sonnet + totals.haiku;

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
          <Tooltip content={<CustomPieTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: 11, color: "#cbd5e1" }}
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
