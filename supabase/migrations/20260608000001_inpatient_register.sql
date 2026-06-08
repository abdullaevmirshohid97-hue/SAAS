-- Statsionarni alohida moliyaviy bo'lim qilish uchun "register" o'lchovi.
-- register: 'reception' (default) | 'inpatient'. Kassa/seyf/jurnal shu bo'yicha
-- filtrlanadi → asosiy kassa statsionarni ko'rsatmaydi, statsionar o'z ko'rinishiga ega.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS register text NOT NULL DEFAULT 'reception';
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS register text NOT NULL DEFAULT 'reception';
ALTER TABLE safe_deposits ADD COLUMN IF NOT EXISTS register text NOT NULL DEFAULT 'reception';

CREATE INDEX IF NOT EXISTS idx_transactions_register ON transactions(clinic_id, register);
CREATE INDEX IF NOT EXISTS idx_expenses_register ON expenses(clinic_id, register);
CREATE INDEX IF NOT EXISTS idx_safe_deposits_register ON safe_deposits(clinic_id, register);

-- Backfill: mavjud statsionar tranzaksiyalari (stay_id bor) → inpatient registr.
UPDATE transactions SET register = 'inpatient' WHERE stay_id IS NOT NULL AND register <> 'inpatient';

-- transaction_payment_legs view'iga register ustunini qo'shish (aggregatsiyalar
-- register bo'yicha scope qila olishi uchun). DROP+CREATE — ustun tartibi erkin.
DROP VIEW IF EXISTS transaction_payment_legs;
CREATE VIEW transaction_payment_legs WITH (security_invoker = true) AS
  SELECT tp.clinic_id, tp.transaction_id, t.shift_id, t.kind, t.is_void,
         t.created_at, t.source AS tx_source, t.notes, t.register,
         tp.method, tp.amount_uzs
    FROM transaction_payments tp
    JOIN transactions t ON t.id = tp.transaction_id
  UNION ALL
  SELECT t.clinic_id, t.id AS transaction_id, t.shift_id, t.kind, t.is_void,
         t.created_at, t.source AS tx_source, t.notes, t.register,
         t.payment_method AS method, t.amount_uzs
    FROM transactions t
    WHERE t.payment_method::text IS DISTINCT FROM 'mixed';
