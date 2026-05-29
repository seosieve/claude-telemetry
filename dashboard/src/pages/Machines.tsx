import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useUsageData } from "../hooks/useUsageData";
import { deleteMachine, fetchMachines, fetchDailyUsage } from "../lib/api";
import { rangeToDate, formatTokens, formatKstTimestamp, fillDateGaps } from "../lib/dateUtils";
import { getStatusDisplay } from "../lib/machineStatus";
import { DateRangePicker } from "../components/filters/DateRangePicker";
import { ConfirmDeleteModal } from "../components/ConfirmDeleteModal";
import {
  BarChart,
  Bar,
  Cell,
  Rectangle,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

import { MACHINE_COLORS } from "../lib/colors";

const MACHINE_ORDER = ["P성민", "K성민", "충원", "대성"];

function sortByOrder<T extends { machine_name: string }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => {
    const ai = MACHINE_ORDER.indexOf(a.machine_name);
    const bi = MACHINE_ORDER.indexOf(b.machine_name);
    if (ai === -1 && bi === -1) return a.machine_name.localeCompare(b.machine_name);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

function MachineSummaryTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { machine_name: string; total_cost: number } }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const orderIndex = MACHINE_ORDER.indexOf(row.machine_name);
  const color =
    orderIndex >= 0
      ? MACHINE_COLORS[orderIndex % MACHINE_COLORS.length]
      : MACHINE_COLORS[0];
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 p-3 shadow-xl">
      <div className="flex items-center gap-2 text-xs">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="text-white">{row.machine_name}</span>
        <span className="ml-auto font-mono font-medium text-white">
          ${row.total_cost.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

function MachineDailyTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + p.value, 0);
  const ordered = [...payload].reverse().filter((p) => p.value > 0);
  const weekdayLabel = (() => {
    if (!label) return label;
    const d = new Date(label + "T00:00:00");
    if (isNaN(d.getTime())) return label;
    const days = ["일", "월", "화", "수", "목", "금", "토"];
    return `${label} (${days[d.getDay()]})`;
  })();
  if (total === 0) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-900 p-3 shadow-xl">
        <p className="mb-1 text-xs text-slate-300">{weekdayLabel}</p>
        <p className="text-xs text-slate-500">사용 기록 없음</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 p-3 shadow-xl">
      <p className="mb-1 text-xs text-slate-300">{weekdayLabel}</p>
      {ordered.map((p) => (
        <div key={p.name} className="flex items-center gap-2 text-xs">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: p.color }}
          />
          <span className="text-white">{p.name}</span>
          <span className="ml-auto font-mono font-medium text-white">
            ${p.value.toFixed(2)}
          </span>
        </div>
      ))}
      <div className="mt-1 border-t border-slate-700 pt-1 text-xs font-medium text-white">
        Total: <span className="font-mono">${total.toFixed(2)}</span>
      </div>
    </div>
  );
}


