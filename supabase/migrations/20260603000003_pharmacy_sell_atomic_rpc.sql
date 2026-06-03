-- =============================================================================
-- Clary v2 — Migration: pharmacy_sell atomar sotuv RPC
-- Bitta tranzaksiyada: qoldiq tekshiruvi + FIFO yechish + pharmacy_sales +
-- pharmacy_sale_items (doktor ulushi/foyda snapshot) + stock harakatlari +
-- qarz bo'lsa mijoz-klinika daftari. Qoldiq yetmasa RAISE → to'liq rollback
-- (eski sell() yarim-sotuv bug'i yo'qoladi).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.pharmacy_sell(
  p_clinic_id uuid,
  p_user_id uuid,
  p_pharmacy_clinic_id uuid,
  p_pharmacy_doctor_id uuid,
  p_payment_method text,
  p_items jsonb,
  p_discount_uzs bigint,
  p_paid_uzs bigint,
  p_debt_uzs bigint,
  p_notes text,
  p_shift_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_sale_id uuid;
  v_item jsonb;
  v_med_id uuid;
  v_qty int;
  v_override bigint;
  v_price bigint;
  v_med_name text;
  v_avail int;
  v_remaining int;
  v_batch RECORD;
  v_take int;
  v_subtotal bigint := 0;
  v_total bigint;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'no items';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_med_id := (v_item->>'medication_id')::uuid;
    v_qty := (v_item->>'quantity')::int;
    SELECT COALESCE(SUM(qty_remaining),0) INTO v_avail
      FROM medication_batches WHERE clinic_id=p_clinic_id AND medication_id=v_med_id AND qty_remaining>0;
    IF v_avail < v_qty THEN
      RAISE EXCEPTION 'insufficient stock for medication %: have %, need %', v_med_id, v_avail, v_qty;
    END IF;
  END LOOP;

  INSERT INTO pharmacy_sales
    (clinic_id, cashier_id, pharmacy_clinic_id, pharmacy_doctor_id, shift_id,
     payment_method, discount_uzs, total_uzs, paid_uzs, debt_uzs, notes)
  VALUES
    (p_clinic_id, p_user_id, p_pharmacy_clinic_id, p_pharmacy_doctor_id, p_shift_id,
     p_payment_method::payment_method_type, COALESCE(p_discount_uzs,0), 0,
     COALESCE(p_paid_uzs,0), COALESCE(p_debt_uzs,0), p_notes)
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_med_id := (v_item->>'medication_id')::uuid;
    v_qty := (v_item->>'quantity')::int;
    v_override := NULLIF(v_item->>'unit_price_override','')::bigint;
    SELECT name INTO v_med_name FROM medications WHERE id=v_med_id;
    v_price := COALESCE(
      v_override,
      (SELECT unit_price_uzs FROM medication_batches
         WHERE clinic_id=p_clinic_id AND medication_id=v_med_id AND qty_remaining>0 AND unit_price_uzs IS NOT NULL
         ORDER BY COALESCE(expiry_date,'9999-12-31'::date) ASC, received_at ASC LIMIT 1),
      (SELECT price_uzs FROM medications WHERE id=v_med_id),
      0
    );
    v_remaining := v_qty;
    FOR v_batch IN
      SELECT id, qty_remaining, unit_cost_uzs, doctor_share_percent, doctor_share_bonus_uzs
        FROM medication_batches
       WHERE clinic_id=p_clinic_id AND medication_id=v_med_id AND qty_remaining>0
       ORDER BY COALESCE(expiry_date,'9999-12-31'::date) ASC, received_at ASC
    LOOP
      EXIT WHEN v_remaining<=0;
      v_take := LEAST(v_batch.qty_remaining, v_remaining);
      UPDATE medication_batches SET qty_remaining = qty_remaining - v_take WHERE id=v_batch.id;
      INSERT INTO pharmacy_sale_items
        (clinic_id, sale_id, medication_id, batch_id, name_snapshot, price_snapshot,
         unit_cost_snapshot, quantity, subtotal_uzs, doctor_share_uzs, profit_uzs)
      VALUES
        (p_clinic_id, v_sale_id, v_med_id, v_batch.id, v_med_name, v_price,
         v_batch.unit_cost_uzs, v_take, v_take*v_price,
         ROUND(v_take*v_price*COALESCE(v_batch.doctor_share_percent,0)/100.0)
           + COALESCE(v_batch.doctor_share_bonus_uzs,0)*v_take,
         (v_price - v_batch.unit_cost_uzs)*v_take);
      INSERT INTO pharmacy_stock_movements
        (clinic_id, medication_id, kind, quantity, sale_id, performed_by)
      VALUES (p_clinic_id, v_med_id, 'out', -v_take, v_sale_id, p_user_id);
      v_remaining := v_remaining - v_take;
    END LOOP;
    IF v_remaining > 0 THEN
      RAISE EXCEPTION 'insufficient stock for medication % (combined lines)', v_med_id;
    END IF;
    UPDATE medications SET stock = stock - v_qty WHERE id=v_med_id AND clinic_id=p_clinic_id;
    v_subtotal := v_subtotal + v_qty * v_price;
  END LOOP;

  v_total := GREATEST(0, v_subtotal - COALESCE(p_discount_uzs,0));
  UPDATE pharmacy_sales SET total_uzs = v_total WHERE id=v_sale_id;

  IF COALESCE(p_debt_uzs,0) > 0 AND p_pharmacy_clinic_id IS NOT NULL THEN
    INSERT INTO pharmacy_clinic_ledger
      (clinic_id, pharmacy_clinic_id, sale_id, entry_kind, amount_uzs, payment_method, description, created_by)
    VALUES
      (p_clinic_id, p_pharmacy_clinic_id, v_sale_id, 'charge', -p_debt_uzs, p_payment_method, 'Dorixona sotuv qarzi', p_user_id);
  END IF;

  RETURN v_sale_id;
END;
$$;
