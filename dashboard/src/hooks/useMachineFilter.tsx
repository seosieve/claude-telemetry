import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { fetchMachines } from "../lib/api";

interface Machine {
  id: string;
  name: string;
  os: string | null;
  hostname: string | null;
  last_sync_at: string | null;
  is_active: boolean;
}

interface MachineFilterContextValue {
  machineId: string | undefined;
  setMachineId: (id: string | undefined) => void;
  machines: Machine[];
  loading: boolean;
}

const MachineFilterContext = createContext<MachineFilterContextValue>({
  machineId: undefined,
  setMachineId: () => {},
  machines: [],
  loading: true,
});

export function MachineFilterProvider({ children }: { children: ReactNode }) {
  const [machineId, setMachineIdState] = useState<string | undefined>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("machine") || undefined;
  });
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMachines()
      .then((data) => setMachines(data as Machine[]))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const setMachineId = (id: string | undefined) => {
    setMachineIdState(id);
    const params = new URLSearchParams(window.location.search);
    if (id) {
      params.set("machine", id);
    } else {
      params.delete("machine");
    }
    const newUrl = params.toString()
      ? `${window.location.pathname}?${params}`
      : window.location.pathname;
    window.history.replaceState({}, "", newUrl);
  };

  return (
    <MachineFilterContext.Provider
      value={{ machineId, setMachineId, machines, loading }}
    >
      {children}
    </MachineFilterContext.Provider>
  );
}

export function useMachineFilter() {
  return useContext(MachineFilterContext);
}
