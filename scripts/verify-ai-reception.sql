-- =============================================================================
-- AI QABULXONA — funksional tekshiruv (deploy-ai-reception.sh chaqiradi)
-- =============================================================================
-- Tranzaksiya oxirida ATAYLAB bekor qilinadi (ROLLBACK) — bazada test yozuvi
-- QOLMAYDI. Natija bitta qatorda: "TEST_RESULT OK | ..." yoki "TEST_RESULT FAIL[...]".
-- =============================================================================
BEGIN;

DO $$
DECLARE
  r         record;
  v_id      uuid;
  v_second  text := 'yozildi';
  v_start   timestamptz := date_trunc('hour', now()) + interval '400 days';
  v_cols    int;
  v_missing text;
BEGIN
  -- 0) Jadvallar oldindan (boshqa yo'l bilan) yaratilgan bo'lsa ham, kod kutgan
  --    HAMMA ustun borligini tekshiramiz: CREATE TABLE IF NOT EXISTS eski/boshqa
  --    variantdagi jadvalni o'zgartirmaydi.
  SELECT string_agg(w.t || '.' || w.c, ', ' ORDER BY w.t, w.c) INTO v_missing
    FROM (VALUES
      ('doctor_booking_profiles', 'staff_id'), ('doctor_booking_profiles', 'clinic_id'),
      ('doctor_booking_profiles', 'booking_enabled'), ('doctor_booking_profiles', 'medical_category'),
      ('doctor_booking_profiles', 'academic_degree'), ('doctor_booking_profiles', 'academic_title'),
      ('doctor_booking_profiles', 'experience_years'), ('doctor_booking_profiles', 'slot_minutes'),
      ('doctor_booking_profiles', 'keywords'), ('doctor_booking_profiles', 'public_note'),
      ('doctor_booking_profiles', 'service_id'), ('doctor_booking_profiles', 'sort_order'),
      ('doctor_booking_profiles', 'updated_at'), ('doctor_booking_profiles', 'updated_by'),
      ('doctor_schedule_rules', 'id'), ('doctor_schedule_rules', 'clinic_id'),
      ('doctor_schedule_rules', 'staff_id'), ('doctor_schedule_rules', 'weekday'),
      ('doctor_schedule_rules', 'start_time'), ('doctor_schedule_rules', 'end_time'),
      ('doctor_schedule_rules', 'capacity'),
      ('doctor_time_off', 'id'), ('doctor_time_off', 'clinic_id'), ('doctor_time_off', 'staff_id'),
      ('doctor_time_off', 'starts_at'), ('doctor_time_off', 'ends_at'), ('doctor_time_off', 'reason'),
      ('doctor_time_off', 'created_by'),
      ('ai_reception_settings', 'clinic_id'), ('ai_reception_settings', 'mode'),
      ('ai_reception_settings', 'after_hours_mode'), ('ai_reception_settings', 'ai_allowed'),
      ('ai_reception_settings', 'monthly_call_limit'), ('ai_reception_settings', 'assistant_name'),
      ('ai_reception_settings', 'greeting'), ('ai_reception_settings', 'voicemail_prompt'),
      ('ai_reception_settings', 'russian_hint'), ('ai_reception_settings', 'voice'),
      ('ai_reception_settings', 'speech_speed'), ('ai_reception_settings', 'booking_horizon_days'),
      ('ai_reception_settings', 'min_lead_minutes'), ('ai_reception_settings', 'allow_new_patients'),
      ('ai_reception_settings', 'transfer_phone'), ('ai_reception_settings', 'extra_instructions'),
      ('ai_reception_settings', 'record_calls'), ('ai_reception_settings', 'max_call_seconds'),
      ('ai_reception_settings', 'notify_owner_telegram'), ('ai_reception_settings', 'telegram_ai_chat'),
      ('ai_reception_settings', 'confirm_telegram'), ('ai_reception_settings', 'confirm_sms'),
      ('ai_reception_settings', 'reminder_enabled'), ('ai_reception_settings', 'reminder_hour'),
      ('ai_reception_settings', 'reminder_sms'), ('ai_reception_settings', 'mark_no_show'),
      ('ai_reception_settings', 'updated_at'), ('ai_reception_settings', 'updated_by'),
      ('ai_phone_lines', 'id'), ('ai_phone_lines', 'clinic_id'), ('ai_phone_lines', 'line_key'),
      ('ai_phone_lines', 'phone_number'), ('ai_phone_lines', 'forwarded_from'),
      ('ai_phone_lines', 'label'), ('ai_phone_lines', 'is_active'), ('ai_phone_lines', 'created_at'),
      ('ai_calls', 'id'), ('ai_calls', 'clinic_id'), ('ai_calls', 'line_id'), ('ai_calls', 'channel'),
      ('ai_calls', 'mode'), ('ai_calls', 'status'), ('ai_calls', 'external_id'),
      ('ai_calls', 'caller_phone'), ('ai_calls', 'patient_id'), ('ai_calls', 'appointment_id'),
      ('ai_calls', 'outcome'), ('ai_calls', 'needs_callback'), ('ai_calls', 'callback_note'),
      ('ai_calls', 'callback_done_at'), ('ai_calls', 'callback_done_by'), ('ai_calls', 'started_at'),
      ('ai_calls', 'last_activity_at'), ('ai_calls', 'ended_at'), ('ai_calls', 'duration_sec'),
      ('ai_calls', 'transcript'), ('ai_calls', 'llm_state'), ('ai_calls', 'summary'),
      ('ai_calls', 'recording_path'), ('ai_calls', 'stt_seconds'), ('ai_calls', 'tts_chars'),
      ('ai_calls', 'llm_input_tokens'), ('ai_calls', 'llm_output_tokens'), ('ai_calls', 'est_cost_uzs'),
      ('ai_calls', 'meta'), ('ai_calls', 'error')
    ) AS w(t, c)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns ic
      WHERE ic.table_schema = 'public' AND ic.table_name = w.t AND ic.column_name = w.c);
  IF v_missing IS NOT NULL THEN
    RAISE NOTICE 'TEST_RESULT FAIL[ustun yo''q: %]', v_missing;
    RETURN;
  END IF;

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
