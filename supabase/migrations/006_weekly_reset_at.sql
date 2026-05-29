-- 006_weekly_reset_at.sql
-- Track the weekly rate-limit window end (when the 1w limit resets)
-- Source: `ccost sl --per 1w` → data[*].windowEnd

ALTER TABLE rate_limits
    ADD COLUMN IF NOT EXISTS weekly_reset_at TIMESTAMPTZ;
