import { useEffect, useState } from "react";
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

export function useUsageData(dateRange: DateRange): UsageData {
  const { machineId } = useMachineFilter();
  const [summary, setSummary] = useState<UsageSummaryRow[]>([]);
  const [projects, setProjects] = useState<ProjectCostRow[]>([]);
  const [weeklyRates, setWeeklyRates] = useState<WeeklyRateRow[]>([]);
  const [machines, setMachines] = useState<MachineSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      getUsageSummary(dateRange.start, dateRange.end, machineId),
      getProjectCosts(dateRange.start, dateRange.end, machineId),
      getWeeklyRateEstimate(machineId),
      getMachineSummary(dateRange.start, dateRange.end),
    ])
      .then(([s, p, w, m]) => {
        if (cancelled) return;
        setSummary(s);
        setProjects(p);
        setWeeklyRates(w);
        setMachines(m);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [dateRange.start, dateRange.end, machineId]);

  return { summary, projects, weeklyRates, machines, loading, error };
}
