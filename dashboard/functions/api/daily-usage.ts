import { fetchAllRows, serviceHeaders, type SupabaseEnv } from "./_lib";

export const onRequestGet: PagesFunction<SupabaseEnv> = async (context) => {
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

  // Page through ALL matching rows. Charts depend on the full range; a plain
  // fetch caps at 1000 and the missing older days would silently render as 0.
  const data = await fetchAllRows(
    `${context.env.SUPABASE_URL}/rest/v1/daily_usage${query}`,
    serviceHeaders(context.env),
  );

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
