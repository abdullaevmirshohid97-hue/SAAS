-- =============================================================================
-- ORQAGA QAYTARISH — 20260814000006_pharmacy_void_receipt
-- =============================================================================
-- Nima qaytariladi:
--   1) pharmacy_void_receipt() funksiyasi
--   2) pharmacy_receipts dagi is_void / voided_at / voided_by / voided_reason
--
-- MUHIM: agar bu funksiya bilan ALLAQACHON prixod bekor qilingan bo'lsa,
-- ustunlarni o'chirish "qaysi prixod bekor qilingani" ma'lumotini yo'qotadi,
-- LEKIN ombor va daftardagi teskari yozuvlar O'Z O'RNIDA QOLADI (ular alohida
-- qatorlar). Ya'ni raqamlar buzilmaydi — faqat belgi yo'qoladi.
--
-- Shuning uchun tartib: AVVAL 1-bandni bajarib holatni ko'ring.
--
-- TARTIB:
--   git revert <commit>          # kod (API endpoint + UI)
--   psql "$DATABASE_URL" -f scripts/rollback-20260814-void-receipt.sql

-- ── 1) Holatni ko'rish: bu funksiya bilan nechta prixod bekor qilingan? ────
SELECT
  count(*)                            AS jami_prixod,
  count(*) FILTER (WHERE is_void)     AS bekor_qilingan,
  min(voided_at)                      AS birinchi_bekor,
  max(voided_at)                      AS oxirgi_bekor
FROM pharmacy_receipts;

-- Bekor qilinganlar ro'yxati (zaxira uchun ko'chirib oling)
SELECT id, receipt_no, supplier_id, total_cost_uzs, voided_at, voided_by, voided_reason
  FROM pharmacy_receipts
 WHERE is_void
 ORDER BY voided_at DESC;

-- ── 2) Zaxira ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS _rollback_void_receipt_20260814 AS
SELECT id AS receipt_id, is_void, voided_at, voided_by, voided_reason
  FROM pharmacy_receipts
 WHERE is_void;

-- ── 3) Funksiya va ustunlarni olib tashlash ───────────────────────────────
DROP FUNCTION IF EXISTS public.pharmacy_void_receipt(UUID, UUID, UUID, TEXT);

DROP INDEX IF EXISTS idx_pharmacy_receipts_active;

ALTER TABLE pharmacy_receipts
  DROP COLUMN IF EXISTS is_void,
  DROP COLUMN IF EXISTS voided_at,
  DROP COLUMN IF EXISTS voided_by,
  DROP COLUMN IF EXISTS voided_reason;

-- ── 4) Tekshirish ─────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='pharmacy_receipts'
      AND column_name='is_void')                       AS ustun_qoldimi_0_kerak,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='pharmacy_void_receipt') AS funksiya_qoldimi_0_kerak,
  (SELECT count(*) FROM pharmacy_receipts)             AS prixodlar_soni,
  (SELECT count(*) FROM _rollback_void_receipt_20260814) AS zaxiraga_olingan;

-- ── QAYTA TIKLASH ─────────────────────────────────────────────────────────
-- Migratsiyani qayta qo'llang, so'ng:
--
--   UPDATE pharmacy_receipts r
--      SET is_void = b.is_void, voided_at = b.voided_at,
--          voided_by = b.voided_by, voided_reason = b.voided_reason
--     FROM _rollback_void_receipt_20260814 b
--    WHERE r.id = b.receipt_id;
--
--   DROP TABLE _rollback_void_receipt_20260814;
