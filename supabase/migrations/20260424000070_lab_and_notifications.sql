-- =============================================================================
-- Clary v2 — Migration 70: Laboratory state machine + Notifications outbox
--   * notifications_outbox: tenant-scoped SMS/email queue (idempotent sender)
--   * lab_orders/lab_order_items: state machine + workflow timestamps
--   * lab_results: add attachment_url (PDF/image)
-- =============================================================================

-- Notifications outbox — generic per-tenant queue for SMS/email/push
CREATE TABLE IF NOT EXISTS notifications_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'email', 'push', 'telegram')),
  recipient TEXT NOT NULL,                             -- phone or email
  template_key TEXT,                                   -- e.g. 'lab.result_ready'
  locale TEXT NOT NULL DEFAULT 'uz-Latn',
  subject TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'canceled')),
  attempt_count INT NOT NULL DEFAULT 0,
  last_error TEXT,
  provider TEXT,                                       -- eskiz / twilio / resend / ...
  provider_message_id TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  patient_id UUID REFERENCES patients(id),
  related_resource TEXT,                               -- e.g. 'lab_orders'
  related_id UUID,
  idempotency_key TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_outbox_clinic_status
  ON notifications_outbox(clinic_id, status, scheduled_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notif_outbox_idem
  ON notifications_outbox(clinic_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DROP TRIGGER IF EXISTS tg_notif_outbox_updated ON notifications_outbox;
CREATE TRIGGER tg_notif_outbox_updated
  BEFORE UPDATE ON notifications_outbox
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE notifications_outbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_notif_outbox_tenant ON notifications_outbox;
CREATE POLICY p_notif_outbox_tenant ON notifications_outbox
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

-- -----------------------------------------------------------------------------
-- Lab extensions
-- -----------------------------------------------------------------------------
ALTER TABLE lab_orders
  ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS running_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reported_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reported_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notify_sms BOOLEAN NOT NULL DEFAULT true;

-- Align status machine
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lab_orders_status_chk'
  ) THEN
    ALTER TABLE lab_orders
      ADD CONSTRAINT lab_orders_status_chk
      CHECK (status IN ('pending', 'collected', 'running', 'completed', 'reported', 'delivered', 'canceled'));
  END IF;
END $$;

ALTER TABLE lab_order_items
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE lab_results
  ADD COLUMN IF NOT EXISTS attachment_url TEXT,
  ADD COLUMN IF NOT EXISTS attachment_mime TEXT;
