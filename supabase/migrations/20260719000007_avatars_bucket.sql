-- =============================================================================
-- M2 — avatars bucket: xodim profil rasmlari (mobil yuklaydi, admin anketada ko'radi)
-- =============================================================================
-- PUBLIC bucket — avatar maxfiy hujjat emas (PII hujjatlar staff-documents'da,
-- u private). authenticated yuklaydi/yangilaydi, o'qish public URL orqali.
-- PROD'GA QO'LLANGAN (2026-07-19).

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "avatars_auth_insert" ON storage.objects;
CREATE POLICY "avatars_auth_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars_auth_update" ON storage.objects;
CREATE POLICY "avatars_auth_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars');
