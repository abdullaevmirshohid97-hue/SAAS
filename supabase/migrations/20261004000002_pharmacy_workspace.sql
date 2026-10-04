-- =============================================================================
-- DORIXONA 2.0 — alohida dorixona kirishi (Faza 2 / 3 / 7 jadvallari)
-- =============================================================================
--   A) product_subscriptions        — klinikaga biriktirilgan "Dorixona" obunasi
--                                     (300 000 so'm, 3 qurilma). FAQAT super admin.
--   B) product_subscription_events  — biriktirish/uzaytirish/to'xtatish tarixi
--   C) profiles.workspace           — 'clinic' | 'pharmacy' (dorixona akkaunti)
--   D) pharmacy_devices             — ro'yxatdan o'tgan kompyuterlar (limit obunada)
--   E) pharmacy_operators           — Admin / Kassa 1 / Kassa 2 ... PIN bilan
--   F) pharmacy_operator_sessions   — PIN bilan ochilgan sessiya (token xeshi)
--   G) pharmacy_shifts              — har kassaning o'z smenasi (bir vaqtda bir nechta)
--   H) pharmacy_cash_movements      — kassadagi naqd harakatlari (rasxod, inkassatsiya...)
--   I) pharmacy_sale_payments       — sotuvning to'lov qismlari (naqd + karta ...)
--   J) pharmacy_link_account(...)   — Gmail akkauntni dorixona akkauntiga aylantirish
--
-- Klinika kassasi (shifts) va klinika obunasi (clinics.subscription_*) TEGILMAYDI:
-- klinikada bir vaqtda faqat bitta smena ochiq bo'la oladi, dorixonaning ikki
-- kassasi uchun alohida jadval shart.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A) Obuna
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  product         text NOT NULL CHECK (product IN ('pharmacy')),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'canceled')),
  price_uzs       bigint NOT NULL DEFAULT 300000 CHECK (price_uzs >= 0),
  max_devices     integer NOT NULL DEFAULT 3 CHECK (max_devices BETWEEN 1 AND 50),
  starts_at       timestamptz NOT NULL DEFAULT now(),
  ends_at         timestamptz NOT NULL,
  account_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  account_email   text,
  notes           text,
  activated_by    uuid REFERENCES public.profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, product)
);
CREATE INDEX IF NOT EXISTS idx_product_subscriptions_account
  ON public.product_subscriptions (account_user_id) WHERE account_user_id IS NOT NULL;

ALTER TABLE public.product_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_subscriptions FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.product_subscription_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id      uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  product        text NOT NULL DEFAULT 'pharmacy',
  action         text NOT NULL,
  months         integer,
  amount_uzs     bigint,
  discount_pct   numeric(5,2),
  ends_at_before timestamptz,
  ends_at_after  timestamptz,
  notes          text,
  created_by     uuid REFERENCES public.profiles(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_sub_events_clinic
  ON public.product_subscription_events (clinic_id, created_at DESC);

ALTER TABLE public.product_subscription_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_subscription_events FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- C) profiles.workspace
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS workspace text NOT NULL DEFAULT 'clinic';
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_workspace_chk;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_workspace_chk
  CHECK (workspace IN ('clinic', 'pharmacy'));

-- ---------------------------------------------------------------------------
-- D) Qurilmalar
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pharmacy_devices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  device_key_hash text NOT NULL,
  name            text NOT NULL,
  register_no     integer CHECK (register_no IS NULL OR register_no BETWEEN 1 AND 20),
  user_agent      text,
  last_ip         text,
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  is_revoked      boolean NOT NULL DEFAULT false,
  revoked_at      timestamptz,
  revoked_by      uuid REFERENCES public.profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, device_key_hash)
);
CREATE INDEX IF NOT EXISTS idx_pharmacy_devices_active
  ON public.pharmacy_devices (clinic_id) WHERE NOT is_revoked;

