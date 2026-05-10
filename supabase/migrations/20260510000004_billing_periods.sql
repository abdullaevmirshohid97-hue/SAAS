-- =============================================================================
-- Sprint 2B — Billing periods (Monthly/Yearly) + helper for seat enforcement
-- =============================================================================

-- 1) plans.price_yearly_cents — yillik narx (oylik × 12 × 0.8 default)
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS price_yearly_cents INT;

-- Mavjud plan'lar uchun yearly narx hisoblab qo'yamiz (12 oy × 80% = 9.6×oylik)
UPDATE plans
   SET price_yearly_cents = ROUND(price_usd_cents * 12 * 0.8)::INT
 WHERE price_yearly_cents IS NULL
   AND price_usd_cents > 0;

COMMENT ON COLUMN plans.price_yearly_cents IS
  'Yillik to''lov narxi (cents). Default = oylik × 12 × 0.8 (20% chegirma).';

-- 2) subscriptions.billing_period
DO $$ BEGIN
  CREATE TYPE billing_period AS ENUM ('monthly', 'yearly');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS billing_period billing_period NOT NULL DEFAULT 'monthly';

CREATE INDEX IF NOT EXISTS idx_subscriptions_clinic_active
  ON subscriptions(clinic_id, status)
  WHERE status IN ('active', 'trialing', 'past_due');

COMMENT ON COLUMN subscriptions.billing_period IS
  'Oylik yoki yillik to''lov. Yearly = 20% chegirma, lekin bir martada to''lanadi.';

-- 3) Helper: clinic_id orqali joriy faol plan limitlarini olish
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

COMMENT ON FUNCTION get_clinic_plan_limits IS
  'Klinikaning joriy faol plan limitlarini qaytaradi. NULL bo''lsa unlimited.';
