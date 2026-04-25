-- =============================================================================
-- Clary v2 — Migration 000001: Extensions
-- =============================================================================

-- UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Encrypted columns (PII protection)
CREATE EXTENSION IF NOT EXISTS "pgsodium";

-- Supabase Vault for BYO credentials (uses pgsodium). Optional on local dev.
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS "vault" WITH SCHEMA "vault";
  EXCEPTION WHEN feature_not_supported OR undefined_file OR invalid_parameter_value THEN
    RAISE NOTICE 'Supabase vault extension not available on this environment (local dev). Skipping.';
    CREATE SCHEMA IF NOT EXISTS vault;
  END;
END$$;

-- Full-text search + similarity
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Generic triggers helpers
CREATE EXTENSION IF NOT EXISTS "moddatetime";

-- Cron jobs (retention, hash chain verification)
CREATE EXTENSION IF NOT EXISTS "pg_cron";

-- HTTP client (for webhooks from DB)
CREATE EXTENSION IF NOT EXISTS "pg_net";

-- Audit logging helper
CREATE EXTENSION IF NOT EXISTS "pgaudit";

-- =============================================================================
-- Custom types
-- =============================================================================

CREATE TYPE user_role AS ENUM (
  'super_admin',
  'clinic_owner',
  'clinic_admin',
  'doctor',
  'receptionist',
  'cashier',
  'pharmacist',
  'lab_technician',
  'radiologist',
  'nurse',
  'staff'
);

CREATE TYPE subscription_plan AS ENUM ('demo', '25pro', '50pro', '120pro');

CREATE TYPE subscription_status AS ENUM (
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused'
);

CREATE TYPE device_kind AS ENUM ('desktop', 'tablet', 'mobile', 'kiosk');

CREATE TYPE appointment_status AS ENUM (
  'scheduled',
  'checked_in',
  'in_progress',
  'completed',
  'canceled',
  'no_show'
);

CREATE TYPE queue_status AS ENUM (
  'waiting',
  'called',
  'serving',
  'served',
  'left'
);

CREATE TYPE payment_method_type AS ENUM (
  'cash',
  'card',
  'transfer',
  'insurance',
  'click',
  'payme',
  'uzum',
  'kaspi',
  'humo',
  'uzcard',
  'stripe'
);

CREATE TYPE organization_type AS ENUM (
  'clinic',
  'hospital',
  'diagnostic_center',
  'dental',
  'laboratory',
  'pharmacy'
);

-- =============================================================================
-- Helper functions for RLS
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_my_clinic_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (auth.jwt()->'app_metadata'->>'clinic_id')::uuid;
$$;

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(auth.jwt()->'app_metadata'->>'role', 'staff');
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT public.get_my_role() = 'super_admin';
$$;

CREATE OR REPLACE FUNCTION public.is_clinic_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT public.get_my_role() IN ('clinic_owner', 'clinic_admin', 'super_admin');
$$;

-- Generic updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.version := COALESCE(OLD.version, 0) + 1;
  RETURN NEW;
END;
$$;

-- JSON diff function (used by settings_audit_log trigger)
CREATE OR REPLACE FUNCTION public.jsonb_diff(a JSONB, b JSONB)
RETURNS JSONB
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT jsonb_object_agg(key, value)
  FROM (
    SELECT key, value
    FROM jsonb_each(COALESCE(b, '{}'::jsonb))
    WHERE NOT (COALESCE(a, '{}'::jsonb) ? key) OR COALESCE(a, '{}'::jsonb)->key IS DISTINCT FROM value
    UNION ALL
    SELECT key, 'null'::jsonb
    FROM jsonb_each(COALESCE(a, '{}'::jsonb))
    WHERE NOT (COALESCE(b, '{}'::jsonb) ? key)
  ) AS diff
$$;
