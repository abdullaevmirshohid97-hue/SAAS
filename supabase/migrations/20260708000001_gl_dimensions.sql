-- =============================================================================
-- QISM 1 / F1 — GL Dimensions + COA ierarxiya (backbone).
--   COA: parent_id (ierarxiya 1000→1100→1110), is_header, sort_order.
--   Dimension masterlar: cost_centers / departments / projects (per clinic).
--   (branch = klinika, shuning uchun branch dimension SHART EMAS.)
--   gl_lines: cost_center_id / department_id / project_id (nullable).
--   post_journal v2: har qatorda ixtiyoriy dimension (orqaga MOS — eski chaqiruvlar null).
-- Additive — mavjud GL/hisobotlar o'zgarmaydi.
-- =============================================================================

-- 1) COA ierarxiya
ALTER TABLE public.chart_of_accounts
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.chart_of_accounts(id),
  ADD COLUMN IF NOT EXISTS is_header boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0;

-- 2) Dimension masterlar (per clinic)
CREATE TABLE IF NOT EXISTS public.cost_centers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  code text NOT NULL, name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true, sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, code)
);
CREATE TABLE IF NOT EXISTS public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  code text NOT NULL, name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true, sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, code)
);
CREATE TABLE IF NOT EXISTS public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  code text NOT NULL, name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true, sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, code)
);
ALTER TABLE public.cost_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
REVOKE SELECT ON public.cost_centers, public.departments, public.projects FROM anon, authenticated;

-- 3) gl_lines dimension ustunlari
ALTER TABLE public.gl_lines
  ADD COLUMN IF NOT EXISTS cost_center_id uuid REFERENCES public.cost_centers(id),
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id),
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id);
CREATE INDEX IF NOT EXISTS idx_gl_lines_cost_center ON public.gl_lines (cost_center_id) WHERE cost_center_id IS NOT NULL;

-- 4) post_journal v2 — har qatorda ixtiyoriy dimension (backward compatible)
CREATE OR REPLACE FUNCTION public.post_journal(
  p_clinic uuid, p_type text, p_date date,
  p_source_table text, p_source_id uuid, p_memo text, p_lines jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_journal uuid; v_debit bigint := 0; v_credit bigint := 0; v_line jsonb; v_acc uuid;
BEGIN
  IF p_source_table IS NOT NULL THEN
    SELECT id INTO v_journal FROM gl_journals
      WHERE clinic_id = p_clinic AND source_table = p_source_table AND source_id = p_source_id;
    IF v_journal IS NOT NULL THEN RETURN v_journal; END IF;
  END IF;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_debit := v_debit + COALESCE((v_line->>'debit')::bigint, 0);
    v_credit := v_credit + COALESCE((v_line->>'credit')::bigint, 0);
  END LOOP;
  IF v_debit <> v_credit THEN
    RAISE EXCEPTION 'GL balans xato: debit % <> credit %', v_debit, v_credit;
  END IF;
  IF v_debit = 0 THEN RETURN NULL; END IF;
  INSERT INTO gl_journals (clinic_id, journal_date, type, source_table, source_id, memo)
    VALUES (p_clinic, p_date, p_type, p_source_table, p_source_id, p_memo) RETURNING id INTO v_journal;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT id INTO v_acc FROM chart_of_accounts WHERE clinic_id = p_clinic AND code = (v_line->>'code');
    IF v_acc IS NULL THEN RAISE EXCEPTION 'Hisob topilmadi: %', (v_line->>'code'); END IF;
    INSERT INTO gl_lines (journal_id, account_id, debit_uzs, credit_uzs, cost_center_id, department_id, project_id)
      VALUES (v_journal, v_acc,
        COALESCE((v_line->>'debit')::bigint,0), COALESCE((v_line->>'credit')::bigint,0),
        NULLIF(v_line->>'cost_center_id','')::uuid,
        NULLIF(v_line->>'department_id','')::uuid,
        NULLIF(v_line->>'project_id','')::uuid);
  END LOOP;
  RETURN v_journal;
END; $$;
