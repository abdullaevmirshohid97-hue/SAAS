-- =============================================================================
-- Clary v2 — Dev seed data (local only; not run in production)
-- Minimal seed: two demo clinics. Profiles, services, patients must be
-- seeded via the API's /dev/seed endpoint or `pnpm db:seed` (which also
-- provisions auth.users + profiles first, respecting FK constraints).
-- =============================================================================

INSERT INTO clinics (id, slug, name, organization_type, country, city, current_plan, subscription_status, trial_ends_at)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'klinika-nur',      'Klinika NUR',        'clinic',            'UZ', 'Tashkent',  '50pro',  'active', now() + interval '1 year'),
  ('22222222-2222-2222-2222-222222222222', 'diagnostic-markaz','Diagnostika Markaz', 'diagnostic_center', 'UZ', 'Samarkand', '120pro', 'active', now() + interval '1 year')
ON CONFLICT (id) DO NOTHING;
