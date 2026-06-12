-- 002-fable-cost.sql
-- get_usage_summary()에 fable_cost 컬럼 추가 (Claude Fable 5 / Mythos 5 대응).
-- RETURNS TABLE 컬럼이 늘어나므로 CREATE OR REPLACE 불가 → DROP 후 재생성.
-- schema.sql의 정의와 동일하게 유지할 것.

DROP FUNCTION IF EXISTS get_usage_summary(DATE, DATE, UUID);

CREATE FUNCTION get_usage_summary(
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
