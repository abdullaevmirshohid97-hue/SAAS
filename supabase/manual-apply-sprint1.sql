-- ============================================================================
-- Clary Sprint 1 — Supabase manual apply
-- ============================================================================
-- Supabase Dashboard → SQL Editor → ushbu butun faylni paste qiling → Run.
-- Idempotent: bir necha marta ishga tushirilsa ham xato chiqarmaydi.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1) platform_payments.notes  (manba: admin-extras.service.ts)
-- ============================================================================

ALTER TABLE platform_payments
  ADD COLUMN IF NOT EXISTS notes TEXT;

COMMENT ON COLUMN platform_payments.notes IS
  'Free-form admin note attached to a manual platform-side payment adjustment '
  '(plan change, broadcast charge, etc.).';

-- ============================================================================
-- 2) profiles photo_url + documents (staff invite, sertifikat va diplom)
-- ============================================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS photo_url TEXT,
  ADD COLUMN IF NOT EXISTS documents JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN profiles.photo_url IS
  'Public URL of the staff member''s avatar photo (Supabase Storage).';

COMMENT ON COLUMN profiles.documents IS
  'Array of attached documents (diplomas, certificates) — '
  '[{type:"diploma"|"certificate"|"license"|"id"|"other", name, url, uploaded_at}].';

CREATE INDEX IF NOT EXISTS profiles_documents_gin_idx
  ON profiles USING GIN (documents);

-- ============================================================================
-- 3) Storage bucket: staff-documents
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'staff-documents',
  'staff-documents',
  TRUE,
  10 * 1024 * 1024,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS staff_documents_authenticated_rw ON storage.objects;
CREATE POLICY staff_documents_authenticated_rw ON storage.objects
  FOR ALL
  TO authenticated
  USING (bucket_id = 'staff-documents')
  WITH CHECK (bucket_id = 'staff-documents');

DROP POLICY IF EXISTS staff_documents_public_read ON storage.objects;
CREATE POLICY staff_documents_public_read ON storage.objects
  FOR SELECT
  TO anon
  USING (bucket_id = 'staff-documents');

-- ============================================================================
-- VERIFY
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_payments' AND column_name = 'notes'
  ) THEN
    RAISE EXCEPTION 'platform_payments.notes ustuni qo''shilmadi';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'photo_url'
  ) THEN
    RAISE EXCEPTION 'profiles.photo_url ustuni qo''shilmadi';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'documents'
  ) THEN
    RAISE EXCEPTION 'profiles.documents ustuni qo''shilmadi';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'staff-documents'
  ) THEN
    RAISE EXCEPTION 'staff-documents bucket yaratilmadi';
  END IF;
  RAISE NOTICE '✅ Sprint 1 migration applied successfully';
END
$$;

COMMIT;
