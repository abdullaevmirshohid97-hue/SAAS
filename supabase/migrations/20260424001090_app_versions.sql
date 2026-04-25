-- =============================================================================
-- Clary v2 — Migration 001090: App version manifest
-- Tracks current minimum-supported versions for each app (clinic, admin,
-- patient, mobile) so clients can show "new version available" banners and
-- force-update critical releases.
-- =============================================================================

CREATE TABLE IF NOT EXISTS app_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app TEXT NOT NULL CHECK (app IN ('web-clinic','web-admin','web-patient','web-landing','mobile-android','mobile-ios','desktop')),
  channel TEXT NOT NULL DEFAULT 'stable' CHECK (channel IN ('stable','beta','dev')),
  version TEXT NOT NULL,
  commit_sha TEXT,
  released_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  min_supported_version TEXT NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT true,
  force_update BOOLEAN NOT NULL DEFAULT false,
  release_notes_i18n JSONB NOT NULL DEFAULT '{}'::jsonb,
  download_url TEXT,
  changelog_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (app, channel, version)
);

CREATE INDEX IF NOT EXISTS idx_app_versions_current ON app_versions(app, channel) WHERE is_current = true;

DROP TRIGGER IF EXISTS tg_app_versions_updated ON app_versions;
CREATE TRIGGER tg_app_versions_updated BEFORE UPDATE ON app_versions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Only one row with is_current = true per (app, channel)
CREATE OR REPLACE FUNCTION public.tg_app_versions_single_current()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_current = true THEN
    UPDATE app_versions
      SET is_current = false
      WHERE app = NEW.app
        AND channel = NEW.channel
        AND id <> NEW.id
        AND is_current = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_app_versions_uniq_current ON app_versions;
CREATE TRIGGER tg_app_versions_uniq_current
  AFTER INSERT OR UPDATE OF is_current ON app_versions
  FOR EACH ROW EXECUTE FUNCTION public.tg_app_versions_single_current();

ALTER TABLE app_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_app_versions_read ON app_versions;
CREATE POLICY p_app_versions_read ON app_versions
  FOR SELECT USING (is_current = true);
DROP POLICY IF EXISTS p_app_versions_admin ON app_versions;
CREATE POLICY p_app_versions_admin ON app_versions
  FOR ALL
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

-- Seed the baseline (v2.0.0 for all web apps)
INSERT INTO app_versions (app, channel, version, min_supported_version, force_update, release_notes_i18n)
VALUES
  ('web-clinic',  'stable', '2.0.0', '2.0.0', false, '{"uz-Latn":"Clary v2 rasmiy ishga tushirish","ru":"Запуск Clary v2","en":"Clary v2 launch"}'::jsonb),
  ('web-admin',   'stable', '2.0.0', '2.0.0', false, '{"uz-Latn":"Super Admin v2","ru":"Super Admin v2","en":"Super Admin v2"}'::jsonb),
  ('web-patient', 'stable', '1.0.0', '1.0.0', false, '{"uz-Latn":"Bemor portali (birinchi versiya)","ru":"Портал пациента","en":"Patient portal"}'::jsonb),
  ('web-landing', 'stable', '2.0.0', '2.0.0', false, '{"uz-Latn":"www.clary.uz","ru":"www.clary.uz","en":"www.clary.uz"}'::jsonb),
  ('mobile-android', 'stable', '1.0.0', '1.0.0', false, '{"uz-Latn":"Birinchi APK preview","ru":"Первый APK","en":"First APK preview"}'::jsonb)
ON CONFLICT (app, channel, version) DO NOTHING;

COMMENT ON TABLE app_versions IS 'Manifest of current app versions (used for self-update banners and force-update)';
