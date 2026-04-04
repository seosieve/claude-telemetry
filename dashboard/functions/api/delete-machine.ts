interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const id = url.searchParams.get("id");

  if (!id) {
    return new Response(
      JSON.stringify({ error: "id query parameter is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Fetch machine name before deleting (for response)
  const getResponse = await fetch(
    `${context.env.SUPABASE_URL}/rest/v1/machines?id=eq.${id}&select=name`,
    {
      headers: {
        apikey: context.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${context.env.SUPABASE_SERVICE_KEY}`,
      },
    },
  );

  const machines = (await getResponse.json()) as Array<{ name: string }>;
  if (!machines.length) {
    return new Response(
      JSON.stringify({ error: "Machine not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  const machineName = machines[0].name;

  // Delete machine — ON DELETE CASCADE handles all related data
  const deleteResponse = await fetch(
    `${context.env.SUPABASE_URL}/rest/v1/machines?id=eq.${id}`,
    {
      method: "DELETE",
      headers: {
        apikey: context.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${context.env.SUPABASE_SERVICE_KEY}`,
      },
    },
  );

  if (!deleteResponse.ok) {
    const err = await deleteResponse.text();
    return new Response(
      JSON.stringify({ error: `Failed to delete machine: ${err}` }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({ success: true, deleted: machineName }),
    { headers: { "Content-Type": "application/json" } },
  );
};
