interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const authHeader = context.request.headers.get("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Missing or invalid Authorization header" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  const token = authHeader.slice(7);

  // Validate token with Supabase Auth
  const response = await fetch(
    `${context.env.SUPABASE_URL}/auth/v1/user`,
    {
      headers: {
        apikey: context.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    return new Response(
      JSON.stringify({ error: "Invalid or expired token" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  const user = await response.json();
  return new Response(JSON.stringify(user), {
    headers: { "Content-Type": "application/json" },
  });
};
