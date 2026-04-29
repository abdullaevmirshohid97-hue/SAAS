-- =============================================================================
-- Staff profiles — to'liq xodim anketa (rasmlar, diplom, sertifikatlar, oylik)
-- =============================================================================

CREATE TABLE IF NOT EXISTS staff_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  profile_id UUID UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  -- Identity
  last_name TEXT NOT NULL,
  first_name TEXT NOT NULL,
  patronymic TEXT,
  phone TEXT,
  -- Position
  position TEXT NOT NULL CHECK (position IN ('doctor','nurse','cleaner','administrator','cashier','pharmacist','lab_tech','manager','other')),
  specialization TEXT,
  -- Education
  education_level TEXT CHECK (education_level IN ('secondary','higher','master','phd')),
  diploma_url TEXT,
  certificates TEXT[] NOT NULL DEFAULT '{}',
  -- Photos (3-4 fotosi)
  photos TEXT[] NOT NULL DEFAULT '{}',
  -- Salary
  salary_type TEXT NOT NULL DEFAULT 'fixed' CHECK (salary_type IN ('fixed','percent','mixed')),
  salary_fixed_uzs BIGINT NOT NULL DEFAULT 0,
  salary_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (salary_percent >= 0 AND salary_percent <= 100),
  -- Status
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  -- Audit
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_profiles_clinic ON staff_profiles(clinic_id, is_active);
CREATE INDEX IF NOT EXISTS idx_staff_profiles_position ON staff_profiles(clinic_id, position);

ALTER TABLE staff_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clinic_isolation" ON staff_profiles;
CREATE POLICY "clinic_isolation" ON staff_profiles
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.is_super_admin())
  WITH CHECK (clinic_id = public.get_my_clinic_id());

-- updated_at trigger
CREATE OR REPLACE FUNCTION staff_profiles_set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_staff_profiles_updated_at ON staff_profiles;
CREATE TRIGGER trg_staff_profiles_updated_at
  BEFORE UPDATE ON staff_profiles
  FOR EACH ROW EXECUTE FUNCTION staff_profiles_set_updated_at();

-- Storage bucket for staff photos/diplomas
INSERT INTO storage.buckets (id, name, public)
VALUES ('staff-files', 'staff-files', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies — clinic_id is encoded as folder prefix
DROP POLICY IF EXISTS "staff_files_read" ON storage.objects;
CREATE POLICY "staff_files_read" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'staff-files' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "staff_files_write" ON storage.objects;
CREATE POLICY "staff_files_write" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'staff-files' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "staff_files_delete" ON storage.objects;
CREATE POLICY "staff_files_delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'staff-files' AND auth.role() = 'authenticated');
