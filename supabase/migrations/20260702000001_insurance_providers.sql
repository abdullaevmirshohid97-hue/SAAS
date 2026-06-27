-- =============================================================================
-- Sug'urta — Faza A: 2 qatlamli model poydevori.
--   Layer 1 (markaziy): insurance_providers (GLOBAL, super-admin boshqaradi).
--   Layer 2 (per-clinic): insurance_companies'ga shartnoma maydonlari + provider link.
--   GL: COA'ga 1210 (Insurer AR) + 5200 (Sug'urta komissiya/chegirma).
-- Additive — mavjud sug'urta/billing oqimi o'zgarmaydi.
-- =============================================================================

-- 1) Markaziy direktoriya (clinic_id YO'Q — plans/site_entries patterni) -----
CREATE TABLE IF NOT EXISTS public.insurance_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  legal_name text,
  type text NOT NULL DEFAULT 'dms' CHECK (type IN ('dms','oms','other')),
  logo_url text,
  phone text,
  email text,
  website text,
  integration_mode text NOT NULL DEFAULT 'manual' CHECK (integration_mode IN ('manual','api')),
  api_base text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS tg_insurance_providers_updated ON public.insurance_providers;
CREATE TRIGGER tg_insurance_providers_updated BEFORE UPDATE ON public.insurance_providers
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.insurance_providers ENABLE ROW LEVEL SECURITY;
REVOKE SELECT ON public.insurance_providers FROM anon, authenticated;

-- Asosiy UZ sug'urta kompaniyalari (boshlang'ich direktoriya)
INSERT INTO public.insurance_providers (code, name, type, sort_order) VALUES
  ('apex',        'Apex Insurance',          'dms', 1),
  ('gross',       'Gross Insurance',         'dms', 2),
  ('kafolat',     'Kafolat Sug''urta',       'dms', 3),
  ('kapital',     'Kapital Sug''urta',       'dms', 4),
  ('uzbekinvest', 'O''zbekinvest',           'dms', 5),
  ('trust',       'Trust Insurance',         'dms', 6),
  ('euroasia',    'Euroasia Insurance',      'dms', 7),
  ('inson',       'Inson Sug''urta',         'dms', 8),
  ('alskom',      'Alskom',                  'dms', 9),
  ('semurg',      'Semurg Insurance',        'dms', 10),
  ('other',       'Boshqa (mahalliy)',       'other', 99)
ON CONFLICT (code) DO NOTHING;

-- 2) Per-clinic shartnoma maydonlari (insurance_companies kengaytirish) ------
ALTER TABLE public.insurance_companies
  ADD COLUMN IF NOT EXISTS provider_id uuid REFERENCES public.insurance_providers(id),
  ADD COLUMN IF NOT EXISTS contract_start date,
  ADD COLUMN IF NOT EXISTS contract_end date,
  ADD COLUMN IF NOT EXISTS copay_percent numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS covered_category_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS max_benefit_uzs bigint,
  ADD COLUMN IF NOT EXISTS payout_details jsonb;

-- 3) GL — Insurer AR (1210) + Sug'urta komissiya/chegirma (5200) -------------
CREATE OR REPLACE FUNCTION public.seed_chart_of_accounts(p_clinic uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO chart_of_accounts (clinic_id, code, name, type) VALUES
    (p_clinic, '1010', 'Kassa', 'asset'),
    (p_clinic, '1020', 'Seyf', 'asset'),
    (p_clinic, '1030', 'Bank / Plastik', 'asset'),
    (p_clinic, '1200', 'Bemor qarzi (AR)', 'asset'),
    (p_clinic, '1210', 'Sug''urta qarzi (Insurer AR)', 'asset'),
    (p_clinic, '1400', 'Tovar-moddiy zaxira (Inventory)', 'asset'),
    (p_clinic, '2100', 'Yetkazib beruvchi qarzi (AP)', 'liability'),
    (p_clinic, '2300', 'QQS to''lov', 'liability'),
    (p_clinic, '3000', 'Kapital', 'equity'),
    (p_clinic, '4000', 'Xizmat daromadi', 'income'),
    (p_clinic, '4100', 'Dorixona daromadi', 'income'),
    (p_clinic, '5000', 'Umumiy xarajat', 'expense'),
    (p_clinic, '5100', 'Materiallar/Reagent xarajati', 'expense'),
    (p_clinic, '5200', 'Sug''urta komissiya/chegirma', 'expense')
  ON CONFLICT (clinic_id, code) DO NOTHING;
$$;
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT id FROM clinics LOOP PERFORM seed_chart_of_accounts(c.id); END LOOP;
END $$;
