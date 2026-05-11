-- =============================================================================
-- Sprint 2 polish: plans.stripe_price_id_yearly for yearly billing
-- =============================================================================

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS stripe_price_id_yearly TEXT;

COMMENT ON COLUMN plans.stripe_price_id_yearly IS
  'Stripe Price ID for yearly billing (12 month, 20% discount). NULL = yearly disabled for this plan.';
