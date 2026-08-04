-- =============================================================================
-- BILLING DOCS — super-admin hisob-faktura (invoys) + shartnoma/oferta moduli
-- =============================================================================
-- Mavjud `invoices` jadvali Stripe/USD shaklida edi (amount_usd_cents,
-- stripe_invoice_id) va HECH QACHON to'ldirilmagan (0 qator) — admin "Tushum"
-- sahifasi shu bo'sh jadvaldan o'qigani uchun obuna daromadi $0 ko'rinardi.
-- Bu migratsiya uni O'zbekiston amaliyotiga (so'm, davr, QQS, rekvizit) moslaydi
-- va yonига satrlar/shartnoma/rekvizit jadvallarini qo'shadi.
--
-- Hammasi IDEMPOTENT — prod'da ham, toza bazada ham xavfsiz qayta ishga tushadi.
-- =============================================================================

-- --- 1) invoices: so'm, davr, QQS, rekvizit snapshot ------------------------
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS period_start      DATE,
  ADD COLUMN IF NOT EXISTS period_end        DATE,
  ADD COLUMN IF NOT EXISTS plan_code         TEXT,
  ADD COLUMN IF NOT EXISTS months            INT     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS subtotal_uzs      BIGINT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_percent  NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_uzs      BIGINT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_percent       NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_uzs           BIGINT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_uzs         BIGINT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lang              TEXT    NOT NULL DEFAULT 'uz',
  ADD COLUMN IF NOT EXISTS issuer            JSONB   NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS customer          JSONB   NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS notes             TEXT,
  ADD COLUMN IF NOT EXISTS payment_method    TEXT,
  ADD COLUMN IF NOT EXISTS sent_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS void_reason       TEXT,
  ADD COLUMN IF NOT EXISTS created_by        UUID REFERENCES profiles(id);

-- amount_usd_cents NOT NULL edi, defaultsiz — so'mli invoys yozib bo'lmasdi.
ALTER TABLE invoices ALTER COLUMN amount_usd_cents SET DEFAULT 0;
-- Platforma O'zbekistonda ishlaydi — yangi invoyslar so'mda.
ALTER TABLE invoices ALTER COLUMN currency SET DEFAULT 'UZS';
ALTER TABLE invoices ALTER COLUMN status SET DEFAULT 'draft';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_status_check') THEN
    ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
      CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'void'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_number ON invoices(number) WHERE number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_clinic  ON invoices(clinic_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_status  ON invoices(status, due_at);

-- --- 2) invoice_items — invoys satrlari ------------------------------------
CREATE TABLE IF NOT EXISTS invoice_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id     UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  position       INT  NOT NULL DEFAULT 0,
  title          TEXT NOT NULL,
  description    TEXT,
  unit           TEXT NOT NULL DEFAULT 'oy',
  quantity       NUMERIC(12,2) NOT NULL DEFAULT 1,
  unit_price_uzs BIGINT NOT NULL DEFAULT 0,
  amount_uzs     BIGINT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id, position);

-- --- 3) contracts — 2 tomonlama shartnoma / oferta akseptasi ---------------
CREATE TABLE IF NOT EXISTS contracts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  number        TEXT UNIQUE,
  -- bilateral = imzolanadigan 2 tomonlama shartnoma
  -- offer      = ommaviy oferta akseptasi (mijoz onlayn qabul qilgan)
  kind          TEXT NOT NULL DEFAULT 'bilateral' CHECK (kind IN ('bilateral', 'offer')),
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'sent', 'signed', 'terminated')),
  lang          TEXT NOT NULL DEFAULT 'uz',
  plan_code     TEXT,
  monthly_uzs   BIGINT NOT NULL DEFAULT 0,
  billing_period TEXT NOT NULL DEFAULT 'monthly',
  starts_on     DATE,
  ends_on       DATE,
  signed_at     TIMESTAMPTZ,
  terminated_at TIMESTAMPTZ,
  -- Imzolash paytidagi rekvizitlar KO'CHIRMASI — keyin o'zgarsa hujjat buzilmasin.
  issuer        JSONB NOT NULL DEFAULT '{}'::jsonb,
  customer      JSONB NOT NULL DEFAULT '{}'::jsonb,
  terms_version TEXT,
  notes         TEXT,
  created_by    UUID REFERENCES profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contracts_clinic ON contracts(clinic_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);

-- --- 4) platform_billing_settings — Clary'ning O'Z rekvizitlari ------------
-- Bitta qator (id = TRUE). Kodda hardcode QILINMAYDI — admin panelidan to'ldiriladi.
CREATE TABLE IF NOT EXISTS platform_billing_settings (
  id                 BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  company_name       TEXT NOT NULL DEFAULT 'Clary Care',
  legal_name         TEXT,
  tax_id             TEXT,          -- STIR / INN
  oked               TEXT,
  address            TEXT,
  phone              TEXT,
  email              TEXT,
  website            TEXT DEFAULT 'clary.uz',
  bank_name          TEXT,
  bank_account       TEXT,          -- hisob raqami
  bank_mfo           TEXT,
  director_name      TEXT,
  director_position  TEXT DEFAULT 'Direktor',
  vat_percent        NUMERIC(5,2) NOT NULL DEFAULT 0,
  invoice_prefix     TEXT NOT NULL DEFAULT 'CLARY',
  contract_prefix    TEXT NOT NULL DEFAULT 'CLARY-SH',
  invoice_due_days   INT  NOT NULL DEFAULT 5,
  offer_url          TEXT,
  offer_version      TEXT DEFAULT '1.0',
  payment_note       TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO platform_billing_settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

-- Rahbar ismi — hujjatlarda "Ijrochi" tomonidan imzolovchi shaxs.
-- Faqat bo'sh bo'lsa to'ldiriladi (admin panelda o'zgartirilgani bekor qilinmasin).
UPDATE platform_billing_settings
   SET director_name = 'Mirshohid Abdullaev',
       director_position = COALESCE(director_position, 'Direktor')
 WHERE id = TRUE AND (director_name IS NULL OR director_name = '');

-- --- 5) Hujjat raqami — yil bo'yicha uzluksiz, atomik --------------------
CREATE TABLE IF NOT EXISTS billing_doc_counters (
  kind    TEXT NOT NULL,
  year    INT  NOT NULL,
  last_no INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, year)
);

-- CLARY-2026-0001 ko'rinishida. INSERT..ON CONFLICT DO UPDATE — bir vaqtda
-- ikki admin bossa ham raqam takrorlanmaydi (qator darajasida lock).
CREATE OR REPLACE FUNCTION next_billing_number(p_kind TEXT, p_prefix TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year INT := EXTRACT(YEAR FROM now())::INT;
  v_no   INT;
BEGIN
  INSERT INTO billing_doc_counters (kind, year, last_no)
  VALUES (p_kind, v_year, 1)
  ON CONFLICT (kind, year) DO UPDATE SET last_no = billing_doc_counters.last_no + 1
  RETURNING last_no INTO v_no;

  RETURN p_prefix || '-' || v_year || '-' || LPAD(v_no::TEXT, 4, '0');
END $$;

REVOKE ALL ON FUNCTION next_billing_number(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- --- 6) RLS — faqat service_role (API service key bilan ishlaydi) ---------
ALTER TABLE invoice_items             ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_billing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_doc_counters      ENABLE ROW LEVEL SECURITY;

-- --- 7) PostgREST sxema keshini yangilash ---------------------------------
NOTIFY pgrst, 'reload schema';
