-- =============================================================================
-- Clary v2 — Migration 000120: Landing site CMS
-- Super-admin manages hero, sections, features, pricing, testimonials, media,
-- SEO metadata and settings for www.clary.uz with i18n (7 languages) and a
-- draft/publish workflow.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- site_entries — generic content blocks keyed by string
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS site_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'hero', 'section', 'feature', 'testimonial', 'faq', 'plan',
    'media', 'seo', 'config', 'block'
  )),
  -- Per-locale payload: { "uz-Latn": { title, body, ... }, "ru": {...}, ... }
  content_i18n JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Optional non-locale payload (urls, colors, sorting hints)
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Display ordering inside its group (lower first)
  sort_order INT NOT NULL DEFAULT 0,
  -- Publish lifecycle
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  published_at TIMESTAMPTZ,
  published_by UUID REFERENCES profiles(id),
  -- Draft copy (edits made after publish live here until next publish)
  draft_content_i18n JSONB,
  draft_data JSONB,
  is_visible BOOLEAN NOT NULL DEFAULT true,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES profiles(id),
  updated_by UUID REFERENCES profiles(id)
);
CREATE INDEX IF NOT EXISTS idx_site_entries_kind ON site_entries(kind, sort_order);
CREATE INDEX IF NOT EXISTS idx_site_entries_status ON site_entries(status) WHERE status = 'published';

CREATE TRIGGER tg_site_entries_updated BEFORE UPDATE ON site_entries
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- site_media — assets (photos, videos) shown on landing
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS site_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'document')),
  url TEXT NOT NULL,
  poster_url TEXT, -- video poster
  alt_i18n JSONB NOT NULL DEFAULT '{}'::jsonb,
  width INT,
  height INT,
  mime_type TEXT,
  bytes BIGINT,
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES profiles(id)
);
CREATE INDEX IF NOT EXISTS idx_site_media_kind ON site_media(kind, created_at DESC);

-- ---------------------------------------------------------------------------
-- site_revisions — immutable history (every publish/revert creates a row)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS site_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID NOT NULL REFERENCES site_entries(id) ON DELETE CASCADE,
  version INT NOT NULL,
  content_i18n JSONB NOT NULL,
  data JSONB NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_visible BOOLEAN NOT NULL DEFAULT true,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES profiles(id)
);
CREATE INDEX IF NOT EXISTS idx_site_revisions_entry ON site_revisions(entry_id, version DESC);

-- ---------------------------------------------------------------------------
-- RLS: super_admin only for writes; published rows readable to everyone
-- ---------------------------------------------------------------------------
ALTER TABLE site_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_site_entries_public_read ON site_entries;
CREATE POLICY p_site_entries_public_read ON site_entries
  FOR SELECT
  USING (status = 'published' OR public.get_my_role() = 'super_admin');
DROP POLICY IF EXISTS p_site_entries_admin_write ON site_entries;
CREATE POLICY p_site_entries_admin_write ON site_entries
  FOR ALL
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

ALTER TABLE site_media ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_site_media_read ON site_media;
CREATE POLICY p_site_media_read ON site_media
  FOR SELECT USING (true);
DROP POLICY IF EXISTS p_site_media_write ON site_media;
CREATE POLICY p_site_media_write ON site_media
  FOR ALL
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

ALTER TABLE site_revisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_site_revisions_admin ON site_revisions;
CREATE POLICY p_site_revisions_admin ON site_revisions
  FOR ALL
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

