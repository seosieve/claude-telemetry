interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

async function getUserId(request: Request, env: Env): Promise<string | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);

  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) return null;
  const user = (await res.json()) as { id: string };
  return user.id;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const userId = await getUserId(context.request, context.env);
  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Try to fetch existing preferences
  const getRes = await fetch(
    `${context.env.SUPABASE_URL}/rest/v1/user_preferences?user_id=eq.${userId}`,
    {
      headers: {
        apikey: context.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${context.env.SUPABASE_SERVICE_KEY}`,
      },
    },
  );

  const rows = (await getRes.json()) as Array<Record<string, unknown>>;

  if (rows.length > 0) {
    return new Response(JSON.stringify(rows[0]), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Auto-create with defaults
  const defaults = {
    user_id: userId,
    plan_cost: null,
    plan_name: "none",
    project_budgets: {},
    alert_thresholds: { daily: 20, weekly: 100 },
    week_start_day: "monday",
    theme: "dark",
  };

  const insertRes = await fetch(
    `${context.env.SUPABASE_URL}/rest/v1/user_preferences`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: context.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${context.env.SUPABASE_SERVICE_KEY}`,
        Prefer: "return=representation",
      },
      body: JSON.stringify(defaults),
    },
  );

  const created = await insertRes.json();
  const result = Array.isArray(created) ? created[0] : created;

  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
};

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const userId = await getUserId(context.request, context.env);
  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = (await context.request.json()) as Record<string, unknown>;

  // Only allow updating known fields
  const allowed = [
    "plan_cost",
    "plan_name",
    "project_budgets",
    "alert_thresholds",
    "week_start_day",
    "theme",
    "notifications",
  ];
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (key in body) update[key] = body[key];
  }

  const res = await fetch(
    `${context.env.SUPABASE_URL}/rest/v1/user_preferences?user_id=eq.${userId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: context.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${context.env.SUPABASE_SERVICE_KEY}`,
        Prefer: "return=representation",
      },
      body: JSON.stringify(update),
    },
  );

  const updated = await res.json();
  const result = Array.isArray(updated) ? updated[0] : updated;

  return new Response(JSON.stringify(result), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
};
