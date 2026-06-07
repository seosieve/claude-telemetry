import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchMachines, deleteMachine, downloadExport, fetchProjectCosts, testWebhook } from "../lib/api";
import type { NotificationPrefs } from "../lib/api";
import { getStatusDisplay } from "../lib/machineStatus";
import { usePreferences } from "../hooks/usePreferences";
import { daysAgo, today, formatKstTimestamp } from "../lib/dateUtils";
import { ConfirmDeleteModal } from "../components/ConfirmDeleteModal";

interface Machine {
  id: string;
  name: string;
  os: string | null;
  hostname: string | null;
  last_sync_at: string | null;
  is_active: boolean;
  created_at: string;
}

const DEFAULT_NOTIF: NotificationPrefs = {
  webhook_url: null,
  webhook_enabled: false,
  types: { project_budget: true, rate_limit: true },
};

function NotificationsSection({ prefs, save }: { prefs: { notifications?: NotificationPrefs }; save: (data: Record<string, unknown>) => void }) {
  const notif = { ...DEFAULT_NOTIF, ...prefs.notifications };
  const types = { ...DEFAULT_NOTIF.types, ...notif.types };

  const [webhookUrl, setWebhookUrl] = useState(notif.webhook_url || "");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const update = (patch: Partial<NotificationPrefs>) => {
    save({ notifications: { ...notif, ...patch } });
  };

  const handleSave = () => {
    update({ webhook_url: webhookUrl || null, webhook_enabled: !!webhookUrl, types });
  };

  const handleTest = async () => {
    if (!webhookUrl) return;
    setTesting(true);
    setTestResult(null);
    try {
      const ok = await testWebhook(webhookUrl);
      setTestResult(ok ? "Webhook sent!" : "Webhook failed — check the URL");
    } catch {
      setTestResult("Webhook failed — check the URL");
    }
    setTesting(false);
  };

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-4">
      <h3 className="text-sm font-medium">Notifications</h3>

      <div>
        <label className="block text-xs text-slate-400 mb-1">Webhook URL</label>
        <input
          type="url"
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          placeholder="https://discord.com/api/webhooks/..."
          className="w-full rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-xs font-mono outline-none focus:border-sky-500/50"
        />
        <p className="mt-1 text-[10px] text-slate-600">Discord, Slack, or any webhook that accepts JSON.</p>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-slate-400">Send alert when:</p>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={types.project_budget}
            onChange={(e) => update({ types: { ...types, project_budget: e.target.checked } })}
            className="rounded border-white/[0.1] bg-white/[0.05]"
          />
          <span className="text-xs text-slate-300">Project budget reaches 90%</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={types.rate_limit}
            onChange={(e) => update({ types: { ...types, rate_limit: e.target.checked } })}
            className="rounded border-white/[0.1] bg-white/[0.05]"
          />
          <span className="text-xs text-slate-300">Rate limit (5h or weekly) reaches 90%</span>
        </label>
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleTest}
          disabled={testing || !webhookUrl}
          className="rounded-lg border border-white/[0.06] px-3 py-1.5 text-xs text-slate-300 hover:bg-white/[0.04] disabled:opacity-50"
        >
          {testing ? "Sending..." : "Test Webhook"}
        </button>
        <button
          onClick={handleSave}
          className="rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-600"
        >
          Save
        </button>
      </div>

      {testResult && (
        <p className={`text-[10px] ${testResult.includes("sent") ? "text-emerald-400" : "text-rose-400"}`}>
          {testResult}
        </p>
      )}

      <p className="text-[10px] text-slate-600">
        Requires cron: POST to <code className="text-slate-400">/api/cron-check-notifications</code> every 15 min
        with <code className="text-slate-400">X-Cron-Secret</code> header.
      </p>
    </div>
  );
}

