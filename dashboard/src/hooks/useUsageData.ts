import { useQuery } from "@tanstack/react-query";
import {
  getUsageSummary,
  getProjectCosts,
  getWeeklyRateEstimate,
  getMachineSummary,
  type UsageSummaryRow,
  type ProjectCostRow,
  type WeeklyRateRow,
  type MachineSummaryRow,
} from "../lib/queries";
import { useMachineFilter } from "./useMachineFilter";

interface DateRange {
  start: string;
  end: string;
}

interface UsageData {
  summary: UsageSummaryRow[];
  projects: ProjectCostRow[];
  weeklyRates: WeeklyRateRow[];
  machines: MachineSummaryRow[];
  loading: boolean;
  error: string | null;
}

export function useUsageData(
  dateRange: DateRange,
  opts?: { polling?: boolean },
): UsageData {
  const { machineId } = useMachineFilter();
  const { start, end } = dateRange;
  // 5 min: agent syncs ~every 15 min, so 30s polling just woke Neon for nothing.
  const refetchInterval = opts?.polling ? 300_000 : undefined;

  const summaryQ = useQuery<UsageSummaryRow[]>({
    queryKey: ["usage-summary", start, end, machineId],
    queryFn: () => getUsageSummary(start, end, machineId),
    refetchInterval,
  });

  const projectsQ = useQuery<ProjectCostRow[]>({
    queryKey: ["project-costs", start, end, machineId],
    queryFn: () => getProjectCosts(start, end, machineId),
    refetchInterval,
  });

  const weeklyQ = useQuery<WeeklyRateRow[]>({
    queryKey: ["weekly-rate", machineId],
    queryFn: () => getWeeklyRateEstimate(machineId),
    refetchInterval,
  });

  const machinesQ = useQuery<MachineSummaryRow[]>({
    queryKey: ["machine-summary", start, end],
    queryFn: () => getMachineSummary(start, end),
    refetchInterval,
  });

  const error =
    summaryQ.error?.message ||
    projectsQ.error?.message ||
    weeklyQ.error?.message ||
    machinesQ.error?.message ||
    null;

  return {
    summary: summaryQ.data ?? [],
    projects: projectsQ.data ?? [],
    weeklyRates: weeklyQ.data ?? [],
    machines: machinesQ.data ?? [],
    loading:
      summaryQ.isLoading ||
      projectsQ.isLoading ||
      weeklyQ.isLoading ||
      machinesQ.isLoading,
    error,
  };
}
