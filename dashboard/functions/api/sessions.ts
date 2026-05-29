import { db, json, type Env } from "./_lib";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const machine_id = url.searchParams.get("machine_id");
  const project = url.searchParams.get("project");
  const model = url.searchParams.get("model");
  const is_subagent = url.searchParams.get("is_subagent");
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const per_page = Math.min(100, Math.max(1, parseInt(url.searchParams.get("per_page") || "20", 10) || 20));
  const ALLOWED_SORT = ["cost_usd", "total_tokens", "last_activity_at", "input_tokens", "output_tokens"];
  const sort = ALLOWED_SORT.includes(url.searchParams.get("sort") || "") ? url.searchParams.get("sort")! : "cost_usd";
  const order = url.searchParams.get("order") === "asc" ? "asc" : "desc";

  const offset = (page - 1) * per_page;

  // Build WHERE clause from filters using parameterized placeholders ($1, $2, ...).
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (machine_id && uuidRe.test(machine_id)) {
    params.push(machine_id);
    conditions.push(`machine_id = $${params.length}`);
  }
  if (project) {
    params.push(project);
    conditions.push(`project = $${params.length}`);
  }
  if (model) {
    // PostgREST cs.{model} = array contains → value = any(models)
    params.push(model);
    conditions.push(`$${params.length} = any(models)`);
  }
  if (is_subagent === "true") conditions.push("is_subagent = true");
  if (is_subagent === "false") conditions.push("is_subagent = false");

  const whereClause = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";

  const sql = db(context.env);

  // Total count (exact) with the same filters.
  const countRows = await sql.query(
    `select count(*)::int as total from sessions ${whereClause}`,
    params,
  );
  const total = (countRows[0]?.total as number) ?? 0;

  // Paginated data — sort column is whitelisted, order is asc/desc, nulls last.
  const dataParams = [...params, per_page, offset];
  const limitIdx = dataParams.length - 1; // $ for per_page
  const offsetIdx = dataParams.length; // $ for offset
  const data = await sql.query(
    `select * from sessions ${whereClause} order by ${sort} ${order} nulls last limit $${limitIdx} offset $${offsetIdx}`,
    dataParams,
  );

  return json({ data, total, page, per_page });
};
