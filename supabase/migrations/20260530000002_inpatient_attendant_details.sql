-- =============================================================================
-- Clary v2 — Migration: qarovchi (attendant) qo'shimcha ma'lumotlari
--
-- Qarovchi haqida to'liqroq ma'lumot — chiqish hisob-fakturasi va batafsil
-- sahifada ko'rsatish uchun: telefon, yosh, jinsi.
-- =============================================================================

ALTER TABLE inpatient_stays
  ADD COLUMN IF NOT EXISTS attendant_phone TEXT,
  ADD COLUMN IF NOT EXISTS attendant_age INT,
  ADD COLUMN IF NOT EXISTS attendant_gender TEXT;

COMMENT ON COLUMN inpatient_stays.attendant_phone IS 'Qarovchi telefon raqami';
COMMENT ON COLUMN inpatient_stays.attendant_age IS 'Qarovchi yoshi';
COMMENT ON COLUMN inpatient_stays.attendant_gender IS 'Qarovchi jinsi (male/female/other)';
