import { db, json, type Env } from "./_lib";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const start_date = url.searchParams.get("start_date");
  const end_date = url.searchParams.get("end_date");
  const machine_id = url.searchParams.get("machine_id");
  const project = url.searchParams.get("project");
  const model = url.searchParams.get("model");

  // Only allow UUID format for machine_id (matches the rest of the API surface).
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (start_date) {
    params.push(start_date);
    conditions.push(`date >= $${params.length}`);
  }
  if (end_date) {
    params.push(end_date);
    conditions.push(`date <= $${params.length}`);
  }
  if (machine_id && uuidRe.test(machine_id)) {
    params.push(machine_id);
    conditions.push(`machine_id = $${params.length}::uuid`);
  }
  if (project) {
    params.push(project);
    conditions.push(`project = $${params.length}`);
  }
  if (model) {
    params.push(model);
    conditions.push(`model = $${params.length}`);
  }

  const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";

  // Charts depend on the full matching range, so select every row (the old
  // PostgREST path paged past the 1000-row cap; plain SQL has no such limit).
  const sql = db(context.env);
  const data = await sql.query(
    `select * from daily_usage ${where} order by date desc`,
    params,
  );

  return json(data, 200);
};
