-- =============================================================================
-- Clary v2 — Migration: Clinic reviews, ratings, web-profile & analytics
-- =============================================================================

-- -----------------------------------------------------------------------------
-- clinic_web_profiles — public-facing profile editable by clinic
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinic_web_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL UNIQUE REFERENCES clinics(id) ON DELETE CASCADE,
  tagline TEXT,
  description TEXT,
  banner_url TEXT,
  gallery_urls JSONB NOT NULL DEFAULT '[]'::jsonb,   -- array of image URLs
  video_urls JSONB NOT NULL DEFAULT '[]'::jsonb,     -- array of {title, url}
  services JSONB NOT NULL DEFAULT '[]'::jsonb,       -- [{name, price_uzs, duration_min, description}]
  working_hours JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {mon:{open,close}, ...}
  geo_lat NUMERIC(9,6),
  geo_lng NUMERIC(9,6),
  specialties TEXT[] NOT NULL DEFAULT '{}',
  languages TEXT[] NOT NULL DEFAULT '{uz-Latn}',
  established_year INT,
  bed_count INT,
  is_published BOOLEAN NOT NULL DEFAULT false,
  portal_slug TEXT UNIQUE,                           -- custom slug override
  seo_title TEXT,
  seo_description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INT NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_cwp_clinic ON clinic_web_profiles(clinic_id);
CREATE INDEX IF NOT EXISTS idx_cwp_slug ON clinic_web_profiles(portal_slug) WHERE portal_slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cwp_published ON clinic_web_profiles(is_published) WHERE is_published = true;

DROP TRIGGER IF EXISTS tg_cwp_updated ON clinic_web_profiles;
CREATE TRIGGER tg_cwp_updated BEFORE UPDATE ON clinic_web_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE clinic_web_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_cwp_public_read ON clinic_web_profiles;
CREATE POLICY p_cwp_public_read ON clinic_web_profiles
  FOR SELECT USING (is_published = true);

DROP POLICY IF EXISTS p_cwp_tenant_write ON clinic_web_profiles;
CREATE POLICY p_cwp_tenant_write ON clinic_web_profiles
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

-- -----------------------------------------------------------------------------
-- clinic_reviews — patient ratings & comments
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinic_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  portal_user_id UUID NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES online_queue_bookings(id) ON DELETE SET NULL,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  is_verified BOOLEAN NOT NULL DEFAULT false,    -- visited/booked
  is_hidden BOOLEAN NOT NULL DEFAULT false,      -- moderated
  helpful_count INT NOT NULL DEFAULT 0,
  -- Clinic reply
  reply_text TEXT,
  replied_at TIMESTAMPTZ,
  replied_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INT NOT NULL DEFAULT 1,
  UNIQUE (clinic_id, portal_user_id)             -- one review per patient per clinic
);

CREATE INDEX IF NOT EXISTS idx_cr_clinic ON clinic_reviews(clinic_id, created_at DESC) WHERE is_hidden = false;
CREATE INDEX IF NOT EXISTS idx_cr_patient ON clinic_reviews(portal_user_id);
CREATE INDEX IF NOT EXISTS idx_cr_rating ON clinic_reviews(clinic_id, rating) WHERE is_hidden = false;

DROP TRIGGER IF EXISTS tg_cr_updated ON clinic_reviews;
CREATE TRIGGER tg_cr_updated BEFORE UPDATE ON clinic_reviews
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE clinic_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_cr_public_read ON clinic_reviews;
CREATE POLICY p_cr_public_read ON clinic_reviews
  FOR SELECT USING (is_hidden = false);

DROP POLICY IF EXISTS p_cr_patient_write ON clinic_reviews;
CREATE POLICY p_cr_patient_write ON clinic_reviews
  FOR INSERT WITH CHECK (portal_user_id = auth.uid());

