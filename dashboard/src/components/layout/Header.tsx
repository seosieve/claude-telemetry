import { useMachineFilter } from "../../hooks/useMachineFilter";
import { useAuth } from "../../contexts/AuthContext";

interface HeaderProps {
  title: string;
}

export function Header({ title }: HeaderProps) {
  const { machineId, setMachineId, machines } = useMachineFilter();
  const { user, logout } = useAuth();

  return (
    <header className="flex h-14 items-center justify-between border-b border-white/[0.06] px-6">
      <h1 className="text-lg font-semibold">{title}</h1>
      <div className="flex items-center gap-3">
        <select
          value={machineId || ""}
          onChange={(e) => setMachineId(e.target.value || undefined)}
          aria-label="Filter by machine"
          className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-xs text-slate-300 outline-none focus:border-sky-500/50"
        >
          <option value="">All Machines</option>
          {machines.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        {user && (
          <>
            <span className="text-xs text-slate-500">{user.email}</span>
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
