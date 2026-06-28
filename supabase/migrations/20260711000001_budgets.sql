-- =============================================================================
-- QISM 2 / E3 — Budget & Variance. Hisob (account) bo'yicha oylik reja.
-- Variance = reja (budgets) vs fakt (gl_account_activity) API'da hisoblanadi.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  period_year int NOT NULL,
  period_month int NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  account_code text NOT NULL,
  planned_uzs bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1,
  UNIQUE (clinic_id, period_year, period_month, account_code)
);
CREATE INDEX IF NOT EXISTS idx_budgets_clinic_period ON public.budgets (clinic_id, period_year, period_month);

DROP TRIGGER IF EXISTS tg_budgets_updated ON public.budgets;
CREATE TRIGGER tg_budgets_updated BEFORE UPDATE ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
REVOKE SELECT ON public.budgets FROM anon, authenticated;
