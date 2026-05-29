import { fetchAllRows, serviceHeaders, type SupabaseEnv } from "./_lib";

export const onRequestGet: PagesFunction<SupabaseEnv> = async (context) => {
  const url = new URL(context.request.url);
  const machine_id = url.searchParams.get("machine_id");
  const project = url.searchParams.get("project");
  const format = url.searchParams.get("format") || "csv";

  const filters: string[] = ["order=cost_usd.desc"];
  if (machine_id) filters.push(`machine_id=eq.${machine_id}`);
  if (project) filters.push(`project=eq.${project}`);

  const query = `?${filters.join("&")}`;

  // Page through ALL rows — a plain fetch caps at 1000 and silently drops the
  // rest (sessions already exceeds that), so exports were losing data.
  const data = await fetchAllRows(
    `${context.env.SUPABASE_URL}/rest/v1/sessions${query}`,
    serviceHeaders(context.env),
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