export function Settings() {
  const { prefs, save } = usePreferences();
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [dailyThreshold, setDailyThreshold] = useState("");
  const [weeklyThreshold, setWeeklyThreshold] = useState("");

  useEffect(() => {
    setDailyThreshold(String(prefs.alert_thresholds?.daily || 20));
    setWeeklyThreshold(String(prefs.alert_thresholds?.weekly || 100));
  }, [prefs.alert_thresholds]);

  const machinesQ = useQuery<Machine[]>({
    queryKey: ["machines", { active_only: false }],
    queryFn: () => fetchMachines(false) as Promise<Machine[]>,
  });
  const machines = machinesQ.data ?? [];
  const loading = machinesQ.isLoading;

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteMachine(deleteTarget.id);
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["machines"] });
    } catch {
      // Error handled by api.ts
    }
  }, [deleteTarget, queryClient]);

  const saveThresholds = () => {
    save({
      alert_thresholds: {
        daily: parseFloat(dailyThreshold) || 0,
        weekly: parseFloat(weeklyThreshold) || 0,
      },
    });
  };

  const [budgets, setBudgets] = useState<Record<string, string>>({});

  const projectsQ = useQuery({
    queryKey: ["project-costs-90d"],
    queryFn: () => {
      const dateRange = { start: daysAgo(90), end: today() };
      return fetchProjectCosts(dateRange.start, dateRange.end) as Promise<Array<{ project: string }>>;
    },
  });
  const projectNames = useMemo(
    () => (projectsQ.data ?? []).map((p) => p.project),
    [projectsQ.data],
  );

  // Sync budgets from preferences
  useEffect(() => {
    if (prefs.project_budgets) {
      const b: Record<string, string> = {};
      for (const [k, v] of Object.entries(prefs.project_budgets)) {
        b[k] = String(v);
      }
      setBudgets(b);
    }
  }, [prefs.project_budgets]);

  const saveBudgets = () => {
    const parsed: Record<string, number> = {};
    for (const [k, v] of Object.entries(budgets)) {
      const num = parseFloat(v);
      if (num > 0) parsed[k] = num;
    }
    save({ project_budgets: parsed });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h2 className="text-xl font-semibold">Settings</h2>

      {/* Machines list */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <h3 className="mb-3 text-sm font-medium">Registered Machines</h3>
        {loading ? (
          <p className="text-xs text-slate-500">Loading...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06] text-slate-500">
                  <th className="pb-2 text-left font-medium">Name</th>
                  <th className="pb-2 text-left font-medium">OS</th>
                  <th className="pb-2 text-left font-medium">Hostname</th>
                  <th className="pb-2 text-left font-medium">Last Sync</th>
                  <th className="pb-2 text-left font-medium">Status</th>
                  <th className="pb-2 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {machines.map((m) => {
                  const badge = getStatusDisplay(m.last_sync_at);
                  return (
                    <tr
                      key={m.id}
                      className="border-b border-white/[0.03] hover:bg-white/[0.02]"
                    >
                      <td className="py-2 font-medium">{m.name}</td>
                      <td className="py-2 text-slate-400">{m.os || "—"}</td>
                      <td className="py-2 font-mono text-slate-400">
                        {m.hostname || "—"}
                      </td>
                      <td className="py-2 font-mono text-slate-400">
                        {formatKstTimestamp(m.last_sync_at)}
                      </td>
                      <td className="py-2">
                        <div className="flex items-center gap-1.5">
                          <span className={`inline-flex h-2 w-2 rounded-full ${badge.color}`} />
                          <span className="text-slate-500">{badge.label}</span>
                        </div>
                      </td>
                      <td className="py-2 text-right">
                        <button
                          onClick={() => setDeleteTarget({ id: m.id, name: m.name })}
                          className="rounded px-2 py-1 text-[10px] font-medium text-rose-400 hover:bg-rose-500/10"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Your Plan */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <h3 className="mb-3 text-sm font-medium">Your Plan</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Plan tier</label>
            <select
              value={prefs.plan_name || "none"}
              onChange={(e) => {
                const name = e.target.value;
                const costs: Record<string, number | null> = {
                  none: null,
                  pro: 20,
                  max5x: 100,
                  max20x: 200,
                  custom: prefs.plan_cost,
                };
                save({ plan_name: name, plan_cost: costs[name] ?? null });
              }}
              aria-label="Select plan"
              className="w-full rounded-lg border border-white/[0.06] bg-slate-800 px-3 py-1.5 text-sm text-white outline-none"
            >
              <option value="none">Not selected</option>
              <option value="pro">Pro ($20/mo)</option>
              <option value="max5x">Max 5x ($100/mo)</option>
              <option value="max20x">Max 20x ($200/mo)</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          {prefs.plan_name === "custom" && (
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Monthly cost ($)
              </label>
              <input
                type="number"
                value={prefs.plan_cost ?? ""}
                onChange={(e) => {
                  const val = e.target.value ? parseFloat(e.target.value) : null;
                  save({ plan_cost: val });
                }}
                placeholder="150"
                className="w-full rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-sm font-mono outline-none focus:border-sky-500/50"
              />
            </div>
          )}
        </div>
        <p className="mt-2 text-[10px] text-slate-600">
          Used to calculate savings vs API pricing on the Overview page.
        </p>
      </div>

      {/* Access */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <h3 className="mb-3 text-sm font-medium">Access</h3>
        <p className="text-xs text-slate-500">
          This dashboard runs in <span className="text-slate-300">guest mode</span> — no login is
          required, so anyone with the URL can view it. Email-based login was intentionally
          disabled in this fork for simpler day-to-day access.
        </p>
        <p className="mt-3 text-[10px] text-slate-600">
          To restrict who can view it, put the deployment behind{" "}
          <a
            href="https://developers.cloudflare.com/cloudflare-one/policies/access/"
            target="_blank"
            rel="noreferrer"
            className="text-slate-400 underline hover:text-slate-200"
          >
            Cloudflare Access
          </a>{" "}
          or an equivalent reverse proxy.
        </p>
      </div>

      {/* Alert thresholds */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <h3 className="mb-3 text-sm font-medium">Alert Thresholds</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Daily cost alert ($)
            </label>
            <input
              type="number"
              value={dailyThreshold}
              onChange={(e) => setDailyThreshold(e.target.value)}
              className="w-full rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-sm font-mono outline-none focus:border-sky-500/50"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Weekly cost alert ($)
            </label>
            <input
              type="number"
              value={weeklyThreshold}
              onChange={(e) => setWeeklyThreshold(e.target.value)}
              className="w-full rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-sm font-mono outline-none focus:border-sky-500/50"
            />
          </div>
        </div>
        <button
          onClick={saveThresholds}
          className="mt-3 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-600"
        >
          Save Thresholds
        </button>
      </div>

      {/* Project Budgets */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <h3 className="mb-3 text-sm font-medium">Project Budgets</h3>
        {projectNames.length > 0 ? (
          <>
            <div className="space-y-2">
              {projectNames.map((name: string) => (
                <div key={name} className="flex items-center gap-3">
                  <span className="flex-1 text-xs truncate">{name}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-slate-500">$</span>
                    <input
                      type="number"
                      value={budgets[name] || ""}
                      onChange={(e) => setBudgets((b) => ({ ...b, [name]: e.target.value }))}
                      placeholder="—"
                      className="w-20 rounded border border-white/[0.06] bg-white/[0.02] px-2 py-1 text-xs font-mono outline-none focus:border-sky-500/50"
                    />
                    <span className="text-[10px] text-slate-600">/mo</span>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={saveBudgets}
              className="mt-3 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-600"
            >
              Save Budgets
            </button>
          </>
        ) : (
          <p className="text-xs text-slate-500">No projects found. Sync data first.</p>
        )}
        <p className="mt-2 text-[10px] text-slate-600">
          Projects without a budget won't trigger alerts.
        </p>
      </div>

      {/* Notifications */}
      <NotificationsSection prefs={prefs} save={save} />

      {/* Export */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <h3 className="mb-3 text-sm font-medium">Export Data</h3>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => downloadExport("daily", "csv")}
            className="rounded-lg border border-white/[0.06] px-3 py-1.5 text-xs text-slate-300 hover:bg-white/[0.04]"
          >
            Export Daily (CSV)
          </button>
          <button
            onClick={() => downloadExport("sessions", "csv")}
            className="rounded-lg border border-white/[0.06] px-3 py-1.5 text-xs text-slate-300 hover:bg-white/[0.04]"
          >
            Export Sessions (CSV)
          </button>
          <button
            onClick={() => downloadExport("daily", "json")}
            className="rounded-lg border border-white/[0.06] px-3 py-1.5 text-xs text-slate-300 hover:bg-white/[0.04]"
          >
            Export JSON
          </button>
        </div>
      </div>

      {/* About */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <h3 className="mb-2 text-sm font-medium">About</h3>
        <p className="text-xs text-slate-400">
          Claude Telemetry v0.3.1
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Open-source centralized token usage tracking for Claude Code.
        </p>
      </div>

      <ConfirmDeleteModal
        machineName={deleteTarget?.name || ""}
        isOpen={!!deleteTarget}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
