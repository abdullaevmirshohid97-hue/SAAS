-- =============================================================================
-- Clary v2 — Migration 001080: Legal documents & user acceptances
-- Stores versioned legal documents (offer/privacy/terms/...) and records every
-- user's acceptance with timestamp + IP + UA for evidentiary purposes.
-- =============================================================================

CREATE TABLE IF NOT EXISTS legal_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL,
  version TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'public_offer','privacy','cookies','terms','dpa','acceptable_use','patient_consent','other'
  )),
  title_i18n JSONB NOT NULL DEFAULT '{}'::jsonb,
  body_i18n JSONB NOT NULL DEFAULT '{}'::jsonb,
  effective_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_current BOOLEAN NOT NULL DEFAULT true,
  published_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (slug, version)
);

CREATE INDEX IF NOT EXISTS idx_legal_docs_slug_current ON legal_documents(slug) WHERE is_current = true;

DROP TRIGGER IF EXISTS tg_legal_docs_updated ON legal_documents;
CREATE TRIGGER tg_legal_docs_updated BEFORE UPDATE ON legal_documents
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE legal_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_legal_docs_read ON legal_documents;
CREATE POLICY p_legal_docs_read ON legal_documents FOR SELECT USING (true);
DROP POLICY IF EXISTS p_legal_docs_admin ON legal_documents;
CREATE POLICY p_legal_docs_admin ON legal_documents
  FOR ALL
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

-- -----------------------------------------------------------------------------
-- user_legal_acceptances — evidentiary record
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_legal_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES legal_documents(id),
  document_slug TEXT NOT NULL,
  document_version TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip INET,
  user_agent TEXT,
  locale TEXT,
  source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web','clinic_app','patient_app','mobile','landing','api')),
  UNIQUE (user_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_legal_accept_user ON user_legal_acceptances(user_id, accepted_at DESC);

ALTER TABLE user_legal_acceptances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_legal_accept_self ON user_legal_acceptances;
CREATE POLICY p_legal_accept_self ON user_legal_acceptances
  FOR ALL
  USING (user_id = auth.uid() OR public.get_my_role() = 'super_admin')
  WITH CHECK (user_id = auth.uid() OR public.get_my_role() = 'super_admin');

-- Seed placeholder legal documents (real text will be inserted via Super Admin
-- after legal review; these are just "seen" entries so the app doesn't block
-- registration in development).
INSERT INTO legal_documents (slug, version, kind, title_i18n, body_i18n, is_current)
VALUES
  ('public-offer', '1.0.0', 'public_offer',
    '{"uz-Latn":"Ommaviy oferta","ru":"Публичная оферта","en":"Public offer"}'::jsonb,
    '{"uz-Latn":"{{ LEGAL REVIEW TBD }} — to''liq matn Super Admin orqali yoziladi.","ru":"{{ LEGAL REVIEW TBD }}","en":"{{ LEGAL REVIEW TBD }}"}'::jsonb,
    true),
  ('privacy', '1.0.0', 'privacy',
    '{"uz-Latn":"Maxfiylik siyosati","ru":"Политика конфиденциальности","en":"Privacy policy"}'::jsonb,
    '{"uz-Latn":"{{ LEGAL REVIEW TBD }}","ru":"{{ LEGAL REVIEW TBD }}","en":"{{ LEGAL REVIEW TBD }}"}'::jsonb,
    true),
  ('terms', '1.0.0', 'terms',
    '{"uz-Latn":"Foydalanish shartlari","ru":"Условия использования","en":"Terms of use"}'::jsonb,
    '{"uz-Latn":"{{ LEGAL REVIEW TBD }}","ru":"{{ LEGAL REVIEW TBD }}","en":"{{ LEGAL REVIEW TBD }}"}'::jsonb,
    true),
  ('cookies', '1.0.0', 'cookies',
    '{"uz-Latn":"Cookie siyosati","ru":"Cookie","en":"Cookies"}'::jsonb,
    '{"uz-Latn":"{{ LEGAL REVIEW TBD }}","ru":"{{ LEGAL REVIEW TBD }}","en":"{{ LEGAL REVIEW TBD }}"}'::jsonb,
    true),
  ('patient-consent', '1.0.0', 'patient_consent',
    '{"uz-Latn":"Bemor roziligi","ru":"Согласие пациента","en":"Patient consent"}'::jsonb,
    '{"uz-Latn":"{{ LEGAL REVIEW TBD }}","ru":"{{ LEGAL REVIEW TBD }}","en":"{{ LEGAL REVIEW TBD }}"}'::jsonb,
    true)
ON CONFLICT (slug, version) DO NOTHING;

COMMENT ON TABLE legal_documents IS 'Versioned legal documents (public offer, privacy, terms, ...)';
COMMENT ON TABLE user_legal_acceptances IS 'Evidentiary record of user accepting a legal document version';
