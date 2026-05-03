-- =============================================================================
-- Clary v2 — Migration 001110: extend site_entries.kind for blog/docs/changelog
-- =============================================================================

ALTER TABLE site_entries DROP CONSTRAINT IF EXISTS site_entries_kind_check;
ALTER TABLE site_entries ADD CONSTRAINT site_entries_kind_check CHECK (
  kind IN (
    'hero', 'section', 'feature', 'testimonial', 'faq', 'plan',
    'media', 'seo', 'config', 'block',
    'post', 'doc', 'changelog', 'usecase', 'feature_detail', 'gallery', 'download'
  )
);
