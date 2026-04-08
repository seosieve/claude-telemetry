/**
 * POST /api/cron/check-notifications
 *
 * Runs every 15 min via external cron. Checks 2 conditions:
 *   1. Any project at 90%+ of monthly budget
 *   2. Rate limit (5h or weekly) at 90%+
 *
 * Sends webhook alerts (Discord/Slack/generic). Max 1 per type per day.
 * Protected by X-Cron-Secret header.
 */

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  CRON_SECRET?: string;
}

interface NotifPrefs {
  webhook_url: string | null;
  webhook_enabled: boolean;
  types: { project_budget: boolean; rate_limit: boolean };
}

interface UserRow {
  user_id: string;
  project_budgets: Record<string, number>;
  notifications: NotifPrefs;
}

interface Alert {
  type: string;
  title: string;
  description: string;
  fields: Array<{ name: string; value: string; inline: boolean }>;
  color: number;
  url_path: string;
}

async function supabaseGet(env: Env, path: string): Promise<unknown> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
  });
  return res.json();
}

async function supabaseRpc(env: Env, fn: string, params: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify(params),
  });
  return res.json();
}

async function supabaseInsert(env: Env, table: string, row: Record<string, unknown>): Promise<void> {
  await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify(row),
  });
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

async function alreadySentToday(env: Env, userId: string, type: string): Promise<boolean> {
  const rows = await supabaseGet(
    env,
    `notification_history?user_id=eq.${userId}&type=eq.${type}&sent_at=gte.${todayISO()}T00:00:00Z&limit=1`,
  ) as Array<unknown>;
  return rows.length > 0;
}

async function checkAlerts(env: Env, user: UserRow): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const types = user.notifications?.types || {};

  // 1. Project budgets at 90%+
  if (types.project_budget !== false && Object.keys(user.project_budgets || {}).length > 0) {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    const projects = await supabaseRpc(env, "get_project_costs", {
      p_start_date: d.toISOString().slice(0, 10),
      p_end_date: todayISO(),
    }) as Array<{ project: string; total_cost: number }>;

    for (const p of projects) {
      const budget = user.project_budgets[p.project];
      const cost = Number(p.total_cost) || 0;
      if (budget && cost > budget * 0.9) {
        const pct = Math.round((cost / budget) * 100);
        const daysLeft = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate() - new Date().getDate();
        alerts.push({
          type: `project_budget_${p.project}`,
          title: "Project Budget Alert",
          description: `Project **${p.project}** reached ${pct}% of monthly budget`,
          fields: [
            { name: "Spent", value: `$${cost.toFixed(0)}`, inline: true },
            { name: "Budget", value: `$${budget.toFixed(0)}`, inline: true },
            { name: "Days left", value: String(daysLeft), inline: true },
          ],
          color: pct >= 100 ? 15548997 : 16744192, // red or orange
          url_path: "/projects",
        });
      }
    }
  }

  // 2. Rate limits at 90%+
  if (types.rate_limit !== false) {
    const rows = await supabaseGet(env, "rate_limits?order=timestamp.desc&limit=1") as Array<{
      window_5h_percent: number | null;
      window_1w_percent: number | null;
    }>;

    if (rows.length > 0) {
      const r = rows[0];
      if (r.window_5h_percent != null && r.window_5h_percent > 90) {
        alerts.push({
          type: "rate_limit_5h",
          title: "Rate Limit Warning",
          description: `5-hour rate limit at **${r.window_5h_percent.toFixed(1)}%**`,
          fields: [
            { name: "Window", value: "5-hour", inline: true },
            { name: "Usage", value: `${r.window_5h_percent.toFixed(1)}%`, inline: true },
            { name: "Status", value: r.window_5h_percent >= 100 ? "LIMIT HIT" : "Warning", inline: true },
          ],
          color: r.window_5h_percent >= 100 ? 15548997 : 16744192,
          url_path: "/insights",
        });
      }
      if (r.window_1w_percent != null && r.window_1w_percent > 90) {
        alerts.push({
          type: "rate_limit_1w",
          title: "Rate Limit Warning",
          description: `Weekly rate limit at **${r.window_1w_percent.toFixed(1)}%**`,
          fields: [
            { name: "Window", value: "Weekly", inline: true },
            { name: "Usage", value: `${r.window_1w_percent.toFixed(1)}%`, inline: true },
            { name: "Status", value: r.window_1w_percent >= 100 ? "LIMIT HIT" : "Warning", inline: true },
          ],
          color: r.window_1w_percent >= 100 ? 15548997 : 16744192,
          url_path: "/insights",
        });
      }
    }
  }

  return alerts;
}

async function sendWebhook(url: string, alert: Alert): Promise<boolean> {
  const isSlack = url.includes("hooks.slack.com");

  const payload = isSlack
    ? {
        text: `*${alert.title}*\n${alert.description.replace(/\*\*/g, "*")}`,
        blocks: [
          { type: "header", text: { type: "plain_text", text: alert.title } },
          { type: "section", text: { type: "mrkdwn", text: alert.description.replace(/\*\*/g, "*") } },
          {
            type: "section",
            fields: alert.fields.map((f) => ({ type: "mrkdwn", text: `*${f.name}*\n${f.value}` })),
          },
        ],
      }
    : {
        // Discord-compatible (also works as generic webhook)
        embeds: [
          {
            title: alert.title,
            description: alert.description,
            color: alert.color,
            fields: alert.fields,
            footer: { text: "claude-telemetry" },
          },
        ],
      };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  // Auth
  if (context.env.CRON_SECRET) {
    if (context.request.headers.get("X-Cron-Secret") !== context.env.CRON_SECRET) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const users = await supabaseGet(
    context.env,
    "user_preferences?select=user_id,project_budgets,notifications",
  ) as UserRow[];

  let totalSent = 0;

  for (const user of users) {
    const notif = user.notifications;
    if (!notif?.webhook_enabled || !notif.webhook_url) continue;

    const alerts = await checkAlerts(context.env, user);

    for (const alert of alerts) {
      if (await alreadySentToday(context.env, user.user_id, alert.type)) continue;

      const sent = await sendWebhook(notif.webhook_url, alert);
      if (sent) {
        await supabaseInsert(context.env, "notification_history", {
          user_id: user.user_id,
          type: alert.type,
          title: alert.title,
          body: alert.description,
          channel: "webhook",
        });
        totalSent++;
      }
    }
  }

  return new Response(
    JSON.stringify({ ok: true, users_checked: users.length, notifications_sent: totalSent }),
    { headers: { "Content-Type": "application/json" } },
  );
};
