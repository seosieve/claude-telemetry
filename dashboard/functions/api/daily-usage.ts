interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const start_date = url.searchParams.get("start_date");
  const end_date = url.searchParams.get("end_date");
  const machine_id = url.searchParams.get("machine_id");
  const project = url.searchParams.get("project");
  const model = url.searchParams.get("model");

  const filters: string[] = [];
  if (start_date) filters.push(`date=gte.${start_date}`);
  if (end_date) filters.push(`date=lte.${end_date}`);
  if (machine_id) filters.push(`machine_id=eq.${machine_id}`);
  if (project) filters.push(`project=eq.${project}`);
  if (model) filters.push(`model=eq.${model}`);

  const query = filters.length > 0 ? `?${filters.join("&")}&order=date.desc` : "?order=date.desc";

  const response = await fetch(
    `${context.env.SUPABASE_URL}/rest/v1/daily_usage${query}`,
    {
      headers: {
        apikey: context.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${context.env.SUPABASE_SERVICE_KEY}`,
      },
    },
  );

  const data = await response.json();
  return new Response(JSON.stringify(data), {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
};
