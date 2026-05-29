import { useState, useMemo } from "react";
import { useUsageData } from "../hooks/useUsageData";
import { usePreferences } from "../hooks/usePreferences";
import { rangeToDate } from "../lib/dateUtils";
import { DateRangePicker } from "../components/filters/DateRangePicker";
import { MetricCard } from "../components/cards/MetricCard";
import { EmptyState } from "../components/EmptyState";
import { EmptyFolder } from "../components/illustrations/EmptyFolder";
import { ModelBadge } from "../components/ModelBadge";
import { Spinner } from "../components/Spinner";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

function CustomPieTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; payload: { fill: string } }>;
}) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 p-3 shadow-xl">
      <div className="flex items-center gap-2 text-xs">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: entry.payload.fill }}
        />
        <span className="font-medium text-white">{entry.name}</span>
        <span className="ml-2 font-mono text-white">
          ${entry.value.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

const PIE_COLORS = [
  "#f43f5e", "#38bdf8", "#34d399", "#8b5cf6",
  "#f59e0b", "#ec4899", "#06b6d4", "#84cc16",
  "#94a3b8",
];

export function Projects() {
  const [range, setRange] = useState("30d");
  const dateRange = useMemo(() => rangeToDate(range), [range]);
  const { projects, loading } = useUsageData(dateRange);

  const { prefs } = usePreferences();
  const totalCost = projects.reduce((s, p) => s + p.total_cost, 0);

  // Pie data: top 8 + "Others"
  const pieData = useMemo(() => {
    const top = projects.slice(0, 8);
    const rest = projects.slice(8);
    const restCost = rest.reduce((s, p) => s + p.total_cost, 0);
    const data = top.map((p) => ({ name: p.project, value: p.total_cost }));
    if (restCost > 0) data.push({ name: "Others", value: restCost });
    return data;
  }, [projects]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Projects</h2>
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Spinner />
          Loading...
        </div>
      )}

      {!loading && projects.length === 0 && (
        <EmptyState
          illustration={<EmptyFolder />}
          title="No projects tracked"
          description="Use Claude Code in any project directory and sync to see it here."
        />
      )}

      {/* Metric cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard label="Total Projects" value={String(projects.length)} />
        <MetricCard label="Total Cost" value={`$${totalCost.toFixed(2)}`} />
        <MetricCard
          label="Top Project"
          value={
            projects.length > 0
              ? projects[0].project.length > 15
                ? projects[0].project.slice(0, 15) + "..."
                : projects[0].project
              : "—"
          }
          sub={projects.length > 0 ? `$${projects[0].total_cost.toFixed(2)}` : ""}
        />
        <MetricCard
          label="Paperclip"
          value={
            "$" +
            projects
              .filter((p) => p.project === "Paperclip")
              .reduce((s, p) => s + p.total_cost, 0)
              .toFixed(2)
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Horizontal bar chart */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <h3 className="mb-4 text-sm font-medium">Cost by Project</h3>
          <ResponsiveContainer width="100%" height={Math.max(200, projects.length * 32)}>
            <BarChart
              data={projects.slice(0, 15)}
              layout="vertical"
              margin={{ top: 0, right: 20, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" />
              <XAxis
                type="number"
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                tickFormatter={(v: number) => `$${v}`}
              />
              <YAxis
                type="category"
                dataKey="project"
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                width={140}
                tickFormatter={(v: string) =>
                  v.length > 20 ? v.slice(0, 20) + "..." : v
                }
              />
              <Tooltip
                formatter={(value: number) => [`$${value.toFixed(2)}`, "Cost"]}
                labelStyle={{ color: "#cbd5e1", fontSize: 11 }}
                contentStyle={{
                  backgroundColor: "rgb(15,23,42)",
                  border: "1px solid rgb(51,65,85)",
                  borderRadius: 8,
                  fontSize: 12,
                  color: "white",
                }}
                cursor={{ fill: "rgba(148,163,184,0.08)" }}
              />
              <Bar dataKey="total_cost" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Pie chart */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <h3 className="mb-4 text-sm font-medium">Distribution</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={90}
                paddingAngle={2}
                dataKey="value"
              >
                {pieData.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<CustomPieTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: 10 }}
                iconType="circle"
                iconSize={8}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Full table */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <h3 className="mb-3 text-sm font-medium">All Projects</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/[0.06] text-slate-500">
                <th className="pb-2 text-left font-medium">Project</th>
                <th className="pb-2 text-right font-medium">Cost</th>
                <th className="pb-2 text-right font-medium">%</th>
                <th className="pb-2 text-left font-medium">Model</th>
                <th className="pb-2 text-right font-medium">Machines</th>
                <th className="pb-2 text-left font-medium">Budget</th>
                <th className="pb-2 text-left font-medium">Bar</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const pct = totalCost > 0 ? (p.total_cost / totalCost) * 100 : 0;
                return (
                  <tr
                    key={p.project}
                    className="border-b border-white/[0.03] hover:bg-white/[0.02]"
                  >
                    <td className="py-1.5 font-medium">{p.project}</td>
                    <td className="py-1.5 text-right font-mono">
                      ${p.total_cost.toFixed(2)}
                    </td>
                    <td className="py-1.5 text-right font-mono text-slate-400">
                      {pct.toFixed(1)}%
                    </td>
                    <td className="py-1.5">
                      <ModelBadge model={p.primary_model} />
                    </td>
                    <td className="py-1.5 text-right font-mono text-slate-400">
                      {p.machines_used}
                    </td>
                    <td className="py-1.5 w-28">
                      {(() => {
                        const budget = prefs.project_budgets?.[p.project];
                        if (!budget) return <span className="text-slate-600">—</span>;
                        const budgetPct = (p.total_cost / budget) * 100;
                        const color = budgetPct > 90 ? "bg-fuchsia-500" : budgetPct > 70 ? "bg-amber-500" : "bg-violet-500";
                        return (
                          <div>
                            <div className="h-2 rounded-full bg-white/[0.04]">
                              <div className={`h-2 rounded-full ${color}`} style={{ width: `${Math.min(100, budgetPct)}%` }} />
                            </div>
                            <span className="text-[9px] text-slate-500">${p.total_cost.toFixed(0)}/${budget}</span>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="py-1.5 w-32">
                      <div className="h-2 rounded-full bg-white/[0.04]">
                        <div
                          className="h-2 rounded-full bg-violet-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
