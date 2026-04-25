-- =============================================================================
-- Clary v2 — Migration 000020: Clinical schema
-- Patients, appointments, queues, diagnostic orders/results, lab orders/results,
-- inpatient stays, vital signs, treatment notes, pharmacy sales.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- patients (PII: id_number, phone encrypted via pgsodium hooks)
-- -----------------------------------------------------------------------------
CREATE TABLE patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  mrn TEXT, -- medical record number (human-readable)
  full_name TEXT NOT NULL,
  dob DATE,
  gender TEXT CHECK (gender IN ('male', 'female', 'other', 'unknown')),
  phone TEXT, -- encrypted application-side via pgsodium wrapper
  secondary_phone TEXT,
  email TEXT,
  id_number TEXT, -- encrypted
  id_type TEXT, -- 'passport' | 'id' | 'driver'
  address TEXT,
  city TEXT,
  region TEXT,
  notes TEXT,
  tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  blood_type TEXT,
  allergies JSONB DEFAULT '[]'::jsonb,
  chronic_conditions JSONB DEFAULT '[]'::jsonb,
  emergency_contact JSONB,
  insurance_company_id UUID REFERENCES insurance_companies(id),
  insurance_policy_no TEXT,
  referral_partner_id UUID REFERENCES referral_partners(id),
  loyalty_points INT NOT NULL DEFAULT 0,
  processing_restricted BOOLEAN NOT NULL DEFAULT false,
  marketing_opted_out BOOLEAN NOT NULL DEFAULT false,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES profiles(id)
);
CREATE INDEX idx_patients_clinic ON patients(clinic_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_patients_name_trgm ON patients USING gin (full_name gin_trgm_ops);
CREATE INDEX idx_patients_mrn ON patients(clinic_id, mrn) WHERE deleted_at IS NULL;

CREATE TRIGGER tg_patients_updated BEFORE UPDATE ON patients
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- -----------------------------------------------------------------------------
-- appointments
-- -----------------------------------------------------------------------------
CREATE TABLE appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id),
  doctor_id UUID REFERENCES profiles(id),
  service_id UUID REFERENCES services(id),
  room_id UUID REFERENCES rooms(id),
  scheduled_at TIMESTAMPTZ NOT NULL,
  duration_min INT NOT NULL DEFAULT 30,
  status appointment_status NOT NULL DEFAULT 'scheduled',
  -- Snapshot (price at booking time)
  service_name_snapshot TEXT,
  service_price_snapshot BIGINT,
  reason TEXT,
  notes TEXT,
  checked_in_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  canceled_reason TEXT,
  reminder_sent_at TIMESTAMPTZ,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES profiles(id)
);
CREATE INDEX idx_appointments_clinic_date ON appointments(clinic_id, scheduled_at);
CREATE INDEX idx_appointments_doctor ON appointments(doctor_id, scheduled_at);
CREATE INDEX idx_appointments_patient ON appointments(patient_id, scheduled_at DESC);

CREATE TRIGGER tg_appointments_updated BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- -----------------------------------------------------------------------------
-- queues (live waiting-room state)
-- -----------------------------------------------------------------------------
CREATE TABLE queues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES appointments(id),
  patient_id UUID NOT NULL REFERENCES patients(id),
  doctor_id UUID REFERENCES profiles(id),
  ticket_no TEXT NOT NULL,
  status queue_status NOT NULL DEFAULT 'waiting',
  priority INT NOT NULL DEFAULT 0, -- 0 normal, >0 urgent
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  called_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  served_at TIMESTAMPTZ,
  left_at TIMESTAMPTZ,
  room_id UUID REFERENCES rooms(id),
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_queues_clinic_status ON queues(clinic_id, status) WHERE status IN ('waiting', 'called', 'serving');
CREATE TRIGGER tg_queues_updated BEFORE UPDATE ON queues
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- -----------------------------------------------------------------------------
-- diagnostic_orders (ordered tests), diagnostic_results (outcomes)
-- -----------------------------------------------------------------------------
CREATE TABLE diagnostic_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id),
  appointment_id UUID REFERENCES appointments(id),
  diagnostic_type_id UUID NOT NULL REFERENCES diagnostic_types(id),
  ordered_by UUID NOT NULL REFERENCES profiles(id),
  scheduled_at TIMESTAMPTZ,
  equipment_id UUID REFERENCES diagnostic_equipment(id),
  room_id UUID REFERENCES rooms(id),
  assigned_to UUID REFERENCES profiles(id),
  status TEXT NOT NULL DEFAULT 'pending',
  clinical_indication TEXT,
  urgency TEXT NOT NULL DEFAULT 'routine', -- routine, urgent, stat
  -- Snapshot
  price_snapshot BIGINT NOT NULL,
  name_snapshot TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES profiles(id)
);
CREATE INDEX idx_do_clinic ON diagnostic_orders(clinic_id, status);
CREATE INDEX idx_do_patient ON diagnostic_orders(patient_id, created_at DESC);
CREATE TRIGGER tg_do_updated BEFORE UPDATE ON diagnostic_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE diagnostic_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES diagnostic_orders(id),
  findings TEXT,
  impression TEXT,
  numeric_values JSONB,
  attachments JSONB DEFAULT '[]'::jsonb,
  is_final BOOLEAN NOT NULL DEFAULT false,
  reported_by UUID REFERENCES profiles(id),
  reported_at TIMESTAMPTZ,
  amended_from_id UUID REFERENCES diagnostic_results(id),
  amendment_reason TEXT,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_dr_order ON diagnostic_results(order_id);
