import { useMemo } from "react";
import { useUsageData } from "../hooks/useUsageData";
import { useAlertThresholds } from "../hooks/useAlertThresholds";
import { daysAgo, today } from "../lib/dateUtils";

interface InsightCardProps {
  icon: string;
  title: string;
  text: string;
  color: "amber" | "rose" | "sky" | "emerald" | "violet";
}

function InsightCard({ icon, title, text, color }: InsightCardProps) {
  const colorMap = {
    amber: "border-amber-500/20 bg-amber-500/5 text-amber-400",
    rose: "border-rose-500/20 bg-rose-500/5 text-rose-400",
    sky: "border-sky-500/20 bg-sky-500/5 text-sky-400",
    emerald: "border-emerald-500/20 bg-emerald-500/5 text-emerald-400",
    violet: "border-violet-500/20 bg-violet-500/5 text-violet-400",
  };
  return (
    <div className={`rounded-xl border p-4 ${colorMap[color]}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">{icon}</span>
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      <p className="text-xs text-slate-400 leading-relaxed">{text}</p>
    </div>
  );
}

export function Insights() {
  const dateRange14 = useMemo(
    () => ({ start: daysAgo(14), end: today() }),
    [],
  );
  const { summary, projects, machines, weeklyRates, loading } =
    useUsageData(dateRange14);
  const thresholdAlerts = useAlertThresholds(summary);

  const insights: InsightCardProps[] = [];

  // Threshold alerts (from Settings)
  for (const alert of thresholdAlerts) {
    insights.push({
      icon: "\u26A0\uFE0F",
      title: alert.type === "daily" ? "Daily Cost Alert" : "Weekly Cost Alert",
      text: alert.message,
      color: "rose",
    });
  }

  // Rate limit estimator
  const totalCost14 = summary.reduce((s, r) => s + r.total_cost, 0);
  const activeDays14 = summary.length;
  const avgDaily = activeDays14 > 0 ? totalCost14 / activeDays14 : 0;
  const projectedWeekly = avgDaily * 7;

  insights.push({
    icon: "\u26A1",
    title: "Weekly Cost Projection",
    text: `Based on your average of $${avgDaily.toFixed(2)}/day over the last 14 days, your projected weekly cost is $${projectedWeekly.toFixed(2)}.${projectedWeekly > 150 ? " This exceeds $150/week — consider optimizing model usage." : ""}`,
    color: projectedWeekly > 150 ? "rose" : "sky",
  });

  // Model optimization
  const opusCost = summary.reduce((s, r) => s + r.opus_cost, 0);
  const opusPct = totalCost14 > 0 ? (opusCost / totalCost14) * 100 : 0;
  if (opusPct > 70) {
    const weeklySavings = (opusCost / activeDays14) * 7 * 0.5 * 0.8;
    insights.push({
      icon: "\uD83D\uDCA1",
      title: "Model Optimization",
      text: `Opus accounts for ${opusPct.toFixed(0)}% of your costs. Use /model sonnet for routine tasks. Estimated savings: $${weeklySavings.toFixed(2)}/week.`,
      color: "amber",
    });
  }

  // Project dominance
  if (projects.length > 0) {
    const topProject = projects[0];
    const topPct =
      totalCost14 > 0 ? (topProject.total_cost / totalCost14) * 100 : 0;
    if (topPct > 50) {
      insights.push({
        icon: "\uD83D\uDCCA",
        title: "Project Dominance",
        text: `"${topProject.project}" consumes ${topPct.toFixed(0)}% of your total budget ($${topProject.total_cost.toFixed(2)}).`,
        color: "violet",
      });
    }
  }

  // Trend analysis (week over week)
  const thisWeek = summary.filter((r) => r.date >= daysAgo(7));
  const prevWeek = summary.filter(
    (r) => r.date >= daysAgo(14) && r.date < daysAgo(7),
  );
  const thisWeekCost = thisWeek.reduce((s, r) => s + r.total_cost, 0);
  const prevWeekCost = prevWeek.reduce((s, r) => s + r.total_cost, 0);
  if (prevWeekCost > 0) {
    const change = ((thisWeekCost - prevWeekCost) / prevWeekCost) * 100;
    const direction = change > 0 ? "increased" : "decreased";
    insights.push({
      icon: change > 0 ? "\uD83D\uDCC8" : "\uD83D\uDCC9",
      title: "Trend Analysis",
      text: `Your spending ${direction} by ${Math.abs(change).toFixed(0)}% this week ($${thisWeekCost.toFixed(2)}) compared to last week ($${prevWeekCost.toFixed(2)}).`,
      color: change > 0 ? "rose" : "emerald",
    });
  }

  // Machine comparison
  if (machines.length > 1) {
    const sorted = [...machines].sort((a, b) => b.total_cost - a.total_cost);
    const top = sorted[0];
    insights.push({
      icon: "\uD83D\uDDA5\uFE0F",
      title: "Machine Comparison",
      text: `"${top.machine_name}" is your highest-spending machine ($${top.total_cost.toFixed(2)}), primarily used for "${top.top_project || "various projects"}".`,
      color: "sky",
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Insights</h2>
        <p className="text-xs text-slate-500">
          Automated recommendations based on your usage patterns
        </p>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-600 border-t-sky-400" />
          Analyzing...
        </div>
      )}

      {/* Rate limit progress bar */}
      {weeklyRates.length > 0 && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <h3 className="mb-2 text-sm font-medium">Weekly Rate Estimate</h3>
          <div className="space-y-2">
            {weeklyRates.slice(0, 4).map((w) => (
              <div key={w.week_start} className="flex items-center gap-3">
                <span className="w-20 text-xs font-mono text-slate-500">
                  {w.week_start.slice(5)}
                </span>
                <div className="flex-1 h-3 rounded-full bg-white/[0.04]">
                  <div
                    className={`h-3 rounded-full ${w.week_cost > 150 ? "bg-rose-500" : w.week_cost > 100 ? "bg-amber-500" : "bg-sky-500"}`}
                    style={{
                      width: `${Math.min(100, (w.week_cost / 200) * 100)}%`,
                    }}
                  />
                </div>
                <span className="w-16 text-right text-xs font-mono">
                  ${w.week_cost.toFixed(0)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Insight cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {insights.map((insight, i) => (
          <InsightCard key={i} {...insight} />
        ))}
      </div>

      {insights.length === 0 && !loading && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-8 text-center">
          <p className="text-sm text-slate-400">
            Not enough data for insights yet.
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Keep syncing and check back in a few days.
          </p>
        </div>
      )}
    </div>
  );
}
