-- =============================================================================
-- TARIF IMKONIYATLARI — funksional tekshiruv (deploy skripti chaqiradi).
-- Tranzaksiya oxirida ROLLBACK: bazada hech narsa o'zgarmaydi.
-- Natija: "TEST_RESULT OK | ..." yoki "TEST_RESULT FAIL[...]".
-- =============================================================================
BEGIN;

DO $$
DECLARE
  c        record;
  e        jsonb;
  v_n      int := 0;
  v_plan   text;
  v_any    uuid;
  v_m      text[];
  lim      record;
BEGIN
  -- 1) Obyektlar
  IF to_regclass('public.clinic_entitlements') IS NULL OR to_regclass('public.entitlement_changes') IS NULL THEN
    RAISE EXCEPTION 'TEST_RESULT FAIL[jadval] | clinic_entitlements/entitlement_changes yo''q';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_enforce_payment_method' AND NOT tgisinternal) <> 3 THEN
    RAISE EXCEPTION 'TEST_RESULT FAIL[trigger] | to''lov turi triggeri 3 jadvalda emas';
  END IF;

  -- 2) Har bir klinika: imkoniyatlar hisoblanadi, tarif to'g'ri, limit funksiyasi ishlaydi
  FOR c IN SELECT id, name, current_plan FROM clinics WHERE deleted_at IS NULL LOOP
    e := clinic_effective_entitlements(c.id);
    IF e IS NULL OR e ->> 'plan' IS NULL THEN
      RAISE EXCEPTION 'TEST_RESULT FAIL[effective] | %: imkoniyatlar hisoblanmadi', c.name;
    END IF;
    SELECT * INTO lim FROM get_clinic_plan_limits(c.id);
    IF lim.plan_code IS NULL THEN
      RAISE EXCEPTION 'TEST_RESULT FAIL[limits] | %: get_clinic_plan_limits bo''sh', c.name;
    END IF;
    v_n := v_n + 1;
  END LOOP;

  -- 3) Deploy paytida hech kim cheklanmagan bo'lishi kerak (eski xulq saqlanadi)
  IF EXISTS (SELECT 1 FROM plans WHERE entitlements <> '{}'::jsonb)
     AND NOT EXISTS (SELECT 1 FROM entitlement_changes) THEN
    RAISE EXCEPTION 'TEST_RESULT FAIL[default] | tariflarda kutilmagan cheklov bor';
  END IF;

  -- 4) Funksional: kelishuv → to'lov turi cheklovi (ROLLBACK bilan)
  SELECT id INTO v_any FROM clinics WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1;
  IF v_any IS NOT NULL THEN
    INSERT INTO clinic_entitlements (clinic_id, overrides)
    VALUES (v_any, '{"payments":{"methods":["cash"]},"modules":{"lab":false}}')
    ON CONFLICT (clinic_id) DO UPDATE SET overrides = EXCLUDED.overrides, valid_until = NULL;
    v_m := clinic_allowed_payment_methods(v_any);
    IF v_m IS DISTINCT FROM ARRAY['cash'] THEN
      RAISE EXCEPTION 'TEST_RESULT FAIL[payments] | kutilgan {cash}, keldi %', v_m;
    END IF;
    IF (clinic_effective_entitlements(v_any) #>> '{modules,lab}')::boolean IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'TEST_RESULT FAIL[modules] | lab yopilmadi';
    END IF;
  END IF;

  RAISE NOTICE 'TEST_RESULT OK | % klinika: imkoniyatlar, limitlar, to''lov triggeri, kelishuv', v_n;
END $$;

ROLLBACK;
