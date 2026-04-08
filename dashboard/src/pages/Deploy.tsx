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
  const activateCmd = isWin
    ? ".\\venv\\Scripts\\Activate"
    : "source venv/bin/activate";
  const pythonCmd = isWin ? "python" : "python3";
  const cdSep = isWin ? "\\" : "/";

  const setupCmd = isWin
    ? `claude-telemetry setup --non-interactive --name "${machineName}" --supabase-url "${config.supabase_url}" --supabase-key "PASTE_YOUR_KEY_HERE" --machine-id "${config.machine_id}"`
    : [
        `claude-telemetry setup --non-interactive \\`,
        `  --name "${machineName}" \\`,
        `  --supabase-url "${config.supabase_url}" \\`,
        `  --supabase-key "PASTE_YOUR_KEY_HERE" \\`,
        `  --machine-id "${config.machine_id}"`,
      ].join("\n");

  return [
    {
      step: "1",
      label: "Install dependencies",
      code: [
        "git clone https://github.com/RyanTech00/claude-telemetry.git",
        `cd claude-telemetry${cdSep}agent`,
        `${pythonCmd} -m venv venv`,
        activateCmd,
        "pip install -e .",
      ].join("\n"),
    },
    {
      step: "2",
      label: "Run setup wizard",
      code: setupCmd,
      warning:
        "Paste the service key from the previous step. The wizard will configure hooks, MCP server, statusline, and daemon automatically.",
    },
    {
      step: "3",
      label: "Verify installation",
      code: [activateCmd, "claude-telemetry doctor"].join("\n"),
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

function OneTimeKeyModal({
  serviceKey,
  onClose,
}: {
  serviceKey: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handleCopy = () => {
    navigator.clipboard.writeText(serviceKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" />
      <div className="relative z-10 w-full max-w-lg rounded-xl border border-amber-500/20 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">{"\uD83D\uDD10"}</span>
          <h3 className="text-sm font-semibold text-amber-400">
            Service Key — One-Time View
          </h3>
        </div>

        <p className="text-xs text-slate-400 mb-4">
          This key will only be shown <span className="font-semibold text-white">once</span>.
          Copy it now and paste it in Step 2 of the setup commands.
        </p>

        <div className="relative rounded-lg bg-slate-950 border border-white/[0.06] p-4">
          <code className="block break-all font-mono text-xs text-amber-300 select-all">
            {serviceKey}
          </code>
          <button
            onClick={handleCopy}
            className="absolute top-2 right-2 rounded-md bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-500/30"
          >
            {copied ? "Copied!" : "Copy Key"}
          </button>
        </div>

        <div className="mt-4 rounded-lg border border-rose-500/20 bg-rose-500/5 p-3">
          <p className="text-[11px] text-rose-400">
            {"\u26A0\uFE0F"} After closing this dialog, the key cannot be retrieved.
            If you lose it, go to Supabase Dashboard {"\u2192"} Settings {"\u2192"} API {"\u2192"} service_role.
          </p>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg bg-white/[0.06] px-4 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-white/[0.1]"
          >
            I've copied the key — close
          </button>
        </div>
      </div>
    </div>
  );
}

export function Deploy() {
  const [os, setOs] = useState<OS>(detectOS);
  const [machineName, setMachineName] = useState("");
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [oneTimeKey, setOneTimeKey] = useState<string | null>(null);

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
      // Show the service key in a one-time modal
      setOneTimeKey(cfg.service_key);
      setShowKeyModal(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate config");
    } finally {
      setLoading(false);
    }
  };

  const handleCloseKeyModal = () => {
    setShowKeyModal(false);
    // Clear the key from memory — never shown again
    setOneTimeKey(null);
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

          {commands.map((cmd) => (
            <div
              key={cmd.step}
              className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4"
            >
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-medium">
                  <span className="text-sky-400">Step {cmd.step}</span> — {cmd.label}
                </h3>
                <CopyButton text={cmd.code} />
              </div>
              <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-xs text-slate-300">
                {cmd.code}
              </pre>
              {cmd.warning && (
                <p className="mt-2 text-xs text-amber-400">
                  {"\u26A0\uFE0F"} {cmd.warning}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* One-time key modal */}
      {showKeyModal && oneTimeKey && (
        <OneTimeKeyModal
          serviceKey={oneTimeKey}
          onClose={handleCloseKeyModal}
        />
      )}
    </div>
  );
}
