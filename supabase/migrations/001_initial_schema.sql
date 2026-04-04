-- 001_initial_schema.sql
-- Claude Usage Tracker — initial schema

-- Machines registadas (cada PC com agent)
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

CREATE TABLE users (
    id UUID PRIMARY KEY REFERENCES auth.users(id),
    email TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE machine_owners (
    machine_id UUID REFERENCES machines(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (machine_id, user_id)
);

-- Uso diario (fonte: ccusage daily --json --instances)
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

-- Sessoes (fonte: ccusage session --json)
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

-- Rate limits (fonte: ccost sl --output json)
CREATE TABLE rate_limits (
    id BIGSERIAL PRIMARY KEY,
    machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ NOT NULL,
    window_5h_percent NUMERIC(5, 2),
    window_1w_percent NUMERIC(5, 2),
    session_cost_usd NUMERIC(10, 4),
    session_duration_seconds INTEGER,
    UNIQUE(machine_id, timestamp)
);

-- Dados extra que ccusage/ccost nao leem (fonte: agent directo)
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
    model_usage JSONB
);

CREATE TABLE sync_log (
    id BIGSERIAL PRIMARY KEY,
    machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    synced_at TIMESTAMPTZ DEFAULT now(),
    source TEXT NOT NULL,
    records_upserted INTEGER DEFAULT 0,
    errors TEXT[],
    duration_ms INTEGER
);

-- Indices
CREATE INDEX idx_daily_usage_machine_date ON daily_usage(machine_id, date);
CREATE INDEX idx_daily_usage_project ON daily_usage(project);
CREATE INDEX idx_daily_usage_model ON daily_usage(model);
CREATE INDEX idx_daily_usage_date ON daily_usage(date);
CREATE INDEX idx_sessions_machine ON sessions(machine_id);
CREATE INDEX idx_sessions_project ON sessions(project);
CREATE INDEX idx_rate_limits_machine_ts ON rate_limits(machine_id, timestamp);

-- RLS
ALTER TABLE machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE stats_extra ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own machines" ON machines FOR SELECT
    USING (id IN (SELECT machine_id FROM machine_owners WHERE user_id = auth.uid()));
CREATE POLICY "Users see own daily_usage" ON daily_usage FOR SELECT
    USING (machine_id IN (SELECT machine_id FROM machine_owners WHERE user_id = auth.uid()));
CREATE POLICY "Users see own sessions" ON sessions FOR SELECT
    USING (machine_id IN (SELECT machine_id FROM machine_owners WHERE user_id = auth.uid()));
CREATE POLICY "Users see own rate_limits" ON rate_limits FOR SELECT
    USING (machine_id IN (SELECT machine_id FROM machine_owners WHERE user_id = auth.uid()));
CREATE POLICY "Users see own stats_extra" ON stats_extra FOR SELECT
    USING (machine_id IN (SELECT machine_id FROM machine_owners WHERE user_id = auth.uid()));

-- Functions

CREATE OR REPLACE FUNCTION get_usage_summary(
    p_start_date DATE, p_end_date DATE, p_machine_id UUID DEFAULT NULL
) RETURNS TABLE(
    date DATE, total_cost NUMERIC, total_tokens BIGINT,
    opus_cost NUMERIC, sonnet_cost NUMERIC, haiku_cost NUMERIC,
    machine_count BIGINT
) AS $$
BEGIN
    RETURN QUERY SELECT d.date,
        SUM(d.cost_usd)::NUMERIC, SUM(d.total_tokens)::BIGINT,
        SUM(CASE WHEN d.model LIKE '%opus%' THEN d.cost_usd ELSE 0 END)::NUMERIC,
        SUM(CASE WHEN d.model LIKE '%sonnet%' THEN d.cost_usd ELSE 0 END)::NUMERIC,
        SUM(CASE WHEN d.model LIKE '%haiku%' THEN d.cost_usd ELSE 0 END)::NUMERIC,
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
    GROUP BY d.project ORDER BY total_cost DESC;
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
    GROUP BY date_trunc('week', d.date) ORDER BY week_start DESC;
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
    GROUP BY m.id, m.name ORDER BY total_cost DESC;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;
