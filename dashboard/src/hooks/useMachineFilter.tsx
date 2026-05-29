import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
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

  const { data, isLoading } = useQuery<Machine[]>({
    queryKey: ["machines", { active_only: true }],
    queryFn: () => fetchMachines() as Promise<Machine[]>,
  });

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
      value={{
        machineId,
        setMachineId,
        machines: data ?? [],
        loading: isLoading,
      }}
    >
      {children}
    </MachineFilterContext.Provider>
  );
}

export function useMachineFilter() {
  return useContext(MachineFilterContext);
}
