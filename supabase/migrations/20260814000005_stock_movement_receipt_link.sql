-- =============================================================================
-- Dorixona: prixod harakatlarini o'z hujjatiga bog'lash
-- =============================================================================
-- A yo'nalishi (1C: hujjat → registr) ning BIRINCHI va eng xavfsiz qadami.
--
-- Prod o'lchovi (2026-08-14):
--   kind='out' (sotuv)   1206 harakat — 1206 tasida sale_id  ✅ izlanadi
--   kind='in'  (prixod)   140 harakat —  120 tasida MANBA YO'Q ❌
--
-- pharmacy_receipts (63 hujjat) mavjud, lekin harakatlar ularga ishora
-- qilmasdi: kodda `receiptId` o'zgaruvchisi bor edi, movement yozuviga
-- qo'shilmagan (pharmacy.module.ts ~761-qator).
--
-- BU MIGRATSIYA PUL HISOB-KITOBIGA TEGMAYDI.
-- Faqat nullable ustun + FK + indeks qo'shadi. Mavjud qatorlar o'zgarmaydi.
--
-- Eski 120 qator `null` bo'lib qoladi — ular uchun bog'lanish ma'lumoti
-- umuman yo'q, taxmin bilan to'ldirish noto'g'ri bo'lardi. `null` = "eski
-- oqim" degani; yangi kod faqat to'ldirilganlariga tayanadi.
--
-- ORQAGA QAYTARISH: scripts/rollback-20260814-stock-receipt-link.sql

ALTER TABLE pharmacy_stock_movements
  ADD COLUMN IF NOT EXISTS receipt_id UUID REFERENCES pharmacy_receipts(id) ON DELETE SET NULL;

-- "Bu prixod qanday harakatlar yaratdi?" so'rovi uchun.
CREATE INDEX IF NOT EXISTS idx_stock_movements_receipt
  ON pharmacy_stock_movements (receipt_id)
  WHERE receipt_id IS NOT NULL;

COMMENT ON COLUMN pharmacy_stock_movements.receipt_id IS
  'Manba prixod hujjati. NULL = 2026-08-14 dan oldingi eski yozuvlar.';
