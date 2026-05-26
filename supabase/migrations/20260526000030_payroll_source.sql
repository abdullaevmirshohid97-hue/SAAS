-- Payroll payout uchun pul manbai (kassa drawer yoki seyf).

ALTER TABLE public.doctor_payouts
  ADD COLUMN IF NOT EXISTS source cashier_source NOT NULL DEFAULT 'cash_drawer';

CREATE INDEX IF NOT EXISTS idx_doctor_payouts_clinic_source
  ON public.doctor_payouts(clinic_id, source);

COMMENT ON COLUMN public.doctor_payouts.source IS 'Pul manbai: cash_drawer | safe';
