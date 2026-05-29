interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

// Routes that don't require authentication
const PUBLIC_PATHS = [
  "/api/auth/login",
  "/api/auth/callback",
  "/api/auth/me",
  "/api/cron-check-notifications",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname);
}

export const onRequest: PagesFunction<Env> = async (context) => {
  // Guest mode — all routes are public, no authentication required.
  return context.next();
};
