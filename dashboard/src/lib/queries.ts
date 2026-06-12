import {
  fetchUsageSummary,
  fetchProjectCosts,
  fetchWeeklyEstimate,
  fetchMachineSummary,
} from "./api";

export interface UsageSummaryRow {
  date: string;
  total_cost: number;
  total_tokens: number;
  opus_cost: number;
  sonnet_cost: number;
  haiku_cost: number;
  fable_cost: number;
  machine_count: number;
}

export interface ProjectCostRow {
  project: string;
  total_cost: number;
  total_tokens: number;
  primary_model: string;
  machines_used: number;
}

export interface WeeklyRateRow {
  week_start: string;
  week_cost: number;
  week_tokens: number;
  avg_daily_cost: number;
  projected_weekly_cost: number;
  days_active: number;
}

export interface MachineSummaryRow {
  machine_id: string;
  machine_name: string;
  total_cost: number;
  total_tokens: number;
  days_active: number;
  last_activity: string;
  top_project: string;
}

export async function getUsageSummary(
  startDate: string,
  endDate: string,
  machineId?: string,
): Promise<UsageSummaryRow[]> {
  const rows = (await fetchUsageSummary(startDate, endDate, machineId)) as UsageSummaryRow[];
  // DB 함수가 002-fable-cost 마이그레이션 이전이면 fable_cost가 없음 — NaN 전파 방지
  return rows.map((r) => ({ ...r, fable_cost: r.fable_cost ?? 0 }));
}

export async function getProjectCosts(
  startDate: string,
  endDate: string,
  machineId?: string,
): Promise<ProjectCostRow[]> {
  return fetchProjectCosts(startDate, endDate, machineId) as Promise<ProjectCostRow[]>;
}

export async function getWeeklyRateEstimate(
  machineId?: string,
): Promise<WeeklyRateRow[]> {
  return fetchWeeklyEstimate(machineId) as Promise<WeeklyRateRow[]>;
}

export async function getMachineSummary(
  startDate?: string,
  endDate?: string,
): Promise<MachineSummaryRow[]> {
  return fetchMachineSummary(startDate, endDate) as Promise<MachineSummaryRow[]>;
}