export function Machines() {
  const [range, setRange] = useState(() =>
    typeof window !== "undefined" && window.innerWidth < 1024 ? "7d" : "30d",
  );
  const dateRange = useMemo(() => rangeToDate(range), [range]);
  const { machines: rawMachines, loading } = useUsageData(dateRange, { polling: true });
  const machines = useMemo(() => sortByOrder(rawMachines), [rawMachines]);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [, setRefresh] = useState(0);
  const [soloMachine, setSoloMachine] = useState<string | null>(null);
  const [pendingSolo, setPendingSolo] = useState<string | null>(null);
  const [chartVisible, setChartVisible] = useState(false);

  useEffect(() => {
    if (pendingSolo == null) return;
    const t = setTimeout(() => {
      setSoloMachine(pendingSolo);
      setPendingSolo(null);
    }, 180);
    return () => clearTimeout(t);
  }, [pendingSolo]);

  const handleLegendToggle = useCallback((name: string) => {
    setSoloMachine((prev) => {
      if (prev === name) return null;
      setPendingSolo(name);
      return "__none__";
    });
  }, []);

  const { data: machinesRaw } = useQuery({
    queryKey: ["machines", { active_only: false }],
    queryFn: () => fetchMachines(false) as Promise<Array<{ id: string; last_sync_at: string | null }>>,
    refetchInterval: 30_000,
  });
  const syncMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of machinesRaw ?? []) {
      if (r.last_sync_at) map.set(r.id, r.last_sync_at);
    }
    return map;
  }, [machinesRaw]);

  const totalCost = machines.reduce((s, m) => s + m.total_cost, 0);

  const { data: dailyRows } = useQuery({
    queryKey: ["daily-usage", dateRange.start, dateRange.end],
    queryFn: () =>
      fetchDailyUsage(dateRange.start, dateRange.end) as Promise<
        Array<{ date: string; machine_id: string; cost_usd: number }>
      >,
    refetchInterval: 30_000,
  });
  const dailyByMachine = useMemo<Array<Record<string, number | string>>>(() => {
    if (!dailyRows) return [];
    const nameById = new Map(machines.map((m) => [m.machine_id, m.machine_name]));
    const byDate = new Map<string, Record<string, number>>();
    for (const r of dailyRows) {
      const name = nameById.get(r.machine_id);
      if (!name) continue;
      const day = byDate.get(r.date) ?? {};
      day[name] = (day[name] ?? 0) + Number(r.cost_usd ?? 0);
      byDate.set(r.date, day);
    }
    const rows = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, costs]) => ({ date, ...costs }));
    const emptyMachineCosts = Object.fromEntries(
      machines.map((m) => [m.machine_name, 0]),
    );
    return fillDateGaps(rows, dateRange.start, dateRange.end, (date) => ({
      date,
      ...emptyMachineCosts,
    }));
  }, [dailyRows, machines, dateRange]);

  const filteredDailyByMachine = useMemo(() => {
    if (!soloMachine) return dailyByMachine;
    return dailyByMachine.map((row) => {
      const out: Record<string, number | string> = {
        date: row.date as string,
      };
      for (const m of machines) {
        const v = row[m.machine_name];
        out[m.machine_name] =
          m.machine_name === soloMachine && typeof v === "number" ? v : 0;
      }
      return out;
    });
  }, [dailyByMachine, soloMachine, machines]);

  useEffect(() => {
    if (chartVisible || dailyByMachine.length === 0) return;
    const t = setTimeout(() => setChartVisible(true), 400);
    return () => clearTimeout(t);
  }, [dailyByMachine.length, chartVisible]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteMachine(deleteTarget.id);
      setDeleteTarget(null);
      setRefresh((n) => n + 1);
      window.location.reload();
    } catch {
      // Error handled by api.ts
    }
  }, [deleteTarget]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Machines</h2>
          <p className="text-xs text-slate-500">
            {machines.length} machine{machines.length !== 1 ? "s" : ""} registered
          </p>
        </div>
        <div className="flex items-center gap-3">
          <DateRangePicker value={range} onChange={setRange} />
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-600 border-t-sky-400" />
          Loading...
        </div>
      )}

      {/* Comparison chart */}
      {machines.length > 0 && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <h3 className="mb-4 text-sm font-medium">Cost by Machine</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={machines}
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
                dataKey="machine_name"
                tick={{ fontSize: 11, fill: "#94a3b8" }}
                width={120}
              />
              <Tooltip
                content={<MachineSummaryTooltip />}
                cursor={{ fill: "rgba(148,163,184,0.08)" }}
              />
              <Bar
                dataKey="total_cost"
                radius={[0, 4, 4, 0]}
                shape={(props: object) => {
                  const p = props as React.ComponentProps<typeof Rectangle> & {
                    x?: number;
                    width?: number;
                  };
                  const offset = 0.5;
                  const w = Math.max(0, (p.width ?? 0) - offset);
                  return <Rectangle {...p} x={(p.x ?? 0) + offset} width={w} />;
                }}
              >
                {machines.map((m, i) => (
                  <Cell key={m.machine_id} fill={MACHINE_COLORS[i % MACHINE_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Daily breakdown by machine (stacked) */}
      {machines.length > 0 && dailyByMachine.length > 0 && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <h3 className="mb-4 text-sm font-medium">Daily Cost by Machine</h3>
          <div
            style={{
              opacity: chartVisible ? 1 : 0,
              transition: "opacity 0.3s ease-out",
            }}
          >
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={filteredDailyByMachine} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                tickFormatter={(v: string) => v.slice(5)}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                tickFormatter={(v: number) => `$${v}`}
              />
              <Tooltip
                content={<MachineDailyTooltip />}
                cursor={{ fill: "rgba(148,163,184,0.08)" }}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, cursor: "pointer" }}
                iconType="circle"
                iconSize={8}
                onClick={(o: { value?: string }) => {
                  if (!o.value) return;
                  handleLegendToggle(o.value);
                }}
                formatter={(value: string) => (
                  <span
                    style={{
                      opacity: soloMachine && soloMachine !== value ? 0.4 : 1,
                    }}
                  >
                    {value}
                  </span>
                )}
              />
              {[...machines].reverse().map((m) => {
                const originalIndex = machines.findIndex((x) => x.machine_id === m.machine_id);
                return (
                  <Bar
                    key={m.machine_id}
                    dataKey={m.machine_name}
                    name={m.machine_name}
                    stackId="cost"
                    fill={MACHINE_COLORS[originalIndex % MACHINE_COLORS.length]}
                    isAnimationActive={true}
                    animationDuration={160}
                    shape={(props: object) => {
                      const p = props as {
                        x: number;
                        y: number;
                        width: number;
                        height: number;
                        fill: string;
                        payload?: Record<string, number | string>;
                        name?: string;
                      };
                      const ownName = p.name;
                      if (!ownName || !p.payload) return <g />;
                      const ownCost = Number(p.payload[ownName] || 0);
                      if (ownCost <= 0 || p.height <= 0) return <g />;

                      const yScale = p.height / ownCost;
                      const totalCost = machines.reduce(
                        (s, mm) => s + Number(p.payload?.[mm.machine_name] || 0),
                        0,
                      );
                      const totalHeight = totalCost * yScale;
                      const selfIdx = machines.findIndex(
                        (mm) => mm.machine_name === ownName,
                      );
                      const aboveCost = machines
                        .slice(0, selfIdx)
                        .reduce(
                          (s, mm) => s + Number(p.payload?.[mm.machine_name] || 0),
                          0,
                        );
                      const yOffset = 0.5;
                      const stackTopY = p.y - aboveCost * yScale - yOffset;

                      const date = String(p.payload.date ?? "");
                      const safeDate = date.replace(/[^a-zA-Z0-9]/g, "");
                      const clipId = `stack-clip-${safeDate}`;

                      const r = Math.min(3, p.width / 2, totalHeight / 2);
                      const sx = p.x;
                      const sy = stackTopY;
                      const sw = p.width;
                      const sh = totalHeight;
                      const topRoundedPath =
                        `M${sx},${sy + r} ` +
                        `Q${sx},${sy} ${sx + r},${sy} ` +
                        `L${sx + sw - r},${sy} ` +
                        `Q${sx + sw},${sy} ${sx + sw},${sy + r} ` +
                        `L${sx + sw},${sy + sh} ` +
                        `L${sx},${sy + sh} Z`;

                      return (
                        <g>
                          <defs>
                            <clipPath id={clipId}>
                              <path d={topRoundedPath} />
                            </clipPath>
                          </defs>
                          <rect
                            x={p.x}
                            y={p.y - yOffset}
                            width={p.width}
                            height={p.height}
                            fill={p.fill}
                            clipPath={`url(#${clipId})`}
                          />
                        </g>
                      );
                    }}
                  />
                );
              })}
            </BarChart>
          </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Machine cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {machines.map((m) => {
          const lastSyncAt = syncMap.get(m.machine_id) || null;
          const badge = getStatusDisplay(lastSyncAt);
          const pct = totalCost > 0 ? ((m.total_cost / totalCost) * 100).toFixed(0) : "0";
          return (
            <div
              key={m.machine_id}
              className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 pt-3 pb-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-sm">{m.machine_name}</h3>
                <div className="flex items-center gap-1.5">
                  <span className={`inline-flex h-2 w-2 rounded-full ${badge.color}`} />
                  <span className="text-[10px] text-slate-500">{badge.label}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-slate-500">Cost</p>
                  <p className="font-mono font-medium">${m.total_cost.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-slate-500">Tokens</p>
                  <p className="font-mono font-medium">{formatTokens(m.total_tokens)}</p>
                </div>
                <div>
                  <p className="text-slate-500">Top Project</p>
                  <p className="font-medium truncate">{m.top_project || "—"}</p>
                </div>
                <div>
                  <p className="text-slate-500">% of Total</p>
                  <p className="font-mono font-medium">{pct}%</p>
                </div>
                <div>
                  <p className="text-slate-500">Days Active</p>
                  <p className="font-mono font-medium">{m.days_active}</p>
                </div>
                <div>
                  <p className="text-slate-500">Avg/Day</p>
                  <p className="font-mono font-medium">
                    ${m.days_active > 0 ? (m.total_cost / m.days_active).toFixed(2) : "0.00"}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Last Activity</p>
                  <p className="font-mono font-medium text-[10px]">
                    {lastSyncAt ? formatKstTimestamp(lastSyncAt, { withSeconds: true }) : m.last_activity || "never"}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setDeleteTarget({ id: m.machine_id, name: m.machine_name })}
                className="w-full rounded-lg border border-rose-500/20 py-1.5 text-[10px] font-medium text-rose-400 transition-colors hover:bg-rose-500/10"
              >
                Delete
              </button>
            </div>
          );
        })}
      </div>

      {machines.length === 0 && !loading && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-8 text-center">
          <p className="text-sm text-slate-400">No machines registered yet</p>
          <p className="mt-1 text-xs text-slate-600">
            Go to Deploy to add your first machine
          </p>
        </div>
      )}

      <ConfirmDeleteModal
        machineName={deleteTarget?.name || ""}
        isOpen={!!deleteTarget}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
