-- =============================================================================
-- QISM 0 / F0.1 — Multi-branch poydevor: Kompaniya qatlami (har klinika = FILIAL).
-- 100% ADDITIVE: mavjud clinic_id va ma'lumot saqlanadi. Har mavjud klinikaga
-- 1 ta company yaratiladi (1 filial = HQ). Hech qanday mavjud xulq o'zgarmaydi.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  legal_name text,
  country text NOT NULL DEFAULT 'UZ',
  base_currency text NOT NULL DEFAULT 'UZS',
  owner_user_id uuid REFERENCES public.profiles(id),
  package text NOT NULL DEFAULT 'small' CHECK (package IN ('small','business','enterprise')),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS tg_companies_updated ON public.companies;
CREATE TRIGGER tg_companies_updated BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Klinika = filial: company link + filial metadata
ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id),
  ADD COLUMN IF NOT EXISTS branch_code text,
  ADD COLUMN IF NOT EXISTS is_hq boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_clinics_company ON public.clinics (company_id);

-- Backfill: har mavjud klinikaga 1 ta company (1 filial = HQ)
DO $$
DECLARE c record; v_company uuid;
BEGIN
  FOR c IN SELECT id, name, legal_name, country, currency, billing_code, slug FROM clinics WHERE company_id IS NULL LOOP
    INSERT INTO companies (name, legal_name, country, base_currency, package)
      VALUES (c.name, c.legal_name, COALESCE(c.country,'UZ'), COALESCE(c.currency,'UZS'), 'small')
      RETURNING id INTO v_company;
    UPDATE clinics
      SET company_id = v_company, is_hq = true, branch_code = COALESCE(c.billing_code, c.slug)
      WHERE id = c.id;
  END LOOP;
END $$;

-- RLS helper: foydalanuvchining kompaniyasi (uning filialidan kelib chiqadi)
CREATE OR REPLACE FUNCTION public.get_my_company_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT company_id FROM public.clinics WHERE id = public.get_my_clinic_id();
$$;

-- RLS — companies (API service_role orqali; super_admin)
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
REVOKE SELECT ON public.companies FROM anon, authenticated;
