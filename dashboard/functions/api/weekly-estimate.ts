import { db, json, type Env } from "./_lib";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const machine_id = url.searchParams.get("machine_id");
  const machineId = machine_id && UUID_RE.test(machine_id) ? machine_id : null;

  const sql = db(context.env);
  const rows = await sql`select * from get_weekly_rate_estimate(${machineId})`;

  return json(rows, 200);
};
