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

interface ModelLimitEntry {
  pct?: number | null;
  resets_at?: string | null;
}

interface RateLimitRow {
  machine_id?: string;
  window_1w_percent?: number | null;
  weekly_reset_at?: string | null;
  timestamp?: string;
  model_limits?: Record<string, ModelLimitEntry> | null;
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

/**
 * Account-wide gauge for one model-scoped weekly limit (e.g. "fable" — the
 * 50%-of-weekly Fable cap). Same aggregation as accountWeeklyPct: latest row
 * per machine, current window only (the entry's own resets_at must be in the
 * future), min across machines. The OAuth readings are live values, so within
 * one account the min is just the freshest reading.
 */
export function accountModelLimit(
  rows: Array<Record<string, unknown>> | RateLimitRow[] | undefined,
  model: string,
): { pct: number; resetsAtMs: number | null } | null {
  if (!rows) return null;
  const now = Date.now();
  const latest = new Map<string, { pct: number; resetsAtMs: number | null }>();
  for (const raw of rows) {
    const r = raw as RateLimitRow;
    const mid = r.machine_id;
    const entry = r.model_limits?.[model];
    const pct = entry?.pct;
    if (mid == null || pct == null) continue;
    const resetsAtMs = entry?.resets_at ? new Date(entry.resets_at).getTime() : null;
    if (resetsAtMs != null && resetsAtMs <= now) continue;
    if (!latest.has(mid)) latest.set(mid, { pct, resetsAtMs });
  }
  let min: { pct: number; resetsAtMs: number | null } | null = null;
  for (const v of latest.values()) {
    if (min == null || v.pct < min.pct) min = v;
  }
  return min;
}
