-- =============================================================================
-- DORIXONA 2.0 — Sotuv 2.0 + dorixona kassasi (Faza 6 / 7 / 9)
-- =============================================================================
--   A) pharmacy_sales / items     — operator, smena, kassa, idempotency, birliklar
--   B) pharmacy_sell_v2(...)      — qadoq/blister/dona, bo'lib to'lash, tanlangan
--                                   partiya (DataMatrix), smena, ikki marta sotilmaydi
--   C) pharmacy_return_items_v2   — qaytarish + kassadan qaytgan pul harakati
--   D) pharmacy_void_sale_v2      — bekor qilish + kassadan qaytgan pul harakati
--   E) pharmacy_shift_totals      — X/Z hisobot yig'indilari
--   F) pharmacy_close_shift       — smenani yopish (kutilgan vs sanalgan, Z raqami)
--
-- ⚠️ Yangi ustunlar NULL bo'lishi mumkin (NOT NULL emas): Savatcha (trash_restore)
-- eski arxiv qatorlarini jsonb_populate_recordset bilan qayta yozadi — u yerda
-- yangi kalitlar bo'lmaydi va NOT NULL ustun tiklashni sindirardi.
-- Eski pharmacy_sell / pharmacy_return_items / pharmacy_void_sale O'ZGARMAYDI.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A) Ustunlar
-- ---------------------------------------------------------------------------
ALTER TABLE public.pharmacy_sales
  ADD COLUMN IF NOT EXISTS operator_id       uuid,
  ADD COLUMN IF NOT EXISTS pharmacy_shift_id uuid,
  ADD COLUMN IF NOT EXISTS register_no       integer,
  ADD COLUMN IF NOT EXISTS idempotency_key   uuid,
  ADD COLUMN IF NOT EXISTS received_cash_uzs bigint,
  ADD COLUMN IF NOT EXISTS change_uzs        bigint,
  ADD COLUMN IF NOT EXISTS fiscal_status     text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pharmacy_sales_idem
  ON public.pharmacy_sales (clinic_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pharmacy_sales_pshift
  ON public.pharmacy_sales (pharmacy_shift_id) WHERE pharmacy_shift_id IS NOT NULL;

ALTER TABLE public.pharmacy_sale_items
  ADD COLUMN IF NOT EXISTS unit_kind      text,
  ADD COLUMN IF NOT EXISTS unit_factor    integer,
  ADD COLUMN IF NOT EXISTS unit_price_uzs bigint,
  ADD COLUMN IF NOT EXISTS unit_qty       numeric(14,3);

-- ---------------------------------------------------------------------------
-- B) Sotuv v2
-- ---------------------------------------------------------------------------
-- p_payload:
--  { idempotency_key?, items: [{ medication_id, quantity, unit_kind?('unit'|'blister'|'pack'),
--                                unit_price_override?, preferred_batch_no? }],
--    payments?: [{ method, amount_uzs }],     -- bo'sh bo'lsa: payment_method + paid_uzs (eski shakl)
--    payment_method?, paid_uzs?, debt_uzs?, discount_uzs?,
--    pharmacy_clinic_id?, pharmacy_doctor_id?, patient_id?, prescription_id?,
--    reception_transaction_id?, shift_id?(klinika smenasi), pharmacy_shift_id?, register_no?,
--    operator_id?, require_shift?, received_cash_uzs?, change_uzs?, notes? }
CREATE OR REPLACE FUNCTION public.pharmacy_sell_v2(p_clinic uuid, p_user uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key       uuid := NULLIF(p_payload->>'idempotency_key', '')::uuid;
  v_pc        uuid := NULLIF(p_payload->>'pharmacy_clinic_id', '')::uuid;
  v_pd        uuid := NULLIF(p_payload->>'pharmacy_doctor_id', '')::uuid;
  v_patient   uuid := NULLIF(p_payload->>'patient_id', '')::uuid;
  v_shift     uuid := NULLIF(p_payload->>'pharmacy_shift_id', '')::uuid;
  v_reg       integer := NULLIF(p_payload->>'register_no', '')::integer;
  v_operator  uuid := NULLIF(p_payload->>'operator_id', '')::uuid;
  v_req_shift boolean := COALESCE(NULLIF(p_payload->>'require_shift', '')::boolean, false);
  v_discount  bigint := GREATEST(0, COALESCE(NULLIF(p_payload->>'discount_uzs', '')::bigint, 0));
  v_debt      bigint := GREATEST(0, COALESCE(NULLIF(p_payload->>'debt_uzs', '')::bigint, 0));
  v_payments  jsonb := COALESCE(p_payload->'payments', '[]'::jsonb);
  v_existing  RECORD;
  v_shift_row RECORD;
  v_item      jsonb;
  v_pay       jsonb;
  v_med       RECORD;
  v_line      jsonb;
  v_lines     jsonb := '[]'::jsonb;
  v_need      jsonb := '{}'::jsonb;
  v_need_row  RECORD;
  v_batch     RECORD;
  v_kind      text;
  v_factor    integer;
  v_qty       integer;
  v_base      integer;
  v_price     bigint;
  v_override  bigint;
  v_line_sum  bigint;
  v_subtotal  bigint := 0;
  v_total     bigint;
  v_paid      bigint := 0;
  v_method    text;
  v_pay_count integer := 0;
  v_disc_fac  numeric;
  v_sale      uuid;
  v_avail     bigint;
  v_remaining integer;
  v_take      integer;
  v_alloc     bigint;
  v_alloc_sum bigint;
  v_eff       bigint;
  v_eff_sum   bigint := 0;
  v_line_no   integer := 0;
  v_line_cnt  integer;
  v_pref      text;
BEGIN
  IF jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_payload->'items') = 0 THEN
    RAISE EXCEPTION 'Savatda dori yo''q';
  END IF;

  -- Ikki marta bosish / tarmoq takrori → o'sha sotuv qaytadi
  IF v_key IS NOT NULL THEN
    SELECT id, total_uzs, paid_uzs, debt_uzs INTO v_existing
      FROM pharmacy_sales WHERE clinic_id = p_clinic AND idempotency_key = v_key;
    IF FOUND THEN
      RETURN jsonb_build_object('sale_id', v_existing.id, 'duplicate', true,
        'total_uzs', v_existing.total_uzs, 'paid_uzs', v_existing.paid_uzs,
        'debt_uzs', v_existing.debt_uzs);
    END IF;
  END IF;

  -- Dorixona kassasi smenasi
  IF v_shift IS NOT NULL THEN
    SELECT * INTO v_shift_row FROM pharmacy_shifts WHERE id = v_shift AND clinic_id = p_clinic;
    IF NOT FOUND OR v_shift_row.closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Kassa smenasi yopilgan yoki topilmadi — smenani qayta oching';
    END IF;
    v_reg := COALESCE(v_reg, v_shift_row.register_no);
  ELSIF v_req_shift THEN
    RAISE EXCEPTION 'Kassa smenasi ochilmagan. Avval smenani oching.';
  END IF;

  IF v_debt > 0 AND v_pc IS NULL THEN
    RAISE EXCEPTION 'Qarzli savdo uchun mijoz klinika tanlang';
  END IF;

  -- 1-o'tish: narx, birlik, mavjudlik
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items') LOOP
    SELECT id, name, price_uzs, cost_uzs, pack_qty, blister_qty, pack_price_uzs, blister_price_uzs,
           sell_by_unit, is_archived
      INTO v_med
      FROM medications
     WHERE id = NULLIF(v_item->>'medication_id', '')::uuid AND clinic_id = p_clinic;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Dori topilmadi';
    END IF;
    IF v_med.is_archived THEN
      RAISE EXCEPTION 'Dori arxivlangan: %', v_med.name;
    END IF;

    v_kind := COALESCE(NULLIF(v_item->>'unit_kind', ''), 'unit');
    IF v_kind NOT IN ('unit', 'blister', 'pack') THEN
      RAISE EXCEPTION 'Noto''g''ri birlik: %', v_kind;
    END IF;
    v_qty := NULLIF(v_item->>'quantity', '')::integer;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Soni noto''g''ri (%)', v_med.name;
    END IF;
    IF COALESCE(v_med.pack_qty, 1) > 1 AND v_kind <> 'pack' AND NOT COALESCE(v_med.sell_by_unit, false) THEN
      RAISE EXCEPTION '% faqat qadoqda sotiladi (donalab sotish yoqilmagan)', v_med.name;
    END IF;
    IF v_kind = 'blister' AND v_med.blister_qty IS NULL THEN
      RAISE EXCEPTION '% uchun blister o''lchami kiritilmagan', v_med.name;
    END IF;

    v_factor := CASE v_kind
      WHEN 'pack' THEN GREATEST(COALESCE(v_med.pack_qty, 1), 1)
      WHEN 'blister' THEN v_med.blister_qty
      ELSE 1 END;
    v_base := v_qty * v_factor;

    -- Narx (packages/utils pharmacy-units.ts unitPrice() bilan bir xil)
    v_price := CASE v_kind
      WHEN 'pack' THEN COALESCE(NULLIF(v_med.pack_price_uzs, 0),
                                COALESCE(v_med.price_uzs, 0) * GREATEST(COALESCE(v_med.pack_qty, 1), 1))
      WHEN 'blister' THEN COALESCE(NULLIF(v_med.blister_price_uzs, 0),
                                   ROUND(COALESCE(v_med.price_uzs, 0)::numeric * v_med.blister_qty))
      ELSE COALESCE(v_med.price_uzs, 0) END;

    v_override := NULLIF(v_item->>'unit_price_override', '')::bigint;
    IF v_override IS NOT NULL THEN
      IF v_override < 0 THEN
        RAISE EXCEPTION 'Narx manfiy bo''lishi mumkin emas';
      END IF;
      IF v_med.cost_uzs IS NOT NULL AND v_override < v_med.cost_uzs * v_factor THEN
        RAISE EXCEPTION 'Narx tannarxdan past (% < %)', v_override, v_med.cost_uzs * v_factor;
      END IF;
      v_price := v_override;
    END IF;

    v_line_sum := v_price * v_qty;
    v_subtotal := v_subtotal + v_line_sum;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'med', v_med.id, 'name', v_med.name, 'kind', v_kind, 'factor', v_factor, 'qty', v_qty,
      'base', v_base, 'price', v_price, 'line', v_line_sum,
      'pref', NULLIF(v_item->>'preferred_batch_no', '')));
    v_need := jsonb_set(v_need, ARRAY[v_med.id::text],
      to_jsonb(COALESCE((v_need->>(v_med.id::text))::integer, 0) + v_base));
  END LOOP;

  -- Bir dori bir necha qatorda bo'lishi mumkin (qadoq + dona) — jami ehtiyoj
  FOR v_need_row IN SELECT key, value FROM jsonb_each_text(v_need) LOOP
    SELECT COALESCE(SUM(qty_remaining), 0) INTO v_avail
      FROM medication_batches
     WHERE clinic_id = p_clinic AND medication_id = v_need_row.key::uuid AND qty_remaining > 0
       AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE);
    IF v_avail < v_need_row.value::integer THEN
      RAISE EXCEPTION 'Muddati o''tmagan zaxira yetarli emas (%): bor %, kerak %',
        (SELECT name FROM medications WHERE id = v_need_row.key::uuid), v_avail, v_need_row.value;
    END IF;
  END LOOP;

  IF v_discount > v_subtotal THEN
    RAISE EXCEPTION 'Chegirma jami summadan katta';
  END IF;
  v_total := v_subtotal - v_discount;

  -- To'lov
  IF jsonb_typeof(v_payments) = 'array' AND jsonb_array_length(v_payments) > 0 THEN
    FOR v_pay IN SELECT * FROM jsonb_array_elements(v_payments) LOOP
      IF COALESCE(NULLIF(v_pay->>'amount_uzs', '')::bigint, 0) <= 0 THEN
        CONTINUE;
      END IF;
      IF (v_pay->>'method') NOT IN ('cash', 'card', 'transfer', 'click', 'payme', 'uzum', 'humo',
                                    'uzcard', 'insurance') THEN
        RAISE EXCEPTION 'Noto''g''ri to''lov usuli: %', v_pay->>'method';
      END IF;
      v_paid := v_paid + (v_pay->>'amount_uzs')::bigint;
      v_pay_count := v_pay_count + 1;
      v_method := v_pay->>'method';
    END LOOP;
    IF v_pay_count > 1 THEN
      v_method := 'mixed';
    ELSIF v_pay_count = 0 THEN
      v_method := CASE WHEN v_debt > 0 THEN 'debt' ELSE 'cash' END;
    END IF;
  ELSE
    v_paid := GREATEST(0, COALESCE(NULLIF(p_payload->>'paid_uzs', '')::bigint, v_total - v_debt));
    v_method := COALESCE(NULLIF(p_payload->>'payment_method', ''), 'cash');
  END IF;

  IF v_paid + v_debt <> v_total THEN
    RAISE EXCEPTION 'To''lov + qarz jamiga teng emas (% + % <> %)', v_paid, v_debt, v_total;
  END IF;

  v_disc_fac := CASE WHEN v_subtotal > 0 THEN v_total::numeric / v_subtotal ELSE 1 END;

  INSERT INTO pharmacy_sales
    (clinic_id, cashier_id, patient_id, pharmacy_clinic_id, pharmacy_doctor_id, shift_id,
     prescription_id, payment_method, discount_uzs, total_uzs, paid_uzs, debt_uzs, notes,
     reception_transaction_id, operator_id, pharmacy_shift_id, register_no, idempotency_key,
     received_cash_uzs, change_uzs)
  VALUES
    (p_clinic, p_user, v_patient, v_pc, v_pd, NULLIF(p_payload->>'shift_id', '')::uuid,
     NULLIF(p_payload->>'prescription_id', '')::uuid, v_method::payment_method_type, v_discount,
     v_total, v_paid, v_debt, NULLIF(p_payload->>'notes', ''),
     NULLIF(p_payload->>'reception_transaction_id', '')::uuid, v_operator, v_shift, v_reg, v_key,
     NULLIF(p_payload->>'received_cash_uzs', '')::bigint, NULLIF(p_payload->>'change_uzs', '')::bigint)
  RETURNING id INTO v_sale;

  -- To'lov qismlari (har doim yoziladi — kassa hisoboti shundan)
  IF v_pay_count > 0 THEN
    INSERT INTO pharmacy_sale_payments (clinic_id, sale_id, method, amount_uzs)
    SELECT p_clinic, v_sale, x->>'method', (x->>'amount_uzs')::bigint
      FROM jsonb_array_elements(v_payments) x
     WHERE COALESCE(NULLIF(x->>'amount_uzs', '')::bigint, 0) > 0;
  ELSIF v_paid > 0 THEN
    INSERT INTO pharmacy_sale_payments (clinic_id, sale_id, method, amount_uzs)
    VALUES (p_clinic, v_sale, CASE WHEN v_method IN ('debt', 'mixed') THEN 'cash' ELSE v_method END, v_paid);
  END IF;

  -- 2-o'tish: FEFO (tanlangan partiya birinchi), qatorlar, harakatlar
  v_line_cnt := jsonb_array_length(v_lines);
  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines) LOOP
    v_line_no := v_line_no + 1;
    v_remaining := (v_line->>'base')::integer;
    v_factor := (v_line->>'factor')::integer;
    v_alloc_sum := 0;
    v_pref := v_line->>'pref';
    FOR v_batch IN
      SELECT id, qty_remaining, unit_cost_uzs, doctor_share_percent, doctor_share_bonus_uzs, batch_no
        FROM medication_batches
       WHERE clinic_id = p_clinic AND medication_id = (v_line->>'med')::uuid AND qty_remaining > 0
         AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
       ORDER BY (v_pref IS NOT NULL AND batch_no = v_pref) DESC,
                COALESCE(expiry_date, '9999-12-31'::date) ASC, received_at ASC
       FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_take := LEAST(v_batch.qty_remaining, v_remaining);
      UPDATE medication_batches SET qty_remaining = qty_remaining - v_take WHERE id = v_batch.id;

      -- Qator summasini partiyalarga proporsional bo'lamiz (oxirgisi qoldiqni oladi)
      IF v_take = v_remaining THEN
        v_alloc := (v_line->>'line')::bigint - v_alloc_sum;
      ELSE
        v_alloc := ROUND((v_line->>'line')::numeric * v_take / (v_line->>'base')::integer);
      END IF;
      v_alloc_sum := v_alloc_sum + v_alloc;

      -- Chegirma qo'llangan summa; savdoning eng oxirgi qatori yaxlitlash farqini oladi
      IF v_line_no = v_line_cnt AND v_take = v_remaining THEN
        v_eff := v_total - v_eff_sum;
      ELSE
        v_eff := ROUND(v_alloc * v_disc_fac);
      END IF;
      v_eff_sum := v_eff_sum + v_eff;

      INSERT INTO pharmacy_sale_items
        (clinic_id, sale_id, medication_id, batch_id, name_snapshot, price_snapshot,
         unit_cost_snapshot, quantity, subtotal_uzs, doctor_share_uzs, profit_uzs,
         unit_kind, unit_factor, unit_price_uzs, unit_qty)
      VALUES
        (p_clinic, v_sale, (v_line->>'med')::uuid, v_batch.id, v_line->>'name',
         ROUND((v_line->>'price')::numeric / v_factor), v_batch.unit_cost_uzs, v_take, v_eff,
         ROUND(v_eff * COALESCE(v_batch.doctor_share_percent, 0) / 100.0)
           + COALESCE(v_batch.doctor_share_bonus_uzs, 0) * v_take,
         v_eff - v_batch.unit_cost_uzs * v_take,
         v_line->>'kind', v_factor, (v_line->>'price')::bigint, ROUND(v_take::numeric / v_factor, 3));

      INSERT INTO pharmacy_stock_movements
        (clinic_id, medication_id, kind, quantity, sale_id, batch_no, performed_by)
      VALUES
        (p_clinic, (v_line->>'med')::uuid, 'out', -v_take, v_sale, v_batch.batch_no, p_user);

      v_remaining := v_remaining - v_take;
    END LOOP;
    IF v_remaining > 0 THEN
      RAISE EXCEPTION 'Muddati o''tmagan zaxira yetarli emas (%)', v_line->>'name';
    END IF;
    UPDATE medications SET stock = stock - (v_line->>'base')::integer
     WHERE id = (v_line->>'med')::uuid AND clinic_id = p_clinic;
  END LOOP;

  IF v_debt > 0 AND v_pc IS NOT NULL THEN
    INSERT INTO pharmacy_clinic_ledger
      (clinic_id, pharmacy_clinic_id, sale_id, entry_kind, amount_uzs, payment_method, description, created_by)
    VALUES
      (p_clinic, v_pc, v_sale, 'charge', -v_debt, v_method, 'Dorixona sotuv qarzi', p_user);
  END IF;

  RETURN jsonb_build_object(
    'sale_id', v_sale, 'duplicate', false, 'subtotal_uzs', v_subtotal, 'total_uzs', v_total,
    'paid_uzs', v_paid, 'debt_uzs', v_debt, 'payment_method', v_method);
