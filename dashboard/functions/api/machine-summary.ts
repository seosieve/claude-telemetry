interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const start_date = url.searchParams.get("start_date") || "2020-01-01";
  const end_date =
    url.searchParams.get("end_date") ||
    new Date().toISOString().slice(0, 10);

  const response = await fetch(
    `${context.env.SUPABASE_URL}/rest/v1/rpc/get_machine_summary`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: context.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${context.env.SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({
        p_start_date: start_date,
        p_end_date: end_date,
      }),
    },
  );

  const data = await response.json();
  return new Response(JSON.stringify(data), {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
};
