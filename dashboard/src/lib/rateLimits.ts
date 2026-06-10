// Helpers for deriving account-level rate-limit values from the per-machine
// rate_limits rows returned by /api/rate-limits.
//
// The weekly (1w) limit is shared across the whole account, but each machine
// reports it independently from its own local ccost reading. ccost's
// maxSevenDayPct is a per-window PEAK, so a machine that was busy *before* a
// reset keeps reporting the pre-reset peak until its window closes, while a
// machine that only became active *after* the reset reports the fresh, lower
// value. Picking a single most-recent row across machines therefore flickers
// between the stale and fresh readings (whichever synced last wins).

interface RateLimitRow {
  machine_id?: string;
  window_1w_percent?: number | null;
  weekly_reset_at?: string | null;
  timestamp?: string;
}

/**
 * Account-wide weekly usage %, robust to the per-machine peak/staleness skew.
 *
 * `rows` must be newest-first (the API sorts by `timestamp desc`), so the first
 * row seen per machine is that machine's latest reading. We keep only rows whose
 * weekly window hasn't reset yet (`weekly_reset_at` in the future) — that scopes
 * the value to the *current* weekly window and drops leftover rows from machines
 * that went quiet in a previous window. Across the surviving machines we take the
 * minimum: a reset only lowers true usage, so the freshest reading is the smallest
 * peak.
 */
export function accountWeeklyPct(
  rows: Array<Record<string, unknown>> | RateLimitRow[] | undefined,
): number | null {
  if (!rows) return null;
  const now = Date.now();
  const latest = new Map<string, number>();
  for (const raw of rows) {
    const r = raw as RateLimitRow;
    const mid = r.machine_id;
    const pct = r.window_1w_percent;
    const resetAt = r.weekly_reset_at ? new Date(r.weekly_reset_at).getTime() : 0;
    if (mid == null || pct == null || resetAt <= now) continue;
    if (!latest.has(mid)) latest.set(mid, pct);
  }
  if (latest.size === 0) return null;
  return Math.min(...latest.values());
}