END;
$$;

REVOKE ALL ON FUNCTION public.pharmacy_sell_v2(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pharmacy_sell_v2(uuid, uuid, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- Eski pharmacy_void_sale TUZATISHI: qisman qaytarilgan savdo bekor qilinganda
-- qaytarilgan dona IKKINCHI marta omborga qo'shilardi (quantity to'liq
-- tiklanardi, returned_qty hisobga olinmasdi) — partiya CHECK'i yiqilardi yoki
-- qoldiq ortib ketardi. Endi faqat qaytarilmagan qism tiklanadi.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pharmacy_void_sale(
  p_clinic_id uuid, p_user_id uuid, p_sale_id uuid, p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sale RECORD;
  v_item RECORD;
BEGIN
  SELECT * INTO v_sale FROM pharmacy_sales WHERE id = p_sale_id AND clinic_id = p_clinic_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale not found'; END IF;
  IF v_sale.is_void THEN RAISE EXCEPTION 'sale already void'; END IF;

  FOR v_item IN
    SELECT medication_id, batch_id, quantity - returned_qty AS qty
      FROM pharmacy_sale_items
     WHERE sale_id = p_sale_id AND quantity - returned_qty > 0
  LOOP
    IF v_item.batch_id IS NOT NULL THEN
      UPDATE medication_batches SET qty_remaining = qty_remaining + v_item.qty WHERE id = v_item.batch_id;
    END IF;
    UPDATE medications SET stock = stock + v_item.qty WHERE id = v_item.medication_id AND clinic_id = p_clinic_id;
    INSERT INTO pharmacy_stock_movements (clinic_id, medication_id, kind, quantity, sale_id, performed_by, notes)
    VALUES (p_clinic_id, v_item.medication_id, 'in', v_item.qty, p_sale_id, p_user_id, 'Sotuv bekor qilindi');
  END LOOP;

  IF COALESCE(v_sale.debt_uzs, 0) > 0 AND v_sale.pharmacy_clinic_id IS NOT NULL THEN
    INSERT INTO pharmacy_clinic_ledger (clinic_id, pharmacy_clinic_id, sale_id, entry_kind, amount_uzs, description, created_by)
    VALUES (p_clinic_id, v_sale.pharmacy_clinic_id, p_sale_id, 'refund', v_sale.debt_uzs, 'Sotuv bekor qilindi', p_user_id);
  END IF;

  UPDATE pharmacy_sales
     SET is_void = true, voided_at = now(), voided_by = p_user_id, voided_reason = p_reason
   WHERE id = p_sale_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.pharmacy_void_sale(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pharmacy_void_sale(uuid, uuid, uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Yordamchi: savdoning naqd ulushi (to'lov qismlaridan; eski savdo — usuldan)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pharmacy_sale_cash_share(p_sale uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM pharmacy_sale_payments WHERE sale_id = p_sale)
      THEN COALESCE((SELECT SUM(amount_uzs) FROM pharmacy_sale_payments
                      WHERE sale_id = p_sale AND method = 'cash'), 0)
    ELSE COALESCE((SELECT CASE WHEN payment_method::text = 'cash' THEN paid_uzs ELSE 0 END
                     FROM pharmacy_sales WHERE id = p_sale), 0)
  END;
$$;

-- ---------------------------------------------------------------------------
-- C) Qaytarish v2 — eski funksiya + kassa harakati
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pharmacy_return_items_v2(
  p_clinic uuid, p_user uuid, p_sale uuid, p_items jsonb, p_reason text,
  p_shift uuid, p_operator uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before RECORD;
  v_after  RECORD;
  v_refund bigint;
  v_paid_back bigint;
  v_cash_share bigint;
  v_cash_back bigint;
BEGIN
  SELECT total_uzs, paid_uzs, debt_uzs INTO v_before
    FROM pharmacy_sales WHERE id = p_sale AND clinic_id = p_clinic FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Savdo topilmadi';
  END IF;

  PERFORM pharmacy_return_items(p_clinic, p_user, p_sale, p_items, p_reason);

  SELECT total_uzs, paid_uzs, debt_uzs INTO v_after FROM pharmacy_sales WHERE id = p_sale;
  v_refund := v_before.total_uzs - v_after.total_uzs;
  v_paid_back := v_before.paid_uzs - v_after.paid_uzs;

  -- Kassadan naqd qaytgan qism (naqd ulushidan oshmaydi)
  v_cash_share := pharmacy_sale_cash_share(p_sale);
  v_cash_back := LEAST(v_paid_back, v_cash_share);

  -- Naqd qism kassadan chiqadi; naqdsiz qism (karta/Click) alohida yoziladi —
  -- u kutilgan naqdga ta'sir qilmaydi, lekin Z hisobotdagi "qaytarishlar"da ko'rinadi.
  IF p_shift IS NOT NULL AND v_cash_back > 0 THEN
    INSERT INTO pharmacy_cash_movements
      (clinic_id, shift_id, kind, method, amount_uzs, notes, operator_id, created_by, ref_table, ref_id)
    VALUES
      (p_clinic, p_shift, 'refund', 'cash', -v_cash_back,
       COALESCE('Qaytarish: ' || NULLIF(p_reason, ''), 'Qaytarish'), p_operator, p_user,
       'pharmacy_sales', p_sale);
  END IF;
  IF p_shift IS NOT NULL AND v_paid_back - v_cash_back > 0 THEN
    INSERT INTO pharmacy_cash_movements
      (clinic_id, shift_id, kind, method, amount_uzs, notes, operator_id, created_by, ref_table, ref_id)
    VALUES
      (p_clinic, p_shift, 'refund', 'card', -(v_paid_back - v_cash_back),
       COALESCE('Qaytarish (naqdsiz): ' || NULLIF(p_reason, ''), 'Qaytarish (naqdsiz)'),
       p_operator, p_user, 'pharmacy_sales', p_sale);
  END IF;

  RETURN jsonb_build_object('refund_uzs', v_refund, 'paid_back_uzs', v_paid_back,
                            'cash_back_uzs', v_cash_back);
END;
$$;

REVOKE ALL ON FUNCTION public.pharmacy_return_items_v2(uuid, uuid, uuid, jsonb, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pharmacy_return_items_v2(uuid, uuid, uuid, jsonb, text, uuid, uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- D) Bekor qilish v2 — eski funksiya + kassa harakati
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pharmacy_void_sale_v2(
  p_clinic uuid, p_user uuid, p_sale uuid, p_reason text, p_shift uuid, p_operator uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale RECORD;
  v_cash bigint;
BEGIN
  SELECT * INTO v_sale FROM pharmacy_sales WHERE id = p_sale AND clinic_id = p_clinic FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Savdo topilmadi';
  END IF;
  v_cash := LEAST(v_sale.paid_uzs, pharmacy_sale_cash_share(p_sale));

  PERFORM pharmacy_void_sale(p_clinic, p_user, p_sale, p_reason);

  IF p_shift IS NOT NULL AND v_cash > 0 THEN
    INSERT INTO pharmacy_cash_movements
      (clinic_id, shift_id, kind, method, amount_uzs, notes, operator_id, created_by, ref_table, ref_id)
    VALUES
      (p_clinic, p_shift, 'refund', 'cash', -v_cash,
       COALESCE('Bekor qilindi: ' || NULLIF(p_reason, ''), 'Sotuv bekor qilindi'),
       p_operator, p_user, 'pharmacy_sales', p_sale);
  END IF;
  IF p_shift IS NOT NULL AND v_sale.paid_uzs - v_cash > 0 THEN
    INSERT INTO pharmacy_cash_movements
      (clinic_id, shift_id, kind, method, amount_uzs, notes, operator_id, created_by, ref_table, ref_id)
    VALUES
      (p_clinic, p_shift, 'refund', 'card', -(v_sale.paid_uzs - v_cash),
       COALESCE('Bekor qilindi (naqdsiz): ' || NULLIF(p_reason, ''), 'Sotuv bekor qilindi (naqdsiz)'),
       p_operator, p_user, 'pharmacy_sales', p_sale);
  END IF;

  RETURN jsonb_build_object('ok', true, 'cash_back_uzs', v_cash);
END;
$$;

REVOKE ALL ON FUNCTION public.pharmacy_void_sale_v2(uuid, uuid, uuid, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pharmacy_void_sale_v2(uuid, uuid, uuid, text, uuid, uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- E) Smena yig'indilari (X / Z hisobot)
-- ---------------------------------------------------------------------------
-- Sotuvlar YALPI hisoblanadi (keyin bekor qilinganlari ham) — bekor qilish va
-- qaytarish alohida "refund" harakati bo'lib qaysi smenada bo'lsa o'sha yerda
-- ayriladi. Shunda har smena o'z kunidagi haqiqiy pul oqimini ko'rsatadi.
CREATE OR REPLACE FUNCTION public.pharmacy_shift_totals(p_clinic uuid, p_shift uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift   RECORD;
  v_methods jsonb;
  v_moves   jsonb;
  v_gross   bigint;
  v_legs    bigint;
  v_cash_legs bigint;
  v_cash_moves bigint;
  v_count   integer;
  v_void    integer;
  v_disc    bigint;
  v_refunds bigint;
  v_ret_cnt integer;
BEGIN
  SELECT * INTO v_shift FROM pharmacy_shifts WHERE id = p_shift AND clinic_id = p_clinic;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Smena topilmadi';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE is_void), COALESCE(SUM(discount_uzs), 0)
    INTO v_count, v_void, v_disc
    FROM pharmacy_sales WHERE clinic_id = p_clinic AND pharmacy_shift_id = p_shift;

  SELECT COALESCE(SUM(i.subtotal_uzs), 0) INTO v_gross
    FROM pharmacy_sale_items i
    JOIN pharmacy_sales s ON s.id = i.sale_id
   WHERE s.clinic_id = p_clinic AND s.pharmacy_shift_id = p_shift;

  SELECT COALESCE(jsonb_object_agg(method, amt), '{}'::jsonb), COALESCE(SUM(amt), 0),
         COALESCE(SUM(amt) FILTER (WHERE method = 'cash'), 0)
    INTO v_methods, v_legs, v_cash_legs
    FROM (
      SELECT p.method, SUM(p.amount_uzs) AS amt
        FROM pharmacy_sale_payments p
        JOIN pharmacy_sales s ON s.id = p.sale_id
       WHERE s.clinic_id = p_clinic AND s.pharmacy_shift_id = p_shift
       GROUP BY p.method
    ) t;

  SELECT COALESCE(jsonb_object_agg(kind, amt), '{}'::jsonb) INTO v_moves
    FROM (
      SELECT kind, SUM(amount_uzs) AS amt FROM pharmacy_cash_movements
       WHERE clinic_id = p_clinic AND shift_id = p_shift GROUP BY kind
    ) t;

  SELECT COALESCE(SUM(amount_uzs) FILTER (WHERE method = 'cash'), 0),
         COALESCE(-SUM(amount_uzs) FILTER (WHERE kind = 'refund'), 0),
         count(*) FILTER (WHERE kind = 'refund')
    INTO v_cash_moves, v_refunds, v_ret_cnt
    FROM pharmacy_cash_movements WHERE clinic_id = p_clinic AND shift_id = p_shift;

  RETURN jsonb_build_object(
    'shift_id', p_shift,
    'register_no', v_shift.register_no,
    'opened_at', v_shift.opened_at,
    'closed_at', v_shift.closed_at,
    'opening_cash_uzs', v_shift.opening_cash_uzs,
    'sales_count', v_count,
    'void_count', v_void,
    'gross_uzs', v_gross,
    'discount_uzs', v_disc,
    'paid_uzs', v_legs,
    'debt_uzs', GREATEST(0, v_gross - v_legs),
    'by_method', v_methods,
    'movements', v_moves,
    'refunds_uzs', v_refunds,
    'returns_count', v_ret_cnt,
    'cash_sales_uzs', v_cash_legs,
    'cash_movements_uzs', v_cash_moves,
    'expected_cash_uzs', v_shift.opening_cash_uzs + v_cash_legs + v_cash_moves
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pharmacy_shift_totals(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pharmacy_shift_totals(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- F) Smenani yopish
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pharmacy_close_shift(
  p_clinic uuid, p_shift uuid, p_user uuid, p_operator uuid, p_actual_cash bigint, p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift  RECORD;
  v_totals jsonb;
  v_expected bigint;
  v_z integer;
BEGIN
  SELECT * INTO v_shift FROM pharmacy_shifts WHERE id = p_shift AND clinic_id = p_clinic FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Smena topilmadi';
  END IF;
  IF v_shift.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Smena allaqachon yopilgan';
  END IF;
  IF p_actual_cash IS NULL OR p_actual_cash < 0 THEN
    RAISE EXCEPTION 'Kassadagi naqd summani kiriting';
  END IF;

  v_totals := pharmacy_shift_totals(p_clinic, p_shift);
  v_expected := (v_totals->>'expected_cash_uzs')::bigint;

  -- Farq bo'lsa sabab majburiy (klinika kassasidagi qoida bilan bir xil)
  IF p_actual_cash <> v_expected AND COALESCE(btrim(p_notes), '') = '' THEN
    RAISE EXCEPTION 'Naqd farqi: % so''m. Smenani yopish uchun farq sababini izohda yozing.',
      p_actual_cash - v_expected;
  END IF;

  SELECT COALESCE(MAX(z_no), 0) + 1 INTO v_z
    FROM pharmacy_shifts WHERE clinic_id = p_clinic AND register_no = v_shift.register_no;

  UPDATE pharmacy_shifts
     SET closed_at = now(),
         closed_by_user = p_user,
         closed_by_operator = p_operator,
         expected_cash_uzs = v_expected,
         actual_cash_uzs = p_actual_cash,
         totals = v_totals,
         notes = NULLIF(btrim(p_notes), ''),
         z_no = v_z
   WHERE id = p_shift;

  RETURN v_totals || jsonb_build_object('z_no', v_z, 'actual_cash_uzs', p_actual_cash,
                                        'diff_uzs', p_actual_cash - v_expected);
END;
$$;

REVOKE ALL ON FUNCTION public.pharmacy_close_shift(uuid, uuid, uuid, uuid, bigint, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pharmacy_close_shift(uuid, uuid, uuid, uuid, bigint, text)
  TO service_role;
REVOKE ALL ON FUNCTION public.pharmacy_sale_cash_share(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pharmacy_sale_cash_share(uuid) TO service_role;