ALTER TABLE public.pharmacy_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pharmacy_devices FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- E) Operatorlar (PIN)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pharmacy_operators (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id           uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  full_name           text NOT NULL,
  role                text NOT NULL CHECK (role IN ('admin', 'cashier')),
  register_no         integer CHECK (register_no IS NULL OR register_no BETWEEN 1 AND 20),
  pin_hash            text NOT NULL,
  pin_failed_attempts integer NOT NULL DEFAULT 0,
  pin_locked_until    timestamptz,
  can_return          boolean NOT NULL DEFAULT false,
  can_receive         boolean NOT NULL DEFAULT false,
  can_discount        boolean NOT NULL DEFAULT true,
  is_active           boolean NOT NULL DEFAULT true,
  sort_order          integer NOT NULL DEFAULT 0,
  created_by          uuid REFERENCES public.profiles(id),
  updated_by          uuid REFERENCES public.profiles(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pharmacy_operators_clinic
  ON public.pharmacy_operators (clinic_id) WHERE is_active;

ALTER TABLE public.pharmacy_operators ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pharmacy_operators FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- F) Operator sessiyalari
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pharmacy_operator_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  operator_id  uuid NOT NULL REFERENCES public.pharmacy_operators(id) ON DELETE CASCADE,
  device_id    uuid REFERENCES public.pharmacy_devices(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_pharmacy_op_sessions_operator
  ON public.pharmacy_operator_sessions (operator_id) WHERE revoked_at IS NULL;

ALTER TABLE public.pharmacy_operator_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pharmacy_operator_sessions FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- G) Dorixona kassasi smenalari
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pharmacy_shifts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id          uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  register_no        integer NOT NULL DEFAULT 1 CHECK (register_no BETWEEN 1 AND 20),
  opened_by_operator uuid REFERENCES public.pharmacy_operators(id) ON DELETE SET NULL,
  opened_by_user     uuid REFERENCES public.profiles(id),
  device_id          uuid REFERENCES public.pharmacy_devices(id) ON DELETE SET NULL,
  opened_at          timestamptz NOT NULL DEFAULT now(),
  opening_cash_uzs   bigint NOT NULL DEFAULT 0 CHECK (opening_cash_uzs >= 0),
  closed_at          timestamptz,
  closed_by_operator uuid REFERENCES public.pharmacy_operators(id) ON DELETE SET NULL,
  closed_by_user     uuid REFERENCES public.profiles(id),
  expected_cash_uzs  bigint,
  actual_cash_uzs    bigint,
  diff_uzs           bigint GENERATED ALWAYS AS
                       (COALESCE(actual_cash_uzs, 0) - COALESCE(expected_cash_uzs, 0)) STORED,
  totals             jsonb,
  notes              text,
  z_no               integer,
  created_at         timestamptz NOT NULL DEFAULT now()
);
-- Har kassada bir vaqtda faqat bitta ochiq smena
CREATE UNIQUE INDEX IF NOT EXISTS uq_pharmacy_shifts_open
  ON public.pharmacy_shifts (clinic_id, register_no) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pharmacy_shifts_clinic
  ON public.pharmacy_shifts (clinic_id, opened_at DESC);

ALTER TABLE public.pharmacy_shifts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pharmacy_shifts FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- H) Kassa harakatlari (+ kassaga kirdi, − chiqdi)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pharmacy_cash_movements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  shift_id    uuid REFERENCES public.pharmacy_shifts(id) ON DELETE SET NULL,
  kind        text NOT NULL CHECK (kind IN (
                'supplier_payment', 'expense', 'encashment', 'debt_collection',
                'cash_in', 'cash_out', 'refund')),
  method      text NOT NULL DEFAULT 'cash',
  amount_uzs  bigint NOT NULL,
  notes       text,
  operator_id uuid REFERENCES public.pharmacy_operators(id) ON DELETE SET NULL,
  created_by  uuid REFERENCES public.profiles(id),
  ref_table   text,
  ref_id      uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pharmacy_cash_mov_shift
  ON public.pharmacy_cash_movements (shift_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_cash_mov_clinic
  ON public.pharmacy_cash_movements (clinic_id, created_at DESC);

ALTER TABLE public.pharmacy_cash_movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pharmacy_cash_movements FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- I) Sotuv to'lov qismlari
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pharmacy_sale_payments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  sale_id    uuid NOT NULL REFERENCES public.pharmacy_sales(id) ON DELETE CASCADE,
  method     text NOT NULL,
  amount_uzs bigint NOT NULL CHECK (amount_uzs > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pharmacy_sale_payments_sale
  ON public.pharmacy_sale_payments (sale_id);

ALTER TABLE public.pharmacy_sale_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pharmacy_sale_payments FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- J) Dorixona akkaunti
-- ---------------------------------------------------------------------------
-- Akkaunt klinikaga 'pharmacist' roli bilan ulanadi, JWT'ga workspace='pharmacy'
-- yoziladi. Server bunday akkauntga faqat dorixona API'larini ochadi (kassir
-- klinika ma'lumotlarini ko'rmaydi).
CREATE OR REPLACE FUNCTION public.pharmacy_link_account(p_user uuid, p_clinic uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  UPDATE public.profiles
     SET clinic_id = p_clinic,
         role = 'pharmacist',
         workspace = 'pharmacy'
   WHERE id = p_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profil topilmadi';
  END IF;

  UPDATE auth.users
     SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object(
           'clinic_id', p_clinic::text,
           'role', 'pharmacist',
           'workspace', 'pharmacy')
   WHERE id = p_user;
END;
$$;

REVOKE ALL ON FUNCTION public.pharmacy_link_account(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pharmacy_link_account(uuid, uuid) TO service_role;