-- ---------------------------------------------------------------------------
-- Seed minimal live content (hero + 6 features + 4 plans + about video block)
-- ---------------------------------------------------------------------------
INSERT INTO site_entries (key, kind, content_i18n, data, status, published_at, sort_order)
VALUES
  (
    'hero.home',
    'hero',
    jsonb_build_object(
      'uz-Latn', jsonb_build_object(
        'badge', 'v2.0 ishga tushdi',
        'title', 'Klinikangizni bir joydan boshqaring. To''liq.',
        'subtitle', 'O''zbekiston uchun yaratilgan, dunyo standartlariga mos klinika SaaS.',
        'cta_primary', 'Bepul boshlash',
        'cta_secondary', 'Demo ko''rish'
      ),
      'ru', jsonb_build_object(
        'badge', 'v2.0 запущен',
        'title', 'Управляйте клиникой из одного места. Полностью.',
        'subtitle', 'SaaS для клиник, созданный для Узбекистана по мировым стандартам.',
        'cta_primary', 'Начать бесплатно',
        'cta_secondary', 'Посмотреть демо'
      ),
      'en', jsonb_build_object(
        'badge', 'v2.0 is live',
        'title', 'Run your clinic from one place. Completely.',
        'subtitle', 'World-class clinic SaaS purpose-built for Uzbekistan and Central Asia.',
        'cta_primary', 'Start free',
        'cta_secondary', 'Watch demo'
      )
    ),
    jsonb_build_object('cta_primary_href', '/signup', 'cta_secondary_href', '/book-demo'),
    'published',
    now(),
    0
  ),
  (
    'about.video',
    'block',
    jsonb_build_object(
      'uz-Latn', jsonb_build_object(
        'title', 'Biz haqimizda',
        'body', 'Clary — klinikangizning yuragi: qabul, navbat, dorixona, kassa, analitika va bemor aloqalari bitta tizimda.'
      ),
      'ru', jsonb_build_object(
        'title', 'О нас',
        'body', 'Clary — сердце вашей клиники: приём, очередь, аптека, касса, аналитика и коммуникации в одной системе.'
      ),
      'en', jsonb_build_object(
        'title', 'About Clary',
        'body', 'Clary is the heart of your clinic: reception, queue, pharmacy, cashier, analytics and patient comms — all in one.'
      )
    ),
    jsonb_build_object('video_url', '', 'poster_url', '', 'gallery', '[]'::jsonb),
    'published',
    now(),
    1
  )
ON CONFLICT (key) DO NOTHING;

INSERT INTO site_entries (key, kind, content_i18n, data, status, published_at, sort_order)
VALUES
  ('feature.patients',   'feature', jsonb_build_object(
    'uz-Latn', jsonb_build_object('title', 'Bemor bazasi', 'body', 'Tashxis tarixi, hujjatlar, allergiyalar, qidiruv'),
    'ru',      jsonb_build_object('title', 'База пациентов', 'body', 'История диагнозов, документы, аллергии, поиск'),
    'en',      jsonb_build_object('title', 'Patient base',   'body', 'Diagnosis history, documents, allergies, search')
  ), jsonb_build_object('icon', 'ClipboardList'), 'published', now(), 1),
  ('feature.queue',      'feature', jsonb_build_object(
    'uz-Latn', jsonb_build_object('title', 'Qabul va navbat', 'body', 'Real-time navbat, kalendar, eslatmalar'),
    'ru',      jsonb_build_object('title', 'Приём и очередь', 'body', 'Очередь в реальном времени, календарь, напоминания'),
    'en',      jsonb_build_object('title', 'Reception & queue', 'body', 'Real-time queue, calendar, reminders')
  ), jsonb_build_object('icon', 'ListOrdered'), 'published', now(), 2),
  ('feature.diagnostics','feature', jsonb_build_object(
    'uz-Latn', jsonb_build_object('title', 'Diagnostika', 'body', 'X-Ray, CT, MRI, USG, ECG, jadval'),
    'ru',      jsonb_build_object('title', 'Диагностика', 'body', 'X-Ray, CT, MRI, УЗИ, ЭКГ, расписание'),
    'en',      jsonb_build_object('title', 'Diagnostics', 'body', 'X-Ray, CT, MRI, US, ECG, scheduling')
  ), jsonb_build_object('icon', 'Stethoscope'), 'published', now(), 3),
  ('feature.pharmacy',   'feature', jsonb_build_object(
    'uz-Latn', jsonb_build_object('title', 'Dorixona POS', 'body', 'Ombor, barkod, sotuvlar, hisobot'),
    'ru',      jsonb_build_object('title', 'Аптека POS',  'body', 'Склад, штрих-код, продажи, отчёты'),
    'en',      jsonb_build_object('title', 'Pharmacy POS', 'body', 'Stock, barcode, sales, reports')
  ), jsonb_build_object('icon', 'Pill'), 'published', now(), 4),
  ('feature.cashier',    'feature', jsonb_build_object(
    'uz-Latn', jsonb_build_object('title', 'Kassa va smena', 'body', 'Click/Payme/Uzum, inkassatsiya'),
    'ru',      jsonb_build_object('title', 'Касса и смены',  'body', 'Click/Payme/Uzum, инкассация'),
    'en',      jsonb_build_object('title', 'Cashier & shift', 'body', 'Click/Payme/Uzum, reconciliation')
  ), jsonb_build_object('icon', 'Wallet'), 'published', now(), 5),
  ('feature.analytics',  'feature', jsonb_build_object(
    'uz-Latn', jsonb_build_object('title', 'Analitika', 'body', 'Daromad, konversiya, cohort, per-doctor'),
    'ru',      jsonb_build_object('title', 'Аналитика', 'body', 'Доход, конверсия, когорта, по врачам'),
    'en',      jsonb_build_object('title', 'Analytics', 'body', 'Revenue, conversion, cohort, per-doctor')
  ), jsonb_build_object('icon', 'BarChart3'), 'published', now(), 6)
