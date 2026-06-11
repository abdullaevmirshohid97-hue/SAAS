-- ============================================================================
-- site_builds — landing saytni admin paneldan qayta qurish (deploy) tarixi.
-- POST /api/v1/admin/site/rebuild har chaqirilganda bitta qator yoziladi;
-- status jarayon tugagach yangilanadi. RLS: faqat service_role (API admin
-- klienti) ishlaydi, super_admin oqishi API orqali.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.site_builds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed')),
  triggered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  log_tail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_site_builds_started_at ON public.site_builds (started_at DESC);

ALTER TABLE public.site_builds ENABLE ROW LEVEL SECURITY;
-- Hech qanday public policy yo'q — faqat service_role (API) o'qiydi/yozadi.
