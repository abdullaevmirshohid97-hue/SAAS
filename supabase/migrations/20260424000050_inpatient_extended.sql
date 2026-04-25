-- =============================================================================
-- Clary v2 — Migration 50: Inpatient module — care schedule + patient ledger
--   * rooms: section (wing) + floor already exist; add building + status_notes
--   * room_bed_count / room occupancy derived from active stays
--   * care_items (planned care per stay: med/injection/procedure/exam)
--   * patient_ledger (wallet: deposits/charges per patient)
-- =============================================================================

-- Rooms: add section/building
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS section TEXT,           -- "A-kardiologiya", "B-terapiya"
  ADD COLUMN IF NOT EXISTS building TEXT,          -- "Asosiy", "2-chi bino"
  ADD COLUMN IF NOT EXISTS includes_meals BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE INDEX IF NOT EXISTS idx_rooms_section ON rooms(clinic_id, section, floor);

-- -----------------------------------------------------------------------------
-- care_items — per-stay planned care (medication, injection, procedure, exam)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS care_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  stay_id UUID NOT NULL REFERENCES inpatient_stays(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id),
  kind TEXT NOT NULL CHECK (kind IN ('medication', 'injection', 'procedure', 'examination', 'observation', 'note')),
  title TEXT NOT NULL,                               -- "Cefazolin 1g" | "EKG ertalab"
  medication_id UUID REFERENCES medications(id),
  dosage TEXT,
  quantity INT NOT NULL DEFAULT 1,
  route TEXT,                                        -- 'iv' | 'im' | 'oral' | 'topical'
  scheduled_at TIMESTAMPTZ NOT NULL,
  performed_at TIMESTAMPTZ,
  performed_by UUID REFERENCES profiles(id),
  assigned_to UUID REFERENCES profiles(id),          -- nurse assignment
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'performed', 'skipped', 'missed', 'canceled')),
  skip_reason TEXT,
  notes TEXT,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_care_items_stay ON care_items(stay_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_care_items_clinic_today ON care_items(clinic_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_care_items_assigned ON care_items(assigned_to, scheduled_at)
  WHERE status = 'scheduled';

DROP TRIGGER IF EXISTS tg_care_items_updated ON care_items;
CREATE TRIGGER tg_care_items_updated
  BEFORE UPDATE ON care_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE care_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_care_items_tenant ON care_items;
CREATE POLICY p_care_items_tenant ON care_items
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

-- -----------------------------------------------------------------------------
-- patient_ledger — per-patient wallet (deposits, charges, adjustments)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patient_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id),
  stay_id UUID REFERENCES inpatient_stays(id),
  entry_kind TEXT NOT NULL CHECK (entry_kind IN ('deposit', 'charge', 'refund', 'adjustment')),
  amount_uzs BIGINT NOT NULL,                         -- +credit for deposit, -debit for charge
  balance_after_uzs BIGINT,
  description TEXT,
  transaction_id UUID REFERENCES transactions(id),
  care_item_id UUID REFERENCES care_items(id),
  recorded_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_ledger_patient ON patient_ledger(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_patient_ledger_stay ON patient_ledger(stay_id, created_at DESC);

ALTER TABLE patient_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_patient_ledger_tenant ON patient_ledger;
CREATE POLICY p_patient_ledger_tenant ON patient_ledger
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

-- Append-only: ledger entries are immutable (only INSERT)
CREATE RULE no_update_patient_ledger AS ON UPDATE TO patient_ledger DO INSTEAD NOTHING;
CREATE RULE no_delete_patient_ledger AS ON DELETE TO patient_ledger DO INSTEAD NOTHING;

-- View for current balance per patient
CREATE OR REPLACE VIEW patient_balance AS
SELECT
  clinic_id,
  patient_id,
  COALESCE(SUM(amount_uzs), 0)::BIGINT AS balance_uzs,
  MAX(created_at) AS updated_at
FROM patient_ledger
GROUP BY clinic_id, patient_id;

-- -----------------------------------------------------------------------------
-- inpatient_stays: add bed_no, ledger_balance view back-reference
-- -----------------------------------------------------------------------------
ALTER TABLE inpatient_stays
  ADD COLUMN IF NOT EXISTS bed_no TEXT,
  ADD COLUMN IF NOT EXISTS meal_plan TEXT,
  ADD COLUMN IF NOT EXISTS attending_notes TEXT,
  ADD COLUMN IF NOT EXISTS planned_discharge_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_stays_room_active
  ON inpatient_stays(clinic_id, room_id)
  WHERE status = 'admitted';
