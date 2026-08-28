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
//   * scheduled weekly reset — the freshest reading carries the old
//     weekly_reset_at, now in the past, so it is reported as 0 rather than as
//     its stale pre-reset % (see accountWeeklyPct);
//   * off-cycle reset (e.g. the 2026-06-10 mid-week refresh) — pre-reset rows
//     stay in-window, but they can only outrank a post-reset reading by
//     timestamp, and honest reading timestamps make the post-reset reading
//     strictly newer. (This is why the agent-side timestamp fix and this
//     aggregation ship together.)
//
// CAVEAT: freshest-across-all assumes every reporting machine shares one
// account pool. True today — all four machines (충원 / 성민 / 정섭 / 대성) are
// on the same account (verified 2026-08-18 by identical weekly_reset_at
// anchors), which is also why 대성 reporting no rate limits costs us nothing:
// 대성 uses the Claude desktop app only, which runs no statusline and refreshes
// no CLI Keychain token, and its numbers would be identical to the others'
// anyway. If a machine on a *different* account joins the fleet, group rows by
// their weekly_reset_at anchor first and aggregate per group — otherwise the
// pools mix.
//
// Corollary for callers: these values are account-scoped, so never fetch them
// through a machine filter. See Overview.tsx's two un-filtered queries (the
// newest-N listing for the 5h/weekly gauges, and the per-machine
// model_limits=latest set for accountModelLimit).

interface ModelLimitEntry {
  pct?: number | null;
  resets_at?: string | null;
  // When the agent actually read this value from the OAuth API (agent ≥ 0.3.8).
  // Older agents omit it; the row's timestamp stands in.
  fetched_at?: string | null;
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
 * Account-wide 5h session gauge: the freshest usable reading.
 * session_duration_seconds encodes the reset time (timestamp + 5h - duration).
 *
 * A reading whose session has already reset does NOT carry the current usage —
 * its % predates the reset that zeroed it — but the reset itself is
 * information: usage is 0, not unknown. So report 0 with no countdown (the new
 * session's window isn't known until a fresh reading lands) rather than null,
 * which would make the card vanish for the gap between the reset and the next
 * sync. Older rows are not consulted in that case: rows are newest-first and a
 * shared account pool resets for every machine at once, so anything behind a
 * reset reading is equally stale.
 *
 * Readings without a duration can't be checked and are taken at face value
 * (resetsAtMs null). Returns null only when no reading exists at all.
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
    if (resetsAtMs != null && resetsAtMs <= now) return { pct: 0, resetsAtMs: null };
    return { pct, resetsAtMs };
  }
  return null;
}

/**
 * Account-wide weekly usage %: the freshest reading, with the reset time of the
 * window it belongs to. `rows` must be newest-first (the API sorts by
 * `timestamp desc`), so the first usable row is the freshest reading of the
 * shared pool.
 *
 * When that reading's weekly window has already rolled over its % predates the
 * reset that zeroed it, but the reset itself is information: usage is 0, not
 * unknown. So report 0 with no reset time (the new window's anchor isn't known
 * until a fresh reading lands) rather than null, which would make the card
 * vanish for the whole gap between the reset and the next sync — a gap that
 * lasts until a machine that reports rate limits actually runs. Older rows are
 * not consulted in that case: rows are newest-first and a shared account pool
 * resets for every machine at once, so anything behind a reset reading is
 * equally stale. Mirrors accountSessionPct.
 *
 * Readings without a weekly_reset_at can't be checked and are taken at face
 * value (resetsAtMs null). Returns null only when no reading exists at all.
 */
export function accountWeeklyPct(
  rows: Array<Record<string, unknown>> | RateLimitRow[] | undefined,
): { pct: number; resetsAtMs: number | null } | null {
  if (!rows) return null;
  const now = Date.now();
  for (const raw of rows) {
    const r = raw as RateLimitRow;
    const pct = r.window_1w_percent;
    if (pct == null) continue;
    const resetsAtMs = r.weekly_reset_at ? new Date(r.weekly_reset_at).getTime() : null;
    if (resetsAtMs != null && resetsAtMs <= now) return { pct: 0, resetsAtMs: null };
    return { pct, resetsAtMs };
  }
  return null;
}

/**
 * Account-wide gauge for one model-scoped weekly limit (e.g. "fable" — the
 * 50%-of-weekly Fable cap): the most recently READ entry for `model` that
 * still belongs to the current window.
 *
 * Unlike the 5h/weekly gauges, the model_limits column is not a live reading
 * stamped with the row's time — it is whatever the agent's OAuth cache held at
 * sync time, which can be days old when that machine's fetch is broken. So two
 * things differ from accountWeeklyPct:
 *
 *   * entries are ranked by their own fetched_at (falling back to the row
 *     timestamp for pre-0.3.8 agents), not by row order, so a stale cache on a
 *     busy machine cannot outrank a fresher reading on an idle one;
 *   * an entry whose resets_at has passed is skipped rather than returned as
 *     0 — it describes the previous window, and another machine may well hold
 *     the current one. Only when every entry has expired is the answer 0 with
 *     no reset time: the window genuinely rolled over and no machine has read
 *     the new one yet (dropping the card would blank it until some agent
 *     syncs). 2026-08-23~28 is the case this guards: one machine re-sent a
 *     100% / resets-08-23 entry on fresh rows for five days, and the old
 *     newest-row-wins logic showed 0% while the account sat at 65%.
 *
 * `rows` should be one row per machine — the newest carrying model_limits
 * (see /api/rate-limits?model_limits=latest); a plain newest-N listing gets
 * flooded by machines whose column is null.
 */
export function accountModelLimit(
  rows: Array<Record<string, unknown>> | RateLimitRow[] | undefined,
  model: string,
): { pct: number; resetsAtMs: number | null } | null {
  if (!rows) return null;
  const now = Date.now();
  let best: { pct: number; resetsAtMs: number | null; readMs: number } | null = null;
  let sawExpired = false;
  for (const raw of rows) {
    const r = raw as RateLimitRow;
    const entry = r.model_limits?.[model];
    const pct = entry?.pct;
    if (pct == null) continue;
    const resetsAtMs = entry?.resets_at ? new Date(entry.resets_at).getTime() : null;
    if (resetsAtMs != null && resetsAtMs <= now) {
      sawExpired = true;
      continue;
    }
    const readRaw = entry?.fetched_at ?? r.timestamp;
    const readMs = readRaw ? new Date(readRaw).getTime() : 0;
    const safeReadMs = Number.isFinite(readMs) ? readMs : 0;
    if (!best || safeReadMs > best.readMs) best = { pct, resetsAtMs, readMs: safeReadMs };
  }
  if (best) return { pct: best.pct, resetsAtMs: best.resetsAtMs };
  return sawExpired ? { pct: 0, resetsAtMs: null } : null;
}
