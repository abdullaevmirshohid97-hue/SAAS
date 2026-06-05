-- =============================================================================
-- SAVATCHA (Trash / O'chirilganlar) — bittalab o'chirilgan yozuvlarni arxivlab
-- saqlash + qaytarish. Jurnal tranzaksiyasi, dorixona savdosi, statsionar yozuvi.
--
-- Har o'chirishda to'liq snapshot saqlanadi:
--   summary jsonb — ko'rsatish uchun (bemor, shifokor, smena, xizmatlar+turi, jami)
--   payload jsonb — qaytarish uchun (har jadval qatorlari massiv ko'rinishida)
--
-- patient_ledger APPEND-ONLY (no_delete/no_update RULE) — DELETE bloklanadi,
-- shuning uchun delete RPC'lar rule'ni vaqtincha o'chiradi (hard_delete_transaction
-- namunasida). INSERT (restore) bloklanmaydi.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.trash_bin (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('transaction','pharmacy_sale','inpatient')),
  source_id    uuid NOT NULL,
  reason       text NOT NULL,
  summary      jsonb NOT NULL,
  payload      jsonb NOT NULL,
  deleted_by   uuid REFERENCES profiles(id),
  deleted_at   timestamptz NOT NULL DEFAULT now(),
  restored_by  uuid REFERENCES profiles(id),
  restored_at  timestamptz
);

CREATE INDEX IF NOT EXISTS trash_bin_clinic_deleted_idx
  ON public.trash_bin (clinic_id, deleted_at DESC);

-- RLS yoqilgan, policy yo'q → faqat service_role (backend admin) ko'radi.
ALTER TABLE public.trash_bin ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- Yordamchi: jsonb massivni jadvalga qayta INSERT qiladi (id bo'yicha idempotent).
-- Barcha jadvallarda `id` ustuni bor. to_jsonb(row) barcha ustunlarni saqlaydi,
-- shuning uchun jsonb_populate_recordset ustun tartibiga mos qatorlar beradi.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._trash_reinsert(p_table regclass, p_rows jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN;
  END IF;
  EXECUTE format(
    'INSERT INTO %1$s SELECT s.* FROM jsonb_populate_recordset(NULL::%1$s, $1) AS s '
    || 'WHERE NOT EXISTS (SELECT 1 FROM %1$s t WHERE t.id = s.id)',
    p_table
  ) USING p_rows;
END;
$$;

-- =============================================================================
-- 1) JURNAL TRANZAKSIYASI — arxivla + o'chir
-- =============================================================================
CREATE OR REPLACE FUNCTION public.trash_delete_transaction(
  p_clinic_id uuid, p_tx uuid, p_deleted_by uuid, p_reason text, p_summary jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid; v_payload jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM transactions WHERE id = p_tx AND clinic_id = p_clinic_id) THEN
    RAISE EXCEPTION 'Tranzaksiya topilmadi yoki ruxsat yo''q';
  END IF;

  v_payload := jsonb_build_object(
    'transactions',       coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM transactions t WHERE t.id = p_tx), '[]'::jsonb),
    'transaction_items',  coalesce((SELECT jsonb_agg(to_jsonb(i)) FROM transaction_items i WHERE i.transaction_id = p_tx), '[]'::jsonb),
    'doctor_commissions', coalesce((SELECT jsonb_agg(to_jsonb(d)) FROM doctor_commissions d WHERE d.transaction_id = p_tx), '[]'::jsonb),
    'patient_ledger',     coalesce((SELECT jsonb_agg(to_jsonb(l)) FROM patient_ledger l WHERE l.transaction_id = p_tx), '[]'::jsonb)
  );

  INSERT INTO trash_bin (clinic_id, kind, source_id, reason, summary, payload, deleted_by)
  VALUES (p_clinic_id, 'transaction', p_tx, p_reason, p_summary, v_payload, p_deleted_by)
  RETURNING id INTO v_id;

  ALTER TABLE patient_ledger DISABLE RULE no_delete_patient_ledger;
  BEGIN
    DELETE FROM patient_ledger WHERE transaction_id = p_tx AND clinic_id = p_clinic_id;
    UPDATE payment_qr_invoices SET transaction_id = NULL WHERE transaction_id = p_tx;
    UPDATE home_nurse_visits   SET transaction_id = NULL WHERE transaction_id = p_tx;
    UPDATE service_referrals   SET fulfilled_transaction_id = NULL WHERE fulfilled_transaction_id = p_tx;
    DELETE FROM transactions WHERE id = p_tx AND clinic_id = p_clinic_id;
  EXCEPTION WHEN OTHERS THEN
    ALTER TABLE patient_ledger ENABLE RULE no_delete_patient_ledger;
    RAISE;
  END;
  ALTER TABLE patient_ledger ENABLE RULE no_delete_patient_ledger;

  RETURN v_id;
