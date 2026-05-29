import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { MetricCard } from "../components/cards/MetricCard";
import { MachineCard } from "../components/cards/MachineCard";
import { DailyCostChart } from "../components/charts/DailyCostChart";
import { ModelBreakdown } from "../components/charts/ModelBreakdown";
import { EmptyState } from "../components/EmptyState";
import { EmptyDashboard } from "../components/illustrations/EmptyDashboard";
import { MonthlyCostChart } from "../components/charts/MonthlyCostChart";
import { DateRangePicker } from "../components/filters/DateRangePicker";
import { useUsageData } from "../hooks/useUsageData";
import { usePreferences } from "../hooks/usePreferences";
import { useMachineFilter } from "../hooks/useMachineFilter";
import { fetchRateLimits, fetchMachines } from "../lib/api";
import { rangeToDate, formatTokens, fillDateGaps } from "../lib/dateUtils";

export function Overview() {
  const [range, setRange] = useState("30d");
  const dateRange = useMemo(() => rangeToDate(range), [range]);
  const { summary, projects, machines, loading, error } = useUsageData(dateRange, { polling: true });
  const { prefs } = usePreferences();
  const { machineId } = useMachineFilter();

  const [now, setNow] = useState(() => Date.now());

  const { data: machinesRaw } = useQuery({
    queryKey: ["machines", { active_only: false }],
    queryFn: () => fetchMachines(false) as Promise<Array<{ id: string; last_sync_at: string | null }>>,
    refetchInterval: 300_000,
  });
  const syncMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of machinesRaw ?? []) {
      if (r.last_sync_at) map.set(r.id, r.last_sync_at);
    }
    return map;
  }, [machinesRaw]);

  const { data: rateLimitsRecent } = useQuery({
    queryKey: ["rate-limits", machineId, "10"],
    queryFn: () => fetchRateLimits(machineId, "10") as Promise<Array<Record<string, unknown>>>,
    refetchInterval: 300_000,
  });
  const { rateLimits, resetAtMs } = useMemo(() => {
    if (!rateLimitsRecent) return { rateLimits: null, resetAtMs: null };
    const nowMs = Date.now();
    const row = rateLimitsRecent.find((r) => {
      const ts = r.timestamp as string | undefined;
      return ts ? new Date(ts).getTime() <= nowMs : false;
    });
    if (!row) return { rateLimits: null, resetAtMs: null };
    const ts = row.timestamp as string | undefined;
    const dur = row.session_duration_seconds as number | undefined;
    const reset = ts && typeof dur === "number"
      ? new Date(ts).getTime() + (5 * 3600 - dur) * 1000
      : null;
    return {
      rateLimits: {
        window_5h_percent: row.window_5h_percent as number | undefined,
        window_1w_percent: row.window_1w_percent as number | undefined,
      },
      resetAtMs: reset,
    };
  }, [rateLimitsRecent]);

  const { data: rateLimitsWeekly } = useQuery({
    queryKey: ["rate-limits", undefined, "50"],
    queryFn: () => fetchRateLimits(undefined, "50") as Promise<Array<Record<string, unknown>>>,
    refetchInterval: 300_000,
  });
  const weeklyResetAtMs = useMemo(() => {
    if (!rateLimitsWeekly) return null;
    const row = rateLimitsWeekly.find((r) => r.weekly_reset_at);
    const weeklyAt = row?.weekly_reset_at as string | undefined;
    return weeklyAt ? new Date(weeklyAt).getTime() : null;
  }, [rateLimitsWeekly]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const resetLabel = useMemo(() => {
    if (resetAtMs == null) return null;
    const diffMs = resetAtMs - now;
    if (diffMs <= 0) return null;
    const totalMin = Math.floor(diffMs / 60_000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h > 0) return `Resets in ${h}h ${m}m`;
    return `Resets in ${m}m`;
  }, [resetAtMs, now]);

  const weeklyResetLabel = useMemo(() => {
    if (weeklyResetAtMs == null) return null;
    const d = new Date(weeklyResetAtMs);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const weekday = get("weekday");
    const h12 = get("hour");
    const m = get("minute");
    const ampm = get("dayPeriod");
    return `Resets ${weekday} ${h12}:${m} ${ampm} KST`;
  }, [weeklyResetAtMs]);

  const totalCost = summary.reduce((s, r) => s + r.total_cost, 0);
  const totalTokens = summary.reduce((s, r) => s + r.total_tokens, 0);
  const daysActive = summary.length;
  const avgDaily = daysActive > 0 ? totalCost / daysActive : 0;
  const topProject = projects.length > 0 ? projects[0].project : "—";
  const machineCount = machines.length;

  const opusCost = summary.reduce((s, r) => s + r.opus_cost, 0);
  const opusPct = totalCost > 0 ? ((opusCost / totalCost) * 100).toFixed(0) : "0";

  const filledSummary = useMemo(
    () =>
      fillDateGaps(summary, dateRange.start, dateRange.end, (date) => ({
        date,
        total_cost: 0,
        total_tokens: 0,
        opus_cost: 0,
        sonnet_cost: 0,
        haiku_cost: 0,
        machine_count: 0,
      })),
    [summary, dateRange],
  );

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
              <div className="flex items-baseline justify-between mb-2">
                <p className="text-xs font-medium text-slate-400">Rate Limit (5h)</p>
                {resetLabel && <p className="text-xs text-slate-500">{resetLabel}</p>}
              </div>
              <div className="h-3 rounded-full bg-white/[0.04]">
                <div
                  className={`h-3 rounded-full transition-all ${
                    rateLimits.window_5h_percent > 80 ? "bg-fuchsia-500" : rateLimits.window_5h_percent > 50 ? "bg-amber-500" : "bg-violet-500"
                  }`}
                  style={{
                    width: `${Math.min(100, rateLimits.window_5h_percent)}%`,
                    minWidth: rateLimits.window_5h_percent > 0 ? "0.75rem" : undefined,
                  }}
                />
              </div>
              <p className="mt-2 text-xs font-mono text-slate-400">{rateLimits.window_5h_percent.toFixed(0)}%</p>
            </div>
          )}
          {rateLimits.window_1w_percent != null && (
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="flex items-baseline justify-between mb-2">
                <p className="text-xs font-medium text-slate-400">Rate Limit (1w)</p>
                {weeklyResetLabel && <p className="text-xs text-slate-500">{weeklyResetLabel}</p>}
              </div>
              <div className="h-3 rounded-full bg-white/[0.04]">
                <div
                  className={`h-3 rounded-full transition-all ${
                    rateLimits.window_1w_percent > 80 ? "bg-fuchsia-500" : rateLimits.window_1w_percent > 50 ? "bg-amber-500" : "bg-violet-500"
                  }`}
                  style={{
                    width: `${Math.min(100, rateLimits.window_1w_percent)}%`,
                    minWidth: rateLimits.window_1w_percent > 0 ? "0.75rem" : undefined,
                  }}
                />
              </div>
              <p className="mt-2 text-xs font-mono text-slate-400">{rateLimits.window_1w_percent.toFixed(0)}%</p>
            </div>
          )}
        </div>
      )}

      {/* Charts row */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <DailyCostChart data={filledSummary} />
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
                lastSyncAt={syncMap.get(m.machine_id) ?? null}
                cost={m.total_cost}
                tokens={m.total_tokens}
                topProject={m.top_project}
                daysActive={m.days_active}
              />
            ))}
            {machines.length === 0 && !loading && (
              <div className="col-span-2">
                <EmptyState
                  illustration={<EmptyDashboard />}
                  title="No usage data yet"
                  description="Install the agent on your first machine to see real-time data here."
                  action={{ label: "View install guide", href: "#deploy" }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
