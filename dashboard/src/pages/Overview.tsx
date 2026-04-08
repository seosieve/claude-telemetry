import { useState, useMemo, useEffect } from "react";
import { MetricCard } from "../components/cards/MetricCard";
import { MachineCard } from "../components/cards/MachineCard";
import { DailyCostChart } from "../components/charts/DailyCostChart";
import { ModelBreakdown } from "../components/charts/ModelBreakdown";
import { MonthlyCostChart } from "../components/charts/MonthlyCostChart";
import { DateRangePicker } from "../components/filters/DateRangePicker";
import { useUsageData } from "../hooks/useUsageData";
import { usePreferences } from "../hooks/usePreferences";
import { useMachineFilter } from "../hooks/useMachineFilter";
import { fetchRateLimits } from "../lib/api";
import { rangeToDate, formatTokens } from "../lib/dateUtils";

export function Overview() {
  const [range, setRange] = useState("30d");
  const dateRange = useMemo(() => rangeToDate(range), [range]);
  const { summary, projects, machines, loading, error } = useUsageData(dateRange);
  const { prefs } = usePreferences();
  const { machineId } = useMachineFilter();

  const [rateLimits, setRateLimits] = useState<{
    window_5h_percent?: number;
    window_1w_percent?: number;
  } | null>(null);

  useEffect(() => {
    fetchRateLimits(machineId, "1")
      .then((data) => {
        const arr = data as Array<Record<string, unknown>>;
        if (arr.length > 0) {
          setRateLimits({
            window_5h_percent: arr[0].window_5h_percent as number | undefined,
            window_1w_percent: arr[0].window_1w_percent as number | undefined,
          });
        }
      })
      .catch((e) => { console.warn("Rate limits unavailable:", e.message); });
  }, [machineId]);

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
        {prefs.plan_cost != null && prefs.plan_cost > 0 && (() => {
          const apiEquiv = daysActive > 0 ? (totalCost / daysActive) * 30 : totalCost;
          const savings = apiEquiv - prefs.plan_cost;
          const savingsPct = apiEquiv > 0 ? (savings / apiEquiv) * 100 : 0;
          return (
            <MetricCard
              label="Plan Savings"
              value={`$${Math.abs(savings).toFixed(0)}`}
              sub={`Plan: $${prefs.plan_cost}/mo | API: $${apiEquiv.toFixed(0)} | ${savingsPct > 0 ? "Saving" : "Over"} ${Math.abs(savingsPct).toFixed(0)}%`}
              trend={savings > 0 ? `${savingsPct.toFixed(0)}% saved` : `${Math.abs(savingsPct).toFixed(0)}% over`}
              trendUp={savings > 0}
            />
          );
        })()}
      </div>

      {/* Rate limit bars */}
      {rateLimits && (rateLimits.window_5h_percent != null || rateLimits.window_1w_percent != null) && (
        <div className="grid grid-cols-2 gap-4">
          {rateLimits.window_5h_percent != null && (
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <p className="text-xs font-medium text-slate-400 mb-2">Rate Limit (5h)</p>
              <div className="h-3 rounded-full bg-white/[0.04]">
                <div
                  className={`h-3 rounded-full transition-all ${
                    rateLimits.window_5h_percent > 80 ? "bg-rose-500" : rateLimits.window_5h_percent > 50 ? "bg-amber-500" : "bg-emerald-500"
                  }`}
                  style={{ width: `${Math.min(100, rateLimits.window_5h_percent)}%` }}
                />
              </div>
              <p className="mt-1 text-xs font-mono text-slate-400">{rateLimits.window_5h_percent.toFixed(1)}%</p>
            </div>
          )}
          {rateLimits.window_1w_percent != null && (
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <p className="text-xs font-medium text-slate-400 mb-2">Rate Limit (1w)</p>
              <div className="h-3 rounded-full bg-white/[0.04]">
                <div
                  className={`h-3 rounded-full transition-all ${
                    rateLimits.window_1w_percent > 80 ? "bg-rose-500" : rateLimits.window_1w_percent > 50 ? "bg-amber-500" : "bg-emerald-500"
                  }`}
                  style={{ width: `${Math.min(100, rateLimits.window_1w_percent)}%` }}
                />
              </div>
              <p className="mt-1 text-xs font-mono text-slate-400">{rateLimits.window_1w_percent.toFixed(1)}%</p>
            </div>
          )}
        </div>
      )}

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
                No machines registered yet. Run `claude-telemetry setup` on your PCs.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