-- Append-only rule: once is_final, cannot be updated or deleted
CREATE RULE no_update_final_diagnostic_result AS
  ON UPDATE TO diagnostic_results
  WHERE OLD.is_final = true
  DO INSTEAD NOTHING;
CREATE RULE no_delete_final_diagnostic_result AS
  ON DELETE TO diagnostic_results
  WHERE OLD.is_final = true
  DO INSTEAD NOTHING;

-- -----------------------------------------------------------------------------
-- lab_orders + lab_results
-- -----------------------------------------------------------------------------
CREATE TABLE lab_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id),
  appointment_id UUID REFERENCES appointments(id),
  ordered_by UUID NOT NULL REFERENCES profiles(id),
  status TEXT NOT NULL DEFAULT 'pending', -- pending, collected, running, completed, canceled
  urgency TEXT NOT NULL DEFAULT 'routine',
  sample_collected_at TIMESTAMPTZ,
  sample_collected_by UUID REFERENCES profiles(id),
  clinical_notes TEXT,
  total_uzs BIGINT NOT NULL DEFAULT 0,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE lab_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL,
  order_id UUID NOT NULL REFERENCES lab_orders(id) ON DELETE CASCADE,
  lab_test_id UUID NOT NULL REFERENCES lab_tests(id),
  name_snapshot TEXT NOT NULL,
  price_snapshot BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE lab_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  order_item_id UUID NOT NULL REFERENCES lab_order_items(id),
  value TEXT NOT NULL,
  unit TEXT,
  reference_range TEXT,
  interpretation TEXT,
  is_abnormal BOOLEAN DEFAULT false,
  is_final BOOLEAN NOT NULL DEFAULT false,
  reported_by UUID REFERENCES profiles(id),
  reported_at TIMESTAMPTZ,
  amended_from_id UUID REFERENCES lab_results(id),
  amendment_reason TEXT,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE RULE no_update_final_lab_result AS ON UPDATE TO lab_results
  WHERE OLD.is_final = true DO INSTEAD NOTHING;
CREATE RULE no_delete_final_lab_result AS ON DELETE TO lab_results
  WHERE OLD.is_final = true DO INSTEAD NOTHING;

-- -----------------------------------------------------------------------------
-- inpatient_stays + vital_signs + treatment_notes (append-only)
-- -----------------------------------------------------------------------------
CREATE TABLE inpatient_stays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id),
  room_id UUID REFERENCES rooms(id),
  tariff_id UUID REFERENCES room_tariffs(id),
  admitted_at TIMESTAMPTZ NOT NULL,
  discharged_at TIMESTAMPTZ,
  admission_reason TEXT,
  discharge_summary TEXT,
  attending_doctor_id UUID REFERENCES profiles(id),
  status TEXT NOT NULL DEFAULT 'admitted', -- admitted, transferred, discharged
  total_cost_uzs BIGINT NOT NULL DEFAULT 0,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE vital_signs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id),
  stay_id UUID REFERENCES inpatient_stays(id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by UUID NOT NULL REFERENCES profiles(id),
  temperature_c NUMERIC(4,1),
  pulse_bpm INT,
  systolic_mmhg INT,
  diastolic_mmhg INT,
  respiration_rate INT,
  oxygen_saturation INT,
  weight_kg NUMERIC(5,2),
  height_cm INT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE RULE no_update_vital_signs AS ON UPDATE TO vital_signs DO INSTEAD NOTHING;
CREATE RULE no_delete_vital_signs AS ON DELETE TO vital_signs DO INSTEAD NOTHING;

CREATE TABLE treatment_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id),
  appointment_id UUID REFERENCES appointments(id),
  stay_id UUID REFERENCES inpatient_stays(id),
  author_id UUID NOT NULL REFERENCES profiles(id),
  soap_subjective TEXT,
  soap_objective TEXT,
  soap_assessment TEXT,
  soap_plan TEXT,
  diagnosis_code TEXT, -- ICD-10
  diagnosis_text TEXT,
  is_final BOOLEAN NOT NULL DEFAULT false,
  signed_at TIMESTAMPTZ,
  amended_from_id UUID REFERENCES treatment_notes(id),
  amendment_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE RULE no_update_final_treatment_note AS ON UPDATE TO treatment_notes
  WHERE OLD.is_final = true DO INSTEAD NOTHING;
CREATE RULE no_delete_final_treatment_note AS ON DELETE TO treatment_notes
  WHERE OLD.is_final = true DO INSTEAD NOTHING;

