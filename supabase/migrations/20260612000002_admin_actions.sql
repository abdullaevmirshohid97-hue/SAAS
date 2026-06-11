-- ============================================================================
-- admin_actions — super-admin mutatsion amallari auditi.
-- AdminActionsInterceptor har muvaffaqiyatli POST/PATCH/DELETE /admin/* uchun
-- bitta qator yozadi (kim, qaysi endpoint, payload qisqartmasi, IP).
-- RLS: policy yo'q — faqat service_role (API) o'qiydi/yozadi.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.admin_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- profiles(id) — PostgREST embed (admin ismi) ishlashi uchun; profiles PK = auth user id.
  admin_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  method text NOT NULL,
  path text NOT NULL,
  body_excerpt text,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_actions_created_at ON public.admin_actions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_actions_admin_id ON public.admin_actions (admin_id, created_at DESC);

ALTER TABLE public.admin_actions ENABLE ROW LEVEL SECURITY;
