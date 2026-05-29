/**
 * GET /api/analytics/trends?days=30&machine_id=...
 * Returns: direction, slope, avg, stdev, first/second half comparison, 7-day projection.
 */

import { db, json, type Env } from "./_lib";

function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function linearRegression(values: number[]): { slope: number; intercept: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] || 0 };
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i] - yMean);
    den += (i - xMean) ** 2;
  }
  const slope = den ? num / den : 0;
  return { slope, intercept: yMean - slope * xMean };
}

function mean(arr: number[]): number {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

function stdev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const days = parseInt(url.searchParams.get("days") || "30", 10);

  // Only allow UUID format for machine_id; anything else is treated as null.
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const rawMachineId = url.searchParams.get("machine_id");
  const machineId = rawMachineId && uuidRe.test(rawMachineId) ? rawMachineId : null;

  const sql = db(context.env);
  const rows = (await sql`
    select * from get_usage_summary(${daysAgoISO(days)}, ${daysAgoISO(0)}, ${machineId})
  `) as Array<{ date: string; total_cost: number; total_tokens: number }>;

  if (!rows || rows.length < 3) {
    return json({ error: "Not enough data", rows: rows?.length || 0 }, 200);
  }

  const costs = rows.map((r) => Number(r.total_cost) || 0);
  const { slope, intercept } = linearRegression(costs);
  const avg = mean(costs);
  const sd = stdev(costs);
  const n = costs.length;

  const direction = Math.abs(slope) < avg * 0.02 ? "stable" : slope > 0 ? "up" : "down";

  const mid = Math.floor(n / 2);
  const firstHalfAvg = mean(costs.slice(0, mid));
  const secondHalfAvg = mean(costs.slice(mid));

  // 7-day projection
  const forecast = Array.from({ length: 7 }, (_, i) => {
    const predicted = Math.max(0, slope * (n + i) + intercept);
    return { day: i + 1, predicted };
  });
  const forecastTotal = forecast.reduce((s, f) => s + f.predicted, 0);

  // Daily data for chart (actual + anomaly flag)
  const dailyData = rows.map((r) => {
    const cost = Number(r.total_cost) || 0;
    const z = sd > 0 ? (cost - avg) / sd : 0;
    return {
      date: r.date,
      cost,
      tokens: Number(r.total_tokens) || 0,
      z_score: Math.round(z * 10) / 10,
      is_anomaly: Math.abs(z) >= 2,
    };
  });

  return json({
    direction,
    slope: Math.round(slope * 10000) / 10000,
    avg: Math.round(avg * 100) / 100,
    stdev: Math.round(sd * 100) / 100,
    first_half_avg: Math.round(firstHalfAvg * 100) / 100,
    second_half_avg: Math.round(secondHalfAvg * 100) / 100,
    half_change_pct: firstHalfAvg > 0 ? Math.round(((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 1000) / 10 : 0,
    days: n,
    forecast,
    forecast_total: Math.round(forecastTotal * 100) / 100,
    forecast_low: Math.round(forecast.reduce((s, f) => s + Math.max(0, f.predicted - sd), 0) * 100) / 100,
    forecast_high: Math.round(forecast.reduce((s, f) => s + f.predicted + sd, 0) * 100) / 100,
    daily_data: dailyData,
  });
};
