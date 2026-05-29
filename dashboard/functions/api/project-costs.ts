import { db, json, type Env } from "./_lib";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const start_date = url.searchParams.get("start_date");
  const end_date = url.searchParams.get("end_date");
  const machine_id = url.searchParams.get("machine_id");

  if (!start_date || !end_date) {
    return json({ error: "start_date and end_date are required" }, 400);
  }

  // Validate UUID format when a machine filter is supplied. This endpoint is
  // unauthenticated under guest mode, so reject anything that isn't a
  // well-formed machine id before binding it into SQL.
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (machine_id && !uuidRe.test(machine_id)) {
    return json({ error: "valid machine id (uuid) is required" }, 400);
  }

  const sql = db(context.env);
  const rows = await sql`
    select * from get_project_costs(${start_date}, ${end_date}, ${machine_id || null})
  `;

  return json(rows);
};