ON CONFLICT (key) DO NOTHING;

INSERT INTO site_entries (key, kind, content_i18n, data, status, published_at, sort_order)
VALUES
  ('plan.demo',   'plan', jsonb_build_object(
    'uz-Latn', jsonb_build_object('name', 'Demo', 'desc', '14 kun bepul', 'cta', 'Boshlash'),
    'ru',      jsonb_build_object('name', 'Demo', 'desc', '14 дней бесплатно', 'cta', 'Начать'),
    'en',      jsonb_build_object('name', 'Demo', 'desc', '14 days free', 'cta', 'Start')
  ), jsonb_build_object('price_usd', 0, 'features', ARRAY['2 xodim', '2 qurilma', 'Asosiy imkoniyatlar']), 'published', now(), 1),
  ('plan.25pro',  'plan', jsonb_build_object(
    'uz-Latn', jsonb_build_object('name', '25PRO', 'desc', 'Kichik klinika', 'cta', 'Tanlash'),
    'ru',      jsonb_build_object('name', '25PRO', 'desc', 'Небольшая клиника', 'cta', 'Выбрать'),
    'en',      jsonb_build_object('name', '25PRO', 'desc', 'Small clinic', 'cta', 'Select')
  ), jsonb_build_object('price_usd', 25, 'features', ARRAY['2 xodim', '2 qurilma', 'Asosiy imkoniyatlar']), 'published', now(), 2),
  ('plan.50pro',  'plan', jsonb_build_object(
    'uz-Latn', jsonb_build_object('name', '50PRO', 'desc', 'O''rta klinika', 'cta', 'Tanlash'),
    'ru',      jsonb_build_object('name', '50PRO', 'desc', 'Средняя клиника', 'cta', 'Выбрать'),
    'en',      jsonb_build_object('name', '50PRO', 'desc', 'Medium clinic', 'cta', 'Select')
  ), jsonb_build_object('price_usd', 50, 'featured', true, 'features', ARRAY['10 xodim', '10 qurilma', '+ Analitika']), 'published', now(), 3),
  ('plan.120pro', 'plan', jsonb_build_object(
    'uz-Latn', jsonb_build_object('name', '120PRO', 'desc', 'Katta klinika', 'cta', 'Tanlash'),
    'ru',      jsonb_build_object('name', '120PRO', 'desc', 'Большая клиника', 'cta', 'Выбрать'),
    'en',      jsonb_build_object('name', '120PRO', 'desc', 'Large clinic', 'cta', 'Select')
  ), jsonb_build_object('price_usd', 120, 'features', ARRAY['Cheksiz xodim', 'Cheksiz qurilma', 'Custom rollar + SLA']), 'published', now(), 4)
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE site_entries IS 'Landing site CMS: hero blocks, features, plans, testimonials, media, seo metadata';
COMMENT ON TABLE site_media IS 'Media library for landing site (images/videos)';
COMMENT ON TABLE site_revisions IS 'Immutable version history of site_entries';
