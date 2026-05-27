-- Statsionar uchun alohida payroll sozlamalari. Shifokor anketasida
-- "Maosh" tabidan tashqari "Statsionar maosh" bo'limi bo'ladi.
-- Rejimlar:
--   off      : statsionarda alohida hisob YO'Q (default qoladi)
--   percent  : statsionar tushumidan foiz (kun bo'yicha hisoblanadi)
--   monthly  : oylik fix
--   bonus    : faqat admission bonusi (bir martalik, har stay'da)
-- admission_bonus_uzs — har 4 rejimda ham ishlatilishi mumkin (qo'shimcha).

ALTER TABLE public.staff_profiles
  ADD COLUMN IF NOT EXISTS inpatient_payroll_mode text NOT NULL DEFAULT 'off'
    CHECK (inpatient_payroll_mode IN ('off','percent','monthly','bonus')),
  ADD COLUMN IF NOT EXISTS inpatient_percent numeric(5,2) NOT NULL DEFAULT 0
    CHECK (inpatient_percent >= 0 AND inpatient_percent <= 100),
  ADD COLUMN IF NOT EXISTS inpatient_monthly_uzs bigint NOT NULL DEFAULT 0
    CHECK (inpatient_monthly_uzs >= 0),
  ADD COLUMN IF NOT EXISTS inpatient_admission_bonus_uzs bigint NOT NULL DEFAULT 0
    CHECK (inpatient_admission_bonus_uzs >= 0);

COMMENT ON COLUMN public.staff_profiles.inpatient_payroll_mode IS
  'Statsionar uchun payroll rejimi: off/percent/monthly/bonus';
COMMENT ON COLUMN public.staff_profiles.inpatient_admission_bonus_uzs IS
  'Har bemor yotqizishda shifokorga beriladigan bir martalik bonus (so''m)';
