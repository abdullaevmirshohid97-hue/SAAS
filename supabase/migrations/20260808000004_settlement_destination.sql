-- =============================================================================
-- NAQDSIZ TO'LOVDAGI PUL — yo'nalish tanlash (seyfga yoki bankka)
-- =============================================================================
-- Ilgari naqdsiz pul faqat "bankka" o'tardi. Amalda esa klinika egasi plastik/
-- o'tkazma pulini ikki xil yo'l bilan oladi:
--   1. BANKKA  — hisobda qoladi (o'tkazma, to'lovlar uchun ishlatiladi);
--   2. SEYFGA  — bankomat/kassadan naqd yechib, seyfga qo'yiladi.
-- Ikkinchi holatda pul JISMONAN naqdga aylanadi va seyf qoldig'iga qo'shilishi
-- kerak — aks holda seyfdagi haqiqiy pul tizimdagidan ko'p bo'lib qoladi.
-- =============================================================================

ALTER TABLE bank_settlements
  ADD COLUMN IF NOT EXISTS destination text NOT NULL DEFAULT 'bank';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bank_settlements_destination_check'
  ) THEN
    ALTER TABLE bank_settlements
      ADD CONSTRAINT bank_settlements_destination_check
      CHECK (destination IN ('bank', 'safe'));
  END IF;
END $$;

-- Ustunlar to'plami o'zgargani uchun avval o'chiriladi (CREATE OR REPLACE
-- qaytish turini o'zgartira olmaydi).
DROP FUNCTION IF EXISTS public.cashier_noncash_balance(uuid, text);

-- --- Naqdsiz balans: yo'nalish bo'yicha ajratilgan ---
CREATE FUNCTION public.cashier_noncash_balance(
  p_clinic   uuid,
  p_register text DEFAULT 'reception'
)
RETURNS TABLE (
  received_uzs   bigint,  -- naqdsiz to'lovlar (kirim)
  refunds_uzs    bigint,  -- naqdsiz vozvratlar
  settled_uzs    bigint,  -- olingan (jami: bank + seyf)
  to_bank_uzs    bigint,  -- shundan bankka
  to_safe_uzs    bigint,  -- shundan seyfga (naqdga aylangan)
  pending_uzs    bigint,  -- HALI OLINMAGAN
  expenses_uzs   bigint,  -- naqdsiz rasxot (bankdan)
  payroll_uzs    bigint,  -- naqdsiz maosh (bankdan)
  bank_uzs       bigint   -- BANKDAGI PUL
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH legs AS (
    SELECT kind, amount_uzs
    FROM transaction_payment_legs
    WHERE clinic_id = p_clinic
      AND register  = p_register
      AND is_void   = false
      AND method::text NOT IN ('cash', 'debt', 'mixed')
      AND (tx_source IS NULL OR tx_source::text <> 'safe')
  ),
  inc AS (
    SELECT
      COALESCE(SUM(amount_uzs) FILTER (WHERE kind = 'payment' AND amount_uzs > 0), 0)::bigint AS received,
      COALESCE(SUM(abs(amount_uzs)) FILTER (
        WHERE kind = 'refund' OR (kind = 'payment' AND amount_uzs < 0)
      ), 0)::bigint AS refunds
    FROM legs
  ),
  st AS (
    SELECT
      COALESCE(SUM(amount_uzs), 0)::bigint AS settled,
      COALESCE(SUM(amount_uzs) FILTER (WHERE destination = 'bank'), 0)::bigint AS to_bank,
      COALESCE(SUM(amount_uzs) FILTER (WHERE destination = 'safe'), 0)::bigint AS to_safe
    FROM bank_settlements
    WHERE clinic_id = p_clinic AND register = p_register AND is_void = false
  ),
  ex AS (
    SELECT COALESCE(SUM(amount_uzs), 0)::bigint AS e
    FROM expenses
    WHERE clinic_id = p_clinic AND register = p_register AND is_void = false
      AND COALESCE(payment_method::text, 'cash') NOT IN ('cash')
  ),
  pay AS (
    SELECT CASE WHEN p_register = 'reception'
                THEN COALESCE(SUM(net_uzs), 0) ELSE 0 END::bigint AS p
    FROM doctor_payouts
    WHERE clinic_id = p_clinic AND status = 'paid'
      AND COALESCE(method::text, 'cash') NOT IN ('cash')
  )
  SELECT inc.received, inc.refunds, st.settled, st.to_bank, st.to_safe,
         (inc.received - inc.refunds - st.settled)::bigint,
         ex.e, pay.p,
         -- Bankdagi pul: faqat BANKKA olingani, seyfga olingani bu yerda emas.
         (st.to_bank - ex.e - pay.p)::bigint
  FROM inc, st, ex, pay;
$$;

-- --- Seyfga o'tgan naqdsiz pul (seyf balansiga qo'shiladi) -------------------
CREATE OR REPLACE FUNCTION public.cashier_noncash_to_safe(
  p_clinic   uuid,
  p_register text DEFAULT 'reception'
)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM(amount_uzs), 0)::bigint
  FROM bank_settlements
  WHERE clinic_id = p_clinic AND register = p_register
    AND is_void = false AND destination = 'safe';
$$;

NOTIFY pgrst, 'reload schema';
