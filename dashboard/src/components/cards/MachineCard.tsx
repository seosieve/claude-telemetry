import { formatTokens } from "../../lib/dateUtils";
import { getStatusDisplay } from "../../lib/machineStatus";

interface MachineCardProps {
  name: string;
  lastSync: string;
  lastSyncAt?: string | null;
  cost: number;
  tokens: number;
  topProject: string;
  daysActive: number;
}

export function MachineCard({
  name,
  lastSync,
  lastSyncAt,
  cost,
  tokens,
  topProject,
  daysActive,
}: MachineCardProps) {
  const badge = getStatusDisplay(lastSyncAt);
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm">{name}</h3>
        <span className={`inline-flex h-2 w-2 rounded-full ${badge.color}`} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-slate-500">Cost</p>
          <p className="font-mono font-medium">${cost.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-slate-500">Tokens</p>
          <p className="font-mono font-medium">{formatTokens(tokens)}</p>
        </div>
        <div>
          <p className="text-slate-500">Top Project</p>
          <p className="font-medium truncate">{topProject || "—"}</p>
        </div>
        <div>
          <p className="text-slate-500">Days Active</p>
          <p className="font-mono font-medium">{daysActive}</p>
        </div>
      </div>
      <p className="mt-3 text-[10px] text-slate-600">
        Last sync: {lastSync || "never"}
      </p>
    </div>
  );
}
