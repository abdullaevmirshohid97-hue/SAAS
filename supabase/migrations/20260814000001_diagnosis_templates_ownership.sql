-- =============================================================================
-- Tashxis shablonlari — SHAXSIY egalik
-- =============================================================================
-- Muammo: listTemplates faqat clinic_id bo'yicha filtrlardi, ya'ni kardiolog
-- stomatologning, ginekolog terapevtning shablonlarini ko'rardi. Ro'yxat
-- aralashib ketgani uchun hech kim ishlatmasdi — prod'da 0 ta shablon.
--
-- Yechim: `visibility` ustuni.
--   'private' (standart) — faqat yaratgan shifokor ko'radi
--   'clinic'            — butun klinika ko'radi (bosh shifokor standarti)
-- Egasi `created_by` (jadval allaqachon shu ustunga ega).
--
-- Jadval BO'SH (0 qator) — ma'lumot ko'chirish shart emas, xavf yo'q.

ALTER TABLE diagnosis_templates
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'diagnosis_templates_visibility_chk'
  ) THEN
    ALTER TABLE diagnosis_templates
      ADD CONSTRAINT diagnosis_templates_visibility_chk
      CHECK (visibility IN ('private', 'clinic'));
  END IF;
END $$;

-- Shifokor o'z shablonlarini ochganda: clinic_id + created_by bo'yicha qidiriladi.
CREATE INDEX IF NOT EXISTS idx_diagnosis_templates_owner
  ON diagnosis_templates (clinic_id, created_by)
  WHERE is_active;

-- Klinika umumiy shablonlari ro'yxati.
CREATE INDEX IF NOT EXISTS idx_diagnosis_templates_shared
  ON diagnosis_templates (clinic_id, visibility)
  WHERE is_active AND visibility = 'clinic';

COMMENT ON COLUMN diagnosis_templates.visibility IS
  'private = faqat created_by ko''radi; clinic = butun klinika ko''radi';
