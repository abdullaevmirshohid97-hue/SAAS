-- Demo workspaces — ephemeral clinic instances spawned via /api/v1/demo/spawn
-- Auto-cleanup after expiry; rate-limited per IP/fingerprint at the API layer.

ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS demo_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS clinics_demo_expires_at_idx
  ON clinics (demo_expires_at)
  WHERE is_demo = TRUE;

-- Rate-limit ledger: one row per spawn attempt
CREATE TABLE IF NOT EXISTS demo_spawn_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_hash     TEXT NOT NULL,
  fingerprint TEXT,
  user_agent  TEXT,
  clinic_id   UUID REFERENCES clinics(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS demo_spawn_log_ip_created_idx
  ON demo_spawn_log (ip_hash, created_at DESC);

ALTER TABLE demo_spawn_log ENABLE ROW LEVEL SECURITY;

-- No client access; service role only
CREATE POLICY demo_spawn_log_no_select ON demo_spawn_log FOR SELECT USING (FALSE);
CREATE POLICY demo_spawn_log_no_write  ON demo_spawn_log FOR INSERT WITH CHECK (FALSE);

-- Cleanup function: drop demos past their expiry. Cascades clear via FKs.
CREATE OR REPLACE FUNCTION cleanup_expired_demos()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  WITH expired AS (
    DELETE FROM clinics
    WHERE is_demo = TRUE
      AND demo_expires_at IS NOT NULL
      AND demo_expires_at < NOW()
    RETURNING id
  )
  SELECT COUNT(*) INTO deleted_count FROM expired;

  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION cleanup_expired_demos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cleanup_expired_demos() TO service_role;

COMMENT ON FUNCTION cleanup_expired_demos IS
  'Drops clinics where is_demo=TRUE and demo_expires_at < NOW(). Run hourly via cron.';
