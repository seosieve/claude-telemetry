interface SidebarProps {
  activePage: string;
  onNavigate: (page: string) => void;
  alertCount?: number;
}

const NAV_ITEMS = [
  { id: "overview", label: "Overview" },
  { id: "daily", label: "Daily" },
  { id: "projects", label: "Projects" },
  { id: "models", label: "Models" },
  { id: "machines", label: "Machines" },
  { id: "deploy", label: "Deploy" },
  { id: "sessions", label: "Sessions" },
  { id: "insights", label: "Insights" },
  { id: "settings", label: "Settings" },
];

export function Sidebar({ activePage, onNavigate, alertCount = 0 }: SidebarProps) {
  return (
    <aside className="hidden w-56 flex-shrink-0 border-r border-white/[0.06] bg-slate-950 lg:flex lg:flex-col">
      <div className="flex h-14 items-center gap-2 border-b border-white/[0.06] px-4">
        <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-rose-500 to-sky-400" />
        <span className="font-semibold text-sm tracking-tight">
          Claude Tracker
        </span>
      </div>
      <nav className="flex-1 space-y-0.5 p-2">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
              activePage === item.id
                ? "bg-white/[0.06] text-white"
                : "text-slate-400 hover:bg-white/[0.03] hover:text-slate-200"
            }`}
          >
            {item.label}
            {item.id === "insights" && alertCount > 0 && (
              <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                {alertCount}
              </span>
            )}
          </button>
        ))}
      </nav>
    </aside>
  );
}
