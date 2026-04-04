import { useState, useEffect } from "react";
import { fetchSessions, type PaginatedSessions, type SessionRow } from "../lib/api";
import { useMachineFilter } from "../hooks/useMachineFilter";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

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

export function Sessions() {
  const { machineId } = useMachineFilter();
  const [data, setData] = useState<SessionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage] = useState(20);
  const [sort, setSort] = useState("cost_usd");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [projectFilter, setProjectFilter] = useState("");
  const [subagentFilter, setSubagentFilter] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchSessions({
      machineId,
      project: projectFilter || undefined,
      isSubagent: subagentFilter,
      page,
      perPage,
      sort,
      order,
    })
      .then((result: PaginatedSessions) => {
        setData(result.data);
        setTotal(result.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [machineId, page, perPage, sort, order, projectFilter, subagentFilter]);

  const totalPages = Math.ceil(total / perPage);

  const handleSort = (col: string) => {
    if (sort === col) {
      setOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSort(col);
      setOrder("desc");
    }
    setPage(1);
  };

  const sortIcon = (col: string) => {
    if (sort !== col) return "";
    return order === "asc" ? " \u2191" : " \u2193";
  };

  // Collect unique projects for filter dropdown
  const projects = [...new Set(data.map((s) => s.project))].sort();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Sessions</h2>
        <div className="flex items-center gap-2">
          <select
            value={projectFilter}
            onChange={(e) => { setProjectFilter(e.target.value); setPage(1); }}
            className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1 text-xs text-slate-300 outline-none"
          >
            <option value="">All Projects</option>
            {projects.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <select
            value={subagentFilter || ""}
            onChange={(e) => { setSubagentFilter(e.target.value || undefined); setPage(1); }}
            className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1 text-xs text-slate-300 outline-none"
          >
            <option value="">All Types</option>
            <option value="false">Regular</option>
            <option value="true">Subagent</option>
          </select>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-600 border-t-sky-400" />
          Loading...
        </div>
      )}

      {/* Sessions table */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/[0.06] text-slate-500">
                <th className="px-3 py-2 text-left font-medium">Project</th>
                <th className="px-3 py-2 text-left font-medium">Models</th>
                <th
                  className="px-3 py-2 text-right font-medium cursor-pointer hover:text-white"
                  onClick={() => handleSort("input_tokens")}
                >
                  Input{sortIcon("input_tokens")}
                </th>
                <th
                  className="px-3 py-2 text-right font-medium cursor-pointer hover:text-white"
                  onClick={() => handleSort("output_tokens")}
                >
                  Output{sortIcon("output_tokens")}
                </th>
                <th className="px-3 py-2 text-right font-medium">Cache</th>
                <th
                  className="px-3 py-2 text-right font-medium cursor-pointer hover:text-white"
                  onClick={() => handleSort("cost_usd")}
                >
                  Cost{sortIcon("cost_usd")}
                </th>
                <th className="px-3 py-2 text-left font-medium">Type</th>
                <th
                  className="px-3 py-2 text-right font-medium cursor-pointer hover:text-white"
                  onClick={() => handleSort("last_activity_at")}
                >
                  Date{sortIcon("last_activity_at")}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-white/[0.03] hover:bg-white/[0.02]"
                >
                  <td className="px-3 py-2 font-medium max-w-[200px] truncate">
                    {s.project}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1 flex-wrap">
                      {s.models.map((m) => (
                        <ModelBadge key={m} model={m} />
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-400">
                    {formatTokens(s.input_tokens)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-400">
                    {formatTokens(s.output_tokens)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-400">
                    {formatTokens(s.cache_read_tokens)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-medium">
                    ${s.cost_usd.toFixed(2)}
                  </td>
                  <td className="px-3 py-2">
                    {s.is_subagent && (
                      <span className="inline-block rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                        subagent
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-500">
                    {s.last_activity_at?.slice(0, 10) || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between border-t border-white/[0.06] px-3 py-2">
          <span className="text-xs text-slate-500">
            {total} sessions total
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-white/[0.04] disabled:opacity-30"
            >
              Prev
            </button>
            <span className="text-xs text-slate-400">
              {page} / {totalPages || 1}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-white/[0.04] disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
