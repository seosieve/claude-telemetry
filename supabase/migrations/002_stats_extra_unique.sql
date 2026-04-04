-- 002_stats_extra_unique.sql
-- Add unique constraint on stats_extra.machine_id so upsert works correctly
-- (prevents duplicate stats_extra records per machine)

-- Remove duplicate rows keeping only the latest per machine_id
DELETE FROM stats_extra a
USING stats_extra b
WHERE a.machine_id = b.machine_id
  AND a.id < b.id;

-- Add unique constraint
ALTER TABLE stats_extra ADD CONSTRAINT stats_extra_machine_id_unique UNIQUE (machine_id);

-- Add missing RLS policies on users and machine_owners
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own data" ON users FOR SELECT
    USING (id = auth.uid());

ALTER TABLE machine_owners ENABLE ROW LEVEL SECURITY;

-- machine_owners already has RLS enabled via the machines table, but add explicit policy
CREATE POLICY "Users see own machine_owners" ON machine_owners FOR SELECT
    USING (user_id = auth.uid());

-- Add missing indexes
CREATE INDEX IF NOT EXISTS idx_machines_is_active ON machines(is_active);
CREATE INDEX IF NOT EXISTS idx_sync_log_machine ON sync_log(machine_id, synced_at DESC);
