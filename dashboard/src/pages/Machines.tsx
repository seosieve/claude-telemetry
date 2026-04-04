import { useState, useMemo, useCallback } from "react";
import { useUsageData } from "../hooks/useUsageData";
import { deleteMachine } from "../lib/api";
import { rangeToDate, formatTokens } from "../lib/dateUtils";
import { getStatusDisplay } from "../lib/machineStatus";
import { DateRangePicker } from "../components/filters/DateRangePicker";
import { ConfirmDeleteModal } from "../components/ConfirmDeleteModal";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";


export function Machines() {
  const [range, setRange] = useState("30d");
  const dateRange = useMemo(() => rangeToDate(range), [range]);
  const { machines, loading } = useUsageData(dateRange);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [, setRefresh] = useState(0);

  const totalCost = machines.reduce((s, m) => s + m.total_cost, 0);

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
          <a
            href="#deploy"
            className="rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-600"
          >
            + Add Machine
          </a>
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
                formatter={(value: number) => [`$${value.toFixed(2)}`, "Cost"]}
                contentStyle={{
                  backgroundColor: "#0f172a",
                  border: "1px solid rgb(51,65,85)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Bar dataKey="total_cost" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Machine cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {machines.map((m) => {
          const badge = getStatusDisplay(m.last_activity);
          const pct = totalCost > 0 ? ((m.total_cost / totalCost) * 100).toFixed(0) : "0";
          return (
            <div
              key={m.machine_id}
              className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3"
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
                  <p className="text-slate-500">Last Activity</p>
                  <p className="font-mono font-medium text-[10px]">
                    {m.last_activity || "never"}
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
