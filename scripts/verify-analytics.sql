-- =============================================================================
-- ANALITIKA — funksional tekshiruv (deploy skripti chaqiradi). Faqat o'qiydi,
-- baribir tranzaksiya oxirida ROLLBACK. Natija: "TEST_RESULT OK | ..." yoki FAIL.
-- =============================================================================
BEGIN;

DO $$
DECLARE
  c        record;
  v_from   date := (now() AT TIME ZONE 'Asia/Tashkent')::date - 30;
  v_to     date := (now() AT TIME ZONE 'Asia/Tashkent')::date;
  v_view   numeric;
  v_legs   numeric;
  v_docs   int;
  v_txdoc  int;
  v_n      int := 0;
  v_j      jsonb;
BEGIN
  FOR c IN SELECT id, name FROM clinics WHERE deleted_at IS NULL LOOP
    -- Tushum view = to'lov oyoqlari (qarzsiz, vozvrat manfiy) — bir xil ta'rif
    SELECT COALESCE(sum(revenue_uzs), 0) INTO v_view FROM daily_revenue_view
     WHERE clinic_id = c.id AND day BETWEEN v_from AND v_to;
    SELECT COALESCE(sum(amount_uzs), 0) INTO v_legs FROM transaction_payment_legs
     WHERE clinic_id = c.id AND NOT is_void AND kind IN ('payment', 'refund') AND method::text <> 'debt'
       AND (created_at AT TIME ZONE 'Asia/Tashkent')::date BETWEEN v_from AND v_to;
    IF v_view <> v_legs THEN
      RAISE EXCEPTION 'TEST_RESULT FAIL[tushum] | %: view % <> legs %', c.name, v_view, v_legs;
    END IF;

    -- Shifokorli cheklar bor bo'lsa — shifokor analitikasi bo'sh bo'lmasligi kerak
    SELECT count(*) INTO v_txdoc FROM transactions t LEFT JOIN appointments a ON a.id = t.appointment_id
     WHERE t.clinic_id = c.id AND NOT t.is_void AND t.kind = 'payment'
       AND COALESCE(t.doctor_id, a.doctor_id) IS NOT NULL
       AND EXISTS (SELECT 1 FROM transaction_items i WHERE i.transaction_id = t.id AND i.final_amount_uzs > 0)
       AND (t.created_at AT TIME ZONE 'Asia/Tashkent')::date BETWEEN v_from AND v_to;
    SELECT count(*) INTO v_docs FROM analytics_doctors(c.id, v_from, v_to) WHERE revenue_uzs > 0;
    IF v_txdoc > 0 AND v_docs = 0 THEN
      RAISE EXCEPTION 'TEST_RESULT FAIL[shifokor] | %: % ta shifokorli chek, analitika bo''sh', c.name, v_txdoc;
    END IF;

    -- Qolgan funksiyalar xatosiz ishlashi
    PERFORM * FROM analytics_services(c.id, v_from, v_to, 20);
    PERFORM * FROM analytics_heatmap(c.id, v_from, v_to);
    v_j := analytics_period_extras(c.id, v_from, v_to);
    v_j := analytics_patient_segments(c.id);
    IF (v_j #>> '{summary,total}')::int <> (SELECT count(*) FROM patients
                                            WHERE clinic_id = c.id AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'TEST_RESULT FAIL[segment] | %: jami bemor mos emas', c.name;
    END IF;
    PERFORM * FROM analytics_query(c.id, 'time', 'day', v_from, v_to);
    v_n := v_n + 1;
  END LOOP;

  RAISE NOTICE 'TEST_RESULT OK | % klinika: tushum=legs, shifokorlar, xizmatlar, heatmap, segmentlar, BI', v_n;
END $$;

ROLLBACK;
