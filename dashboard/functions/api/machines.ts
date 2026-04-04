interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const active_only = url.searchParams.get("active_only") !== "false";

  let query = "?order=last_sync_at.desc.nullslast";
  if (active_only) query += "&is_active=eq.true";

  const response = await fetch(
    `${context.env.SUPABASE_URL}/rest/v1/machines${query}`,
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
