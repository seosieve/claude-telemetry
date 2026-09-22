// POST /api/ingest — single write entry point for all agents.
//
// Auth: Authorization: Bearer <machines.api_key>. The server resolves the
// machine_id from the key, so a client cannot write to another machine's rows.
// Body: { "kind": "daily_usage|sessions|blocks|rate_limits|stats_extra",
//         "rows": [ ...models.py dataclass fields, machine_id omitted... ] }
//
// This is the only place the DB master credential (DATABASE_URL) is used for
// writes, so agents no longer carry it.

import { db, json, type Env } from "./_lib";

interface KindSpec {
  table: string;
  columns: string[]; // agent-supplied columns (machine_id injected server-side)
  jsonb: string[]; // columns that must be sent as ::jsonb
  conflict: string[]; // ON CONFLICT key columns, excluding machine_id
  // Columns a zero must never overwrite. ccusage recomputes a whole day on
  // every sync, so last-write-wins is what makes today's number climb — but a
  // failed pricing lookup returns correct tokens priced at 0, and that zero
  // used to blank a real day (2026-09-21: $544.71 -> $0.00). Cost only ever
  // grows for a given conflict key, so a 0 landing on a positive value is
  // always the broken reading, never a correction.
  keepPositive?: string[];
}

const KINDS: Record<string, KindSpec> = {
  daily_usage: {
    table: "daily_usage",
    columns: ["date", "project", "model", "input_tokens", "output_tokens", "cache_creation_tokens", "cache_read_tokens", "total_tokens", "cost_usd"],
    jsonb: [],
    conflict: ["date", "project", "model"],
    keepPositive: ["cost_usd"],
  },
  sessions: {
    table: "sessions",
    columns: ["session_id", "project", "project_path", "models", "is_subagent", "input_tokens", "output_tokens", "cache_creation_tokens", "cache_read_tokens", "total_tokens", "cost_usd", "last_activity_at"],
    jsonb: [],
    conflict: ["session_id"],
    keepPositive: ["cost_usd"],
  },
  blocks: {
    table: "blocks",
    columns: ["block_start", "block_end", "is_active", "is_gap", "input_tokens", "output_tokens", "cache_creation_tokens", "cache_read_tokens", "total_tokens", "cost_usd", "models", "duration_minutes", "entries"],
    jsonb: [],
    conflict: ["block_start"],
    keepPositive: ["cost_usd"],
  },
  rate_limits: {
    table: "rate_limits",
    columns: ["timestamp", "window_5h_percent", "window_1w_percent", "session_cost_usd", "session_duration_seconds", "weekly_reset_at", "model_limits"],
    jsonb: ["model_limits"],
    conflict: ["timestamp"],
  },
  stats_extra: {
    table: "stats_extra",
    columns: ["total_sessions", "total_messages", "longest_session_messages", "longest_session_duration_ms", "first_session_date", "hour_counts", "daily_activity", "model_usage"],
    jsonb: ["hour_counts", "daily_activity", "model_usage"],
    conflict: [], // machine_id is the sole conflict key
  },
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const sql = db(context.env);

  // 1) authenticate via api_key → machine_id
  const authz = context.request.headers.get("Authorization") || "";
  const apiKey = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  if (!apiKey) return json({ error: "missing api_key" }, 401);

  let machineId: string;
  try {
    const m = (await sql`select id from machines where api_key = ${apiKey} and is_active = true`) as Array<{ id: string }>;
    if (m.length !== 1) return json({ error: "invalid api_key" }, 401);
    machineId = m[0].id;
  } catch {
    return json({ error: "auth lookup failed" }, 500);
  }

  // 2) parse + validate payload
  let body: { kind?: string; rows?: unknown };
  try { body = await context.request.json(); } catch { return json({ error: "bad json" }, 400); }
  const kind = body.kind ?? "";
  // Own-property check: a plain lookup also finds Object.prototype members, so
  // kind="constructor" used to sail past this guard and crash the worker on the
  // first spec field it touched.
  const spec = Object.prototype.hasOwnProperty.call(KINDS, kind) ? KINDS[kind] : undefined;
  if (!spec) return json({ error: `unknown kind: ${kind}` }, 400);
  if (!Array.isArray(body.rows)) return json({ error: "rows must be an array" }, 400);
  const rows = body.rows as Array<Record<string, unknown>>;
  if (rows.length === 0) return json({ ok: true, kind, upserted: 0 });

  // dedup within the request by conflict key (keep last) — Postgres rejects a
  // multi-row INSERT that touches the same ON CONFLICT key twice.
  let deduped: Array<Record<string, unknown>>;
  if (spec.conflict.length > 0) {
    const seen = new Map<string, Record<string, unknown>>();
    // NUL joins the key parts: it cannot occur in a project name, date or
    // model, so no two distinct keys can collide. Written as an escape so the
    // file stays pure ASCII — a literal NUL byte here made git treat the
    // whole file as binary, which hid every diff of this endpoint.
    for (const r of rows) seen.set(spec.conflict.map((c) => String(r[c])).join("\u0000"), r);
    deduped = [...seen.values()];
  } else {
    deduped = [rows[rows.length - 1]]; // stats_extra: one row per machine
  }

  // 3) blocks: deactivate blocks no longer reported active (ported from agent)
  if (kind === "blocks") {
    const activeStarts = deduped.filter((r) => r.is_active).map((r) => r.block_start);
    try {
      if (activeStarts.length > 0) {
        await sql.query(
          `update blocks set is_active = false
             where machine_id = $1 and is_active = true
               and not (block_start = any($2::timestamptz[]))`,
          [machineId, activeStarts],
        );
      } else {
        await sql`update blocks set is_active = false where machine_id = ${machineId} and is_active = true`;
      }
    } catch { /* best-effort */ }
  }

  // 4) parameterized multi-row upsert
  const allCols = ["machine_id", ...spec.columns];
  const params: unknown[] = [];
  const tuples: string[] = [];
  for (const row of deduped) {
    const ph: string[] = [];
    params.push(machineId); ph.push(`$${params.length}`);
    for (const col of spec.columns) {
      const v = row[col];
      if (spec.jsonb.includes(col)) {
        params.push(v == null ? null : JSON.stringify(v));
        ph.push(`$${params.length}::jsonb`);
      } else {
        params.push(v ?? null);
        ph.push(`$${params.length}`);
      }
    }
    tuples.push(`(${ph.join(", ")})`);
  }
  const conflictCols = ["machine_id", ...spec.conflict].join(", ");
  const keepPositive = new Set(spec.keepPositive ?? []);
  const updateSet = spec.columns
    .map((c) =>
      keepPositive.has(c)
        ? `${c} = case when excluded.${c} = 0 and ${spec.table}.${c} > 0 then ${spec.table}.${c} else excluded.${c} end`
        : `${c} = excluded.${c}`,
    )
    .join(", ");
  const text =
    `insert into ${spec.table} (${allCols.join(", ")}) values ${tuples.join(", ")} ` +
    `on conflict (${conflictCols}) do update set ${updateSet}`;

  try {
    await sql.query(text, params);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      await sql`insert into sync_log (machine_id, source, records_upserted, errors, duration_ms)
                values (${machineId}, ${kind}, 0, ${[msg.slice(0, 500)]}, ${null})`;
    } catch { /* ignore */ }
    return json({ error: `upsert failed: ${msg}` }, 500);
  }

  // 5) sync_log + machine last_sync_at (replaces the agent's _log_sync)
  try {
    await sql`insert into sync_log (machine_id, source, records_upserted, errors, duration_ms)
              values (${machineId}, ${kind}, ${deduped.length}, ${null}, ${null})`;
    await sql`update machines set last_sync_at = now() where id = ${machineId}`;
  } catch { /* non-fatal */ }

  // 6) retention: bound the append-only tables (compute + storage). rate_limits
  // fires once per sync cycle, so piggyback the sync_log cleanup here too.
  if (kind === "rate_limits") {
    try {
      await sql`delete from rate_limits where machine_id = ${machineId} and timestamp < now() - interval '14 days'`;
      await sql`delete from sync_log   where machine_id = ${machineId} and synced_at  < now() - interval '14 days'`;
    } catch { /* best-effort */ }
  }

  return json({ ok: true, kind, upserted: deduped.length });
};
