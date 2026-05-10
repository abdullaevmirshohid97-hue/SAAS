-- ============================================================================
-- Clary Sprint 2B — Billing periods (Monthly/Yearly) + plan limits helper
-- ============================================================================
-- Supabase Dashboard → SQL Editor → ushbu butun faylni paste qiling → Run.
-- Idempotent: ALTER ... ADD COLUMN IF NOT EXISTS, CREATE TYPE try-catch.
-- ============================================================================

BEGIN;

-- 1) plans.price_yearly_cents
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS price_yearly_cents INT;

UPDATE plans
   SET price_yearly_cents = ROUND(price_usd_cents * 12 * 0.8)::INT
 WHERE price_yearly_cents IS NULL
   AND price_usd_cents > 0;

-- 2) subscriptions.billing_period
DO $$ BEGIN
  CREATE TYPE billing_period AS ENUM ('monthly', 'yearly');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS billing_period billing_period NOT NULL DEFAULT 'monthly';

CREATE INDEX IF NOT EXISTS idx_subscriptions_clinic_active
  ON subscriptions(clinic_id, status)
  WHERE status IN ('active', 'trialing', 'past_due');

-- 3) RPC: plan limits
CREATE OR REPLACE FUNCTION get_clinic_plan_limits(p_clinic_id UUID)
RETURNS TABLE(
  plan_code subscription_plan,
  max_staff INT,
  max_devices INT,
  max_patients INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.code, p.max_staff, p.max_devices, p.max_patients
    FROM subscriptions s
    JOIN plans p ON p.code = s.plan_code
   WHERE s.clinic_id = p_clinic_id
     AND s.status IN ('active', 'trialing', 'past_due')
   ORDER BY s.created_at DESC
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION get_clinic_plan_limits(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_clinic_plan_limits(UUID) TO service_role;

COMMIT;
