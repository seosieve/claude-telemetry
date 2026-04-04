interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const body = (await context.request.json()) as { email?: string };

  if (!body.email) {
    return new Response(
      JSON.stringify({ error: "email is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Determine the redirect URL for the magic link callback
  const origin = new URL(context.request.url).origin;
  const redirectTo = `${origin}/api/auth/callback`;

  const response = await fetch(
    `${context.env.SUPABASE_URL}/auth/v1/magiclink`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: context.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${context.env.SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({
        email: body.email,
        data: {},
        gotrue_meta_security: { captcha_token: "" },
        code_challenge: null,
        code_challenge_method: null,
      }),
    },
  );

  if (!response.ok) {
    const err = await response.text();
    return new Response(
      JSON.stringify({ error: `Auth failed: ${err}` }),
      { status: response.status, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({ success: true }),
    { headers: { "Content-Type": "application/json" } },
  );
};
