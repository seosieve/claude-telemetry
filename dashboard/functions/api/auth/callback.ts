interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);

  // Supabase sends the tokens as hash fragments which aren't available server-side.
  // For the PKCE flow, Supabase sends code as a query param.
  // We redirect to the frontend which extracts the tokens from the URL fragment.
  const accessToken = url.searchParams.get("access_token");
  const refreshToken = url.searchParams.get("refresh_token");
  const code = url.searchParams.get("code");
  const type = url.searchParams.get("type");

  // If we got a code (PKCE flow), exchange it for a session
  if (code) {
    const response = await fetch(
      `${context.env.SUPABASE_URL}/auth/v1/token?grant_type=pkce`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: context.env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${context.env.SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({
          auth_code: code,
          code_verifier: url.searchParams.get("code_verifier") || "",
        }),
      },
    );

    if (response.ok) {
      const data = (await response.json()) as {
        access_token: string;
        refresh_token: string;
      };
      // Redirect to frontend with tokens in hash
      const origin = url.origin;
      return Response.redirect(
        `${origin}/#auth-callback?access_token=${data.access_token}&refresh_token=${data.refresh_token}`,
        302,
      );
    }
  }

  // If tokens already present (implicit flow), redirect to frontend
  if (accessToken) {
    const origin = url.origin;
    return Response.redirect(
      `${origin}/#auth-callback?access_token=${accessToken}&refresh_token=${refreshToken || ""}`,
      302,
    );
  }

  // Default: redirect to frontend to handle hash fragments
  // Supabase magic links typically use hash fragments (#access_token=...&type=...)
  // which the browser doesn't send to the server. Redirect to a frontend page
  // that reads the hash and stores the session.
  const origin = url.origin;
  const params = url.search;
  return Response.redirect(`${origin}/#auth-callback${params}`, 302);
};
