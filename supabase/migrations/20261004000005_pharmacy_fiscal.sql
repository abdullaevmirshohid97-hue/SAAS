-- =============================================================================
-- DORIXONA 2.0 — Fiskal chek (Faza 11) + Savatcha moslashuvi
-- =============================================================================
--   A) pharmacy_fiscal_settings  — fiskal sozlama (provayder, STIR, terminal)
--   B) fiscal_receipts           — har sotuv/qaytarish uchun fiskal chek navbati va natijasi
--   C) trash_delete_pharmacy_sale / trash_restore — to'lov qismlari ham arxivlanadi;
--      fiskallashtirilgan (yuborilgan) sotuvni o'chirib bo'lmaydi (faqat qaytarish).
--
-- Provayder kodi API'da (adapter): 'test' — sinov rejimi (haqiqiy fiskal EMAS,
-- chekda "TEST" deb yoziladi), 'http' — tashqi fiskal xizmatga JSON so'rov.
-- Kalit/token Supabase Vault'da (secret_vault_id), bazada ochiq saqlanmaydi.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A) Sozlama
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pharmacy_fiscal_settings (
  clinic_id           uuid PRIMARY KEY REFERENCES public.clinics(id) ON DELETE CASCADE,
  enabled             boolean NOT NULL DEFAULT false,
  provider            text NOT NULL DEFAULT 'test' CHECK (provider IN ('test', 'http')),
  company_tin         text,
  company_name        text,
  terminal_id         text,
  endpoint_url        text,
  secret_vault_id     uuid,
  auto_send           boolean NOT NULL DEFAULT true,
  block_without_mxik  boolean NOT NULL DEFAULT false,
  default_vat_percent numeric(5,2) NOT NULL DEFAULT 0,
  updated_by          uuid REFERENCES public.profiles(id),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pharmacy_fiscal_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pharmacy_fiscal_settings FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- B) Fiskal cheklar
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fiscal_receipts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  sale_id       uuid NOT NULL REFERENCES public.pharmacy_sales(id) ON DELETE RESTRICT,
  kind          text NOT NULL DEFAULT 'sale' CHECK (kind IN ('sale', 'refund')),
  ref_key       text NOT NULL DEFAULT 'sale',
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  provider      text,
  is_test       boolean NOT NULL DEFAULT false,
  payload       jsonb NOT NULL,
  response      jsonb,
  fiscal_sign   text,
  fiscal_number text,
  terminal_id   text,
  qr_url        text,
  total_uzs     bigint,
  attempts      integer NOT NULL DEFAULT 0,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz,
  UNIQUE (sale_id, ref_key)
);
CREATE INDEX IF NOT EXISTS idx_fiscal_receipts_queue
  ON public.fiscal_receipts (status, created_at) WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_fiscal_receipts_clinic
  ON public.fiscal_receipts (clinic_id, created_at DESC);

