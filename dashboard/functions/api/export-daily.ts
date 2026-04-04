interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const start_date = url.searchParams.get("start_date");
  const end_date = url.searchParams.get("end_date");
  const machine_id = url.searchParams.get("machine_id");
  const format = url.searchParams.get("format") || "csv";

  const filters: string[] = ["order=date.asc"];
  if (start_date) filters.push(`date=gte.${start_date}`);
  if (end_date) filters.push(`date=lte.${end_date}`);
  if (machine_id) filters.push(`machine_id=eq.${machine_id}`);

  const query = `?${filters.join("&")}`;

  const response = await fetch(
    `${context.env.SUPABASE_URL}/rest/v1/daily_usage${query}`,
    {
      headers: {
        apikey: context.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${context.env.SUPABASE_SERVICE_KEY}`,
      },
    },
  );

  const data = (await response.json()) as Array<Record<string, unknown>>;

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
