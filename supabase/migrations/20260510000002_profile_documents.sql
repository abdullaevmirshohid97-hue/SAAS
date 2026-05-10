-- Sprint 1.5: profiles ga photo_url + documents (sertifikat / diplom)
-- Manba: Staff invite formada photo va sertifikat fieldlari bor edi, lekin
-- backend InviteSchema'ga kelmagan, shuning uchun saqlanmagan. Ushbu migratsiya
-- + InviteSchema kengaytmasi shu fieldlarni saqlab boradi.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS photo_url TEXT,
  ADD COLUMN IF NOT EXISTS documents JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN profiles.photo_url IS
  'Public URL of the staff member''s avatar photo (Supabase Storage).';

COMMENT ON COLUMN profiles.documents IS
  'Array of attached documents (diplomas, certificates) — '
  '[{type:"diploma"|"certificate"|"license"|"id"|"other", name, url, uploaded_at}].';

-- Ixtiyoriy: GIN index agar documents bo'yicha qidiruv kerak bo'lsa
CREATE INDEX IF NOT EXISTS profiles_documents_gin_idx
  ON profiles USING GIN (documents);

-- Storage bucket: staff-documents (avatar + diploma + certificate)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'staff-documents',
  'staff-documents',
  TRUE,
  10 * 1024 * 1024,    -- 10 MB ceiling per file
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Authenticated users can upload to / read from staff-documents
DROP POLICY IF EXISTS staff_documents_authenticated_rw ON storage.objects;
CREATE POLICY staff_documents_authenticated_rw ON storage.objects
  FOR ALL
  TO authenticated
  USING (bucket_id = 'staff-documents')
  WITH CHECK (bucket_id = 'staff-documents');

-- Public can read (URLs are guessable but tied to clinic; we trust the
-- short-lived signed URL flow when sensitivity matters)
DROP POLICY IF EXISTS staff_documents_public_read ON storage.objects;
CREATE POLICY staff_documents_public_read ON storage.objects
  FOR SELECT
  TO anon
  USING (bucket_id = 'staff-documents');
