-- =============================================================================
-- Clary v2 — Migration 40: queue UX, service_referrals, prescriptions
-- - queues: colored ticket code (e.g. A001/R012) + human queue number
-- - service_referrals: doctor -> reception (diagnostics/lab/inpatient)
-- - prescriptions + prescription_items (doctor -> pharmacy)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- queues: extend schema
-- -----------------------------------------------------------------------------
ALTER TABLE queues
  ADD COLUMN IF NOT EXISTS ticket_code TEXT,               -- e.g. "A-012"
  ADD COLUMN IF NOT EXISTS ticket_color TEXT,              -- hex color (doctor-assigned)
  ADD COLUMN IF NOT EXISTS queue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS queue_seq INT,                  -- daily per-doctor seq (1..n)
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'reception', -- reception|referral|kiosk|online
  ADD COLUMN IF NOT EXISTS referral_id UUID,
  ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id),
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Helper: daily sequence per clinic+doctor
CREATE OR REPLACE FUNCTION next_queue_seq(p_clinic UUID, p_doctor UUID, p_date DATE)
RETURNS INT AS $$
DECLARE
  v_seq INT;
BEGIN
  SELECT COALESCE(MAX(queue_seq), 0) + 1
    INTO v_seq
    FROM queues
   WHERE clinic_id = p_clinic
     AND doctor_id = p_doctor
     AND queue_date = p_date;
  RETURN v_seq;
END;
$$ LANGUAGE plpgsql;

-- Auto-assign queue_seq/ticket_code
CREATE OR REPLACE FUNCTION tg_queues_assign_seq()
RETURNS TRIGGER AS $$
DECLARE
  v_prefix TEXT;
BEGIN
  IF NEW.queue_date IS NULL THEN NEW.queue_date := CURRENT_DATE; END IF;
  IF NEW.doctor_id IS NOT NULL AND NEW.queue_seq IS NULL THEN
    NEW.queue_seq := next_queue_seq(NEW.clinic_id, NEW.doctor_id, NEW.queue_date);
  END IF;
  IF NEW.ticket_code IS NULL AND NEW.queue_seq IS NOT NULL THEN
    -- default prefix = uppercased first letter of doctor full_name, else 'Q'
    SELECT COALESCE(UPPER(LEFT(p.full_name, 1)), 'Q') INTO v_prefix
      FROM profiles p WHERE p.id = NEW.doctor_id;
    NEW.ticket_code := COALESCE(v_prefix, 'Q') || '-' || LPAD(NEW.queue_seq::TEXT, 3, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_queues_assign_seq ON queues;
CREATE TRIGGER tg_queues_assign_seq
  BEFORE INSERT ON queues
  FOR EACH ROW EXECUTE FUNCTION tg_queues_assign_seq();

CREATE INDEX IF NOT EXISTS idx_queues_doctor_date
  ON queues(clinic_id, doctor_id, queue_date, status);

-- -----------------------------------------------------------------------------
-- service_referrals (doctor → reception for diagnostics/lab/inpatient)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id),
  appointment_id UUID REFERENCES appointments(id),
  stay_id UUID REFERENCES inpatient_stays(id),
  doctor_id UUID NOT NULL REFERENCES profiles(id),
  referral_kind TEXT NOT NULL CHECK (referral_kind IN ('diagnostic', 'lab', 'service', 'inpatient', 'other')),
  target_service_id UUID REFERENCES services(id),
  target_diagnostic_type_id UUID REFERENCES diagnostic_types(id),
  target_lab_test_id UUID REFERENCES lab_tests(id),
  target_room_id UUID REFERENCES rooms(id),
  urgency TEXT NOT NULL DEFAULT 'routine' CHECK (urgency IN ('routine', 'urgent', 'stat')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'received', 'billed', 'completed', 'canceled')),
  clinical_indication TEXT,
  notes TEXT,
  fulfilled_transaction_id UUID REFERENCES transactions(id),
  fulfilled_at TIMESTAMPTZ,
  fulfilled_by UUID REFERENCES profiles(id),
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_service_referrals_clinic_status
  ON service_referrals(clinic_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_referrals_patient
  ON service_referrals(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_referrals_doctor
  ON service_referrals(doctor_id, created_at DESC);

DROP TRIGGER IF EXISTS tg_service_referrals_updated ON service_referrals;
CREATE TRIGGER tg_service_referrals_updated
  BEFORE UPDATE ON service_referrals
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE service_referrals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_service_referrals_tenant ON service_referrals;
CREATE POLICY p_service_referrals_tenant ON service_referrals
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

-- Back-link queues.referral_id
ALTER TABLE queues
  DROP CONSTRAINT IF EXISTS fk_queues_referral;
ALTER TABLE queues
  ADD CONSTRAINT fk_queues_referral
  FOREIGN KEY (referral_id) REFERENCES service_referrals(id);

-- -----------------------------------------------------------------------------
-- prescriptions + items (doctor → pharmacy)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prescriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id),
  doctor_id UUID NOT NULL REFERENCES profiles(id),
  appointment_id UUID REFERENCES appointments(id),
  stay_id UUID REFERENCES inpatient_stays(id),
  rx_number TEXT,                -- human-readable Rx#
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'partially_dispensed', 'dispensed', 'canceled', 'expired')),
  diagnosis_code TEXT,
  diagnosis_text TEXT,
  instructions TEXT,
  valid_until DATE,
  is_signed BOOLEAN NOT NULL DEFAULT false,
  signed_at TIMESTAMPTZ,
  total_estimated_uzs BIGINT NOT NULL DEFAULT 0,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_prescriptions_patient
  ON prescriptions(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prescriptions_clinic_status
  ON prescriptions(clinic_id, status, created_at DESC);

DROP TRIGGER IF EXISTS tg_prescriptions_updated ON prescriptions;
CREATE TRIGGER tg_prescriptions_updated
  BEFORE UPDATE ON prescriptions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS prescription_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL,
  prescription_id UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  medication_id UUID REFERENCES medications(id),
  medication_name_snapshot TEXT NOT NULL,
  dosage TEXT,                   -- "500mg"
  route TEXT,                    -- "oral", "iv"
  frequency TEXT,                -- "3x/day"
  duration TEXT,                 -- "7 days"
  quantity INT NOT NULL DEFAULT 1,
  dispensed_qty INT NOT NULL DEFAULT 0,
  unit_price_snapshot BIGINT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prescription_items_rx
  ON prescription_items(prescription_id);

ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescription_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_prescriptions_tenant ON prescriptions;
CREATE POLICY p_prescriptions_tenant ON prescriptions
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

DROP POLICY IF EXISTS p_prescription_items_tenant ON prescription_items;
CREATE POLICY p_prescription_items_tenant ON prescription_items
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

-- Append-only on dispensed items
CREATE OR REPLACE FUNCTION tg_rx_items_no_reduce()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.dispensed_qty < OLD.dispensed_qty THEN
    RAISE EXCEPTION 'dispensed_qty cannot decrease';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_rx_items_no_reduce ON prescription_items;
CREATE TRIGGER tg_rx_items_no_reduce
  BEFORE UPDATE ON prescription_items
  FOR EACH ROW EXECUTE FUNCTION tg_rx_items_no_reduce();
