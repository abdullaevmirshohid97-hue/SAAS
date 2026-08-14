-- =============================================================================
-- A4 hujjat blankasi sozlamalari — clinics.document_settings
-- =============================================================================
-- `receipt_settings` ning ukasi: chek sozlamalari o'sha yerda, A4 hujjatlar
-- (tashxis xulosasi, retsept, yo'llanma, rozilik) blankasi esa shu yerda.
--
-- Nega jsonb: sarlavha/kolontitul tarkibi, bemor maydonlari to'plami va muhr
-- har klinikada boshqacha. Har biri uchun alohida ustun qo'shish jadvalni
-- shishiradi va har o'zgarishda migratsiya talab qiladi.
--
-- Litsenziya raqami ham shu yerda erkin matn — alohida ustun kerak emas.
--
-- Kutilayotgan tuzilma (hammasi ixtiyoriy, kod standart qiymat beradi):
-- {
--   "show_logo": true,
--   "name_source": "name" | "legal_name",
--   "show_address": true,
--   "show_phone": true,
--   "show_email": false,
--   "license_text": "Litsenziya AA-1234, 01.01.2026",
--   "footer_text": "",
--   "show_signature": true,
--   "show_stamp": true,
--   "patient_fields": ["dob", "gender", "mrn"]
-- }
-- patient_fields ruxsat etilgan qiymatlar: dob, gender, phone, address,
-- mrn, pinfl, passport. F.I.Sh. har doim chiqadi, ro'yxatga kirmaydi.

ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS document_settings JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN clinics.document_settings IS
  'A4 blanka sozlamalari (sarlavha, bemor maydonlari, imzo/muhr). receipt_settings ning A4 varianti.';
