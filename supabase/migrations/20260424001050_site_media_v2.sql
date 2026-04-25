-- =============================================================================
-- Clary v2 — Migration 001050: Site media v2
-- Extend site_media with variants, focal_point, status, versioning, jobs.
-- =============================================================================

-- Add missing columns (idempotent)
ALTER TABLE site_media
  ADD COLUMN IF NOT EXISTS original_url TEXT,
  ADD COLUMN IF NOT EXISTS storage_path TEXT,
  ADD COLUMN IF NOT EXISTS variants JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS caption_i18n JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS license TEXT CHECK (license IN ('own','cc-by','stock-licensed','public-domain','unknown')) DEFAULT 'own',
  ADD COLUMN IF NOT EXISTS focal_point JSONB,
  ADD COLUMN IF NOT EXISTS aspect_ratio NUMERIC(5,3),
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN (
    'uploading','scanning','processing','ready','failed','quarantined'
  )),
  ADD COLUMN IF NOT EXISTS processing_error TEXT,
  ADD COLUMN IF NOT EXISTS content_hash TEXT,
  ADD COLUMN IF NOT EXISTS duration_sec NUMERIC(9,2),
  ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS replaced_by UUID REFERENCES site_media(id);

CREATE INDEX IF NOT EXISTS idx_site_media_status ON site_media(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_media_hash ON site_media(content_hash) WHERE content_hash IS NOT NULL;

DROP TRIGGER IF EXISTS tg_site_media_updated ON site_media;
CREATE TRIGGER tg_site_media_updated BEFORE UPDATE ON site_media
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- -----------------------------------------------------------------------------
-- site_media_versions — replaced versions (old URLs kept around)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS site_media_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id UUID NOT NULL REFERENCES site_media(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  variants JSONB,
  replaced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  replaced_by UUID REFERENCES profiles(id),
  reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_smv_media ON site_media_versions(media_id, replaced_at DESC);

ALTER TABLE site_media_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_smv_admin ON site_media_versions;
CREATE POLICY p_smv_admin ON site_media_versions
  FOR ALL
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

-- -----------------------------------------------------------------------------
-- media_jobs — track image-optimize / video-transcode / antivirus jobs
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS media_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id UUID NOT NULL REFERENCES site_media(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('optimize','transcode','antivirus','thumbnail','poster')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed','canceled')),
  progress INT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  error TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_jobs_media ON media_jobs(media_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_jobs_pending ON media_jobs(kind, status) WHERE status IN ('queued','running');

DROP TRIGGER IF EXISTS tg_media_jobs_updated ON media_jobs;
CREATE TRIGGER tg_media_jobs_updated BEFORE UPDATE ON media_jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE media_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_media_jobs_admin ON media_jobs;
CREATE POLICY p_media_jobs_admin ON media_jobs
  FOR ALL
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

-- Enable realtime on media_jobs so upload UI can show live progress
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE media_jobs;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

COMMENT ON TABLE site_media_versions IS 'History of replaced media versions (old URLs preserved)';
COMMENT ON TABLE media_jobs IS 'Background jobs for media processing (optimize, transcode, scan)';
