-- =============================================================================
-- ORQAGA QAYTARISH — 20260814000005_stock_movement_receipt_link
-- =============================================================================
-- Nima qaytariladi: pharmacy_stock_movements.receipt_id ustuni.
--
-- XAVFSIZLIK:
--   Bu ustun FAQAT izlanuvchanlik uchun. Ombor qoldig'i, tannarx, kassa,
--   yetkazib beruvchi balansi va boshqa PUL hisob-kitoblari unga TAYANMAYDI.
--   Shuning uchun ustunni o'chirish hech qanday moliyaviy qiymatni
--   o'zgartirmaydi — faqat "bu harakat qaysi prixoddan" ma'lumoti yo'qoladi.
--
-- TARTIB:
--   1. Avval KODNI qaytaring (git revert), aks holda API yo'q ustunga
--      yozmoqchi bo'lib xato beradi.
--   2. Keyin shu skriptni ishga tushiring.
--
--   git revert <commit>          # kod
--   psql "$DATABASE_URL" -f scripts/rollback-20260814-stock-receipt-link.sql
--
-- Yoki Supabase SQL Editor'da quyidagi bloklarni ketma-ket bajaring.

-- ── 1) Avval nima yo'qotilishini KO'RING (o'chirmasdan) ─────────────────────
-- Bu so'rov nechta harakat bog'lanishini yo'qotishini ko'rsatadi.
SELECT
  count(*)                                    AS jami_harakatlar,
  count(receipt_id)                           AS bogliqligi_bor,
  count(*) - count(receipt_id)                AS bogliqligi_yoq
FROM pharmacy_stock_movements;

-- ── 2) Zaxira: bog'lanishlarni alohida jadvalga saqlab qo'yamiz ─────────────
-- Keyinchalik qайta tiklash kerak bo'lsa shu jadvaldan olinadi.
CREATE TABLE IF NOT EXISTS _rollback_stock_receipt_link_20260814 AS
SELECT id AS movement_id, receipt_id
  FROM pharmacy_stock_movements
 WHERE receipt_id IS NOT NULL;

-- ── 3) Indeks va ustunni olib tashlash ─────────────────────────────────────
DROP INDEX IF EXISTS idx_stock_movements_receipt;

ALTER TABLE pharmacy_stock_movements
  DROP COLUMN IF EXISTS receipt_id;

-- ── 4) Tekshirish ──────────────────────────────────────────────────────────
-- Ustun ketganini va harakatlar soni o'zgarmaganini tasdiqlaydi.
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='pharmacy_stock_movements'
      AND column_name='receipt_id')            AS ustun_qoldimi_0_bolishi_kerak,
  (SELECT count(*) FROM pharmacy_stock_movements) AS harakatlar_soni,
  (SELECT count(*) FROM _rollback_stock_receipt_link_20260814) AS zaxiraga_olingan;

-- ── QAYTA TIKLASH (agar rollback'dan keyin fikr o'zgarsa) ──────────────────
-- Migratsiyani qayta qo'llang, so'ng:
--
--   UPDATE pharmacy_stock_movements m
--      SET receipt_id = b.receipt_id
--     FROM _rollback_stock_receipt_link_20260814 b
--    WHERE m.id = b.movement_id;
--
-- Hammasi joyida bo'lgach zaxira jadvalni o'chirish mumkin:
--   DROP TABLE _rollback_stock_receipt_link_20260814;
