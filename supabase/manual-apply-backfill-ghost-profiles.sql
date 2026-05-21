-- =============================================================================
-- Manual backfill: mavjud staff_profiles (position='doctor') uchun ghost
-- profile yaratish.
--
-- Maqsad: anketada qo'shilgan, lekin login holatisiz shifokorlarni Hisob-kitob
-- (payroll) sahifasida ko'rinadigan qilish. Har bir staff_profile uchun:
--   - Yangi profiles qatori yaratiladi (login imkonisiz, role='doctor')
--   - staff_profiles.profile_id shu bilan bog'lanadi
--   - Anketadagi salary_percent / salary_fixed_uzs default rate sifatida
--     doctor_commission_rates ga qo'shiladi
--
-- IDEMPOTENT: agar profile_id allaqachon bog'langan bo'lsa — o'tkazib yuboradi.
-- =============================================================================

WITH new_profiles AS (
  INSERT INTO profiles (id, clinic_id, email, full_name, phone, role, is_active)
  SELECT
    gen_random_uuid(),
    sp.clinic_id,
    'payroll+' || substring(sp.id::text, 1, 8) || '@clary.local',
    trim(concat_ws(' ', sp.last_name, sp.first_name, sp.patronymic)),
    sp.phone,
    'doctor',
    true
  FROM staff_profiles sp
  WHERE sp.position = 'doctor'
    AND sp.profile_id IS NULL
    AND sp.is_active = true
  RETURNING id, email
),
linked AS (
  UPDATE staff_profiles sp
     SET profile_id = np.id,
         updated_at = now()
    FROM new_profiles np
   WHERE np.email = 'payroll+' || substring(sp.id::text, 1, 8) || '@clary.local'
   RETURNING sp.id AS staff_profile_id, sp.clinic_id, np.id AS profile_id,
             sp.salary_percent, sp.salary_fixed_uzs
)
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

-- Tasdiqlash uchun
SELECT
  COUNT(*) AS shifokorlar_jami,
  COUNT(*) FILTER (WHERE profile_id IS NOT NULL) AS payrollga_ulangan
  FROM staff_profiles
 WHERE position = 'doctor' AND is_active = true;
