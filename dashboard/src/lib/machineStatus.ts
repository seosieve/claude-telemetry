export interface StatusDisplay {
  color: string;
  label: string;
}

export function getStatusDisplay(
  lastSync: string | null | undefined,
  isActive?: boolean,
): StatusDisplay {
  if (isActive === false) {
    return { color: "bg-slate-600", label: "Disabled" };
  }
  if (!lastSync) {
    return { color: "bg-slate-600", label: "Never synced" };
  }
  const diffMin = (Date.now() - new Date(lastSync).getTime()) / 60000;
  if (diffMin < 30) return { color: "bg-emerald-400", label: "Online" };
  if (diffMin < 120) return { color: "bg-amber-400", label: "Idle" };
  return { color: "bg-rose-400", label: "Offline" };
}
