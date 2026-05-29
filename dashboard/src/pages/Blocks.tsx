import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchBlocks, type BlockRow } from "../lib/api";
import { useMachineFilter } from "../hooks/useMachineFilter";
import { formatTokens, daysAgo, today } from "../lib/dateUtils";
import { EmptyState } from "../components/EmptyState";
import { EmptyTimeline } from "../components/illustrations/EmptyTimeline";

function ModelBadge({ model }: { model: string }) {
  const name = model.split("-").pop() || model;
  const colorClass = model.includes("opus")
    ? "bg-rose-500/20 text-rose-400"
    : model.includes("sonnet")
      ? "bg-sky-500/20 text-sky-400"
      : "bg-emerald-500/20 text-emerald-400";
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${colorClass}`}>
      {name}
    </span>
  );
}

function StatusBadge({ isActive, isGap }: { isActive: boolean; isGap: boolean }) {
  if (isActive) return <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">Active</span>;
  if (isGap) return <span className="rounded bg-slate-500/20 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">Gap</span>;
  return <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-medium text-sky-400">Done</span>;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-GB", {
      timeZone: "Asia/Seoul",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return iso.slice(0, 16);
  }
}

function rangeToDate(r: string) {
  const days = r === "3d" ? 3 : r === "7d" ? 7 : r === "30d" ? 30 : 7;
  return { start: daysAgo(days), end: today() };
}

export function Blocks() {
  const { machineId, machines } = useMachineFilter();
  const [range, setRange] = useState("7d");
  const dateRange = useMemo(() => rangeToDate(range), [range]);

  const machineNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of machines) map.set(m.id, m.name);
    return map;
  }, [machines]);

  const blocksQ = useQuery<BlockRow[]>({
    queryKey: ["blocks", { machineId, start: dateRange.start, end: dateRange.end }],
    queryFn: () =>
      fetchBlocks({
        machineId,
        startDate: dateRange.start,
        endDate: dateRange.end,
      }) as Promise<BlockRow[]>,
  });
  const blocks = blocksQ.data ?? [];
  const loading = blocksQ.isLoading;

  const activeBlocks = blocks.filter((b) => b.is_active && !b.is_gap);
  const recentBlocks = blocks.filter((b) => !b.is_gap);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">5-Hour Blocks</h2>
          <p className="text-xs text-slate-500">
            Billing blocks from ccusage
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-white/[0.06] bg-white/[0.02] p-1">
          {["3d", "7d", "30d"].map((v) => (
            <button
              key={v}
              onClick={() => setRange(v)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                range === v
                  ? "bg-white/[0.08] text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-600 border-t-sky-400" />
          Loading...
        </div>
      )}

      {/* Active block cards */}
      {activeBlocks.length > 0 && (
        <div className="space-y-3">
          {activeBlocks.map((ab) => {
            const elapsed = ab.duration_minutes;
            const total = 300;
            const remaining = Math.max(0, total - elapsed);
            const pct = Math.min(100, (elapsed / total) * 100);
            const burnRate = elapsed > 0 ? ab.total_tokens / elapsed : 0;
            const projectedTokens = burnRate * total;
            const projectedCost = elapsed > 0 ? (ab.cost_usd / elapsed) * total : 0;
            const name = machineNameMap.get(ab.machine_id) || ab.machine_id.slice(0, 8);

            return (
              <div key={ab.id} className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-emerald-400">Active Block</h3>
                    <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">{name}</span>
                  </div>
                  <span className="text-xs text-slate-400">
                    Started {formatTime(ab.block_start)}
                  </span>
                </div>
                <div className="space-y-3">
                  <div className="grid grid-cols-4 gap-4 text-xs">
                    <div>
                      <p className="text-slate-500">Remaining</p>
                      <p className="font-mono font-medium text-white">
                        {Math.floor(remaining / 60)}h {remaining % 60}m
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500">Burn Rate</p>
                      <p className="font-mono font-medium text-white">
                        {formatTokens(burnRate)}/min
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500">Projected Cost</p>
                      <p className="font-mono font-medium text-white">
                        ${projectedCost.toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500">Projected Tokens</p>
                      <p className="font-mono font-medium text-white">
                        {formatTokens(projectedTokens)}
                      </p>
                    </div>
                  </div>
                  <div>
                    <div className="h-3 rounded-full bg-white/[0.06]">
                      <div
                        className={`h-3 rounded-full transition-all ${
                          pct > 80 ? "bg-fuchsia-500" : pct > 50 ? "bg-amber-500" : "bg-violet-500"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[10px] text-slate-500">
                      {elapsed}min / {total}min ({pct.toFixed(0)}%)
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Timeline visual */}
      {recentBlocks.length > 0 && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <h3 className="mb-3 text-sm font-medium">Timeline</h3>
          <div className="space-y-1">
            {recentBlocks.slice(0, 20).map((b) => {
              const maxCost = Math.max(...recentBlocks.map((x) => x.cost_usd), 1);
              const widthPct = Math.max(4, (b.cost_usd / maxCost) * 100);
              return (
                <div key={b.id} className="flex items-center gap-2" title={`$${b.cost_usd.toFixed(2)} | ${formatTokens(b.total_tokens)} tokens`}>
                  <span className="w-28 text-[10px] font-mono text-slate-500 shrink-0">
                    {formatTime(b.block_start)}
                  </span>
                  <div className="flex-1">
                    <div
                      className={`h-4 rounded ${
                        b.is_active ? "bg-emerald-500/60" : "bg-sky-500/40"
                      }`}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                  <span className="w-16 text-right text-[10px] font-mono text-slate-400">
                    ${b.cost_usd.toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Blocks table */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/[0.06] text-slate-500">
                <th className="px-3 py-2 text-left font-medium">Start</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Duration</th>
                <th className="px-3 py-2 text-right font-medium">Tokens</th>
                <th className="px-3 py-2 text-right font-medium">Cost</th>
                <th className="px-3 py-2 text-left font-medium">Models</th>
                <th className="px-3 py-2 text-left font-medium">Machine</th>
              </tr>
            </thead>
            <tbody>
              {blocks.filter((b) => !b.is_gap).map((b) => (
                <tr
                  key={b.id}
                  className={`border-b border-white/[0.03] hover:bg-white/[0.02] ${
                    b.is_active ? "bg-emerald-500/5" : ""
                  }`}
                >
                  <td className="px-3 py-2 font-mono">{formatTime(b.block_start)}</td>
                  <td className="px-3 py-2"><StatusBadge isActive={b.is_active} isGap={b.is_gap} /></td>
                  <td className="px-3 py-2 text-right font-mono text-slate-400">
                    {b.duration_minutes > 0 ? `${Math.floor(b.duration_minutes / 60)}h ${b.duration_minutes % 60}m` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-400">
                    {formatTokens(b.total_tokens)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-medium">
                    ${b.cost_usd.toFixed(2)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1 flex-wrap">
                      {b.models.map((m) => <ModelBadge key={m} model={m} />)}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-400 truncate max-w-[100px]">
                    {machineNameMap.get(b.machine_id) || b.machine_id.slice(0, 8)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {blocks.filter((b) => !b.is_gap).length === 0 && !loading && (
          <EmptyState
            illustration={<EmptyTimeline />}
            title="No billing blocks yet"
            description="Start a Claude Code session to see your 5-hour billing blocks."
          />
        )}
      </div>
    </div>
  );
}
