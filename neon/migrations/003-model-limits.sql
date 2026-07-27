-- 003-model-limits.sql
-- rate_limits에 model_limits JSONB 추가 — OAuth usage API의 모델별 주간 게이지
-- (Fable 50% cap 등). 키는 lowercase display name:
--   {"fable": {"pct": 9, "resets_at": "2026-08-02T03:00:00+00:00"}}
-- UNIQUE(machine_id, timestamp)는 그대로 유지 (행 분리 대신 JSONB 컬럼).

ALTER TABLE rate_limits ADD COLUMN IF NOT EXISTS model_limits JSONB;