DROP POLICY IF EXISTS p_cr_patient_update ON clinic_reviews;
CREATE POLICY p_cr_patient_update ON clinic_reviews
  FOR UPDATE
  USING (portal_user_id = auth.uid() OR clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (portal_user_id = auth.uid() OR clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

-- -----------------------------------------------------------------------------
-- clinic_review_helpful — "foydali" votes (prevent duplicates)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinic_review_helpful (
  review_id UUID NOT NULL REFERENCES clinic_reviews(id) ON DELETE CASCADE,
  portal_user_id UUID NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (review_id, portal_user_id)
);

ALTER TABLE clinic_review_helpful ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_crh_access ON clinic_review_helpful;
CREATE POLICY p_crh_access ON clinic_review_helpful
  FOR ALL USING (portal_user_id = auth.uid())
  WITH CHECK (portal_user_id = auth.uid());

-- Auto-sync helpful_count
CREATE OR REPLACE FUNCTION public.tg_review_helpful_count()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE clinic_reviews SET helpful_count = helpful_count + 1 WHERE id = NEW.review_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE clinic_reviews SET helpful_count = GREATEST(helpful_count - 1, 0) WHERE id = OLD.review_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tg_review_helpful_count ON clinic_review_helpful;
CREATE TRIGGER tg_review_helpful_count
  AFTER INSERT OR DELETE ON clinic_review_helpful
  FOR EACH ROW EXECUTE FUNCTION public.tg_review_helpful_count();

-- -----------------------------------------------------------------------------
-- clinic_profile_views — analytics: who viewed which clinic
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinic_profile_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  portal_user_id UUID REFERENCES portal_users(id) ON DELETE SET NULL,
  city TEXT,
  source TEXT DEFAULT 'web',                     -- web | mobile | search
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cpv_clinic_time ON clinic_profile_views(clinic_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_cpv_recent ON clinic_profile_views(viewed_at DESC);

ALTER TABLE clinic_profile_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_cpv_insert ON clinic_profile_views;
CREATE POLICY p_cpv_insert ON clinic_profile_views FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS p_cpv_clinic_read ON clinic_profile_views;
CREATE POLICY p_cpv_clinic_read ON clinic_profile_views
  FOR SELECT
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

-- -----------------------------------------------------------------------------
-- Materialized view: clinic_rating_summary — fast rating lookups
-- -----------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS clinic_rating_summary AS
SELECT
  clinic_id,
  COUNT(*)::INT                                             AS review_count,
  ROUND(AVG(rating)::NUMERIC, 2)                           AS avg_rating,
  COUNT(*) FILTER (WHERE rating = 5)::INT                  AS stars_5,
  COUNT(*) FILTER (WHERE rating = 4)::INT                  AS stars_4,
  COUNT(*) FILTER (WHERE rating = 3)::INT                  AS stars_3,
  COUNT(*) FILTER (WHERE rating = 2)::INT                  AS stars_2,
  COUNT(*) FILTER (WHERE rating = 1)::INT                  AS stars_1
FROM clinic_reviews
WHERE is_hidden = false
GROUP BY clinic_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_crs_clinic ON clinic_rating_summary(clinic_id);

-- Refresh helper (called after insert/update on clinic_reviews)
CREATE OR REPLACE FUNCTION public.refresh_clinic_rating_summary()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY clinic_rating_summary;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tg_refresh_rating ON clinic_reviews;
CREATE TRIGGER tg_refresh_rating
  AFTER INSERT OR UPDATE OR DELETE ON clinic_reviews
  FOR EACH STATEMENT EXECUTE FUNCTION public.refresh_clinic_rating_summary();

-- Realtime for reviews (clinic can listen to new reviews)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE clinic_reviews;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

COMMENT ON TABLE clinic_web_profiles IS 'Public-facing clinic profile editable by clinic staff';
COMMENT ON TABLE clinic_reviews IS 'Patient ratings and comments for clinics';
COMMENT ON TABLE clinic_profile_views IS 'Analytics: clinic profile page views';
COMMENT ON MATERIALIZED VIEW clinic_rating_summary IS 'Cached rating aggregates — refreshed after each review change';
