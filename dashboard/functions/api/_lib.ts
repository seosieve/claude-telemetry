// Shared helpers for Cloudflare Pages Functions.
// Files prefixed with "_" are NOT exposed as routes, so this is a safe place
// for code shared across endpoints.

export interface SupabaseEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

export function serviceHeaders(env: SupabaseEnv): Record<string, string> {
  return {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
  };
}

// Fetch ALL rows from a PostgREST URL, paging past the default 1000-row cap via
// Range headers. Without this, large tables (e.g. sessions) get silently
// truncated and exports/charts lose data with no error surfaced anywhere.
export async function fetchAllRows<T = Record<string, unknown>>(
  url: string,
  headers: Record<string, string>,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const res = await fetch(url, {
      headers: {
        ...headers,
        "Range-Unit": "items",
        Range: `${from}-${from + pageSize - 1}`,
      },
    });
    if (!res.ok) break;
    const batch = (await res.json()) as T[];
    if (!Array.isArray(batch)) break;
    all.push(...batch);
    if (batch.length < pageSize) break;
  }
  return all;
}
