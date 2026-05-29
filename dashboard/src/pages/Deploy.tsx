import { useState, useEffect } from "react";
import { generateAgentConfig, type AgentConfig } from "../lib/api";

type OS = "windows" | "linux" | "macos";

function detectOS(): OS {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "windows";
  if (ua.includes("mac")) return "macos";
  return "linux";
}

function suggestMachineName(os: OS): string {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = now.toLocaleString("en", { month: "short" }).toLowerCase();
  const prefix = os === "macos" ? "mac" : os;
  return `${prefix}-pc-${day}${month}`;
}

interface CommandStep {
  step: string;
  label: string;
  code: string;
  warning?: string;
}

function getCommands(
  os: OS,
  config: AgentConfig,
  machineName: string,
): CommandStep[] {
  const isWin = os === "windows";

  const setupCmd = isWin
    ? `cc-telemetry setup --non-interactive --name "${machineName}" --supabase-url "${config.supabase_url}" --supabase-key "PASTE_YOUR_KEY_HERE" --machine-id "${config.machine_id}"`
    : [
        `cc-telemetry setup --non-interactive \\`,
        `  --name "${machineName}" \\`,
        `  --supabase-url "${config.supabase_url}" \\`,
        `  --supabase-key "PASTE_YOUR_KEY_HERE" \\`,
        `  --machine-id "${config.machine_id}"`,
      ].join("\n");

  return [
    {
      step: "1",
      label: "Install",
      code: [
        "npm install -g ccusage ccost",
        "pip install cc-telemetry",
      ].join("\n"),
      warning: "Requires Node.js 18+ and Python 3.11+.",
    },
    {
      step: "2",
      label: "Run setup wizard",
      code: setupCmd,
      warning:
        "Replace PASTE_YOUR_KEY_HERE with your Supabase service_role key (see the note above). The wizard configures hooks, MCP server, statusline, and daemon automatically.",
    },
    {
      step: "3",
      label: "Verify",
      code: "cc-telemetry doctor",
      warning: isWin
        ? "Run PowerShell as Administrator if the service check fails."
        : undefined,
    },
  ];
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="rounded-md border border-white/[0.06] bg-white/[0.04] px-2 py-1 text-[10px] font-medium text-slate-400 transition-colors hover:bg-white/[0.08] hover:text-white"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

// Where the agent's service_role key comes from. We deliberately do NOT return
// the key from /api/generate-agent-config (it's unauthenticated under guest
// mode), so the user copies it once from the Supabase dashboard instead.
function ServiceKeyNotice() {
  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
      <p className="text-xs text-amber-400">
        {"🔐"}{" "}
        <span className="font-semibold">service_role key</span> is not shown
        here for security. Copy it once from{" "}
        <span className="font-mono text-amber-300">
          Supabase {"→"} Settings {"→"} API {"→"} service_role
        </span>{" "}
        and paste it into Step 2 in place of{" "}
        <span className="font-mono">PASTE_YOUR_KEY_HERE</span>.
      </p>
    </div>
  );
}

export function Deploy() {
  const [os, setOs] = useState<OS>(detectOS);
  const [machineName, setMachineName] = useState("");
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-suggest machine name when OS changes or on mount
  useEffect(() => {
    if (!machineName || machineName === suggestMachineName(os === "windows" ? "linux" : os === "linux" ? "macos" : "windows")) {
      setMachineName(suggestMachineName(os));
    }
  }, [os]); // eslint-disable-line react-hooks/exhaustive-deps

  // Set initial suggestion on mount
  useEffect(() => {
    setMachineName(suggestMachineName(detectOS()));
  }, []);

  const handleGenerate = async () => {
    if (!machineName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const cfg = await generateAgentConfig(machineName.trim(), os);
      setConfig(cfg);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate config");
    } finally {
      setLoading(false);
    }
  };

  const commands = config ? getCommands(os, config, machineName) : [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Deploy New Agent</h2>
        <p className="mt-1 text-xs text-slate-500">
          Install a tracking agent on a new machine
        </p>
      </div>

      {/* Config form */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">
            Machine Name
          </label>
          <input
            type="text"
            value={machineName}
            onChange={(e) => setMachineName(e.target.value)}
            placeholder="e.g., Desktop-Casa, Laptop-Work, Server-Prod"
            className="w-full rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-sm outline-none focus:border-sky-500/50"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">
            Operating System
          </label>
          <div className="flex gap-2">
            {(["windows", "linux", "macos"] as const).map((o) => (
              <button
                key={o}
                onClick={() => setOs(o)}
                className={`rounded-lg px-4 py-2 text-xs font-medium transition-colors ${
                  os === o
                    ? "bg-sky-500/20 text-sky-400 border border-sky-500/30"
                    : "border border-white/[0.06] text-slate-400 hover:bg-white/[0.04]"
                }`}
              >
                {o === "macos" ? "macOS" : o.charAt(0).toUpperCase() + o.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handleGenerate}
          disabled={loading || !machineName.trim()}
          className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-600 disabled:opacity-50"
        >
          {loading ? "Generating..." : "Generate Commands"}
        </button>

        {error && (
          <p className="text-xs text-rose-400">{error}</p>
        )}
      </div>

      {/* Generated commands */}
      {config && (
        <div className="space-y-4">
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
            <p className="text-xs text-emerald-400">
              Machine registered! ID:{" "}
              <span className="font-mono">{config.machine_id.slice(0, 8)}...</span>
            </p>
          </div>

          <ServiceKeyNotice />

          {commands.map((cmd) => (
            <div
              key={cmd.step}
              className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4"
            >
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-medium">
                  <span className="text-sky-400">Step {cmd.step}</span> {"—"} {cmd.label}
                </h3>
                <CopyButton text={cmd.code} />
              </div>
              <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-xs text-slate-300">
                {cmd.code}
              </pre>
              {cmd.warning && (
                <p className="mt-2 text-xs text-amber-400">
                  {"⚠️"} {cmd.warning}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
