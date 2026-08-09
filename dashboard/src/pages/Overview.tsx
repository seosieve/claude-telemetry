import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MetricCard } from "../components/cards/MetricCard";
import { MachineCard } from "../components/cards/MachineCard";
import { DailyCostChart } from "../components/charts/DailyCostChart";
import { ModelBreakdown } from "../components/charts/ModelBreakdown";
import { EmptyState } from "../components/EmptyState";
import { EmptyDashboard } from "../components/illustrations/EmptyDashboard";
import { Spinner } from "../components/Spinner";
import { MonthlyCostChart } from "../components/charts/MonthlyCostChart";
import { DateRangePicker } from "../components/filters/DateRangePicker";
import { useUsageData } from "../hooks/useUsageData";
import { usePreferences } from "../hooks/usePreferences";
import { fetchRateLimits, fetchMachines } from "../lib/api";
import { accountWeeklyPct, accountModelLimit, accountSessionPct } from "../lib/rateLimits";
import { rangeToDate, formatTokens, fillDateGaps } from "../lib/dateUtils";

function kstResetLabel(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `Resets ${get("weekday")} ${get("hour")}:${get("minute")} ${get("dayPeriod")} KST`;
}

export function Overview() {
  const [range, setRange] = useState("30d");
  const dateRange = useMemo(() => rangeToDate(range), [range]);
  const { summary, projects, machines, loading, error } = useUsageData(dateRange, { polling: true });
  const { prefs } = usePreferences();

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

  // Every rate-limit gauge below is ACCOUNT-wide: 5h, weekly and the Fable cap
  // are one shared pool, so all machines report identical numbers and the
  // machine filter must not narrow this query. Filtering it used to hide the 5h
  // card entirely whenever a machine that doesn't report rate limits was
  // selected — a machine-shaped question asked of an account-shaped value.
  const { data: rateLimitRows } = useQuery({
    queryKey: ["rate-limits", undefined, "50"],
    queryFn: () => fetchRateLimits(undefined, "50") as Promise<Array<Record<string, unknown>>>,
    refetchInterval: 300_000,
  });

  const session5h = useMemo(() => accountSessionPct(rateLimitRows), [rateLimitRows]);
  const resetAtMs = session5h?.resetsAtMs ?? null;

  // Account-wide weekly %: the freshest reading across machines — rows are live
  // values stamped with their reading time, so newest wins (reset-safety
  // rationale in accountWeeklyPct). resetsAtMs is null once that window has
  // rolled over, which is also what blanks the countdown label below.
  const weekly1w = useMemo(
    () => accountWeeklyPct(rateLimitRows),
    [rateLimitRows],
  );
  const weeklyResetAtMs = weekly1w?.resetsAtMs ?? null;

  // Fable's own weekly gauge (the 50%-of-weekly cap) — model_limits JSONB from
  // the OAuth usage API; null until an agent that reports it has synced.
  const fableLimit = useMemo(
    () => accountModelLimit(rateLimitRows, "fable"),
    [rateLimitRows],
  );

  // When the weekly window is about to roll over, refetch rate limits a few
  // minutes after the reset so the bar updates without waiting for the 5-min
  // poll. The daemon re-syncs ~90s past the reset; we wait longer (3 min) so
  // Neon already holds the refreshed value. Only armed within the last hour
  // before reset — setTimeout can't reliably hold multi-day delays.
  const queryClient = useQueryClient();
  useEffect(() => {
    if (weeklyResetAtMs == null) return;
    const delay = weeklyResetAtMs - Date.now() + 180_000;
    if (delay <= 0 || delay > 3_600_000) return;
    const id = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ["rate-limits"] });
    }, delay);
    return () => clearTimeout(id);
  }, [weeklyResetAtMs, queryClient]);

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

  const weeklyResetLabel = useMemo(
    () => (weeklyResetAtMs == null ? null : kstResetLabel(weeklyResetAtMs)),
    [weeklyResetAtMs],
  );

  const fableResetLabel = useMemo(() => {
    const ms = fableLimit?.resetsAtMs ?? weeklyResetAtMs;
    return ms == null ? null : kstResetLabel(ms);
  }, [fableLimit, weeklyResetAtMs]);

  // Grid width follows how many gauges actually report — a fixed 3-up would
  // stretch two cards across three columns when one source is missing.
  const rateLimitCards = [session5h, weekly1w, fableLimit].filter((v) => v != null).length;

  const totalCost = summary.reduce((s, r) => s + r.total_cost, 0);
  const totalTokens = summary.reduce((s, r) => s + r.total_tokens, 0);
  const daysActive = summary.length;
  const avgDaily = daysActive > 0 ? totalCost / daysActive : 0;
  const topProject = projects.length > 0 ? projects[0].project : "—";
  const machineCount = machines.length;

  // 비중이 가장 큰 모델 1개를 메트릭 카드로 노출 (Fable 등장 이후 Opus 고정 표기는 부정확)
  const topModel = (
    [
      ["Fable", summary.reduce((s, r) => s + r.fable_cost, 0)],
      ["Opus", summary.reduce((s, r) => s + r.opus_cost, 0)],
      ["Sonnet", summary.reduce((s, r) => s + r.sonnet_cost, 0)],
      ["Haiku", summary.reduce((s, r) => s + r.haiku_cost, 0)],
    ] as const
  ).reduce((max, cur) => (cur[1] > max[1] ? cur : max));
  const topModelPct = totalCost > 0 ? ((topModel[1] / totalCost) * 100).toFixed(0) : "0";

  const filledSummary = useMemo(
    () =>
      fillDateGaps(summary, dateRange.start, dateRange.end, (date) => ({
        date,
        total_cost: 0,
        total_tokens: 0,
        opus_cost: 0,
        sonnet_cost: 0,
        haiku_cost: 0,
        fable_cost: 0,
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
          <Spinner />
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
          label={`${topModel[0]} %`}
          value={`${topModelPct}%`}
          sub={`$${topModel[1].toFixed(2)}`}
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

      {/* Rate limit bars — one column per reporting gauge */}
      {rateLimitCards > 0 && (
        <div className={`grid gap-4 ${rateLimitCards >= 3 ? "grid-cols-3" : rateLimitCards === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
          {session5h != null && (
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="flex items-baseline justify-between mb-2">
                <p className="text-xs font-medium text-slate-400">Current Session (5h)</p>
                {resetLabel && <p className="text-xs text-slate-500">{resetLabel}</p>}
              </div>
              <div className="h-3 rounded-full bg-white/[0.04]">
                <div
                  className={`h-3 rounded-full transition-all animate-[bar-grow_600ms_ease-out] ${
                    session5h.pct > 80 ? "bg-fuchsia-500" : session5h.pct > 50 ? "bg-amber-500" : "bg-violet-500"
                  }`}
                  style={{
                    width: `${Math.min(100, session5h.pct)}%`,
                    minWidth: session5h.pct > 0 ? "0.75rem" : undefined,
                  }}
                />
              </div>
              <p className="mt-2 text-xs font-mono text-slate-400">{session5h.pct.toFixed(0)}%</p>
            </div>
          )}
          {weekly1w != null && (
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="flex items-baseline justify-between mb-2">
                <p className="text-xs font-medium text-slate-400">Current Week (All Models)</p>
                {weeklyResetLabel && <p className="text-xs text-slate-500">{weeklyResetLabel}</p>}
              </div>
              <div className="h-3 rounded-full bg-white/[0.04]">
                <div
                  className={`h-3 rounded-full transition-all animate-[bar-grow_600ms_ease-out] ${
                    weekly1w.pct > 80 ? "bg-fuchsia-500" : weekly1w.pct > 50 ? "bg-amber-500" : "bg-violet-500"
                  }`}
                  style={{
                    width: `${Math.min(100, weekly1w.pct)}%`,
                    minWidth: weekly1w.pct > 0 ? "0.75rem" : undefined,
                  }}
                />
              </div>
              <p className="mt-2 text-xs font-mono text-slate-400">{weekly1w.pct.toFixed(0)}%</p>
            </div>
          )}
          {fableLimit != null && (
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="flex items-baseline justify-between mb-2">
                <p className="text-xs font-medium text-slate-400">Current Week (Fable)</p>
                {fableResetLabel && <p className="text-xs text-slate-500">{fableResetLabel}</p>}
              </div>
              <div className="h-3 rounded-full bg-white/[0.04]">
                <div
                  className={`h-3 rounded-full transition-all animate-[bar-grow_600ms_ease-out] ${
                    fableLimit.pct > 80 ? "bg-fuchsia-500" : fableLimit.pct > 50 ? "bg-amber-500" : "bg-violet-500"
                  }`}
                  style={{
                    width: `${Math.min(100, fableLimit.pct)}%`,
                    minWidth: fableLimit.pct > 0 ? "0.75rem" : undefined,
                  }}
                />
              </div>
              <p className="mt-2 text-xs font-mono text-slate-400">{fableLimit.pct.toFixed(0)}%</p>
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