END;
$$;

-- =============================================================================
-- 2) DORIXONA SAVDOSI — arxivla + zaxirani qaytar + o'chir
-- =============================================================================
CREATE OR REPLACE FUNCTION public.trash_delete_pharmacy_sale(
  p_clinic_id uuid, p_sale uuid, p_deleted_by uuid, p_reason text, p_summary jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid; v_payload jsonb; v_item RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pharmacy_sales WHERE id = p_sale AND clinic_id = p_clinic_id) THEN
    RAISE EXCEPTION 'Savdo topilmadi yoki ruxsat yo''q';
  END IF;

  v_payload := jsonb_build_object(
    'pharmacy_sales',          coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM pharmacy_sales s WHERE s.id = p_sale), '[]'::jsonb),
    'pharmacy_sale_items',     coalesce((SELECT jsonb_agg(to_jsonb(i)) FROM pharmacy_sale_items i WHERE i.sale_id = p_sale), '[]'::jsonb),
    'pharmacy_clinic_ledger',  coalesce((SELECT jsonb_agg(to_jsonb(l)) FROM pharmacy_clinic_ledger l WHERE l.sale_id = p_sale), '[]'::jsonb),
    'pharmacy_stock_movements',coalesce((SELECT jsonb_agg(to_jsonb(m)) FROM pharmacy_stock_movements m WHERE m.sale_id = p_sale), '[]'::jsonb)
  );

  INSERT INTO trash_bin (clinic_id, kind, source_id, reason, summary, payload, deleted_by)
  VALUES (p_clinic_id, 'pharmacy_sale', p_sale, p_reason, p_summary, v_payload, p_deleted_by)
  RETURNING id INTO v_id;

  -- Zaxirani qaytaramiz (savdo bekor bo'lgani kabi)
  FOR v_item IN SELECT medication_id, batch_id, quantity FROM pharmacy_sale_items WHERE sale_id = p_sale LOOP
    IF v_item.batch_id IS NOT NULL THEN
      UPDATE medication_batches SET qty_remaining = qty_remaining + v_item.quantity WHERE id = v_item.batch_id;
    END IF;
    UPDATE medications SET stock = stock + v_item.quantity
      WHERE id = v_item.medication_id AND clinic_id = p_clinic_id;
  END LOOP;

  DELETE FROM pharmacy_stock_movements WHERE sale_id = p_sale;
  DELETE FROM pharmacy_clinic_ledger   WHERE sale_id = p_sale;
  DELETE FROM pharmacy_sale_items      WHERE sale_id = p_sale;  -- (CASCADE ham bor)
  DELETE FROM pharmacy_sales           WHERE id = p_sale AND clinic_id = p_clinic_id;

  RETURN v_id;
END;
$$;

-- =============================================================================
-- 3) STATSIONAR YOZUVI — arxivla + o'chir
-- Moliyaviy + strukturaviy kaskad. Klinik NO ACTION bolalar (vital_signs,
-- treatment_notes, prescriptions, service_referrals) mavjud bo'lsa — DELETE
-- xato beradi va butun amal bekor bo'ladi (ma'lumot buzilmaydi). Bunday holda
-- avval klinik yozuvlar tozalanishi kerak.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.trash_delete_inpatient_stay(
  p_clinic_id uuid, p_stay uuid, p_deleted_by uuid, p_reason text, p_summary jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid; v_payload jsonb; v_tx uuid[]; v_care uuid[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM inpatient_stays WHERE id = p_stay AND clinic_id = p_clinic_id) THEN
    RAISE EXCEPTION 'Statsionar yozuvi topilmadi yoki ruxsat yo''q';
  END IF;

  v_tx   := ARRAY(SELECT id FROM transactions WHERE stay_id = p_stay AND clinic_id = p_clinic_id);
  v_care := ARRAY(SELECT id FROM care_items   WHERE stay_id = p_stay AND clinic_id = p_clinic_id);

  v_payload := jsonb_build_object(
    'inpatient_stays',        coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM inpatient_stays s WHERE s.id = p_stay), '[]'::jsonb),
    'stay_assignments',       coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM stay_assignments x WHERE x.stay_id = p_stay), '[]'::jsonb),
    'inpatient_meal_periods', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM inpatient_meal_periods x WHERE x.stay_id = p_stay), '[]'::jsonb),
    'inpatient_transfers',    coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM inpatient_transfers x WHERE x.stay_id = p_stay), '[]'::jsonb),
    'inpatient_doctor_changes',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM inpatient_doctor_changes x WHERE x.stay_id = p_stay), '[]'::jsonb),
    'care_items',             coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM care_items x WHERE x.stay_id = p_stay), '[]'::jsonb),
    'transactions',           coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM transactions t WHERE t.stay_id = p_stay), '[]'::jsonb),
    'transaction_items',      coalesce((SELECT jsonb_agg(to_jsonb(i)) FROM transaction_items i WHERE i.transaction_id = ANY(v_tx)), '[]'::jsonb),
    'doctor_commissions',     coalesce((SELECT jsonb_agg(to_jsonb(d)) FROM doctor_commissions d WHERE d.transaction_id = ANY(v_tx)), '[]'::jsonb),
    'patient_ledger',         coalesce((SELECT jsonb_agg(to_jsonb(l)) FROM patient_ledger l
                                        WHERE l.stay_id = p_stay OR l.transaction_id = ANY(v_tx) OR l.care_item_id = ANY(v_care)), '[]'::jsonb)
  );

  INSERT INTO trash_bin (clinic_id, kind, source_id, reason, summary, payload, deleted_by)
  VALUES (p_clinic_id, 'inpatient', p_stay, p_reason, p_summary, v_payload, p_deleted_by)
  RETURNING id INTO v_id;

  ALTER TABLE patient_ledger DISABLE RULE no_delete_patient_ledger;
  BEGIN
    DELETE FROM patient_ledger
      WHERE clinic_id = p_clinic_id
        AND (stay_id = p_stay OR transaction_id = ANY(v_tx) OR care_item_id = ANY(v_care));
    UPDATE payment_qr_invoices SET transaction_id = NULL WHERE transaction_id = ANY(v_tx);
    UPDATE home_nurse_visits   SET transaction_id = NULL WHERE transaction_id = ANY(v_tx);
    UPDATE service_referrals   SET fulfilled_transaction_id = NULL WHERE fulfilled_transaction_id = ANY(v_tx);
    DELETE FROM transactions WHERE stay_id = p_stay AND clinic_id = p_clinic_id;
    -- inpatient_stays o'chirilganda CASCADE bolalar (assignments, meal_periods,
    -- transfers, doctor_changes, care_items) avtomatik o'chadi.
    DELETE FROM inpatient_stays WHERE id = p_stay AND clinic_id = p_clinic_id;
  EXCEPTION WHEN OTHERS THEN
    ALTER TABLE patient_ledger ENABLE RULE no_delete_patient_ledger;
    RAISE;
  END;
  ALTER TABLE patient_ledger ENABLE RULE no_delete_patient_ledger;

  RETURN v_id;
