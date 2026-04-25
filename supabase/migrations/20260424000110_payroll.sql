-- =============================================================================
-- Clary v2 — Migration 000110: Doctor payroll (commissions, ledger, payouts v2)
-- =============================================================================

-- Doctor commission rates (per-doctor default + optional service override)
CREATE TABLE IF NOT EXISTS doctor_commission_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  service_id UUID REFERENCES services(id) ON DELETE CASCADE,
  percent NUMERIC(5,2) NOT NULL CHECK (percent >= 0 AND percent <= 100),
  fixed_uzs BIGINT NOT NULL DEFAULT 0,
  valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_to DATE,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES profiles(id),
  updated_by UUID REFERENCES profiles(id),
  UNIQUE (clinic_id, doctor_id, service_id, valid_from)
);
CREATE INDEX IF NOT EXISTS idx_dcr_doctor ON doctor_commission_rates(clinic_id, doctor_id);

-- Commission accruals (one row per paid transaction attributable to a doctor)
CREATE TABLE IF NOT EXISTS doctor_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES profiles(id),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES appointments(id),
  service_id UUID REFERENCES services(id),
  gross_uzs BIGINT NOT NULL,
  percent NUMERIC(5,2) NOT NULL,
  fixed_uzs BIGINT NOT NULL DEFAULT 0,
  amount_uzs BIGINT NOT NULL, -- accrued to doctor
  payout_id UUID,             -- set when included in a payout
  status TEXT NOT NULL DEFAULT 'accrued' CHECK (status IN ('accrued', 'paid', 'reversed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, transaction_id, doctor_id)
);
CREATE INDEX IF NOT EXISTS idx_dc_doctor_status ON doctor_commissions(clinic_id, doctor_id, status);
CREATE INDEX IF NOT EXISTS idx_dc_payout ON doctor_commissions(payout_id);

-- Ledger: manual adjustments per doctor (advances, bonuses, fines)
CREATE TABLE IF NOT EXISTS doctor_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES profiles(id),
  kind TEXT NOT NULL CHECK (kind IN ('advance', 'bonus', 'penalty', 'adjustment', 'debt_write_off')),
  amount_uzs BIGINT NOT NULL, -- positive = owed to doctor, negative = reduces payout
  notes TEXT,
  reference TEXT,
  payout_id UUID,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'applied', 'reversed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES profiles(id)
);
CREATE INDEX IF NOT EXISTS idx_dl_doctor ON doctor_ledger(clinic_id, doctor_id, status);

-- Extend doctor_payouts with status + period lifecycle and ledger linkage
ALTER TABLE doctor_payouts
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'paid', 'canceled')),
  ADD COLUMN IF NOT EXISTS gross_commission_uzs BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adjustments_uzs BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS advances_uzs BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS period_label TEXT;

-- Link back: doctor_commissions.payout_id → doctor_payouts(id)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'doctor_commissions_payout_fk'
  ) THEN
    ALTER TABLE doctor_commissions
      ADD CONSTRAINT doctor_commissions_payout_fk
      FOREIGN KEY (payout_id) REFERENCES doctor_payouts(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'doctor_ledger_payout_fk'
  ) THEN
    ALTER TABLE doctor_ledger
      ADD CONSTRAINT doctor_ledger_payout_fk
      FOREIGN KEY (payout_id) REFERENCES doctor_payouts(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Helpful summary view: running balance per doctor
CREATE OR REPLACE VIEW doctor_balances_view AS
WITH accrued AS (
  SELECT clinic_id, doctor_id, COALESCE(SUM(amount_uzs), 0) AS total
  FROM doctor_commissions
  WHERE status = 'accrued'
  GROUP BY clinic_id, doctor_id
),
open_ledger AS (
  SELECT clinic_id, doctor_id, COALESCE(SUM(amount_uzs), 0) AS total
  FROM doctor_ledger
  WHERE status = 'open'
  GROUP BY clinic_id, doctor_id
),
paid AS (
  SELECT clinic_id, doctor_id, COALESCE(SUM(net_uzs), 0) AS total
  FROM doctor_payouts
  WHERE status = 'paid'
  GROUP BY clinic_id, doctor_id
)
SELECT
  p.clinic_id,
  p.id                         AS doctor_id,
  p.full_name,
  COALESCE(a.total, 0)         AS accrued_uzs,
  COALESCE(l.total, 0)         AS ledger_uzs,
  COALESCE(paid.total, 0)      AS paid_uzs,
  COALESCE(a.total, 0) + COALESCE(l.total, 0) AS balance_uzs
FROM profiles p
LEFT JOIN accrued a ON a.doctor_id = p.id AND a.clinic_id = p.clinic_id
LEFT JOIN open_ledger l ON l.doctor_id = p.id AND l.clinic_id = p.clinic_id
LEFT JOIN paid ON paid.doctor_id = p.id AND paid.clinic_id = p.clinic_id
WHERE p.role = 'doctor';

COMMENT ON VIEW doctor_balances_view IS
  'Running doctor payroll balance: accrued commissions + open ledger - already paid';

-- RLS
ALTER TABLE doctor_commission_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_dcr_tenant ON doctor_commission_rates;
CREATE POLICY p_dcr_tenant ON doctor_commission_rates
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

ALTER TABLE doctor_commissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_dc_tenant ON doctor_commissions;
CREATE POLICY p_dc_tenant ON doctor_commissions
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

ALTER TABLE doctor_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_dl_tenant ON doctor_ledger;
CREATE POLICY p_dl_tenant ON doctor_ledger
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');
