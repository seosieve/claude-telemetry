import { useMemo } from "react";
import type { UsageSummaryRow } from "../lib/queries";
import { daysAgo } from "../lib/dateUtils";

export interface Alert {
  type: "daily" | "weekly";
  message: string;
  value: number;
  threshold: number;
}

export function useAlertThresholds(summary: UsageSummaryRow[]): Alert[] {
  return useMemo(() => {
    const dailyThreshold = parseFloat(
      localStorage.getItem("alert_daily_threshold") || "0",
    );
    const weeklyThreshold = parseFloat(
      localStorage.getItem("alert_weekly_threshold") || "0",
    );

    const alerts: Alert[] = [];

    if (!dailyThreshold && !weeklyThreshold) return alerts;

    // Check daily: most recent day's cost
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayRow = summary.find((r) => r.date === todayStr);
    if (dailyThreshold > 0 && todayRow && todayRow.total_cost > dailyThreshold) {
      alerts.push({
        type: "daily",
        message: `Daily cost alert: $${todayRow.total_cost.toFixed(2)} exceeds your $${dailyThreshold} threshold`,
        value: todayRow.total_cost,
        threshold: dailyThreshold,
      });
    }

    // Check weekly: last 7 days total
    if (weeklyThreshold > 0) {
      const weekAgo = daysAgo(7);
      const weekCost = summary
        .filter((r) => r.date >= weekAgo)
        .reduce((s, r) => s + r.total_cost, 0);
      if (weekCost > weeklyThreshold) {
        alerts.push({
          type: "weekly",
          message: `Weekly cost alert: $${weekCost.toFixed(2)} exceeds your $${weeklyThreshold} threshold`,
          value: weekCost,
          threshold: weeklyThreshold,
        });
      }
    }

    return alerts;
  }, [summary]);
}
