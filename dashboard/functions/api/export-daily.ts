import { db, type Env } from "./_lib";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const start_date = url.searchParams.get("start_date");
  const end_date = url.searchParams.get("end_date");
  const machine_id = url.searchParams.get("machine_id");
  const format = url.searchParams.get("format") || "csv";

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

  const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";

  // Export every matching row — daily_usage is append-only and would eventually
  // cross the old 1000-row PostgREST cap; plain SQL has no such limit.
  const sql = db(context.env);
  const data = await sql.query(
    `select * from daily_usage ${where} order by date asc`,
    params,
  );

  if (format === "json") {
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": "attachment; filename=daily_usage.json",
      },
    });
  }

  // CSV
  if (!data.length) {
    return new Response("No data", { status: 200 });
  }

  const headers = Object.keys(data[0]);
  const csvRows = [
    headers.join(","),
    ...data.map((row) =>
      headers.map((h) => {
        const val = row[h];
        if (val === null || val === undefined) return "";
        const str = String(val);
        return str.includes(",") || str.includes('"')
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      }).join(","),
    ),
  ];

  return new Response(csvRows.join("\n"), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": "attachment; filename=daily_usage.csv",
    },
  });
};
