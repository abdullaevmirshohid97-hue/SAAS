-- Staff assignments for inpatient stays (doctor + nurse per stay)
CREATE TABLE stay_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  stay_id UUID NOT NULL REFERENCES inpatient_stays(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id),
  role TEXT NOT NULL CHECK (role IN ('doctor', 'nurse')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by UUID REFERENCES profiles(id),
  UNIQUE(stay_id, profile_id)
);

CREATE INDEX idx_stay_assignments_stay ON stay_assignments(stay_id);
CREATE INDEX idx_stay_assignments_profile ON stay_assignments(profile_id);

ALTER TABLE stay_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clinic_isolation" ON stay_assignments
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.is_super_admin())
  WITH CHECK (clinic_id = public.get_my_clinic_id());
