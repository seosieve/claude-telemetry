import { db, json, type Env } from "./_lib";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const start_date = url.searchParams.get("start_date");
  const end_date = url.searchParams.get("end_date");
  const machine_id = url.searchParams.get("machine_id");

  if (!start_date || !end_date) {
    return json({ error: "start_date and end_date are required" }, 400);
  }

  // Preserve original behavior: machine_id is optional; null means "all machines".
  const machineId = machine_id && UUID_RE.test(machine_id) ? machine_id : null;

  const sql = db(context.env);
  const rows = await sql`select * from get_usage_summary(${start_date}, ${end_date}, ${machineId})`;

  return json(rows);
};
