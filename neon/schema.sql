-- neon/schema.sql
-- Neon Postgres schema for claude-ricegang (migrated from Supabase).
--
-- Differences from supabase/migrations/001-006:
--   * No auth.users FK / auth.uid() — Neon has no GoTrue auth schema.
--   * No RLS — access control is "Cloudflare Functions connect with the
--     connection string"; the DB is never exposed directly to clients.
--     (Enabling RLS without policies would deny-all, so we leave it off.)
--   * users / machine_owners tables dropped — they only existed for the
--     multi-user RLS model, which is unused under guest mode.
--   * All UNIQUE constraints kept — required for INSERT ... ON CONFLICT upserts.
--   * RPC functions kept verbatim — dashboard Functions and the MCP server
--     call them via SELECT * FROM <fn>(...).

-- ── machines ──────────────────────────────────────────────────────────────
CREATE TABLE machines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    api_key TEXT UNIQUE NOT NULL,
    os TEXT,
    hostname TEXT,
    claude_version TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    last_sync_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true
);

-- ── daily_usage ─────────────────────────────────────────────────────────────
CREATE TABLE daily_usage (
    id BIGSERIAL PRIMARY KEY,
    machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    project TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens BIGINT DEFAULT 0,
    output_tokens BIGINT DEFAULT 0,
    cache_creation_tokens BIGINT DEFAULT 0,
    cache_read_tokens BIGINT DEFAULT 0,
    total_tokens BIGINT DEFAULT 0,
    cost_usd NUMERIC(10, 4) DEFAULT 0,
    UNIQUE(machine_id, date, project, model)
);

-- ── sessions ────────────────────────────────────────────────────────────────
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    project TEXT NOT NULL,
    project_path TEXT,
    models TEXT[],
    is_subagent BOOLEAN DEFAULT false,
    input_tokens BIGINT DEFAULT 0,
    output_tokens BIGINT DEFAULT 0,
    cache_creation_tokens BIGINT DEFAULT 0,
    cache_read_tokens BIGINT DEFAULT 0,
    total_tokens BIGINT DEFAULT 0,
    cost_usd NUMERIC(10, 4) DEFAULT 0,
    last_activity_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(machine_id, session_id)
);

-- ── rate_limits (includes 006 weekly_reset_at) ──────────────────────────────
CREATE TABLE rate_limits (
    id BIGSERIAL PRIMARY KEY,
    machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ NOT NULL,
    window_5h_percent NUMERIC(5, 2),
    window_1w_percent NUMERIC(5, 2),
    session_cost_usd NUMERIC(10, 4),
    session_duration_seconds INTEGER,
    weekly_reset_at TIMESTAMPTZ,
    UNIQUE(machine_id, timestamp)
);

-- ── stats_extra (includes 002 UNIQUE(machine_id)) ───────────────────────────
CREATE TABLE stats_extra (
    id BIGSERIAL PRIMARY KEY,
    machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    synced_at TIMESTAMPTZ DEFAULT now(),
    total_sessions INTEGER,
    total_messages INTEGER,
    longest_session_messages INTEGER,
    longest_session_duration_ms BIGINT,
    first_session_date TIMESTAMPTZ,
    hour_counts JSONB,
    daily_activity JSONB,
    model_usage JSONB,
    UNIQUE(machine_id)
);

-- ── sync_log ────────────────────────────────────────────────────────────────
CREATE TABLE sync_log (
    id BIGSERIAL PRIMARY KEY,
    machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    synced_at TIMESTAMPTZ DEFAULT now(),
    source TEXT NOT NULL,
    records_upserted INTEGER DEFAULT 0,
    errors TEXT[],
    duration_ms INTEGER
);

