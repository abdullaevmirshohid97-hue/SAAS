-- ============================================================================
-- Plans: stripe_price_id_yearly
-- Supabase Dashboard → SQL Editor → run.
-- ============================================================================

BEGIN;

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS stripe_price_id_yearly TEXT;

COMMENT ON COLUMN plans.stripe_price_id_yearly IS
  'Stripe Price ID for yearly billing. NULL = yearly disabled.';

COMMIT;

-- Sozlashdan keyin (Stripe Dashboard → Products → har plan uchun 2 ta Price ID yarating):
--
-- UPDATE plans SET stripe_price_id = 'price_xxx_monthly',
--                  stripe_price_id_yearly = 'price_xxx_yearly'
--  WHERE code = '25pro';
-- UPDATE plans SET stripe_price_id = 'price_yyy_monthly',
--                  stripe_price_id_yearly = 'price_yyy_yearly'
--  WHERE code = '50pro';
-- UPDATE plans SET stripe_price_id = 'price_zzz_monthly',
--                  stripe_price_id_yearly = 'price_zzz_yearly'
--  WHERE code = '120pro';
