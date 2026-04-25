-- =============================================================================
-- Clary v2 — Migration 001210: Ensure 'site-media' storage bucket exists
-- so Super Admin can upload landing media directly from the browser.
-- Storage buckets table is managed by Supabase. We insert with ON CONFLICT
-- so the migration is idempotent across environments.
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'site-media',
  'site-media',
  true,
  52428800, -- 50 MB per file (videos should use poster+external CDN for larger)
  ARRAY[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml',
    'video/mp4', 'video/webm',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- RLS policies: allow super_admin to manage, allow anyone to read
DO $$ BEGIN
  -- drop existing idempotency
  BEGIN
    EXECUTE 'DROP POLICY IF EXISTS site_media_read ON storage.objects';
  EXCEPTION WHEN others THEN NULL; END;
  BEGIN
    EXECUTE 'DROP POLICY IF EXISTS site_media_admin_write ON storage.objects';
  EXCEPTION WHEN others THEN NULL; END;

  EXECUTE $sql$
    CREATE POLICY site_media_read ON storage.objects
      FOR SELECT
      USING (bucket_id = 'site-media')
  $sql$;

  EXECUTE $sql$
    CREATE POLICY site_media_admin_write ON storage.objects
      FOR ALL
      USING (
        bucket_id = 'site-media'
        AND (public.get_my_role() = 'super_admin' OR auth.role() = 'service_role')
      )
      WITH CHECK (
        bucket_id = 'site-media'
        AND (public.get_my_role() = 'super_admin' OR auth.role() = 'service_role')
      )
  $sql$;
END $$;