-- ── blocks ──────────────────────────────────────────────────────────────────
CREATE TABLE blocks (
    id BIGSERIAL PRIMARY KEY,
    machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    block_start TIMESTAMPTZ NOT NULL,
    block_end TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN DEFAULT false,
    is_gap BOOLEAN DEFAULT false,
    input_tokens BIGINT DEFAULT 0,
    output_tokens BIGINT DEFAULT 0,
    cache_creation_tokens BIGINT DEFAULT 0,
    cache_read_tokens BIGINT DEFAULT 0,
    total_tokens BIGINT DEFAULT 0,
    cost_usd NUMERIC(10, 4) DEFAULT 0,
    models TEXT[],
    duration_minutes INTEGER,
    entries INTEGER DEFAULT 0,
    UNIQUE(machine_id, block_start)
);

-- ── user_preferences (auth.users FK removed; single guest row) ──────────────
CREATE TABLE user_preferences (
    user_id UUID PRIMARY KEY,
    plan_cost NUMERIC,
    plan_name TEXT DEFAULT 'none',
    project_budgets JSONB DEFAULT '{}',
    alert_thresholds JSONB DEFAULT '{"daily": 20, "weekly": 100}',
    week_start_day TEXT DEFAULT 'monday',
    theme TEXT DEFAULT 'dark',
    notifications JSONB DEFAULT '{"webhook_url": null, "webhook_enabled": false, "types": {"project_budget": true, "rate_limit": true}}',
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── notification_history (auth.users FK removed) ────────────────────────────
CREATE TABLE notification_history (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID,
    type TEXT NOT NULL,
    title TEXT,
    body TEXT,
    sent_at TIMESTAMPTZ DEFAULT now(),
    channel TEXT NOT NULL DEFAULT 'webhook'
);

-- ── indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX idx_daily_usage_machine_date ON daily_usage(machine_id, date);
CREATE INDEX idx_daily_usage_project ON daily_usage(project);
CREATE INDEX idx_daily_usage_model ON daily_usage(model);
CREATE INDEX idx_daily_usage_date ON daily_usage(date);
CREATE INDEX idx_sessions_machine ON sessions(machine_id);
CREATE INDEX idx_sessions_project ON sessions(project);
CREATE INDEX idx_rate_limits_machine_ts ON rate_limits(machine_id, timestamp);
CREATE INDEX idx_machines_is_active ON machines(is_active);
CREATE INDEX idx_sync_log_machine ON sync_log(machine_id, synced_at DESC);
CREATE INDEX idx_blocks_machine ON blocks(machine_id);
CREATE INDEX idx_blocks_start ON blocks(block_start DESC);
CREATE INDEX idx_notif_user_type_sent ON notification_history(user_id, type, sent_at DESC);

-- ── RPC functions (verbatim from 001; called via /rest/v1/rpc or SELECT) ────
CREATE OR REPLACE FUNCTION get_usage_summary(
    p_start_date DATE, p_end_date DATE, p_machine_id UUID DEFAULT NULL
) RETURNS TABLE(
    date DATE, total_cost NUMERIC, total_tokens BIGINT,
    opus_cost NUMERIC, sonnet_cost NUMERIC, haiku_cost NUMERIC,
    fable_cost NUMERIC,
    machine_count BIGINT
) AS $$
BEGIN
    RETURN QUERY SELECT d.date,
        SUM(d.cost_usd)::NUMERIC, SUM(d.total_tokens)::BIGINT,
        SUM(CASE WHEN d.model LIKE '%opus%' THEN d.cost_usd ELSE 0 END)::NUMERIC,
        SUM(CASE WHEN d.model LIKE '%sonnet%' THEN d.cost_usd ELSE 0 END)::NUMERIC,
        SUM(CASE WHEN d.model LIKE '%haiku%' THEN d.cost_usd ELSE 0 END)::NUMERIC,
        -- mythos는 fable과 동일 모델의 별도 id — 같은 버킷으로 집계
        SUM(CASE WHEN d.model LIKE '%fable%' OR d.model LIKE '%mythos%' THEN d.cost_usd ELSE 0 END)::NUMERIC,
        COUNT(DISTINCT d.machine_id)::BIGINT
    FROM daily_usage d
    WHERE d.date BETWEEN p_start_date AND p_end_date
        AND (p_machine_id IS NULL OR d.machine_id = p_machine_id)
    GROUP BY d.date ORDER BY d.date;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_project_costs(
    p_start_date DATE, p_end_date DATE, p_machine_id UUID DEFAULT NULL
) RETURNS TABLE(
    project TEXT, total_cost NUMERIC, total_tokens BIGINT,
    primary_model TEXT, machines_used BIGINT
) AS $$
BEGIN
    RETURN QUERY SELECT d.project,
        SUM(d.cost_usd)::NUMERIC, SUM(d.total_tokens)::BIGINT,
        (SELECT d2.model FROM daily_usage d2 WHERE d2.project = d.project
            AND d2.date BETWEEN p_start_date AND p_end_date
            AND (p_machine_id IS NULL OR d2.machine_id = p_machine_id)
            GROUP BY d2.model ORDER BY SUM(d2.cost_usd) DESC LIMIT 1),
        COUNT(DISTINCT d.machine_id)::BIGINT
    FROM daily_usage d
    WHERE d.date BETWEEN p_start_date AND p_end_date
        AND (p_machine_id IS NULL OR d.machine_id = p_machine_id)
    -- ORDER BY 2 (total_cost's output position), not "total_cost": the bare
    -- name collides with the RETURNS TABLE OUT param and silently sorts by a
    -- NULL variable, so the "top N by cost" ranking was actually alphabetical.
    GROUP BY d.project ORDER BY 2 DESC;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_weekly_rate_estimate(
    p_machine_id UUID DEFAULT NULL
) RETURNS TABLE(
    week_start DATE, week_cost NUMERIC, week_tokens BIGINT,
    avg_daily_cost NUMERIC, projected_weekly_cost NUMERIC, days_active INTEGER
) AS $$
BEGIN
    RETURN QUERY SELECT date_trunc('week', d.date)::DATE,
        SUM(d.cost_usd)::NUMERIC, SUM(d.total_tokens)::BIGINT,
        (SUM(d.cost_usd) / NULLIF(COUNT(DISTINCT d.date), 0))::NUMERIC,
        (SUM(d.cost_usd) / NULLIF(COUNT(DISTINCT d.date), 0) * 7)::NUMERIC,
        COUNT(DISTINCT d.date)::INTEGER
    FROM daily_usage d
    WHERE (p_machine_id IS NULL OR d.machine_id = p_machine_id)
    -- ORDER BY 1 (output column position), not "week_start": the latter
    -- collides with the RETURNS TABLE OUT param and silently sorts by a NULL
    -- variable instead of the week, leaving rows unordered.
    GROUP BY date_trunc('week', d.date) ORDER BY 1 DESC;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_machine_summary(
    p_start_date DATE DEFAULT '2020-01-01', p_end_date DATE DEFAULT CURRENT_DATE
) RETURNS TABLE(
    machine_id UUID, machine_name TEXT, total_cost NUMERIC,
    total_tokens BIGINT, days_active INTEGER, last_activity DATE, top_project TEXT
) AS $$
BEGIN
    RETURN QUERY SELECT m.id, m.name,
        COALESCE(SUM(d.cost_usd), 0)::NUMERIC,
        COALESCE(SUM(d.total_tokens), 0)::BIGINT,
        COUNT(DISTINCT d.date)::INTEGER, MAX(d.date),
        (SELECT d2.project FROM daily_usage d2 WHERE d2.machine_id = m.id
            AND d2.date BETWEEN p_start_date AND p_end_date
            GROUP BY d2.project ORDER BY SUM(d2.cost_usd) DESC LIMIT 1)
    FROM machines m
    LEFT JOIN daily_usage d ON d.machine_id = m.id AND d.date BETWEEN p_start_date AND p_end_date
    WHERE m.is_active = true
    -- ORDER BY 3 (total_cost's output position); see get_project_costs above —
    -- the bare "total_cost" collides with the OUT param and sorts by NULL.
    GROUP BY m.id, m.name ORDER BY 3 DESC;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;
