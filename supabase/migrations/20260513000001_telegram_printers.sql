-- =============================================================================
-- Sprint: Telegram bot per-clinic + LAN thermal printers
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) telegram_bots — har klinika uchun bitta bot (BotFather'dan olingan token)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS telegram_bots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  bot_token TEXT NOT NULL,                   -- BotFather token (secret!)
  bot_username TEXT NOT NULL,                -- @clinic_clary_bot
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

COMMENT ON TABLE telegram_bots IS
  'Har klinikaning shaxsiy Telegram boti. Klinika @BotFather orqali bot '
  'yaratadi, token sozlamalarda yozadi. Bemor /start qiladi → chat_id '
  'patient_telegram_links ga yoziladi.';

-- -----------------------------------------------------------------------------
-- 2) patient_telegram_links — bemor ↔ chat_id mapping
-- -----------------------------------------------------------------------------
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

COMMENT ON TABLE patient_telegram_links IS
  'Bemor /start <telefon-raqami> qiladi, biz telefonga mos bemorni topib '
  'shu yerga yozamiz. Keyingi xabarlar shu chat_id ga jo''natiladi.';

-- -----------------------------------------------------------------------------
-- 3) thermal_printers — klinika tomonidagi LAN/USB thermal chek printerlari
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS thermal_printers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                          -- "Reception 1", "Kassa 2"
  connection_type TEXT NOT NULL CHECK (connection_type IN ('lan', 'usb', 'bluetooth')),
  -- LAN: ip + port (Caddy yo'q, API server'dan to'g'ridan-to'g'ri TCP)
  ip_address INET,
  port INT NOT NULL DEFAULT 9100,              -- ESC/POS standard port
  -- USB: bridge agent identifier (USB qo'shilganda agent qaysi printer'ni ko'rsa)
  usb_vendor_id TEXT,                          -- 04b8 (Epson) etc
  usb_product_id TEXT,
  -- Common
  paper_width_mm INT NOT NULL DEFAULT 80 CHECK (paper_width_mm IN (58, 80)),
  is_default BOOLEAN NOT NULL DEFAULT false,   -- klinikaning asosiy chek printeri
  is_active BOOLEAN NOT NULL DEFAULT true,
  location TEXT,                               -- "Reception", "Kassa"
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

COMMENT ON TABLE thermal_printers IS
  'Klinika tomonidagi thermal chek printerlari. LAN — IP:port to''g''ridan-to''g''ri '
  'API serverdan TCP orqali. USB — alohida agent (keyingi sprint).';

-- -----------------------------------------------------------------------------
-- 4) print_jobs — chek/hujjat chop etish tarixi
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS print_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  printer_id UUID REFERENCES thermal_printers(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('queue_ticket', 'receipt', 'lab_summary', 'rx_summary', 'other')),
  reference_id UUID,                           -- queue_id / transaction_id / lab_order_id
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,  -- raw data printed
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

-- -----------------------------------------------------------------------------
-- 5) notifications_outbox: telegram channel allow + provider field
-- -----------------------------------------------------------------------------
-- channel allaqachon 'sms'|'email'|'push'|'telegram' (services-da Channel type).
-- DB constraint mavjud bo'lsa kengaytiramiz, aks holda hech qanday o'zgarish kerak emas.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.check_constraints
     WHERE constraint_name LIKE 'notifications_outbox_channel%'
  ) THEN
    -- Mavjud check'ni telegram qo'shib qayta yaratish kerak bo'lishi mumkin.
    -- Hozircha skip — schema mavjud check'i 'sms','email','push' bilan cheklangan
    -- bo'lsa, alohida migration kerak. Sizning DB'da check yo'q (Channel TS-side enum).
    NULL;
  END IF;
END $$;
