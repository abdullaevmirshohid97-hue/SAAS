-- DMED Faza 0: Poydevor — dmed_connections, outbox, audit_log, resource_map + patients.pinfl
-- Hammasi additive, CREATE TABLE IF NOT EXISTS, GL'ga tegmaydi.

-- ── 1. dmed_connections — asosiy holat jadvali ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.dmed_connections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL UNIQUE REFERENCES public.clinics(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','invited','active','declined','disabled')),
  client_id       text,
  secret_vault_id uuid,              -- Supabase Vault uuid (sir bu yerda saqlanmaydi)
  fhir_base_url   text,
  facility_code   text,              -- MoH muassasa kodi
  scopes          text[] DEFAULT '{}',
  invited_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at      timestamptz,
  accepted_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at     timestamptz,
  declined_at     timestamptz,
  force_activated bool NOT NULL DEFAULT false,
  last_sync_at    timestamptz,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dmed_conn_status
  ON public.dmed_connections (status);

ALTER TABLE public.dmed_connections ENABLE ROW LEVEL SECURITY;
REVOKE SELECT ON public.dmed_connections FROM anon, authenticated;

-- ── 2. dmed_outbox — Faza 1 worker uchun; Faza 0'da faqat jadval ────────────
CREATE TABLE IF NOT EXISTS public.dmed_outbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  resource_type   text NOT NULL,     -- 'Patient','Encounter','Observation', ...
  source_table    text NOT NULL,
  source_id       uuid NOT NULL,
  fhir_payload    jsonb,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','sent','failed','skipped')),
  attempts        int NOT NULL DEFAULT 0,
  last_error      text,
  dmed_resource_id text,             -- DMED tomonidan qaytarilgan id
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz
);

CREATE INDEX IF NOT EXISTS idx_dmed_outbox_clinic_status
  ON public.dmed_outbox (clinic_id, status);
CREATE INDEX IF NOT EXISTS idx_dmed_outbox_source
  ON public.dmed_outbox (source_table, source_id);

ALTER TABLE public.dmed_outbox ENABLE ROW LEVEL SECURITY;
REVOKE SELECT ON public.dmed_outbox FROM anon, authenticated;

-- ── 3. dmed_audit_log — har amal qayd ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dmed_audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid REFERENCES public.clinics(id) ON DELETE CASCADE,
  action        text NOT NULL,       -- 'invite','accept','decline','force_activate','disconnect','test','sync'
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  detail        jsonb DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dmed_audit_clinic
  ON public.dmed_audit_log (clinic_id, created_at DESC);

ALTER TABLE public.dmed_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE SELECT ON public.dmed_audit_log FROM anon, authenticated;

-- ── 4. dmed_resource_map — Clary id ↔ DMED resource id ─────────────────────
CREATE TABLE IF NOT EXISTS public.dmed_resource_map (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  resource_type    text NOT NULL,
  clary_id         uuid NOT NULL,
  dmed_resource_id text NOT NULL,
  dmed_version     text,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, resource_type, clary_id)
);

CREATE INDEX IF NOT EXISTS idx_dmed_rmap_clinic
  ON public.dmed_resource_map (clinic_id, resource_type);

ALTER TABLE public.dmed_resource_map ENABLE ROW LEVEL SECURITY;
REVOKE SELECT ON public.dmed_resource_map FROM anon, authenticated;

-- ── 5. patients.pinfl — DMED yagona bemor kaliti ────────────────────────────
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS pinfl text;

-- Per-clinic unique: bir klinikada bir xil PINFL bo'lmaydi (NULL ruxsat)
CREATE UNIQUE INDEX IF NOT EXISTS uidx_patients_clinic_pinfl
  ON public.patients (clinic_id, pinfl)
  WHERE pinfl IS NOT NULL;
