-- Kassir amallarida pul manbai: kassa drawer (bugungi tushum) yoki seyf.
-- Refund, encashment, adjustment, expense — har birida foydalanuvchi tanlaydi.
-- Default 'cash_drawer' eski xulq saqlash uchun.

CREATE TYPE cashier_source AS ENUM ('cash_drawer', 'safe');

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS source cashier_source NOT NULL DEFAULT 'cash_drawer';

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS source cashier_source NOT NULL DEFAULT 'cash_drawer';

-- Eski yozuvlar uchun: cash_drawer default qoldi. Inkasatsiya (encashment)
-- tx'lar: kind='adjustment' + amount<0 + payment_method='cash' — ular seyfga
-- pul kelishi (cash_drawer → safe), source mantiqan 'cash_drawer' qoladi
-- (kassadan chiqdi).

CREATE INDEX IF NOT EXISTS idx_transactions_clinic_source
  ON public.transactions(clinic_id, source)
  WHERE is_void = false;

CREATE INDEX IF NOT EXISTS idx_expenses_clinic_source
  ON public.expenses(clinic_id, source)
  WHERE is_void = false;

COMMENT ON COLUMN public.transactions.source IS 'Pul manbai: cash_drawer (kassa) | safe (seyf, encashment qoldigi)';
COMMENT ON COLUMN public.expenses.source IS 'Pul manbai: cash_drawer (kassa) | safe (seyf, encashment qoldigi)';
