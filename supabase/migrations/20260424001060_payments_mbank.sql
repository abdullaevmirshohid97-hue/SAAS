-- =============================================================================
-- Clary v2 — Migration 001060: Payments — add M-Bank (MBANK) provider
-- Extends payment_method_type enum and seeds payment_providers catalog.
-- =============================================================================

-- Add 'mbank' value to the payment_method_type enum if missing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'payment_method_type' AND e.enumlabel = 'mbank'
  ) THEN
    ALTER TYPE payment_method_type ADD VALUE 'mbank';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- payment_providers — catalog of supported payment providers (for UI listing)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_providers (
  code TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  logo_url TEXT,
  supports_charge BOOLEAN NOT NULL DEFAULT true,
  supports_qr BOOLEAN NOT NULL DEFAULT false,
  supports_customer_scan BOOLEAN NOT NULL DEFAULT false,
  supports_webhook BOOLEAN NOT NULL DEFAULT true,
  country TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_mock_only BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO payment_providers (code, display_name, supports_charge, supports_qr, supports_customer_scan, country, sort_order, is_mock_only)
VALUES
  ('click',  'Click',   true, true,  true,  ARRAY['UZ'],              10, false),
  ('payme',  'Payme',   true, true,  true,  ARRAY['UZ'],              20, false),
  ('uzum',   'Uzum',    true, true,  true,  ARRAY['UZ'],              30, false),
  ('mbank',  'MBANK',   true, true,  true,  ARRAY['UZ','KG'],         40, true),
  ('kaspi',  'Kaspi',   true, true,  true,  ARRAY['KZ'],              50, false),
  ('stripe', 'Stripe',  true, false, false, ARRAY['US','GB','EU'],    90, false)
ON CONFLICT (code) DO UPDATE
  SET supports_qr = EXCLUDED.supports_qr,
      supports_customer_scan = EXCLUDED.supports_customer_scan,
      country = EXCLUDED.country,
      is_mock_only = EXCLUDED.is_mock_only,
      is_active = true;

ALTER TABLE payment_providers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_payment_providers_read ON payment_providers;
CREATE POLICY p_payment_providers_read ON payment_providers
  FOR SELECT USING (is_active = true);
DROP POLICY IF EXISTS p_payment_providers_admin ON payment_providers;
CREATE POLICY p_payment_providers_admin ON payment_providers
  FOR ALL
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

COMMENT ON TABLE payment_providers IS 'Catalog of supported payment providers (UI listing + feature flags)';
