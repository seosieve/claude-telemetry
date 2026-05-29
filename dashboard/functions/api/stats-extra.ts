import { db, json, type Env } from "./_lib";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const machine_id = url.searchParams.get("machine_id");

  if (machine_id && !UUID_RE.test(machine_id)) {
    return json({ error: "invalid machine_id" }, 400);
  }

  const sql = db(context.env);

  const rows = machine_id
    ? await sql`
        select * from stats_extra
        where machine_id = ${machine_id}
        order by synced_at desc
        limit 1
      `
    : await sql`
        select * from stats_extra
        order by synced_at desc
        limit 1
      `;

  return json(rows);
};
