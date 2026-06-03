-- =============================================================================
-- Clary v2 — Migration: pharmacy_void_sale (sotuvni bekor qilish / vozvrat)
-- Stockni qaytaradi (har sale_item o'z partiyasiga + medications.stock + harakat),
-- qarzga sotilgan bo'lsa mijoz daftarida refund yozadi, is_void/voided_* belgilaydi.
-- Atomar (bitta tranzaksiya).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.pharmacy_void_sale(
  p_clinic_id uuid,
  p_user_id uuid,
  p_sale_id uuid,
  p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_sale RECORD;
  v_item RECORD;
BEGIN
  SELECT * INTO v_sale FROM pharmacy_sales WHERE id = p_sale_id AND clinic_id = p_clinic_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale not found'; END IF;
  IF v_sale.is_void THEN RAISE EXCEPTION 'sale already void'; END IF;

  FOR v_item IN SELECT medication_id, batch_id, quantity FROM pharmacy_sale_items WHERE sale_id = p_sale_id LOOP
    IF v_item.batch_id IS NOT NULL THEN
      UPDATE medication_batches SET qty_remaining = qty_remaining + v_item.quantity WHERE id = v_item.batch_id;
    END IF;
    UPDATE medications SET stock = stock + v_item.quantity WHERE id = v_item.medication_id AND clinic_id = p_clinic_id;
    INSERT INTO pharmacy_stock_movements (clinic_id, medication_id, kind, quantity, sale_id, performed_by, notes)
    VALUES (p_clinic_id, v_item.medication_id, 'in', v_item.quantity, p_sale_id, p_user_id, 'Sotuv bekor qilindi');
  END LOOP;

  IF COALESCE(v_sale.debt_uzs, 0) > 0 AND v_sale.pharmacy_clinic_id IS NOT NULL THEN
    INSERT INTO pharmacy_clinic_ledger (clinic_id, pharmacy_clinic_id, sale_id, entry_kind, amount_uzs, description, created_by)
    VALUES (p_clinic_id, v_sale.pharmacy_clinic_id, p_sale_id, 'refund', v_sale.debt_uzs, 'Sotuv bekor qilindi', p_user_id);
  END IF;

  UPDATE pharmacy_sales
     SET is_void = true, voided_at = now(), voided_by = p_user_id, voided_reason = p_reason
   WHERE id = p_sale_id;
END;
$$;
