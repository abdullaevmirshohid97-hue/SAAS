-- =============================================================================
-- Pillar 1 v2b — HIBRID accrual: mavjud kassa-asos GL postingiga TEGMAYDI
-- (P&L o'zgarmaydi). Ustiga AR/AP yordamchi kitob (aging) + QQS (ixtiyoriy, 0%).
--   ar_aging  — bemor qarzi (patient_ledger), FIFO yosh-bucket.
--   ap_aging  — supplier qarzi (pharmacy_/inventory_supplier_ledger), FIFO.
--   qqs_report— output VAT (transaction_items × services.qqs_percent, inclusive).
-- Hammasi READ-ONLY hisobot RPC — yangi GL journal yaratmaydi.
-- =============================================================================

-- QQS stavkasi (ixtiyoriy, default 0% = ozod) -------------------------------
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS qqs_percent numeric NOT NULL DEFAULT 0;

-- AR aging — bemor qarzdorligi (FIFO: to'lovlar eng eski charge'larga) -------
CREATE OR REPLACE FUNCTION public.ar_aging(p_clinic uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE(patient_id uuid, patient_name text, total_owed bigint,
              b0_30 bigint, b31_60 bigint, b61_90 bigint, b90_plus bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE r RECORD; c RECORD; v_pay numeric; v_apply numeric; v_owed numeric; v_age int;
        v0 bigint; v1 bigint; v2 bigint; v3 bigint;
BEGIN
  FOR r IN
    SELECT pb.patient_id AS pid, COALESCE(p.full_name, '—') AS pname
    FROM patient_balance pb JOIN patients p ON p.id = pb.patient_id
    WHERE pb.clinic_id = p_clinic AND pb.balance_uzs < 0
  LOOP
    -- jami to'lov (musbat yozuvlar) — FIFO bo'yicha eng eski charge'larga qo'llanadi
    SELECT COALESCE(sum(amount_uzs), 0) INTO v_pay
      FROM patient_ledger
      WHERE clinic_id = p_clinic AND patient_id = r.pid AND amount_uzs > 0 AND created_at::date <= p_as_of;
    v0 := 0; v1 := 0; v2 := 0; v3 := 0;
    FOR c IN
      SELECT (-amount_uzs) AS owed, created_at::date AS d
      FROM patient_ledger
      WHERE clinic_id = p_clinic AND patient_id = r.pid AND amount_uzs < 0 AND created_at::date <= p_as_of
      ORDER BY created_at ASC
    LOOP
      v_owed := c.owed;
      IF v_pay > 0 THEN
        v_apply := LEAST(v_pay, v_owed);
        v_owed := v_owed - v_apply;
        v_pay := v_pay - v_apply;
      END IF;
      IF v_owed <= 0 THEN CONTINUE; END IF;
      v_age := p_as_of - c.d;
      IF v_age <= 30 THEN v0 := v0 + v_owed;
      ELSIF v_age <= 60 THEN v1 := v1 + v_owed;
      ELSIF v_age <= 90 THEN v2 := v2 + v_owed;
      ELSE v3 := v3 + v_owed; END IF;
    END LOOP;
    IF (v0 + v1 + v2 + v3) > 0 THEN
      patient_id := r.pid; patient_name := r.pname; total_owed := v0 + v1 + v2 + v3;
      b0_30 := v0; b31_60 := v1; b61_90 := v2; b90_plus := v3;
      RETURN NEXT;
    END IF;
  END LOOP;
END $$;

-- AP aging — supplier qarzdorligi (pharmacy + inventory ledger birlashtirilgan)
CREATE OR REPLACE FUNCTION public.ap_aging(p_clinic uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE(supplier_id uuid, supplier_name text, total_owed bigint,
              b0_30 bigint, b31_60 bigint, b61_90 bigint, b90_plus bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE r RECORD; c RECORD; v_pay numeric; v_apply numeric; v_owed numeric; v_age int;
        v0 bigint; v1 bigint; v2 bigint; v3 bigint;
BEGIN
  FOR r IN
    SELECT u.sid, COALESCE(sup.name, '—') AS sname
    FROM (
      SELECT supplier_id AS sid, sum(amount_uzs) AS bal
      FROM (
        SELECT supplier_id, amount_uzs, occurred_at FROM pharmacy_supplier_ledger WHERE clinic_id = p_clinic
        UNION ALL
        SELECT supplier_id, amount_uzs, occurred_at FROM inventory_supplier_ledger WHERE clinic_id = p_clinic
      ) x WHERE occurred_at <= p_as_of
      GROUP BY supplier_id
    ) u LEFT JOIN suppliers sup ON sup.id = u.sid
    WHERE u.bal > 0
  LOOP
    SELECT COALESCE(sum(-amount_uzs), 0) INTO v_pay
      FROM (
        SELECT supplier_id, amount_uzs, occurred_at FROM pharmacy_supplier_ledger WHERE clinic_id = p_clinic
        UNION ALL
        SELECT supplier_id, amount_uzs, occurred_at FROM inventory_supplier_ledger WHERE clinic_id = p_clinic
      ) x
      WHERE x.supplier_id IS NOT DISTINCT FROM r.sid AND x.amount_uzs < 0 AND x.occurred_at <= p_as_of;
    v0 := 0; v1 := 0; v2 := 0; v3 := 0;
    FOR c IN
      SELECT amount_uzs AS owed, occurred_at AS d
      FROM (
        SELECT supplier_id, amount_uzs, occurred_at FROM pharmacy_supplier_ledger WHERE clinic_id = p_clinic
        UNION ALL
        SELECT supplier_id, amount_uzs, occurred_at FROM inventory_supplier_ledger WHERE clinic_id = p_clinic
      ) x
      WHERE x.supplier_id IS NOT DISTINCT FROM r.sid AND x.amount_uzs > 0 AND x.occurred_at <= p_as_of
      ORDER BY occurred_at ASC
    LOOP
      v_owed := c.owed;
      IF v_pay > 0 THEN
        v_apply := LEAST(v_pay, v_owed);
        v_owed := v_owed - v_apply;
        v_pay := v_pay - v_apply;
      END IF;
      IF v_owed <= 0 THEN CONTINUE; END IF;
      v_age := p_as_of - c.d;
      IF v_age <= 30 THEN v0 := v0 + v_owed;
      ELSIF v_age <= 60 THEN v1 := v1 + v_owed;
      ELSIF v_age <= 90 THEN v2 := v2 + v_owed;
      ELSE v3 := v3 + v_owed; END IF;
    END LOOP;
    IF (v0 + v1 + v2 + v3) > 0 THEN
      supplier_id := r.sid; supplier_name := r.sname; total_owed := v0 + v1 + v2 + v3;
      b0_30 := v0; b31_60 := v1; b61_90 := v2; b90_plus := v3;
      RETURN NEXT;
    END IF;
  END LOOP;
END $$;

-- QQS hisoboti — output VAT (narx QQS-ichida deb hisoblanadi: amt*rate/(100+rate))
-- Input VAT hozircha 0 (xaridlarda QQS kuzatilmaydi — kelajak versiyada).
CREATE OR REPLACE FUNCTION public.qqs_report(p_clinic uuid, p_from date, p_to date)
RETURNS TABLE(taxable_base bigint, output_vat bigint, input_vat bigint, net_payable bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH taxable AS (
    SELECT ti.final_amount_uzs::numeric AS amt, s.qqs_percent AS rate
    FROM transaction_items ti
    JOIN transactions t ON t.id = ti.transaction_id
    JOIN services s ON s.id = ti.service_id
    WHERE ti.clinic_id = p_clinic
      AND ti.created_at::date BETWEEN p_from AND p_to
      AND t.is_void = false
      AND t.kind IN ('payment','deposit')
      AND s.qqs_percent > 0
  )
  SELECT
    COALESCE(sum(amt), 0)::bigint AS taxable_base,
    COALESCE(sum(round(amt * rate / (100 + rate))), 0)::bigint AS output_vat,
    0::bigint AS input_vat,
    COALESCE(sum(round(amt * rate / (100 + rate))), 0)::bigint AS net_payable
  FROM taxable;
$$;
