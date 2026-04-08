interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

// Routes that don't require authentication
const PUBLIC_PATHS = [
  "/api/auth/login",
  "/api/auth/callback",
  "/api/auth/me",
  "/api/cron/check-notifications",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname);
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);

  // Skip auth for non-API routes (static files, HTML, etc.)
  if (!url.pathname.startsWith("/api/")) {
    return context.next();
  }

  // Skip auth for public auth routes
  if (isPublicPath(url.pathname)) {
    return context.next();
  }

  // Extract and validate Authorization header
  const authHeader = context.request.headers.get("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Authentication required" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  const token = authHeader.slice(7);

  // Validate token with Supabase Auth
  const userResponse = await fetch(
    `${context.env.SUPABASE_URL}/auth/v1/user`,
    {
      headers: {
        apikey: context.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!userResponse.ok) {
    return new Response(
      JSON.stringify({ error: "Invalid or expired token" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  // Token is valid — proceed to the actual function
  return context.next();
};
