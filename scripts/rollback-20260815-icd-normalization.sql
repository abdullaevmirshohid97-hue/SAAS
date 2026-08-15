-- =============================================================================
-- ORQAGA QAYTARISH — 20260815000001_icd_normalization
--                   + 20260815000002_icd_usage_pk_fix (ikkalasini ham qamraydi)
-- =============================================================================
-- Nima qaytariladi:
--   1) icd11_codes jadvali (bo'sh bo'lsa xavfsiz o'chadi)
--   2) doctor_icd_usage.code_system ustuni + trigger
--   3) doctor_icd_usage.code_fkey — ASL qattiq FK ga qaytariladi
--   4) search_diagnosis_codes() funksiyasi
--
-- MUHIM: 3-band FAQAT hamma qator code_system='icd10' bo'lsa xavfsiz.
-- Agar biror ICD-11 sevimli/oxirgi yozuv qo'shilgan bo'lsa, qattiq FK
-- qo'yishga urinish XATO BERADI (chunki ICD-11 kodlari icd10_codes da yo'q).
-- Shuning uchun 0-band bilan avval TEKSHIRING.
--
-- TARTIB:
--   git revert <commit>          # kod (API + frontend)
--   psql "$DATABASE_URL" -f scripts/rollback-20260815-icd-normalization.sql

-- ── 0) TEKSHIRISH: ICD-11 yozuvlari bormi? ─────────────────────────────────
SELECT code_system, count(*) FROM doctor_icd_usage GROUP BY code_system;
-- Agar 'icd11' qatori 0 dan katta bo'lsa — pastdagi 3-bandni ISHLATMANG,
-- avval o'sha yozuvlarni qo'lda ko'rib chiqing (o'chirish yoki saqlab qolish).

-- ── 1) Zaxira ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS _rollback_icd_usage_20260815 AS
SELECT * FROM doctor_icd_usage WHERE code_system = 'icd11';

CREATE TABLE IF NOT EXISTS _rollback_icd11_codes_20260815 AS
SELECT * FROM icd11_codes;

-- ── 2) Funksiya va trigger'ni olib tashlash ────────────────────────────────
DROP FUNCTION IF EXISTS public.search_diagnosis_codes(TEXT, TEXT, INTEGER);
DROP TRIGGER IF EXISTS trg_doctor_icd_usage_check_code ON doctor_icd_usage;
DROP FUNCTION IF EXISTS public.check_doctor_icd_usage_code();

-- ── 3) ICD-11 yozuvlarini olib tashlash (agar 0-bandda 0 chiqqan bo'lsa) ──
DELETE FROM doctor_icd_usage WHERE code_system = 'icd11';

-- PK (20260815000002 da user_id+code_system+code ga kengaytirilgan edi)
-- code_system ustuni bilan bog'liq — ustunni o'chirishdan oldin asl
-- (user_id, code) PK'ga qaytariladi.
ALTER TABLE doctor_icd_usage DROP CONSTRAINT IF EXISTS doctor_icd_usage_pkey;
ALTER TABLE doctor_icd_usage
  DROP COLUMN IF EXISTS code_system;
ALTER TABLE doctor_icd_usage
  ADD CONSTRAINT doctor_icd_usage_pkey PRIMARY KEY (user_id, code);

-- Asl qattiq FK'ni tiklash.
ALTER TABLE doctor_icd_usage
  ADD CONSTRAINT doctor_icd_usage_code_fkey
  FOREIGN KEY (code) REFERENCES icd10_codes(code) ON DELETE CASCADE;

-- ── 4) icd11_codes jadvalini o'chirish ──────────────────────────────────────
DROP TABLE IF EXISTS icd11_codes;

-- ── 5) Tekshirish ────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.tables
    WHERE table_schema='public' AND table_name='icd11_codes')      AS icd11_jadval_0_kerak,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='doctor_icd_usage'
      AND column_name='code_system')                                AS ustun_0_kerak,
  (SELECT count(*) FROM pg_constraint
    WHERE conname='doctor_icd_usage_code_fkey')                      AS fk_1_kerak,
  (SELECT count(*) FROM doctor_icd_usage)                            AS jami_yozuv;

-- ── QAYTA TIKLASH ────────────────────────────────────────────────────────
-- Migratsiyani qayta qo'llang, so'ng:
--   INSERT INTO icd11_codes SELECT * FROM _rollback_icd11_codes_20260815;
--   INSERT INTO doctor_icd_usage SELECT * FROM _rollback_icd_usage_20260815;
--   DROP TABLE _rollback_icd11_codes_20260815, _rollback_icd_usage_20260815;
