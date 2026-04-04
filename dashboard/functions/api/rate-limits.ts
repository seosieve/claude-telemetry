interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const machine_id = url.searchParams.get("machine_id");
  const limit = url.searchParams.get("limit") || "50";

  const filters: string[] = [];
  if (machine_id) filters.push(`machine_id=eq.${machine_id}`);
  filters.push(`limit=${limit}`);

  const query = `?${filters.join("&")}&order=timestamp.desc`;

  const response = await fetch(
    `${context.env.SUPABASE_URL}/rest/v1/rate_limits${query}`,
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
