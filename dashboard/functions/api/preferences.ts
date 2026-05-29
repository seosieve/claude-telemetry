import { db, json, type Env } from "./_lib";

// Guest mode: a single fixed user_id row holds all preferences.
// (Neon has no GoTrue auth; the dashboard runs as one shared guest.)
const GUEST_USER_ID = "00000000-0000-0000-0000-000000000000";

// JSONB columns that must be bound as ${JSON.stringify(v)}::jsonb.
const JSONB_KEYS = new Set(["project_budgets", "alert_thresholds", "notifications"]);

// Fields the client is allowed to write.
const ALLOWED = [
  "plan_cost",
  "plan_name",
  "project_budgets",
  "alert_thresholds",
  "week_start_day",
  "theme",
  "notifications",
] as const;

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const sql = db(context.env);

  // Fetch existing preferences for the guest row.
  const existing = await sql`
    select * from user_preferences
    where user_id = ${GUEST_USER_ID}
    limit 1
  `;

  if (existing.length > 0) {
    return json(existing[0]);
  }

  // Auto-create with defaults (matches the table's column defaults).
  const created = await sql`
    insert into user_preferences (
      user_id, plan_cost, plan_name, project_budgets,
      alert_thresholds, week_start_day, theme
    ) values (
      ${GUEST_USER_ID}, ${null}, ${"none"}, ${JSON.stringify({})}::jsonb,
      ${JSON.stringify({ daily: 20, weekly: 100 })}::jsonb, ${"monday"}, ${"dark"}
    )
    on conflict (user_id) do update set user_id = excluded.user_id
    returning *
  `;

  return json(created[0]);
};

async function upsertPreferences(context: Parameters<PagesFunction<Env>>[0]): Promise<Response> {
  const body = (await context.request.json()) as Record<string, unknown>;

  // Collect the writable fields present in the body.
  const cols: string[] = ["user_id"];
  const placeholders: string[] = ["$1"];
  const params: unknown[] = [GUEST_USER_ID];
  const updateSets: string[] = [];

  for (const key of ALLOWED) {
    if (!(key in body)) continue;
    const value = JSONB_KEYS.has(key) ? JSON.stringify(body[key]) : body[key];
    params.push(value);
    const idx = params.length;
    const cast = JSONB_KEYS.has(key) ? "::jsonb" : "";
    cols.push(key);
    placeholders.push(`$${idx}${cast}`);
    updateSets.push(`${key} = excluded.${key}`);
  }

  // Always bump updated_at on write.
  cols.push("updated_at");
  placeholders.push("now()");
  updateSets.push("updated_at = excluded.updated_at");

  const sql = db(context.env);
  const rows = await sql.query(
    `insert into user_preferences (${cols.join(", ")})
     values (${placeholders.join(", ")})
     on conflict (user_id) do update set ${updateSets.join(", ")}
     returning *`,
    params,
  );

  return json(rows[0]);
}

export const onRequestPut: PagesFunction<Env> = (context) => upsertPreferences(context);

export const onRequestPost: PagesFunction<Env> = (context) => upsertPreferences(context);