-- -----------------------------------------------------------------------------
-- Pharmacy: pharmacy_sales + items + stock_movements
-- -----------------------------------------------------------------------------
CREATE TABLE pharmacy_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES patients(id),
  cashier_id UUID NOT NULL REFERENCES profiles(id),
  shift_id UUID, -- FK to shifts set after finance migration
  total_uzs BIGINT NOT NULL,
  discount_uzs BIGINT NOT NULL DEFAULT 0,
  paid_uzs BIGINT NOT NULL,
  payment_method payment_method_type NOT NULL,
  receipt_no TEXT,
  notes TEXT,
  is_void BOOLEAN NOT NULL DEFAULT false,
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES profiles(id),
  voided_reason TEXT,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pharmacy_sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL,
  sale_id UUID NOT NULL REFERENCES pharmacy_sales(id) ON DELETE CASCADE,
  medication_id UUID NOT NULL REFERENCES medications(id),
  name_snapshot TEXT NOT NULL,
  price_snapshot BIGINT NOT NULL,
  quantity INT NOT NULL,
  subtotal_uzs BIGINT NOT NULL
);

CREATE TABLE pharmacy_stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  medication_id UUID NOT NULL REFERENCES medications(id),
  kind TEXT NOT NULL, -- 'in' | 'out' | 'adjust' | 'transfer'
  quantity INT NOT NULL,
  unit_cost_uzs BIGINT,
  supplier_id UUID REFERENCES suppliers(id),
  sale_id UUID REFERENCES pharmacy_sales(id),
  batch_no TEXT,
  expiry_date DATE,
  notes TEXT,
  performed_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Finance: transactions, shifts, expenses, doctor_payouts
-- -----------------------------------------------------------------------------
CREATE TABLE shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  opening_cash_uzs BIGINT NOT NULL DEFAULT 0,
  cash_total_uzs BIGINT NOT NULL DEFAULT 0,
  card_total_uzs BIGINT NOT NULL DEFAULT 0,
  electronic_total_uzs BIGINT NOT NULL DEFAULT 0,
  expected_cash_uzs BIGINT,
  actual_cash_uzs BIGINT,
  discrepancy_uzs BIGINT GENERATED ALWAYS AS (COALESCE(actual_cash_uzs, 0) - COALESCE(expected_cash_uzs, 0)) STORED,
  notes TEXT,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_shifts_clinic ON shifts(clinic_id, opened_at DESC);

-- Back-link pharmacy_sales.shift_id
ALTER TABLE pharmacy_sales
  ADD CONSTRAINT fk_pharm_sales_shift
  FOREIGN KEY (shift_id) REFERENCES shifts(id);

CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES patients(id),
  appointment_id UUID REFERENCES appointments(id),
  lab_order_id UUID REFERENCES lab_orders(id),
  diagnostic_order_id UUID REFERENCES diagnostic_orders(id),
  stay_id UUID REFERENCES inpatient_stays(id),
  shift_id UUID REFERENCES shifts(id),
  cashier_id UUID NOT NULL REFERENCES profiles(id),
  kind TEXT NOT NULL, -- 'payment' | 'refund' | 'deposit' | 'adjustment'
  amount_uzs BIGINT NOT NULL,
  payment_method payment_method_type NOT NULL,
  provider_reference TEXT,
  insurance_company_id UUID REFERENCES insurance_companies(id),
  notes TEXT,
  is_void BOOLEAN NOT NULL DEFAULT false,
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES profiles(id),
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_trans_clinic_date ON transactions(clinic_id, created_at DESC);

CREATE TABLE transaction_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL,
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  service_id UUID REFERENCES services(id),
  lab_test_id UUID REFERENCES lab_tests(id),
  diagnostic_type_id UUID REFERENCES diagnostic_types(id),
  medication_id UUID REFERENCES medications(id),
  service_name_snapshot TEXT NOT NULL,
  service_price_snapshot BIGINT NOT NULL,
  service_category_snapshot TEXT,
  quantity INT NOT NULL DEFAULT 1,
  discount_snapshot JSONB,
  final_amount_uzs BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  category_id UUID REFERENCES expense_categories(id),
  amount_uzs BIGINT NOT NULL,
  description TEXT,
  supplier_id UUID REFERENCES suppliers(id),
  recorded_by UUID NOT NULL REFERENCES profiles(id),
  payment_method payment_method_type,
  receipt_url TEXT,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE doctor_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES profiles(id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  gross_uzs BIGINT NOT NULL,
  commission_percent NUMERIC(5,2) NOT NULL,
  net_uzs BIGINT NOT NULL,
  paid_at TIMESTAMPTZ,
  paid_by UUID REFERENCES profiles(id),
  method payment_method_type,
  reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Apply updated_at triggers
DO $$
DECLARE tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'lab_orders', 'inpatient_stays', 'pharmacy_sales', 'pharmacy_stock_movements',
    'shifts', 'transactions', 'expenses'
  ])
  LOOP
    EXECUTE format('CREATE TRIGGER tg_%I_updated BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();', tbl, tbl);
  END LOOP;
END $$;
