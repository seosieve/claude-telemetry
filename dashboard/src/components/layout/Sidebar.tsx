interface SidebarProps {
  activePage: string;
  onNavigate: (page: string) => void;
  alertCount?: number;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

const NAV_ITEMS = [
  { id: "overview", label: "Overview" },
  { id: "daily", label: "Daily" },
  { id: "blocks", label: "Blocks" },
  { id: "projects", label: "Projects" },
  { id: "models", label: "Models" },
  { id: "machines", label: "Machines" },
  { id: "deploy", label: "Deploy" },
  { id: "sessions", label: "Sessions" },
  { id: "insights", label: "Insights" },
  { id: "settings", label: "Settings" },
];

function NavList({
  activePage,
  onNavigate,
  alertCount,
}: {
  activePage: string;
  onNavigate: (page: string) => void;
  alertCount: number;
}) {
  return (
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
  );
}

function Brand() {
  return (
    <div className="flex h-14 items-center gap-2 border-b border-white/[0.06] px-4">
      <img src="/favicon.svg" alt="Logo" className="h-7 w-7" />
      <span className="font-semibold text-sm tracking-tight">
        Rice Gang Tracker
      </span>
    </div>
  );
}

export function Sidebar({
  activePage,
  onNavigate,
  alertCount = 0,
  mobileOpen = false,
  onMobileClose,
}: SidebarProps) {
  const handleNavigate = (id: string) => {
    onNavigate(id);
    onMobileClose?.();
  };

  return (
    <>
      <aside className="hidden w-56 flex-shrink-0 border-r border-white/[0.06] bg-slate-950 lg:flex lg:flex-col">
        <Brand />
        <NavList activePage={activePage} onNavigate={onNavigate} alertCount={alertCount} />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" onClick={onMobileClose}>
          <div className="absolute inset-0 bg-black/60" />
          <aside
            className="absolute left-0 top-0 flex h-full w-64 flex-col border-r border-white/[0.06] bg-slate-950"
            onClick={(e) => e.stopPropagation()}
          >
            <Brand />
            <NavList
              activePage={activePage}
              onNavigate={handleNavigate}
              alertCount={alertCount}
            />
          </aside>
        </div>
      )}
    </>
  );
}
