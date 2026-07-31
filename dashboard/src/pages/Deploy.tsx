import { useState, useEffect } from "react";

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

function getCommands(os: OS, machineName: string): CommandStep[] {
  const isWin = os === "windows";
  const isMac = os === "macos";
  // setup registers the machine via the dashboard (which hands back its own
  // api_key) — no database keys ever live on the machine.
  const setupCmd = `cc-telemetry setup --non-interactive --name "${machineName}"`;
  // The rice-gang fork bakes this dashboard's ingest URL into the agent, so
  // machines must install from the fork — never the upstream PyPI package.
  const forkUrl =
    "git+https://github.com/seosieve/claude-telemetry@main#subdirectory=agent";
  const py = isWin ? "python" : "python3";

  const prereqCode = isMac
    ? ["brew install pipx", "npm install -g ccusage ccost"]
    : [
        "npm install -g ccusage ccost",
        `${py} -m pip install --user pipx`,
        `${py} -m pipx ensurepath`,
      ];

  const installStep: CommandStep = isMac
    ? {
        step: "2",
        label: "Install agent (rice-gang fork)",
        code: "curl -fsSL https://raw.githubusercontent.com/seosieve/claude-telemetry/main/bootstrap.sh | sh",
        warning:
          "Also registers a daily 05:10 auto-upgrade LaunchAgent. The backfill sync at the end fails before setup — that's expected; Step 4 covers it.",
      }
    : {
        step: "2",
        label: "Install agent (rice-gang fork)",
        code: `pipx install --force "${forkUrl}"`,
        warning:
          "bootstrap.sh auto-upgrade is macOS-only — re-run this command whenever the agent needs updating.",
      };

  return [
    {
      step: "1",
      label: "Install prerequisites",
      code: prereqCode.join("\n"),
      warning: "Requires Node.js 18+ and Python 3.11+.",
    },
    installStep,
    {
      step: "3",
      label: "Run setup wizard",
      code: setupCmd,
      warning:
        "Registers this machine with the dashboard (it receives its own api_key automatically) and configures hooks, MCP server, statusline, and daemon. No database keys needed on the machine.",
    },
    {
      step: "4",
      label: "Backfill & verify",
      code: ["cc-telemetry sync --force", "cc-telemetry doctor"].join("\n"),
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

export function Deploy() {
  const [os, setOs] = useState<OS>(detectOS);
  const [machineName, setMachineName] = useState("");
  const [showCommands, setShowCommands] = useState(false);

  // Initial machine-name suggestion on mount.
  useEffect(() => {
    setMachineName(suggestMachineName(detectOS()));
  }, []);

  const commands = showCommands && machineName.trim()
    ? getCommands(os, machineName.trim())
    : [];

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
            onChange={(e) => {
              setMachineName(e.target.value);
              setShowCommands(false);
            }}
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
          onClick={() => setShowCommands(true)}
          disabled={!machineName.trim()}
          className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-600 disabled:opacity-50"
        >
          Show setup commands
        </button>
      </div>

      {/* Generated commands */}
      {commands.length > 0 && (
        <div className="space-y-4">
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
