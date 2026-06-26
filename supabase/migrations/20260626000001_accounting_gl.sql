-- =============================================================================
-- Accounting Spine — double-entry General Ledger (Pillar 1 v1, 1C falsafasi)
-- Strategiya: trigger-driven projection. Mavjud modullar O'ZGARMAYDI; har pul
-- hodisasi (transactions, expenses) balansli journal sifatida GL'ga post qiladi.
-- Idempotent (1 manba qatori -> 1 journal). Trigger EXCEPTION-SAFE: GL xatosi
-- hech qachon asosiy to'lov/xarajatni bloklamaydi. Cash-basis (accrual = v2).
-- =============================================================================

-- Hisoblar rejasi (chart of accounts)
CREATE TABLE IF NOT EXISTS public.chart_of_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('asset','liability','income','expense','equity')),
  is_postable boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, code)
);

CREATE TABLE IF NOT EXISTS public.gl_journals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  journal_date date NOT NULL,
  type text NOT NULL,
  source_table text,
  source_id uuid,
  memo text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gl_journal_source
  ON public.gl_journals (clinic_id, source_table, source_id) WHERE source_table IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gl_journals_clinic_date ON public.gl_journals (clinic_id, journal_date);

CREATE TABLE IF NOT EXISTS public.gl_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id uuid NOT NULL REFERENCES public.gl_journals(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.chart_of_accounts(id),
  debit_uzs bigint NOT NULL DEFAULT 0,
  credit_uzs bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gl_lines_journal ON public.gl_lines (journal_id);
CREATE INDEX IF NOT EXISTS idx_gl_lines_account ON public.gl_lines (account_id);

-- Standart hisoblar rejasini seed (idempotent)
CREATE OR REPLACE FUNCTION public.seed_chart_of_accounts(p_clinic uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO chart_of_accounts (clinic_id, code, name, type) VALUES
    (p_clinic, '1010', 'Kassa', 'asset'),
    (p_clinic, '1020', 'Seyf', 'asset'),
    (p_clinic, '1030', 'Bank / Plastik', 'asset'),
    (p_clinic, '1200', 'Bemor qarzi (AR)', 'asset'),
    (p_clinic, '2100', 'Yetkazib beruvchi qarzi (AP)', 'liability'),
    (p_clinic, '2300', 'QQS to''lov', 'liability'),
    (p_clinic, '3000', 'Kapital', 'equity'),
    (p_clinic, '4000', 'Xizmat daromadi', 'income'),
    (p_clinic, '4100', 'Dorixona daromadi', 'income'),
    (p_clinic, '5000', 'Umumiy xarajat', 'expense')
  ON CONFLICT (clinic_id, code) DO NOTHING;
$$;

-- Balansli journal post (idempotent + balans majburiy)
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
    INSERT INTO gl_lines (journal_id, account_id, debit_uzs, credit_uzs)
      VALUES (v_journal, v_acc, COALESCE((v_line->>'debit')::bigint,0), COALESCE((v_line->>'credit')::bigint,0));
  END LOOP;
  RETURN v_journal;
END; $$;

-- Cash hisob kodi (manba + usul bo'yicha)
CREATE OR REPLACE FUNCTION public.gl_cash_code(p_method text, p_source text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_method = 'cash' AND p_source = 'safe' THEN '1020'
    WHEN p_method = 'cash' THEN '1010'
    ELSE '1030'
  END;
$$;

-- Transaction -> journal
CREATE OR REPLACE FUNCTION public.gl_post_tx(t public.transactions)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cash text; v_amt bigint;
BEGIN
  IF t.is_void THEN RETURN; END IF;
  IF t.kind NOT IN ('payment','deposit','refund') THEN RETURN; END IF;
  v_cash := gl_cash_code(t.payment_method::text, t.source::text);
  v_amt := t.amount_uzs;
  IF t.kind IN ('payment','deposit') THEN
    PERFORM post_journal(t.clinic_id, 'sale', t.created_at::date, 'transactions', t.id, 'Tushum',
      jsonb_build_array(
        jsonb_build_object('code', v_cash, 'debit', v_amt, 'credit', 0),
        jsonb_build_object('code', '4000', 'debit', 0, 'credit', v_amt)));
  ELSIF t.kind = 'refund' THEN
    PERFORM post_journal(t.clinic_id, 'refund', t.created_at::date, 'transactions', t.id, 'Qaytarish',
      jsonb_build_array(
        jsonb_build_object('code', '4000', 'debit', v_amt, 'credit', 0),
        jsonb_build_object('code', v_cash, 'debit', 0, 'credit', v_amt)));
  END IF;
END; $$;

-- Expense -> journal
CREATE OR REPLACE FUNCTION public.gl_post_exp(e public.expenses)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cash text;
BEGIN
  v_cash := gl_cash_code(COALESCE(e.payment_method::text,'cash'), 'cash_drawer');
  PERFORM post_journal(e.clinic_id, 'expense', e.expense_date, 'expenses', e.id, COALESCE(e.description,'Xarajat'),
    jsonb_build_array(
      jsonb_build_object('code', '5000', 'debit', e.amount_uzs, 'credit', 0),
      jsonb_build_object('code', v_cash, 'debit', 0, 'credit', e.amount_uzs)));
END; $$;

-- Triggerlar (EXCEPTION-SAFE — GL xatosi asosiy yozuvni bloklamaydi)
CREATE OR REPLACE FUNCTION public.trg_gl_tx() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN BEGIN PERFORM gl_post_tx(NEW); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'GL tx % post xato: %', NEW.id, SQLERRM; END; RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS gl_after_tx ON public.transactions;
CREATE TRIGGER gl_after_tx AFTER INSERT ON public.transactions FOR EACH ROW EXECUTE FUNCTION trg_gl_tx();

CREATE OR REPLACE FUNCTION public.trg_gl_exp() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN BEGIN PERFORM gl_post_exp(NEW); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'GL exp % post xato: %', NEW.id, SQLERRM; END; RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS gl_after_exp ON public.expenses;
CREATE TRIGGER gl_after_exp AFTER INSERT ON public.expenses FOR EACH ROW EXECUTE FUNCTION trg_gl_exp();

-- Yangi klinikaga avto-seed
CREATE OR REPLACE FUNCTION public.trg_seed_coa() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN BEGIN PERFORM seed_chart_of_accounts(NEW.id); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'COA seed xato %: %', NEW.id, SQLERRM; END; RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS gl_seed_coa ON public.clinics;
CREATE TRIGGER gl_seed_coa AFTER INSERT ON public.clinics FOR EACH ROW EXECUTE FUNCTION trg_seed_coa();

-- Mavjud klinikalarga seed
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT id FROM clinics LOOP PERFORM seed_chart_of_accounts(c.id); END LOOP;
END $$;

-- Tarixiy backfill (idempotent) — loop o'zgaruvchisi rowtype bo'lishi shart
DO $$ DECLARE t public.transactions; e public.expenses; BEGIN
  FOR t IN SELECT * FROM transactions LOOP PERFORM gl_post_tx(t); END LOOP;
  FOR e IN SELECT * FROM expenses LOOP PERFORM gl_post_exp(e); END LOOP;
END $$;

-- RLS — barcha amallar API service_role orqali
ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gl_journals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gl_lines ENABLE ROW LEVEL SECURITY;
REVOKE SELECT ON public.chart_of_accounts, public.gl_journals, public.gl_lines FROM anon, authenticated;
