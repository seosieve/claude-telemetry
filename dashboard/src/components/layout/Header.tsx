import { useMachineFilter } from "../../hooks/useMachineFilter";
import { useAuth } from "../../contexts/AuthContext";

interface HeaderProps {
  title: string;
  activePage?: string;
  onMobileMenuToggle?: () => void;
}

export function Header({ title, activePage, onMobileMenuToggle }: HeaderProps) {
  const { machineId, setMachineId, machines } = useMachineFilter();
  const { user, logout } = useAuth();
  const showMachineFilter = activePage !== "machines";

  return (
    <header className="flex h-14 items-center justify-between border-b border-white/[0.06] px-4 lg:px-6">
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onMobileMenuToggle}
          aria-label="Open navigation"
          className="-ml-1 rounded-lg p-2 text-slate-300 hover:bg-white/[0.04] lg:hidden"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <h1 className="truncate text-base font-semibold lg:text-lg">{title}</h1>
      </div>
      <div className="flex items-center gap-2 lg:gap-3">
        {showMachineFilter && (
          <select
            value={machineId || ""}
            onChange={(e) => setMachineId(e.target.value || undefined)}
            aria-label="Filter by machine"
            className="max-w-[120px] truncate rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 text-xs text-slate-300 outline-none focus:border-sky-500/50 lg:max-w-none lg:px-3"
          >
            <option value="">All Machines</option>
            {machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
        {user && (
          <>
            <span className="hidden text-xs text-slate-500 lg:inline">{user.email}</span>
            <button
              onClick={logout}
              aria-label="Logout"
              className="rounded-lg border border-white/[0.06] px-2 py-1 text-xs text-slate-400 hover:bg-white/[0.04] hover:text-white"
            >
              Logout
            </button>
          </>
        )}
      </div>
    </header>
  );
}
