import { db, json, type Env } from "./_lib";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const machine_id = url.searchParams.get("machine_id");
  const limitParam = url.searchParams.get("limit") || "50";

  // Sanitize limit — clamp to a positive integer (default 50 on bad input).
  const parsedLimit = parseInt(limitParam, 10);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50;

  // Only allow UUID format for machine_id.
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const validMachineId = machine_id && uuidRe.test(machine_id) ? machine_id : null;

  const sql = db(context.env);

  const text =
    "select * from rate_limits" +
    (validMachineId ? " where machine_id = $1" : "") +
    " order by timestamp desc" +
    (validMachineId ? " limit $2" : " limit $1");

  const params = validMachineId ? [validMachineId, limit] : [limit];

  const rows = await sql.query(text, params);

  return json(rows, 200);
};
