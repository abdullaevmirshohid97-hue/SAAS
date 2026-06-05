-- =============================================================================
-- DORIXONA — yaxlitlik va xavfsizlik tuzatishlari (audit asosida)
--   A) pharmacy_sell qayta yozish: muddati o'tgan blok, paid/debt yaxlitligi,
--      klinikasiz qarz taqiqi, override himoyasi, chegirma-aware foyda/ulush.
--   B) increment_medication_stock atomar + pharmacy_reconcile_stock.
--   C) medication_stock_summary view'ga barcode/manufacturer.
--   E) pharmacy_sale_items.returned_qty + pharmacy_return_items.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A) Atomar sotuv — yaxlitlik tekshiruvlari bilan
-- ---------------------------------------------------------------------------
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
  v_cost bigint;
  v_med_name text;
  v_avail int;
  v_remaining int;
  v_batch RECORD;
  v_take int;
  v_subtotal bigint := 0;
  v_total bigint;
  v_factor numeric;
  v_eff bigint;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Savatda dori yo''q';
  END IF;

  -- #2 Klinikasiz qarz taqiqi (pul yo'qolishini to'sadi)
  IF COALESCE(p_debt_uzs,0) > 0 AND p_pharmacy_clinic_id IS NULL THEN
    RAISE EXCEPTION 'Qarzli savdo uchun mijoz klinika tanlang';
  END IF;

  -- #1 Muddati O'TMAGAN zaxira yetarliligini tekshirish + subtotal (sotuv narxi
  -- = medications.price_uzs, override berilsa o'sha). #4 override < tannarx — taqiq.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_med_id := (v_item->>'medication_id')::uuid;
    v_qty := (v_item->>'quantity')::int;
    v_override := NULLIF(v_item->>'unit_price_override','')::bigint;

    SELECT price_uzs, cost_uzs INTO v_price, v_cost FROM medications
      WHERE id = v_med_id AND clinic_id = p_clinic_id;
    IF v_override IS NOT NULL THEN
      IF v_override < 0 THEN RAISE EXCEPTION 'Narx manfiy bo''lishi mumkin emas'; END IF;
      IF v_cost IS NOT NULL AND v_override < v_cost THEN
        RAISE EXCEPTION 'Narx tannarxdan past (% < %)', v_override, v_cost;
      END IF;
      v_price := v_override;
    END IF;
    v_price := COALESCE(v_price, 0);

    SELECT COALESCE(SUM(qty_remaining),0) INTO v_avail
      FROM medication_batches
     WHERE clinic_id = p_clinic_id AND medication_id = v_med_id AND qty_remaining > 0
       AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE);
    IF v_avail < v_qty THEN
      RAISE EXCEPTION 'Muddati o''tmagan zaxira yetarli emas (dori %): bor %, kerak %', v_med_id, v_avail, v_qty;
    END IF;

    v_subtotal := v_subtotal + v_qty * v_price;
  END LOOP;

  v_total := GREATEST(0, v_subtotal - COALESCE(p_discount_uzs,0));

  -- #3 To'lov + qarz = jami (yaxlitlik). Klient va server narxi mos (medications.price_uzs).
  IF COALESCE(p_paid_uzs,0) + COALESCE(p_debt_uzs,0) <> v_total THEN
    RAISE EXCEPTION 'To''lov + qarz jamiga teng emas (% + % <> %)',
      COALESCE(p_paid_uzs,0), COALESCE(p_debt_uzs,0), v_total;
  END IF;

  -- #5 Chegirma foyda/doktor ulushiga proporsional tarqaladi
  v_factor := CASE WHEN v_subtotal > 0 THEN v_total::numeric / v_subtotal ELSE 1 END;

  INSERT INTO pharmacy_sales
    (clinic_id, cashier_id, pharmacy_clinic_id, pharmacy_doctor_id, shift_id,
     payment_method, discount_uzs, total_uzs, paid_uzs, debt_uzs, notes)
  VALUES
    (p_clinic_id, p_user_id, p_pharmacy_clinic_id, p_pharmacy_doctor_id, p_shift_id,
     p_payment_method::payment_method_type, COALESCE(p_discount_uzs,0), v_total,
     COALESCE(p_paid_uzs,0), COALESCE(p_debt_uzs,0), p_notes)
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_med_id := (v_item->>'medication_id')::uuid;
    v_qty := (v_item->>'quantity')::int;
    v_override := NULLIF(v_item->>'unit_price_override','')::bigint;
    SELECT name, price_uzs INTO v_med_name, v_price FROM medications WHERE id = v_med_id;
    v_price := COALESCE(v_override, v_price, 0);
    v_eff := ROUND(v_price * v_factor);  -- chegirma qo'llangan samarali narx

    v_remaining := v_qty;
    FOR v_batch IN
      SELECT id, qty_remaining, unit_cost_uzs, doctor_share_percent, doctor_share_bonus_uzs
        FROM medication_batches
       WHERE clinic_id = p_clinic_id AND medication_id = v_med_id AND qty_remaining > 0
         AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
       ORDER BY COALESCE(expiry_date,'9999-12-31'::date) ASC, received_at ASC
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_take := LEAST(v_batch.qty_remaining, v_remaining);
      UPDATE medication_batches SET qty_remaining = qty_remaining - v_take WHERE id = v_batch.id;
      INSERT INTO pharmacy_sale_items
        (clinic_id, sale_id, medication_id, batch_id, name_snapshot, price_snapshot,
         unit_cost_snapshot, quantity, subtotal_uzs, doctor_share_uzs, profit_uzs)
      VALUES
        (p_clinic_id, v_sale_id, v_med_id, v_batch.id, v_med_name, v_price,
         v_batch.unit_cost_uzs, v_take, v_take * v_eff,
         ROUND(v_take * v_eff * COALESCE(v_batch.doctor_share_percent,0) / 100.0)
           + COALESCE(v_batch.doctor_share_bonus_uzs,0) * v_take,
         (v_eff - v_batch.unit_cost_uzs) * v_take);
      INSERT INTO pharmacy_stock_movements
        (clinic_id, medication_id, kind, quantity, sale_id, performed_by)
      VALUES (p_clinic_id, v_med_id, 'out', -v_take, v_sale_id, p_user_id);
      v_remaining := v_remaining - v_take;
    END LOOP;
    IF v_remaining > 0 THEN
      RAISE EXCEPTION 'Muddati o''tmagan zaxira yetarli emas (dori %, birlashgan)', v_med_id;
    END IF;
    UPDATE medications SET stock = stock - v_qty WHERE id = v_med_id AND clinic_id = p_clinic_id;
  END LOOP;

  IF COALESCE(p_debt_uzs,0) > 0 AND p_pharmacy_clinic_id IS NOT NULL THEN
    INSERT INTO pharmacy_clinic_ledger
      (clinic_id, pharmacy_clinic_id, sale_id, entry_kind, amount_uzs, payment_method, description, created_by)
    VALUES
      (p_clinic_id, p_pharmacy_clinic_id, v_sale_id, 'charge', -p_debt_uzs, p_payment_method, 'Dorixona sotuv qarzi', p_user_id);
  END IF;

  RETURN v_sale_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- B) Zaxira yaxlitligi — atomar increment + reconcile
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_medication_stock(p_medication uuid, p_qty int)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE medications SET stock = stock + p_qty WHERE id = p_medication;
$$;

