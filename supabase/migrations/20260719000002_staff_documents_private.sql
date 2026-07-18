-- =============================================================================
-- D3 — staff-documents bucket PII himoyasi (xodim pasport/ID/diplom hujjatlari)
-- =============================================================================
-- Bucket PUBLIC edi — URLni bilgan har kim internetdan xodim hujjatini ochа
-- olardi. Endi private + faqat authenticated (klinika xodimlari) o'qiydi/yuklaydi.
-- Ilova hujjatlarni hozircha faqat yuklaydi (hech qayerda ko'rsatmaydi), shuning
-- uchun hech narsa buzilmaydi. Kelajakda viewer UI qurilsa createSignedUrl ishlatilsin.
-- PROD'GA QO'LLANGAN (2026-07-19).

UPDATE storage.buckets SET public = false WHERE id = 'staff-documents';

DROP POLICY IF EXISTS "staff_documents_auth_read" ON storage.objects;
CREATE POLICY "staff_documents_auth_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'staff-documents');

DROP POLICY IF EXISTS "staff_documents_auth_insert" ON storage.objects;
CREATE POLICY "staff_documents_auth_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'staff-documents');
