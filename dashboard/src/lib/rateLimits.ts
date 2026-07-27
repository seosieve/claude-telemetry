// Helpers for deriving account-level rate-limit values from the per-machine
// rate_limits rows returned by /api/rate-limits.
//
// Rows carry LIVE usage readings from Claude Code's statusline feed, stamped
// with the reading's own time (not the sync time — the agent uses the
// statusline record's ts precisely so an idle machine's daemon re-sync can't
// launder an old reading into a fresh-looking row). For an account-shared
// limit that makes aggregation simple: the freshest in-window reading across
// machines IS the account's current value.
//
// History: this used to be min() across machines. That belonged to the
// ccost-peak era (pre-f42c09f), when rows carried per-window PEAKS that stayed
// high across an off-cycle reset — "a reset only lowers usage, so the smaller
// peak is fresher". With live readings the premise inverts: usage rises within
// a window, so min() pins the dashboard to the *stalest* machine's reading and
// fresh updates from active machines get discarded until every machine syncs.
//
// Reset safety of freshest-wins:
//   * scheduled weekly reset — pre-reset rows carry the old weekly_reset_at,
//     which is now in the past, so the in-window filter drops them;
//   * off-cycle reset (e.g. the 2026-06-10 mid-week refresh) — pre-reset rows
//     stay in-window, but they can only outrank a post-reset reading by
//     timestamp, and honest reading timestamps make the post-reset reading
//     strictly newer. (This is why the agent-side timestamp fix and this
//     aggregation ship together.)
//
// CAVEAT: freshest-across-all assumes every reporting machine shares one
// account pool (true today: 충원 + K성민). If a machine on a *different*
// account joins the fleet, group rows by their weekly_reset_at anchor first
// and aggregate per group — otherwise the pools mix.

interface ModelLimitEntry {
  pct?: number | null;
  resets_at?: string | null;
}

interface RateLimitRow {
  machine_id?: string;
  window_5h_percent?: number | null;
  window_1w_percent?: number | null;
  session_duration_seconds?: number | null;
  weekly_reset_at?: string | null;
  timestamp?: string;
  model_limits?: Record<string, ModelLimitEntry> | null;
}

/**
 * Account-wide 5h session gauge: the newest reading whose 5h session hasn't
 * reset yet. session_duration_seconds encodes the reset time
 * (timestamp + 5h - duration); a reading from an already-reset session is
 * dropped — its % predates the reset that zeroed it. Readings without a
 * duration can't be checked and are kept (resetsAtMs null).
 */
export function accountSessionPct(
  rows: Array<Record<string, unknown>> | RateLimitRow[] | undefined,
): { pct: number; resetsAtMs: number | null } | null {
  if (!rows) return null;
  const now = Date.now();
  for (const raw of rows) {
    const r = raw as RateLimitRow;
    const pct = r.window_5h_percent;
    const ts = r.timestamp;
    if (pct == null || !ts) continue;
    const tsMs = new Date(ts).getTime();
    if (tsMs > now) continue;
    const dur = r.session_duration_seconds;
    const resetsAtMs = typeof dur === "number" ? tsMs + (5 * 3600 - dur) * 1000 : null;
    if (resetsAtMs != null && resetsAtMs <= now) continue;
    return { pct, resetsAtMs };
  }
  return null;
}

/**
 * Account-wide weekly usage %: the newest reading whose weekly window is still
 * open. `rows` must be newest-first (the API sorts by `timestamp desc`), so
 * the first surviving row is the freshest reading of the shared pool.
 */
export function accountWeeklyPct(
  rows: Array<Record<string, unknown>> | RateLimitRow[] | undefined,
): number | null {
  if (!rows) return null;
  const now = Date.now();
  for (const raw of rows) {
    const r = raw as RateLimitRow;
    const pct = r.window_1w_percent;
    const resetAt = r.weekly_reset_at ? new Date(r.weekly_reset_at).getTime() : 0;
    if (pct == null || resetAt <= now) continue;
    return pct;
  }
  return null;
}

/**
 * Account-wide gauge for one model-scoped weekly limit (e.g. "fable" — the
 * 50%-of-weekly Fable cap): the newest row carrying an entry for `model`
 * whose own resets_at is still in the future. The OAuth values are account-
 * level and refreshed on every sync (upserts touch model_limits even when the
 * row's reading timestamp doesn't move), so the newest carrying row is fresh.
 */
export function accountModelLimit(
  rows: Array<Record<string, unknown>> | RateLimitRow[] | undefined,
  model: string,
): { pct: number; resetsAtMs: number | null } | null {
  if (!rows) return null;
  const now = Date.now();
  for (const raw of rows) {
    const r = raw as RateLimitRow;
    const entry = r.model_limits?.[model];
    const pct = entry?.pct;
    if (pct == null) continue;
    const resetsAtMs = entry?.resets_at ? new Date(entry.resets_at).getTime() : null;
    if (resetsAtMs != null && resetsAtMs <= now) continue;
    return { pct, resetsAtMs };
  }
  return null;
}
