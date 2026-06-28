-- =============================================================================
-- QISM 2 / E1 — Payroll → GL. Payout to'langanda (status='paid'):
--   Dr 5400 (Maosh xarajati) / Cr kassa (gl_cash_code). Cash-basis.
-- COA: 5400 (expense) + 2200 (Maosh to'lanadigan — kelajak accrual uchun).
-- Trigger EXCEPTION-SAFE + idempotent (source=doctor_payouts). Mavjud paid
-- payoutlar backfill qilinadi → GL endi maoshni aks ettiradi (kassa↓, xarajat↑).
-- =============================================================================
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
    (p_clinic, '2200', 'Maosh to''lanadigan', 'liability'),
    (p_clinic, '2300', 'QQS to''lov', 'liability'),
    (p_clinic, '3000', 'Kapital', 'equity'),
    (p_clinic, '4000', 'Xizmat daromadi', 'income'),
    (p_clinic, '4100', 'Dorixona daromadi', 'income'),
    (p_clinic, '5000', 'Umumiy xarajat', 'expense'),
    (p_clinic, '5100', 'Materiallar/Reagent xarajati', 'expense'),
    (p_clinic, '5200', 'Sug''urta komissiya/chegirma', 'expense'),
    (p_clinic, '5400', 'Maosh xarajati', 'expense')
  ON CONFLICT (clinic_id, code) DO NOTHING;
$$;
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT id FROM clinics LOOP PERFORM seed_chart_of_accounts(c.id); END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.gl_post_payout(p public.doctor_payouts)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cash text; v_amt bigint;
BEGIN
  IF p.status <> 'paid' THEN RETURN; END IF;
  v_amt := p.net_uzs;
  IF v_amt IS NULL OR v_amt <= 0 THEN RETURN; END IF;
  v_cash := gl_cash_code(COALESCE(p.method::text,'cash'), 'cash_drawer');
  PERFORM post_journal(p.clinic_id, 'payroll', COALESCE(p.paid_at::date, CURRENT_DATE), 'doctor_payouts', p.id, 'Maosh to''lovi',
    jsonb_build_array(
      jsonb_build_object('code','5400','debit',v_amt,'credit',0),
      jsonb_build_object('code',v_cash,'debit',0,'credit',v_amt)));
END; $$;

CREATE OR REPLACE FUNCTION public.trg_gl_payout() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN BEGIN PERFORM gl_post_payout(NEW); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'GL payout % xato: %', NEW.id, SQLERRM; END; RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS gl_after_payout ON public.doctor_payouts;
CREATE TRIGGER gl_after_payout AFTER INSERT OR UPDATE ON public.doctor_payouts FOR EACH ROW EXECUTE FUNCTION trg_gl_payout();

-- Backfill: mavjud to'langan payoutlar -> GL (idempotent)
DO $$ DECLARE p public.doctor_payouts; BEGIN
  FOR p IN SELECT * FROM doctor_payouts WHERE status = 'paid' LOOP PERFORM gl_post_payout(p); END LOOP;
END $$;
