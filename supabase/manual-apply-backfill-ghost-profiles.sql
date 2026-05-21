-- =============================================================================
-- Manual backfill: mavjud staff_profiles (position='doctor') uchun ghost
-- auth.users + profiles yaratish.
--
-- profiles.id auth.users(id)'ga FK qilingan, shuning uchun avval
-- auth.users'ga qator qo'shish kerak. Bu yerda parol "DISABLED" (bcrypt
-- hash xato — login qila olmaydi).
--
-- IDEMPOTENT: profile_id allaqachon bog'langan bo'lsa, o'tkazib yuboradi.
-- =============================================================================

-- 1) Har bir kerakli staff_profile uchun yangi UUID + parametrlar
WITH targets AS (
  SELECT
    sp.id AS staff_id,
    sp.clinic_id,
    gen_random_uuid() AS new_user_id,
    'payroll+' || substring(sp.id::text, 1, 8) || '@clary.local' AS ghost_email,
    trim(concat_ws(' ', sp.last_name, sp.first_name, sp.patronymic)) AS full_name,
    sp.phone,
    sp.salary_percent,
    sp.salary_fixed_uzs
  FROM staff_profiles sp
  WHERE sp.position = 'doctor'
    AND sp.profile_id IS NULL
    AND sp.is_active = true
),
-- 2) auth.users ga qator qo'shish (parolsiz — login qila olmaydi)
ins_users AS (
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_user_meta_data, raw_app_meta_data,
    created_at, updated_at
  )
  SELECT
    t.new_user_id,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated',
    'authenticated',
    t.ghost_email,
    -- DISABLED — bcrypt format'da emas, login mumkin bo'lmaydi
    'DISABLED-GHOST-USER-NO-LOGIN',
    now(),
    jsonb_build_object('ghost', true, 'source', 'staff_profiles', 'staff_profile_id', t.staff_id),
    jsonb_build_object('provider', 'ghost', 'providers', ARRAY['ghost']),
    now(),
    now()
  FROM targets t
  RETURNING id, email
),
-- 3) profiles ga qator qo'shish
ins_profiles AS (
  INSERT INTO profiles (id, clinic_id, email, full_name, phone, role, is_active)
  SELECT
    t.new_user_id,
    t.clinic_id,
    t.ghost_email,
    t.full_name,
    t.phone,
    'doctor',
    true
  FROM targets t
  RETURNING id, clinic_id
),
-- 4) staff_profiles.profile_id ni bog'lash
linked AS (
  UPDATE staff_profiles sp
     SET profile_id = t.new_user_id,
         updated_at = now()
    FROM targets t
   WHERE sp.id = t.staff_id
   RETURNING sp.id AS staff_profile_id, sp.clinic_id, t.new_user_id AS profile_id,
             t.salary_percent, t.salary_fixed_uzs
)
-- 5) Anketadagi salary_percent / salary_fixed_uzs ni payroll ga sync
INSERT INTO doctor_commission_rates (
  clinic_id, doctor_id, service_id, percent, fixed_uzs, valid_from
)
SELECT
  l.clinic_id,
  l.profile_id,
  NULL,
  COALESCE(l.salary_percent, 0),
  COALESCE(l.salary_fixed_uzs, 0),
  CURRENT_DATE
FROM linked l
WHERE COALESCE(l.salary_percent, 0) > 0 OR COALESCE(l.salary_fixed_uzs, 0) > 0;

-- Tasdiqlash
SELECT
  COUNT(*) AS shifokorlar_jami,
  COUNT(*) FILTER (WHERE profile_id IS NOT NULL) AS payrollga_ulangan
  FROM staff_profiles
 WHERE position = 'doctor' AND is_active = true;
