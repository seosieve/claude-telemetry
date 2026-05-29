import { db, json, type Env } from "./_lib";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const active_only = url.searchParams.get("active_only") !== "false";

  const sql = db(context.env);
  const rows = active_only
    ? await sql`
        select * from machines
        where is_active = true
        order by last_sync_at desc nulls last
      `
    : await sql`
        select * from machines
        order by last_sync_at desc nulls last
      `;

  return json(rows, 200);
};
