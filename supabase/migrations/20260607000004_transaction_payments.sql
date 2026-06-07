-- Aralash (split) to'lov "oyoqlari" (legs): bir tranzaksiya bir nechta usulda
-- to'langanda (masalan 120 000 naqd + 80 000 karta). FAQAT kind='payment' uchun.
-- Aralash bo'lsa transactions.payment_method='mixed' va bu yerga N qator yoziladi;
-- yagona usulли to'lovlar avvalgidek (leg yozilmaydi).
CREATE TABLE IF NOT EXISTS transaction_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  method payment_method_type NOT NULL,
  amount_uzs bigint NOT NULL CHECK (amount_uzs > 0),
  -- Naqd leg → 'cash_drawer'; karta/transfer → 'bank' (drawer naqdiga ta'sir qilmaydi).
  source text NOT NULL DEFAULT 'cash_drawer',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_txp_transaction ON transaction_payments(transaction_id);
CREATE INDEX IF NOT EXISTS idx_txp_clinic ON transaction_payments(clinic_id);

ALTER TABLE transaction_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clinic_isolation ON transaction_payments;
CREATE POLICY clinic_isolation ON transaction_payments
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.is_super_admin())
  WITH CHECK (clinic_id = public.get_my_clinic_id());

-- Birlashtirilgan to'lov oyoqlari: aralash tx legs'ga yoyiladi, qolganlari tx'ning
-- o'zi bitta oyoq. Barcha per-method aggregatsiyalar (smena cash/card, kassa
-- byMethod, cashFlow, seyfga o'tmagan naqd) shu view'dan o'qiydi → eski yo'l buzilmaydi.
CREATE OR REPLACE VIEW transaction_payment_legs WITH (security_invoker = true) AS
  SELECT tp.clinic_id, tp.transaction_id, t.shift_id, t.kind, t.is_void,
         t.created_at, t.source AS tx_source, t.notes,
         tp.method, tp.amount_uzs
    FROM transaction_payments tp
    JOIN transactions t ON t.id = tp.transaction_id
  UNION ALL
  SELECT t.clinic_id, t.id AS transaction_id, t.shift_id, t.kind, t.is_void,
         t.created_at, t.source AS tx_source, t.notes,
         t.payment_method AS method, t.amount_uzs
    FROM transactions t
    WHERE t.payment_method::text IS DISTINCT FROM 'mixed';
