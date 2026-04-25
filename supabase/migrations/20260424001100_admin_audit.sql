-- =============================================================================
-- Super admin audit log for cross-tenant data access.
-- Records every sensitive read/list call a super admin performs against
-- clinic data. Feeds /admin/audit timeline and compliance reports.
-- =============================================================================

CREATE TABLE IF NOT EXISTS super_admin_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL REFERENCES profiles(id),
  action TEXT NOT NULL,                        -- e.g. 'patients.list', 'patient.timeline', 'finance.overview'
  target_clinic_id UUID REFERENCES clinics(id) ON DELETE SET NULL,
  target_resource_type TEXT,                   -- 'patient' | 'medication' | 'diagnostic' | ...
  target_resource_id UUID,
  reason TEXT,
  ip_address INET,
  user_agent TEXT,
  request_id TEXT,
  query_params JSONB,
  result_count INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saa_actor_date  ON super_admin_audit(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saa_clinic_date ON super_admin_audit(target_clinic_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saa_action_date ON super_admin_audit(action, created_at DESC);

ALTER TABLE super_admin_audit ENABLE ROW LEVEL SECURITY;

-- Only super admins may SELECT their own audit history; nothing else can read this.
DROP POLICY IF EXISTS super_admin_audit_read ON super_admin_audit;
CREATE POLICY super_admin_audit_read ON super_admin_audit FOR SELECT
  USING (public.is_super_admin());

-- Inserts go through the service role only (NestJS AdminService).
DROP POLICY IF EXISTS super_admin_audit_insert ON super_admin_audit;
CREATE POLICY super_admin_audit_insert ON super_admin_audit FOR INSERT
  WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.log_super_admin_action(
  p_actor UUID,
  p_action TEXT,
  p_target_clinic UUID,
  p_resource_type TEXT,
  p_resource_id UUID,
  p_reason TEXT,
  p_query JSONB,
  p_count INT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO super_admin_audit (
    actor_id, action, target_clinic_id, target_resource_type, target_resource_id,
    reason, query_params, result_count
  ) VALUES (
    p_actor, p_action, p_target_clinic, p_resource_type, p_resource_id,
    p_reason, COALESCE(p_query, '{}'::jsonb), p_count
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
