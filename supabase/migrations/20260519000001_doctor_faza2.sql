-- =============================================================================
-- Doctor Workspace FAZA 2 — medical history, files, diagnosis templates
-- =============================================================================

-- 1) patients — qo'shimcha medical history maydonlari
--    allergies + chronic_conditions allaqachon bor (JSONB).
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS surgeries JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS current_medications JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS medical_notes TEXT;

COMMENT ON COLUMN patients.surgeries IS
  'O''tkazilgan operatsiyalar: [{name, year, notes}]';
COMMENT ON COLUMN patients.current_medications IS
  'Doimiy qabul qilinadigan dorilar: [{name, dose, notes}]';

-- 2) patient_files — X-ray, MRI, lab PDF, rasm
CREATE TABLE IF NOT EXISTS patient_files (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id  UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('xray','mri','ct','ultrasound','lab','prescription','photo','document','other')),
  title       TEXT NOT NULL,
  url         TEXT NOT NULL,
  mime_type   TEXT,
  size_bytes  BIGINT,
  uploaded_by UUID REFERENCES profiles(id),
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_files_patient
  ON patient_files(patient_id, created_at DESC);

ALTER TABLE patient_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_patient_files_tenant ON patient_files;
CREATE POLICY p_patient_files_tenant ON patient_files
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

COMMENT ON TABLE patient_files IS
  'Bemor tibbiy hujjatlari — rentgen, MRT, KT, UTT, lab natijasi, rasm. '
  'Fayl Supabase Storage''da, bu yerda metadata.';

-- 3) diagnosis_templates — shifokor uchun 1-click shablon
CREATE TABLE IF NOT EXISTS diagnosis_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,                 -- "Viral infeksiya"
  diagnosis_code  TEXT,                          -- ICD-10
  diagnosis_text  TEXT,
  soap_subjective TEXT,
  soap_objective  TEXT,
  soap_assessment TEXT,
  soap_plan       TEXT,
  created_by      UUID REFERENCES profiles(id),
  usage_count     INT NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_diagnosis_templates_clinic
  ON diagnosis_templates(clinic_id, is_active);

ALTER TABLE diagnosis_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_diagnosis_templates_tenant ON diagnosis_templates;
CREATE POLICY p_diagnosis_templates_tenant ON diagnosis_templates
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

DROP TRIGGER IF EXISTS tg_diagnosis_templates_updated ON diagnosis_templates;
CREATE TRIGGER tg_diagnosis_templates_updated
  BEFORE UPDATE ON diagnosis_templates
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

COMMENT ON TABLE diagnosis_templates IS
  'Shifokor uchun tayyor tashxis+SOAP shablonlari. 1-click bilan '
  'konsultatsiya formasini to''ldiradi.';
