import { useState, useMemo } from "react";
import { MetricCard } from "../components/cards/MetricCard";
import { MachineCard } from "../components/cards/MachineCard";
import { DailyCostChart } from "../components/charts/DailyCostChart";
import { ModelBreakdown } from "../components/charts/ModelBreakdown";
import { MonthlyCostChart } from "../components/charts/MonthlyCostChart";
import { DateRangePicker } from "../components/filters/DateRangePicker";
import { useUsageData } from "../hooks/useUsageData";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function rangeToDate(range: string): { start: string; end: string } {
  switch (range) {
    case "7d":
      return { start: daysAgo(7), end: today() };
    case "90d":
      return { start: daysAgo(90), end: today() };
    case "30d":
    default:
      return { start: daysAgo(30), end: today() };
  }
}

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function Overview() {
  const [range, setRange] = useState("30d");
  const dateRange = useMemo(() => rangeToDate(range), [range]);
  const { summary, projects, machines, loading, error } = useUsageData(dateRange);

  const totalCost = summary.reduce((s, r) => s + r.total_cost, 0);
  const totalTokens = summary.reduce((s, r) => s + r.total_tokens, 0);
  const daysActive = summary.length;
  const avgDaily = daysActive > 0 ? totalCost / daysActive : 0;
  const topProject = projects.length > 0 ? projects[0].project : "—";
  const machineCount = machines.length;

  const opusCost = summary.reduce((s, r) => s + r.opus_cost, 0);
  const opusPct = totalCost > 0 ? ((opusCost / totalCost) * 100).toFixed(0) : "0";

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-6 text-center">
          <p className="text-sm text-rose-400">Failed to load data</p>
          <p className="mt-1 text-xs text-slate-500">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Usage Overview</h2>
          <p className="text-xs text-slate-500">
            Aggregated across {machineCount} machine{machineCount !== 1 ? "s" : ""}
          </p>
        </div>
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      {/* Loading overlay */}
      {loading && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-600 border-t-sky-400" />
          Loading...
        </div>
      )}

      {/* Metric cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard
          label="Total Cost"
          value={`$${totalCost.toFixed(2)}`}
          sub={`${range} period`}
        />
        <MetricCard
          label="Avg Daily"
          value={`$${avgDaily.toFixed(2)}`}
          sub={`${daysActive} active days`}
        />
        <MetricCard
          label="Total Tokens"
          value={formatTokens(totalTokens)}
          sub="all models"
        />
        <MetricCard
          label="Days Active"
          value={String(daysActive)}
          sub={`of ${range.replace("d", "")} days`}
        />
        <MetricCard
          label="Top Project"
          value={topProject.length > 15 ? topProject.slice(0, 15) + "..." : topProject}
          sub={projects.length > 0 ? `$${projects[0].total_cost.toFixed(2)}` : ""}
        />
        <MetricCard
          label="Opus %"
          value={`${opusPct}%`}
          sub={`$${opusCost.toFixed(2)}`}
        />
      </div>

      {/* Charts row */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <DailyCostChart data={summary} />
        </div>
        <ModelBreakdown data={summary} />
      </div>

      {/* Monthly + Machines */}
      <div className="grid gap-4 lg:grid-cols-2">
        <MonthlyCostChart data={summary} />
        <div>
          <h3 className="mb-3 text-sm font-medium">Machines</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {machines.map((m) => (
              <MachineCard
                key={m.machine_id}
                name={m.machine_name}
                lastSync={m.last_activity}
                cost={m.total_cost}
                tokens={m.total_tokens}
                topProject={m.top_project}
                daysActive={m.days_active}
              />
            ))}
            {machines.length === 0 && !loading && (
              <p className="col-span-2 text-xs text-slate-600">
                No machines registered yet. Run `claude-tracker setup` on your PCs.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
