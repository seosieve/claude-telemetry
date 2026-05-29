interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

function generateUUID(): string {
  return crypto.randomUUID();
}

function generateApiKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `ct_${hex}`;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const body = (await context.request.json()) as {
    name?: string;
    os?: string;
  };

  if (!body.name) {
    return new Response(
      JSON.stringify({ error: "name is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const machine_id = generateUUID();
  const api_key = generateApiKey();

  // Insert machine into Supabase
  const response = await fetch(
    `${context.env.SUPABASE_URL}/rest/v1/machines`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: context.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${context.env.SUPABASE_SERVICE_KEY}`,
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        id: machine_id,
        name: body.name,
        api_key,
        os: body.os || null,
        hostname: body.name,
      }),
    },
  );

  if (!response.ok) {
    const err = await response.text();
    return new Response(
      JSON.stringify({ error: `Failed to register machine: ${err}` }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  // NOTE: never return SUPABASE_SERVICE_KEY here. With the guest-mode
  // middleware this endpoint is unauthenticated, so echoing the service_role
  // key would hand a DB master key to anyone who knows the URL. The key is
  // copied manually from the Supabase dashboard during agent setup instead.
  return new Response(
    JSON.stringify({
      machine_id,
      api_key,
      supabase_url: context.env.SUPABASE_URL,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
};
