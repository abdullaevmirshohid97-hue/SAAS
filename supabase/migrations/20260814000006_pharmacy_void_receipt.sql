-- =============================================================================
-- Prixodni bekor qilish — pharmacy_void_receipt
-- =============================================================================
-- MUAMMO: sotuvni bekor qilish bor (pharmacy_void_sale — to'liq va atomar),
-- prixodni bekor qilish esa UMUMAN YO'Q edi. Xato kiritilgan prixod (noto'g'ri
-- miqdor, takroriy kiritish) omborni doimiy oshirib qo'yardi va yagona chora
-- baza ustida qo'lda operatsiya bo'lardi.
--
-- XAVFSIZLIK QOIDASI (eng muhimi):
--   Prixod FAQAT undan hech narsa sotilmagan bo'lsa bekor qilinadi.
--   Agar bitta dona bo'lsa ham sotilgan bo'lsa — funksiya RAD ETADI va
--   tushunarli xabar beradi. Sotilgan tovarni "yo'q" qilib bo'lmaydi;
--   bunday holat qaytarish (return) orqali hal qilinishi kerak.
--   Amaliyotda prixodni bekor qilish xato kiritilgandan keyin DARHOL
--   kerak bo'ladi — aynan o'shanda hech narsa sotilmagan bo'ladi.
--
-- pharmacy_void_sale bilan bir xil tamoyillar: bitta tranzaksiya,
-- ikki marta bekor qilishdan himoya, harakatlar manba hujjatga bog'lanadi.
--
-- CHEKLOV (halol qayd etamiz): prixod `medications.price_uzs` ni yangilaydi
-- va oldingi narx hech qayerda saqlanmaydi. Shuning uchun bekor qilish
-- NARXNI TIKLAMAYDI — faqat ombor, harakatlar va yetkazib beruvchi balansini
-- qaytaradi. Narxni operator qo'lda to'g'rilaydi.
--
-- ORQAGA QAYTARISH: scripts/rollback-20260814-void-receipt.sql

ALTER TABLE pharmacy_receipts
  ADD COLUMN IF NOT EXISTS is_void       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voided_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by     UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS voided_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_pharmacy_receipts_active
  ON pharmacy_receipts (clinic_id, created_at DESC)
  WHERE NOT is_void;

CREATE OR REPLACE FUNCTION public.pharmacy_void_receipt(
  p_clinic_id UUID,
  p_user_id   UUID,
  p_receipt_id UUID,
  p_reason    TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_receipt RECORD;
  v_batch   RECORD;
  v_sold    INTEGER;
BEGIN
  SELECT * INTO v_receipt
    FROM pharmacy_receipts
   WHERE id = p_receipt_id AND clinic_id = p_clinic_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Prixod topilmadi';
  END IF;
  IF v_receipt.is_void THEN
    RAISE EXCEPTION 'Prixod allaqachon bekor qilingan';
  END IF;

  -- ── HIMOYA: shu prixoddan biror dona sotilganmi? ────────────────────────
  SELECT COALESCE(SUM(qty_received - qty_remaining), 0) INTO v_sold
    FROM medication_batches
   WHERE receipt_id = p_receipt_id AND clinic_id = p_clinic_id;

  IF v_sold > 0 THEN
    RAISE EXCEPTION
      'Bekor qilib bo''lmaydi: bu prixoddan % dona sotilgan. Qaytarish (return) orqali rasmiylashtiring.',
      v_sold;
  END IF;

  -- ── Ombor: partiyalarni bo'shatib, umumiy qoldiqni kamaytiramiz ────────
  FOR v_batch IN
    SELECT id, medication_id, qty_received
      FROM medication_batches
     WHERE receipt_id = p_receipt_id AND clinic_id = p_clinic_id
  LOOP
    UPDATE medications
       SET stock = GREATEST(0, stock - v_batch.qty_received)
     WHERE id = v_batch.medication_id AND clinic_id = p_clinic_id;

    UPDATE medication_batches
       SET qty_remaining = 0
     WHERE id = v_batch.id;

    -- Teskari harakat — manba hujjatga bog'langan holda
    INSERT INTO pharmacy_stock_movements
      (clinic_id, medication_id, kind, quantity, receipt_id, performed_by, notes)
    VALUES
      (p_clinic_id, v_batch.medication_id, 'out', v_batch.qty_received,
       p_receipt_id, p_user_id, 'Prixod bekor qilindi');
  END LOOP;

  -- ── Yetkazib beruvchi daftari: teskari yozuv (daftar append-only) ──────
  -- Balans Σ amount_uzs orqali hisoblanadi, shuning uchun manfiy 'purchase'
  -- yozuvi xaridni bekor qiladi. Mavjud yozuvlar O'CHIRILMAYDI.
  IF v_receipt.supplier_id IS NOT NULL THEN
    INSERT INTO pharmacy_supplier_ledger
      (clinic_id, supplier_id, entry_kind, amount_uzs, receipt_id, occurred_at, notes, created_by)
    SELECT
      p_clinic_id, v_receipt.supplier_id, 'purchase', -l.amount_uzs,
      p_receipt_id, CURRENT_DATE, 'Prixod bekor qilindi', p_user_id
      FROM pharmacy_supplier_ledger l
     WHERE l.receipt_id = p_receipt_id
       AND l.clinic_id = p_clinic_id
       AND l.entry_kind = 'purchase'
       AND l.amount_uzs > 0;
  END IF;

  UPDATE pharmacy_receipts
     SET is_void = true,
         voided_at = now(),
         voided_by = p_user_id,
         voided_reason = p_reason
   WHERE id = p_receipt_id;
END;
$function$;

-- Klient rollari to'g'ridan-to'g'ri chaqira olmasin (secdef funksiya).
REVOKE ALL ON FUNCTION public.pharmacy_void_receipt(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pharmacy_void_receipt(UUID, UUID, UUID, TEXT)
  TO service_role;

COMMENT ON FUNCTION public.pharmacy_void_receipt(UUID, UUID, UUID, TEXT) IS
  'Prixodni bekor qiladi. Undan biror dona sotilgan bo''lsa rad etadi. Narxni tiklamaydi.';