END;
$$;

-- =============================================================================
-- QAYTARISH — payload qatorlarini ota→bola tartibida qayta INSERT (idempotent).
-- Pharmacy uchun zaxira qayta yechiladi (−qty).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.trash_restore(
  p_clinic_id uuid, p_id uuid, p_restored_by uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v RECORD; pl jsonb; v_item RECORD;
BEGIN
  SELECT * INTO v FROM trash_bin WHERE id = p_id AND clinic_id = p_clinic_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Savatcha yozuvi topilmadi'; END IF;
  IF v.restored_at IS NOT NULL THEN RETURN; END IF;  -- idempotent
  pl := v.payload;

  IF v.kind = 'transaction' THEN
    PERFORM _trash_reinsert('transactions',       pl->'transactions');
    PERFORM _trash_reinsert('transaction_items',  pl->'transaction_items');
    PERFORM _trash_reinsert('doctor_commissions', pl->'doctor_commissions');
    PERFORM _trash_reinsert('patient_ledger',     pl->'patient_ledger');

  ELSIF v.kind = 'pharmacy_sale' THEN
    PERFORM _trash_reinsert('pharmacy_sales',           pl->'pharmacy_sales');
    PERFORM _trash_reinsert('pharmacy_sale_items',      pl->'pharmacy_sale_items');
    PERFORM _trash_reinsert('pharmacy_clinic_ledger',   pl->'pharmacy_clinic_ledger');
    PERFORM _trash_reinsert('pharmacy_stock_movements', pl->'pharmacy_stock_movements');
    -- zaxirani qayta yechamiz (savdo qaytdi)
    FOR v_item IN SELECT * FROM jsonb_to_recordset(pl->'pharmacy_sale_items')
                  AS x(medication_id uuid, batch_id uuid, quantity int) LOOP
      IF v_item.batch_id IS NOT NULL THEN
        UPDATE medication_batches SET qty_remaining = qty_remaining - v_item.quantity WHERE id = v_item.batch_id;
      END IF;
      UPDATE medications SET stock = stock - v_item.quantity
        WHERE id = v_item.medication_id AND clinic_id = p_clinic_id;
    END LOOP;

  ELSIF v.kind = 'inpatient' THEN
    PERFORM _trash_reinsert('inpatient_stays',         pl->'inpatient_stays');
    PERFORM _trash_reinsert('transactions',            pl->'transactions');
    PERFORM _trash_reinsert('transaction_items',       pl->'transaction_items');
    PERFORM _trash_reinsert('doctor_commissions',      pl->'doctor_commissions');
    PERFORM _trash_reinsert('stay_assignments',        pl->'stay_assignments');
    PERFORM _trash_reinsert('inpatient_meal_periods',  pl->'inpatient_meal_periods');
    PERFORM _trash_reinsert('inpatient_transfers',     pl->'inpatient_transfers');
    PERFORM _trash_reinsert('inpatient_doctor_changes',pl->'inpatient_doctor_changes');
    PERFORM _trash_reinsert('care_items',              pl->'care_items');
    PERFORM _trash_reinsert('patient_ledger',          pl->'patient_ledger');
  ELSE
    RAISE EXCEPTION 'Noma''lum tur: %', v.kind;
  END IF;

  UPDATE trash_bin SET restored_at = now(), restored_by = p_restored_by WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.trash_delete_transaction(uuid,uuid,uuid,text,jsonb)    TO service_role;
GRANT EXECUTE ON FUNCTION public.trash_delete_pharmacy_sale(uuid,uuid,uuid,text,jsonb)  TO service_role;
GRANT EXECUTE ON FUNCTION public.trash_delete_inpatient_stay(uuid,uuid,uuid,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.trash_restore(uuid,uuid,uuid)                          TO service_role;
