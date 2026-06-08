-- =============================================================================
-- Clary v2 — Migration 20260609000002: Dental files (rentgen + rasmlar)
-- Stomatologiya rasmlari: OPG/KT/pritsel rentgen, og'iz ichi foto, Oldin/Keyin.
-- Maxfiy bucket (public=false) + signed URL (API admin orqali) — tibbiy ma'lumot.
-- Yuklash mijoz tomonidan to'g'ridan-to'g'ri storage'ga (staff-files naqshi).
-- =============================================================================

-- 1) Storage bucket — maxfiy (signed URL bilan ko'riladi)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'dental-files', 'dental-files', false, 26214400,
  ARRAY['image/jpeg','image/png','image/webp','application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies — autentifikatsiyalangan foydalanuvchi (klinika ichidagi).
-- Tenant izolyatsiyasi metadata jadvali (dental_files) + signed URL darajasida.
DROP POLICY IF EXISTS dental_files_read ON storage.objects;
CREATE POLICY dental_files_read ON storage.objects
  FOR SELECT USING (bucket_id = 'dental-files' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS dental_files_write ON storage.objects;
CREATE POLICY dental_files_write ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'dental-files' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS dental_files_delete ON storage.objects;
CREATE POLICY dental_files_delete ON storage.objects
  FOR DELETE USING (bucket_id = 'dental-files' AND auth.role() = 'authenticated');

-- 2) Metadata jadvali
CREATE TABLE IF NOT EXISTS dental_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES dental_treatment_plans(id) ON DELETE SET NULL,
  fdi_number INT,
  kind TEXT NOT NULL DEFAULT 'other' CHECK (kind IN (
    'xray_opg','xray_ct','xray_periapical','intraoral','before','after','other'
  )),
  storage_path TEXT NOT NULL,
  file_name TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  taken_at TIMESTAMPTZ,
  notes TEXT,
  uploaded_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dental_files_patient
  ON dental_files(clinic_id, patient_id, created_at DESC);

ALTER TABLE dental_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_dental_files_tenant ON dental_files;
CREATE POLICY p_dental_files_tenant ON dental_files
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

COMMENT ON TABLE dental_files IS 'Stomatologiya rasmlari/rentgenlari (dental-files bucket, signed URL)';
