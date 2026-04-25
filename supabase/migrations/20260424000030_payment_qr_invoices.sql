-- Reception QR payment invoices (Click Pass / Payme / Uzum QR).
-- Each invoice represents a single QR-based payment request, linked to a
-- future transaction. Two flows are supported:
--   merchant_qr  — clinic generates QR → customer pays from their app
--   customer_scan — customer shows their Click/Payme Pass OTP → cashier verifies

CREATE TYPE payment_qr_flow AS ENUM ('merchant_qr', 'customer_scan');
CREATE TYPE payment_qr_status AS ENUM ('pending', 'succeeded', 'failed', 'canceled', 'expired');

CREATE TABLE payment_qr_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  provider payment_method_type NOT NULL,
  flow payment_qr_flow NOT NULL DEFAULT 'merchant_qr',
  provider_reference TEXT NOT NULL,
  patient_id UUID REFERENCES patients(id),
  transaction_id UUID REFERENCES transactions(id),
  shift_id UUID REFERENCES shifts(id),
  cashier_id UUID REFERENCES profiles(id),
  amount_uzs BIGINT NOT NULL,
  qr_payload TEXT,
  deep_link TEXT,
  status payment_qr_status NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  error_message TEXT,
  idempotency_key TEXT NOT NULL,
  raw_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, idempotency_key),
  UNIQUE (provider, provider_reference)
);

CREATE INDEX payment_qr_invoices_clinic_status_idx
  ON payment_qr_invoices (clinic_id, status, created_at DESC);
CREATE INDEX payment_qr_invoices_expiring_idx
  ON payment_qr_invoices (expires_at)
  WHERE status = 'pending';

CREATE TRIGGER tg_payment_qr_invoices_updated
BEFORE UPDATE ON payment_qr_invoices
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE payment_qr_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY pqi_select ON payment_qr_invoices FOR SELECT
  USING (clinic_id = get_my_clinic_id() OR get_my_role() = 'super_admin');
CREATE POLICY pqi_insert ON payment_qr_invoices FOR INSERT
  WITH CHECK (clinic_id = get_my_clinic_id());
CREATE POLICY pqi_update ON payment_qr_invoices FOR UPDATE
  USING (clinic_id = get_my_clinic_id() OR get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = get_my_clinic_id() OR get_my_role() = 'super_admin');

-- Webhook delivery log (separate from billing.webhook_endpoints) for inbound
-- gateway callbacks. Keeps raw body for dispute investigations.
CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE,
  provider payment_method_type NOT NULL,
  provider_reference TEXT,
  headers JSONB,
  body JSONB,
  signature TEXT,
  valid BOOLEAN,
  processed_at TIMESTAMPTZ,
  error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX payment_webhook_events_ref_idx
  ON payment_webhook_events (provider, provider_reference);

ALTER TABLE payment_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY pwe_select ON payment_webhook_events FOR SELECT
  USING (clinic_id = get_my_clinic_id() OR get_my_role() = 'super_admin');
-- Webhook events are only inserted by the API service role (bypasses RLS).

-- Clinic-level QR flow preference (persisted into clinics.settings jsonb).
-- Example: settings -> 'payments' -> 'qr_flow' = 'merchant_qr' | 'customer_scan'
