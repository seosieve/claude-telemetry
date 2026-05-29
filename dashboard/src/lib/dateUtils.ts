const KST_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function kstDate(d: Date): string {
  return KST_FORMATTER.format(d);
}

export function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return kstDate(d);
}

export function today(): string {
  return kstDate(new Date());
}

export function rangeToDate(range: string): { start: string; end: string } {
  const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
  return { start: daysAgo(days), end: today() };
}

export function fillDateGaps<T extends { date: string }>(
  rows: T[],
  start: string,
  end: string,
  makeEmpty: (date: string) => T,
): T[] {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const out: T[] = [];
  const cur = new Date(start + "T00:00:00Z");
  const last = new Date(end + "T00:00:00Z");
  while (cur <= last) {
    const k = cur.toISOString().slice(0, 10);
    out.push(byDate.get(k) ?? makeEmpty(k));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export interface WeeklyData {
  week: string; // "2026-W14"
  startDate: string;
  totalCost: number;
  totalTokens: number;
  opusCost: number;
  sonnetCost: number;
  haikuCost: number;
}

export function getISOWeekStart(dateStr: string, weekStartDay: string = "monday"): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  const target = weekStartDay === "sunday" ? 0 : 1;
  const diff = (day - target + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}

export function getISOWeekLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((d.getTime() - jan1.getTime()) / 86400000) + 1;
  const weekNum = Math.ceil(dayOfYear / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

export function groupByWeek(
  dailyData: Array<{
    date: string;
    total_cost: number;
    total_tokens: number;
    opus_cost: number;
    sonnet_cost: number;
    haiku_cost: number;
  }>,
  weekStartDay: string = "monday",
): WeeklyData[] {
  const weekMap = new Map<string, WeeklyData>();

  for (const row of dailyData) {
    const weekStart = getISOWeekStart(row.date, weekStartDay);
    const label = getISOWeekLabel(weekStart);
    const existing = weekMap.get(weekStart);
    if (existing) {
      existing.totalCost += row.total_cost;
      existing.totalTokens += row.total_tokens;
      existing.opusCost += row.opus_cost;
      existing.sonnetCost += row.sonnet_cost;
      existing.haikuCost += row.haiku_cost;
    } else {
      weekMap.set(weekStart, {
        week: label,
        startDate: weekStart,
        totalCost: row.total_cost,
        totalTokens: row.total_tokens,
        opusCost: row.opus_cost,
        sonnetCost: row.sonnet_cost,
        haikuCost: row.haiku_cost,
      });
    }
  }

  return Array.from(weekMap.values()).sort((a, b) =>
    a.startDate.localeCompare(b.startDate),
  );
}

export function formatKstDate(isoUtc: string | null | undefined): string {
  if (!isoUtc) return "—";
  const d = new Date(isoUtc);
  if (isNaN(d.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function formatKstTimestamp(
  isoUtc: string | null | undefined,
  opts: { withSeconds?: boolean } = {},
): string {
  if (!isoUtc) return "never";
  const d = new Date(isoUtc);
  if (isNaN(d.getTime())) return "never";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: opts.withSeconds ? "2-digit" : undefined,
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const time = opts.withSeconds
    ? `${get("hour")}:${get("minute")}:${get("second")}`
    : `${get("hour")}:${get("minute")}`;
  return `${date} ${time} KST`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
