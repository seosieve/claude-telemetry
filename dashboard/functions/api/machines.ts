import { db, json, type Env } from "./_lib";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const active_only = url.searchParams.get("active_only") !== "false";

  // Never expose api_key: this endpoint is unauthenticated (guest mode), and
  // the key would let anyone forge ingest data for a machine.
  const sql = db(context.env);
  const rows = active_only
    ? await sql`
        select id, name, os, hostname, claude_version, created_at, last_sync_at, is_active
        from machines
        where is_active = true
        order by last_sync_at desc nulls last
      `
    : await sql`
        select id, name, os, hostname, claude_version, created_at, last_sync_at, is_active
        from machines
        order by last_sync_at desc nulls last
      `;

  return json(rows, 200);
};
