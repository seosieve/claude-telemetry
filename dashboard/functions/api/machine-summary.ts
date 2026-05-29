import { db, json, type Env } from "./_lib";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const start_date = url.searchParams.get("start_date") || "2020-01-01";
  const end_date =
    url.searchParams.get("end_date") ||
    new Date().toISOString().slice(0, 10);

  const sql = db(context.env);
  const rows = await sql`select * from get_machine_summary(${start_date}, ${end_date})`;

  return json(rows, 200);
};
