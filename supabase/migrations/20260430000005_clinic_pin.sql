-- =============================================================================
-- Clinic settings — journal PIN va boshqa app sozlamalari
-- =============================================================================

ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS journal_pin_hash TEXT,
  ADD COLUMN IF NOT EXISTS journal_pin_set_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS default_locale TEXT NOT NULL DEFAULT 'uz-Latn';

-- Default PIN: 0000 (sha256). Klinika administratori bunni o'zgartirishi shart.
-- 0000 sha256 = 9af15b336e6a9619928537df30b2e6a2376569fcf9d7e773eccede65606529a0
UPDATE clinics
SET journal_pin_hash = '9af15b336e6a9619928537df30b2e6a2376569fcf9d7e773eccede65606529a0',
    journal_pin_set_at = now()
WHERE journal_pin_hash IS NULL;

-- Helper to verify PIN (used by API)
CREATE OR REPLACE FUNCTION public.verify_journal_pin(p_clinic UUID, p_pin TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT journal_pin_hash = encode(digest(p_pin, 'sha256'), 'hex')
    FROM clinics WHERE id = p_clinic;
$$;
