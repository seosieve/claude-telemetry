import { db, json, type Env } from "./_lib";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const machine_id = url.searchParams.get("machine_id");
  const start_date = url.searchParams.get("start_date");
  const end_date = url.searchParams.get("end_date");
  const active_only = url.searchParams.get("active_only");

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (machine_id) {
    if (!UUID_RE.test(machine_id)) return json([], 200);
    params.push(machine_id);
    conditions.push(`machine_id = $${params.length}`);
  }
  if (start_date) {
    params.push(start_date);
    conditions.push(`block_start >= $${params.length}`);
  }
  if (end_date) {
    params.push(`${end_date}T23:59:59Z`);
    conditions.push(`block_start <= $${params.length}`);
  }
  if (active_only === "true") {
    conditions.push("is_active = true");
  }

  const where = conditions.length > 0 ? ` where ${conditions.join(" and ")}` : "";
  const text = `select * from blocks${where} order by block_start desc limit 100`;

  const sql = db(context.env);
  const rows = await sql.query(text, params);

  return json(rows, 200);
};
