interface MetricCardProps {
  label: string;
  value: string;
  sub?: string;
  trend?: string;
  trendUp?: boolean;
}

export function MetricCard({ label, value, sub, trend, trendUp }: MetricCardProps) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <p className="text-xs font-medium text-slate-400">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold tracking-tight">
        {value}
      </p>
      {(sub || trend) && (
        <div className="mt-1 flex items-center gap-2">
          {sub && <span className="text-xs text-slate-500">{sub}</span>}
          {trend && (
            <span
              className={`text-xs font-medium ${
                trendUp ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {trend}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
