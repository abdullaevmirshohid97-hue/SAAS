-- Extend patient fields for reception wizard:
--  * split name into first_name / last_name / patronymic (O'zbekistonda otchestvo)
--  * referral source (kanal) — instagram, telegram, facebook, google, word_of_mouth, doctor, other
--  * referral_notes — qaysi shifokor, qaysi tanish
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT,
  ADD COLUMN IF NOT EXISTS patronymic TEXT,
  ADD COLUMN IF NOT EXISTS referral_source TEXT
    CHECK (referral_source IS NULL OR referral_source IN (
      'instagram', 'telegram', 'facebook', 'tiktok', 'youtube',
      'google', 'billboard', 'word_of_mouth', 'doctor', 'returning', 'other'
    )),
  ADD COLUMN IF NOT EXISTS referral_notes TEXT;

-- Backfill first/last from full_name heuristically (split on first space)
UPDATE patients
SET
  last_name  = COALESCE(last_name,  NULLIF(split_part(full_name, ' ', 1), '')),
  first_name = COALESCE(first_name, NULLIF(split_part(full_name, ' ', 2), ''))
WHERE last_name IS NULL OR first_name IS NULL;

-- Keep full_name in sync when wizard inserts structured components
CREATE OR REPLACE FUNCTION patients_sync_full_name()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.first_name IS NOT NULL OR NEW.last_name IS NOT NULL) THEN
    NEW.full_name := TRIM(COALESCE(NEW.last_name,'') || ' ' ||
                          COALESCE(NEW.first_name,'') || ' ' ||
                          COALESCE(NEW.patronymic,''));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_patients_sync_full_name ON patients;
CREATE TRIGGER trg_patients_sync_full_name
BEFORE INSERT OR UPDATE OF first_name, last_name, patronymic, full_name
ON patients
FOR EACH ROW EXECUTE FUNCTION patients_sync_full_name();

CREATE INDEX IF NOT EXISTS patients_referral_source_idx
  ON patients (clinic_id, referral_source)
  WHERE deleted_at IS NULL;
