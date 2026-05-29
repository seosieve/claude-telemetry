interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const id = url.searchParams.get("id");

  // Validate UUID format. This endpoint is unauthenticated under guest mode,
  // so reject anything that isn't a well-formed machine id before touching DB.
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!id || !uuidRe.test(id)) {
    return new Response(
      JSON.stringify({ error: "valid machine id (uuid) is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Fetch machine name before deactivating (for response)
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

  // Soft-delete: flip is_active=false instead of a hard DELETE. The machines
  // endpoint filters active_only by default, so the machine disappears from the
  // dashboard while its historical usage rows are preserved (no CASCADE wipe).
  // This keeps an unauthenticated call non-destructive and recoverable.
  const deleteResponse = await fetch(
    `${context.env.SUPABASE_URL}/rest/v1/machines?id=eq.${id}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: context.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${context.env.SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ is_active: false }),
    },
  );

  if (!deleteResponse.ok) {
    const err = await deleteResponse.text();
    return new Response(
      JSON.stringify({ error: `Failed to deactivate machine: ${err}` }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({ success: true, deleted: machineName }),
    { headers: { "Content-Type": "application/json" } },
  );
};
