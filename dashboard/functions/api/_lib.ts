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
  ALLOWED_EMAILS?: string;
}

// Returns a tagged-template SQL function: await sql`select ... ${val}`.
// For dynamic SQL use sql.query(text, params) with $1, $2, ... placeholders.
export function db(env: Env): NeonQueryFunction<false, false> {
  return neon(env.DATABASE_URL);
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
