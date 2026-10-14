-- =============================================================================
-- AI QABULXONA — funksional tekshiruv (deploy-ai-reception.sh chaqiradi)
-- =============================================================================
-- Tranzaksiya oxirida ATAYLAB bekor qilinadi (ROLLBACK) — bazada test yozuvi
-- QOLMAYDI. Natija bitta qatorda: "TEST_RESULT OK | ..." yoki "TEST_RESULT FAIL[...]".
-- =============================================================================
BEGIN;

DO $$
DECLARE
  r        record;
  v_id     uuid;
  v_second text := 'yozildi';
  v_start  timestamptz := date_trunc('hour', now()) + interval '400 days';
  v_cols   int;
BEGIN
  -- 1) Ustunlar va jadvallar
  SELECT count(*) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'appointments'
     AND column_name IN ('source', 'ai_call_id', 'patient_confirmed_at');
  IF v_cols <> 3 THEN
    RAISE NOTICE 'TEST_RESULT FAIL[appointments ustunlari: %/3]', v_cols;
    RETURN;
  END IF;

  IF to_regclass('public.doctor_booking_profiles') IS NULL
     OR to_regclass('public.doctor_schedule_rules') IS NULL
     OR to_regclass('public.doctor_time_off') IS NULL
     OR to_regclass('public.ai_reception_settings') IS NULL
     OR to_regclass('public.ai_phone_lines') IS NULL
     OR to_regclass('public.ai_calls') IS NULL THEN
    RAISE NOTICE 'TEST_RESULT FAIL[jadval yetishmaydi]';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'call-recordings' AND NOT public) THEN
    RAISE NOTICE 'TEST_RESULT FAIL[call-recordings bucket yo''q yoki public]';
    RETURN;
  END IF;

  -- 2) booking_reserve: birinchi yozuv o'tadi, aynan o'sha vaqtga ikkinchisi rad etiladi
  SELECT a.clinic_id, a.doctor_id, a.patient_id, a.created_by INTO r
    FROM public.appointments a
   WHERE a.doctor_id IS NOT NULL AND a.patient_id IS NOT NULL AND a.created_by IS NOT NULL
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE NOTICE 'TEST_RESULT OK | jadvallar joyida; appointments bo''sh — RPC sinovi o''tkazib yuborildi';
    RETURN;
  END IF;

  v_id := public.booking_reserve(r.clinic_id, r.doctor_id, r.patient_id, v_start, 30, 1,
                                 'ai_phone', r.created_by);
  BEGIN
    PERFORM public.booking_reserve(r.clinic_id, r.doctor_id, r.patient_id, v_start, 30, 1,
                                   'telegram', r.created_by);
  EXCEPTION WHEN OTHERS THEN
    v_second := SQLERRM;
  END;
  IF v_second NOT IN ('SLOT_TAKEN', 'ALREADY_BOOKED') THEN
    RAISE NOTICE 'TEST_RESULT FAIL[ikki marta yozildi: %]', v_second;
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.appointments
                  WHERE id = v_id AND source = 'ai_phone' AND status = 'scheduled') THEN
    RAISE NOTICE 'TEST_RESULT FAIL[yozuv source/status noto''g''ri]';
    RETURN;
  END IF;

  -- 3) O'tgan vaqtga yozib bo'lmaydi
  v_second := 'yozildi';
  BEGIN
    PERFORM public.booking_reserve(r.clinic_id, r.doctor_id, r.patient_id, now() - interval '1 hour',
                                   30, 1, 'ai_phone', r.created_by);
  EXCEPTION WHEN OTHERS THEN
    v_second := SQLERRM;
  END;
  IF v_second <> 'SLOT_IN_PAST' THEN
    RAISE NOTICE 'TEST_RESULT FAIL[o''tgan vaqt: %]', v_second;
    RETURN;
  END IF;

  RAISE NOTICE 'TEST_RESULT OK | 6 jadval + bucket joyida; booking_reserve: yozdi, ikkinchisini rad etdi, o''tgan vaqtni rad etdi';
END $$;

ROLLBACK;