ALTER TABLE public.fiscal_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fiscal_receipts FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- C) Savatcha (trash) — to'lov qismlari va fiskal himoya
-- ---------------------------------------------------------------------------
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

  -- Fiskal chek yuborilgan sotuv qonuniy hujjat — o'chirilmaydi, faqat qaytariladi.
  IF EXISTS (SELECT 1 FROM fiscal_receipts
              WHERE sale_id = p_sale AND status = 'sent' AND NOT is_test) THEN
    RAISE EXCEPTION 'Bu sotuvga fiskal chek chiqarilgan — o''chirib bo''lmaydi. Qaytarish (vozvrat) qiling.';
  END IF;

  v_payload := jsonb_build_object(
    'pharmacy_sales',          coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM pharmacy_sales s WHERE s.id = p_sale), '[]'::jsonb),
    'pharmacy_sale_items',     coalesce((SELECT jsonb_agg(to_jsonb(i)) FROM pharmacy_sale_items i WHERE i.sale_id = p_sale), '[]'::jsonb),
    'pharmacy_sale_payments',  coalesce((SELECT jsonb_agg(to_jsonb(p)) FROM pharmacy_sale_payments p WHERE p.sale_id = p_sale), '[]'::jsonb),
    'pharmacy_clinic_ledger',  coalesce((SELECT jsonb_agg(to_jsonb(l)) FROM pharmacy_clinic_ledger l WHERE l.sale_id = p_sale), '[]'::jsonb),
    'pharmacy_stock_movements',coalesce((SELECT jsonb_agg(to_jsonb(m)) FROM pharmacy_stock_movements m WHERE m.sale_id = p_sale), '[]'::jsonb)
  );

  INSERT INTO trash_bin (clinic_id, kind, source_id, reason, summary, payload, deleted_by)
  VALUES (p_clinic_id, 'pharmacy_sale', p_sale, p_reason, p_summary, v_payload, p_deleted_by)
  RETURNING id INTO v_id;

  -- Faqat qaytarilmagan qism omborga qaytadi (qaytarilgani allaqachon qaytgan).
  -- Bekor qilingan savdoning zaxirasi bekor qilishda qaytgan — qayta qo'shilmaydi.
  IF NOT (SELECT is_void FROM pharmacy_sales WHERE id = p_sale) THEN
    FOR v_item IN SELECT medication_id, batch_id, quantity - returned_qty AS qty
                    FROM pharmacy_sale_items WHERE sale_id = p_sale AND quantity - returned_qty > 0 LOOP
      IF v_item.batch_id IS NOT NULL THEN
        UPDATE medication_batches SET qty_remaining = qty_remaining + v_item.qty WHERE id = v_item.batch_id;
      END IF;
      UPDATE medications SET stock = stock + v_item.qty
        WHERE id = v_item.medication_id AND clinic_id = p_clinic_id;
    END LOOP;
  END IF;

  DELETE FROM fiscal_receipts          WHERE sale_id = p_sale;   -- faqat yuborilmagan/test qoldi
  DELETE FROM pharmacy_stock_movements WHERE sale_id = p_sale;
  DELETE FROM pharmacy_clinic_ledger   WHERE sale_id = p_sale;
  DELETE FROM pharmacy_sale_payments   WHERE sale_id = p_sale;
  DELETE FROM pharmacy_sale_items      WHERE sale_id = p_sale;
  DELETE FROM pharmacy_sales           WHERE id = p_sale AND clinic_id = p_clinic_id;

  RETURN v_id;
END;
$$;

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
    PERFORM _trash_reinsert('pharmacy_sale_payments',   pl->'pharmacy_sale_payments');
    PERFORM _trash_reinsert('pharmacy_clinic_ledger',   pl->'pharmacy_clinic_ledger');
    PERFORM _trash_reinsert('pharmacy_stock_movements', pl->'pharmacy_stock_movements');
    -- O'chirishda qaytgan miqdorni qayta yechamiz (bekor qilingan savdo — hech narsa)
    IF NOT COALESCE((pl->'pharmacy_sales'->0->>'is_void')::boolean, false) THEN
      FOR v_item IN SELECT * FROM jsonb_to_recordset(pl->'pharmacy_sale_items')
                    AS x(medication_id uuid, batch_id uuid, quantity int, returned_qty int) LOOP
        IF v_item.quantity - COALESCE(v_item.returned_qty, 0) > 0 THEN
          IF v_item.batch_id IS NOT NULL THEN
            UPDATE medication_batches
               SET qty_remaining = qty_remaining - (v_item.quantity - COALESCE(v_item.returned_qty, 0))
             WHERE id = v_item.batch_id;
          END IF;
          UPDATE medications SET stock = stock - (v_item.quantity - COALESCE(v_item.returned_qty, 0))
            WHERE id = v_item.medication_id AND clinic_id = p_clinic_id;
        END IF;
      END LOOP;
    END IF;

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

GRANT EXECUTE ON FUNCTION public.trash_delete_pharmacy_sale(uuid,uuid,uuid,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.trash_restore(uuid,uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.trash_delete_pharmacy_sale(uuid,uuid,uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trash_restore(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