CREATE OR REPLACE FUNCTION public.pharmacy_reconcile_stock(p_clinic uuid)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count int;
BEGIN
  UPDATE medications m
     SET stock = COALESCE((SELECT SUM(b.qty_remaining) FROM medication_batches b
                            WHERE b.medication_id = m.id AND b.clinic_id = p_clinic), 0)
   WHERE m.clinic_id = p_clinic;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_medication_stock(uuid, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.pharmacy_reconcile_stock(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- C) Qidiruv — view'ga barcode/manufacturer
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.medication_stock_summary AS
  SELECT m.clinic_id,
    m.id AS medication_id,
    m.name,
    m.form,
    m.price_uzs,
    m.reorder_level,
    COALESCE(sum(mb.qty_remaining), 0::bigint) AS qty_in_stock,
    COALESCE(sum(mb.qty_remaining * mb.unit_cost_uzs), 0::numeric)::bigint AS stock_value_uzs,
    min(mb.expiry_date) AS earliest_expiry,
    count(*) FILTER (WHERE mb.qty_remaining > 0 AND mb.expiry_date <= (CURRENT_DATE + '90 days'::interval)) AS batches_expiring_soon,
    m.barcode,
    m.manufacturer
   FROM medications m
     LEFT JOIN medication_batches mb ON mb.medication_id = m.id AND mb.qty_remaining > 0
  WHERE m.is_archived = false
  GROUP BY m.clinic_id, m.id, m.name, m.form, m.price_uzs, m.reorder_level, m.barcode, m.manufacturer;

-- ---------------------------------------------------------------------------
-- E) Qisman qaytarish — returned_qty + return RPC
-- ---------------------------------------------------------------------------
ALTER TABLE public.pharmacy_sale_items
  ADD COLUMN IF NOT EXISTS returned_qty int NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.pharmacy_return_items(
  p_clinic uuid, p_user uuid, p_sale uuid, p_items jsonb, p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_sale RECORD;
  v_item jsonb;
  v_sale_item RECORD;
  v_qty int;
  v_refund bigint := 0;
  v_eff bigint;
BEGIN
  SELECT * INTO v_sale FROM pharmacy_sales WHERE id = p_sale AND clinic_id = p_clinic;
  IF NOT FOUND THEN RAISE EXCEPTION 'Savdo topilmadi'; END IF;
  IF v_sale.is_void THEN RAISE EXCEPTION 'Bekor qilingan savdoni qaytarib bo''lmaydi'; END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Qaytariladigan dori yo''q'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'qty')::int;
    IF v_qty <= 0 THEN CONTINUE; END IF;
    SELECT * INTO v_sale_item FROM pharmacy_sale_items
      WHERE id = (v_item->>'sale_item_id')::uuid AND sale_id = p_sale AND clinic_id = p_clinic;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sotuv qatori topilmadi'; END IF;
    IF v_qty > v_sale_item.quantity - v_sale_item.returned_qty THEN
      RAISE EXCEPTION 'Qaytarish soni sotilgandan ko''p (% > %)', v_qty, v_sale_item.quantity - v_sale_item.returned_qty;
    END IF;

    -- Zaxirani qaytarish (partiya + jami stok + harakat)
    IF v_sale_item.batch_id IS NOT NULL THEN
      UPDATE medication_batches SET qty_remaining = qty_remaining + v_qty WHERE id = v_sale_item.batch_id;
    END IF;
    UPDATE medications SET stock = stock + v_qty WHERE id = v_sale_item.medication_id AND clinic_id = p_clinic;
    INSERT INTO pharmacy_stock_movements (clinic_id, medication_id, kind, quantity, sale_id, performed_by, notes)
    VALUES (p_clinic, v_sale_item.medication_id, 'in', v_qty, p_sale, p_user, COALESCE('Qaytarish: '||p_reason, 'Qaytarish'));

    UPDATE pharmacy_sale_items SET returned_qty = returned_qty + v_qty WHERE id = v_sale_item.id;

    -- Samarali (chegirma qo'llangan) birlik narx = subtotal/quantity
    v_eff := CASE WHEN v_sale_item.quantity > 0 THEN ROUND(v_sale_item.subtotal_uzs::numeric / v_sale_item.quantity) ELSE 0 END;
    v_refund := v_refund + v_eff * v_qty;
  END LOOP;

  IF v_refund <= 0 THEN RETURN; END IF;

  -- Savdo jamisini kamaytirish; qarz bo'lsa avval qarzdan, qolgani to'lovdan
  UPDATE pharmacy_sales
     SET total_uzs = GREATEST(0, total_uzs - v_refund),
         debt_uzs  = GREATEST(0, debt_uzs - v_refund),
         paid_uzs  = GREATEST(0, paid_uzs - GREATEST(0, v_refund - v_sale.debt_uzs))
   WHERE id = p_sale;

  -- Klinika qarzi bo'lsa daftar 'refund' (qarzni kamaytiruvchi musbat yozuv)
  IF v_sale.pharmacy_clinic_id IS NOT NULL AND v_sale.debt_uzs > 0 THEN
    INSERT INTO pharmacy_clinic_ledger
      (clinic_id, pharmacy_clinic_id, sale_id, entry_kind, amount_uzs, description, created_by)
    VALUES
      (p_clinic, v_sale.pharmacy_clinic_id, p_sale, 'refund', LEAST(v_refund, v_sale.debt_uzs),
       COALESCE('Qaytarish: '||p_reason, 'Qaytarish'), p_user);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pharmacy_return_items(uuid, uuid, uuid, jsonb, text) TO service_role;
