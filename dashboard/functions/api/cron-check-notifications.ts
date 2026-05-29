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

import { db, json, type Env } from "./_lib";

type Sql = ReturnType<typeof db>;

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

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

async function alreadySentToday(sql: Sql, userId: string, type: string): Promise<boolean> {
  const rows = await sql`
    select 1 from notification_history
    where user_id = ${userId}
      and type = ${type}
      and sent_at >= ${`${todayISO()}T00:00:00Z`}
    limit 1
  `;
  return rows.length > 0;
}

async function checkAlerts(sql: Sql, user: UserRow): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const types = user.notifications?.types || {};

  // 1. Project budgets at 90%+
  if (types.project_budget !== false && Object.keys(user.project_budgets || {}).length > 0) {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    const projects = (await sql`
      select * from get_project_costs(${d.toISOString().slice(0, 10)}, ${todayISO()}, ${null})
    `) as Array<{ project: string; total_cost: number }>;

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
    const rows = (await sql`
      select window_5h_percent, window_1w_percent
      from rate_limits
      order by timestamp desc
      limit 1
    `) as Array<{
      window_5h_percent: number | null;
      window_1w_percent: number | null;
    }>;

    if (rows.length > 0) {
      const r = rows[0];
      const w5h = r.window_5h_percent != null ? Number(r.window_5h_percent) : null;
      const w1w = r.window_1w_percent != null ? Number(r.window_1w_percent) : null;
      if (w5h != null && w5h > 90) {
        alerts.push({
          type: "rate_limit_5h",
          title: "Rate Limit Warning",
          description: `5-hour rate limit at **${w5h.toFixed(1)}%**`,
          fields: [
            { name: "Window", value: "5-hour", inline: true },
            { name: "Usage", value: `${w5h.toFixed(1)}%`, inline: true },
            { name: "Status", value: w5h >= 100 ? "LIMIT HIT" : "Warning", inline: true },
          ],
          color: w5h >= 100 ? 15548997 : 16744192,
          url_path: "/insights",
        });
      }
      if (w1w != null && w1w > 90) {
        alerts.push({
          type: "rate_limit_1w",
          title: "Rate Limit Warning",
          description: `Weekly rate limit at **${w1w.toFixed(1)}%**`,
          fields: [
            { name: "Window", value: "Weekly", inline: true },
            { name: "Usage", value: `${w1w.toFixed(1)}%`, inline: true },
            { name: "Status", value: w1w >= 100 ? "LIMIT HIT" : "Warning", inline: true },
          ],
          color: w1w >= 100 ? 15548997 : 16744192,
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
      return json({ error: "Unauthorized" }, 401);
    }
  }

  const sql = db(context.env);

  const users = (await sql`
    select user_id, project_budgets, notifications from user_preferences
  `) as UserRow[];

  let totalSent = 0;

  for (const user of users) {
    const notif = user.notifications;
    if (!notif?.webhook_enabled || !notif.webhook_url) continue;

    const alerts = await checkAlerts(sql, user);

    for (const alert of alerts) {
      if (await alreadySentToday(sql, user.user_id, alert.type)) continue;

      const sent = await sendWebhook(notif.webhook_url, alert);
      if (sent) {
        await sql`
          insert into notification_history (user_id, type, title, body, channel)
          values (${user.user_id}, ${alert.type}, ${alert.title}, ${alert.description}, ${"webhook"})
        `;
        totalSent++;
      }
    }
  }

  return json({ ok: true, users_checked: users.length, notifications_sent: totalSent });
};
