import { db, type Env } from "./_lib";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const machine_id = url.searchParams.get("machine_id");
  const project = url.searchParams.get("project");
  const format = url.searchParams.get("format") || "csv";

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

  const whereClause = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";

  const sql = db(context.env);

  // Full export — no 1000-row cap in SQL, so just select everything that matches.
  const data = await sql.query(
    `select * from sessions ${whereClause} order by cost_usd desc`,
    params,
  );

  if (format === "json") {
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": "attachment; filename=sessions.json",
      },
    });
  }

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
      "Content-Disposition": "attachment; filename=sessions.csv",
    },
  });
};
