-- ============================================================================
-- Telegram bots + LAN thermal printers
-- Supabase Dashboard → SQL Editor → paste → Run
-- ============================================================================

BEGIN;

-- 1) telegram_bots (per-clinic bot, BotFather token)
CREATE TABLE IF NOT EXISTS telegram_bots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  bot_token TEXT NOT NULL,
  bot_username TEXT NOT NULL,
  webhook_secret TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  is_active BOOLEAN NOT NULL DEFAULT true,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clinic_id),
  UNIQUE (bot_username)
);

CREATE INDEX IF NOT EXISTS idx_telegram_bots_clinic ON telegram_bots(clinic_id);

ALTER TABLE telegram_bots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_telegram_bots_tenant ON telegram_bots;
CREATE POLICY p_telegram_bots_tenant ON telegram_bots
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

DROP TRIGGER IF EXISTS tg_telegram_bots_updated ON telegram_bots;
CREATE TRIGGER tg_telegram_bots_updated
  BEFORE UPDATE ON telegram_bots
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 2) patient_telegram_links (bemor ↔ chat_id)
CREATE TABLE IF NOT EXISTS patient_telegram_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  telegram_chat_id BIGINT NOT NULL,
  telegram_username TEXT,
  telegram_first_name TEXT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (clinic_id, patient_id),
  UNIQUE (clinic_id, telegram_chat_id)
);

CREATE INDEX IF NOT EXISTS idx_patient_telegram_links_patient
  ON patient_telegram_links(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_telegram_links_chat
  ON patient_telegram_links(clinic_id, telegram_chat_id);

ALTER TABLE patient_telegram_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_patient_telegram_links_tenant ON patient_telegram_links;
CREATE POLICY p_patient_telegram_links_tenant ON patient_telegram_links
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

-- 3) thermal_printers (LAN + USB)
CREATE TABLE IF NOT EXISTS thermal_printers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  connection_type TEXT NOT NULL CHECK (connection_type IN ('lan', 'usb', 'bluetooth')),
  ip_address INET,
  port INT NOT NULL DEFAULT 9100,
  usb_vendor_id TEXT,
  usb_product_id TEXT,
  paper_width_mm INT NOT NULL DEFAULT 80 CHECK (paper_width_mm IN (58, 80)),
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  location TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_thermal_printers_clinic
  ON thermal_printers(clinic_id, is_active);

ALTER TABLE thermal_printers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_thermal_printers_tenant ON thermal_printers;
CREATE POLICY p_thermal_printers_tenant ON thermal_printers
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

DROP TRIGGER IF EXISTS tg_thermal_printers_updated ON thermal_printers;
CREATE TRIGGER tg_thermal_printers_updated
  BEFORE UPDATE ON thermal_printers
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 4) print_jobs (history + retry)
CREATE TABLE IF NOT EXISTS print_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  printer_id UUID REFERENCES thermal_printers(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('queue_ticket', 'receipt', 'lab_summary', 'rx_summary', 'other')),
  reference_id UUID,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  error TEXT,
  triggered_by UUID REFERENCES profiles(id),
  printed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_print_jobs_clinic_recent
  ON print_jobs(clinic_id, created_at DESC);

ALTER TABLE print_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_print_jobs_tenant ON print_jobs;
CREATE POLICY p_print_jobs_tenant ON print_jobs
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

COMMIT;
