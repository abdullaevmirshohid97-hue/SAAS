-- =============================================================================
-- Journal notes — izohlar barcha journal yozuvlariga (transaction, sale, stay, appointment)
-- =============================================================================

CREATE TABLE IF NOT EXISTS journal_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  ref_type TEXT NOT NULL CHECK (ref_type IN ('transaction','pharmacy_sale','inpatient_stay','appointment','expense')),
  ref_id UUID NOT NULL,
  note TEXT NOT NULL,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_journal_notes_clinic_created ON journal_notes(clinic_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_journal_notes_ref ON journal_notes(ref_type, ref_id);

ALTER TABLE journal_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clinic_isolation" ON journal_notes;
CREATE POLICY "clinic_isolation" ON journal_notes
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.is_super_admin())
  WITH CHECK (clinic_id = public.get_my_clinic_id());

-- updated_at trigger
CREATE OR REPLACE FUNCTION journal_notes_set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_notes_updated_at ON journal_notes;
CREATE TRIGGER trg_journal_notes_updated_at
  BEFORE UPDATE ON journal_notes
  FOR EACH ROW EXECUTE FUNCTION journal_notes_set_updated_at();
