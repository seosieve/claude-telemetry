// Shared helpers for Cloudflare Pages Functions.
// Files prefixed with "_" are NOT exposed as routes.
//
// Data layer: Neon serverless driver over HTTP (works in the Workers runtime).
// The DB is reached only by these server-side Functions via DATABASE_URL — never
// exposed to clients — so there is no RLS / JWT; the connection string is the key.

import { neon, types, type NeonQueryFunction } from "@neondatabase/serverless";

// The Neon driver returns NUMERIC and BIGINT as strings by default, whereas the
// old PostgREST backend returned them as JSON numbers. Parse them back to
// numbers once, here, so every endpoint and the dashboard (charts, arithmetic)
// keep working unchanged.
types.setTypeParser(1700, parseFloat); // NUMERIC
types.setTypeParser(20, (v: string) => parseInt(v, 10)); // INT8 / BIGINT
types.setTypeParser(1082, (v: string) => v); // DATE → keep "YYYY-MM-DD" (avoid Date→ISO/timezone drift)

export interface Env {
  DATABASE_URL: string;
  CRON_SECRET?: string;
}

// Neon scale-to-zero: after ~5 min idle the compute suspends. The first query
// landing during a cold start can fail with a transient connection/wake error,
// which otherwise bubbles up as a Worker exception (HTTP 500 → "Failed to load
// data"). These errors happen at connect/wake time — before the statement runs —
// so retrying a couple of times is safe even for writes, and makes the wake-up
// invisible to the dashboard. Genuine SQL errors (constraint, syntax, bad args)
// don't match this pattern and surface immediately without wasted retries.
const TRANSIENT =
  /\b(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN)\b|connect|connection|timed? ?out|terminat|starting up|not yet|could ?n[o']?t reach|unavailable|fetch failed|network|bad gateway|service unavailable|\b(?:502|503|504|429)\b/i;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry<T>(run: () => Promise<T>, tries = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt >= tries || !TRANSIENT.test(msg)) throw err;
      await sleep(250 * attempt); // 250ms, then 500ms — well within cold-start wake time
    }
  }
}

// Returns a tagged-template SQL function: await sql`select ... ${val}`.
// For dynamic SQL use sql.query(text, params) with $1, $2, ... placeholders.
// Both call styles retry transient cold-start failures (see withRetry above).
// Note: this returns plain Promises instead of Neon's lazy NeonQueryPromise, so
// results must be awaited (all call sites do) — sql.transaction() is unsupported.
export function db(env: Env): NeonQueryFunction<false, false> {
  const sql = neon(env.DATABASE_URL);

  const wrapped = (strings: TemplateStringsArray, ...values: unknown[]) =>
    withRetry(() => sql(strings, ...values));
  wrapped.query = (text: string, params?: unknown[]) =>
    withRetry(() => sql.query(text, params));
  wrapped.transaction = () => {
    throw new Error("sql.transaction() is not supported by the retrying db() wrapper");
  };

  return wrapped as unknown as NeonQueryFunction<false, false>;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
