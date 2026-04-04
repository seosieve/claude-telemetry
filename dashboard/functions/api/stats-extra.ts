interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const machine_id = url.searchParams.get("machine_id");

  let query = "?order=synced_at.desc&limit=1";
  if (machine_id) query += `&machine_id=eq.${machine_id}`;

  const response = await fetch(
    `${context.env.SUPABASE_URL}/rest/v1/stats_extra${query}`,
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
