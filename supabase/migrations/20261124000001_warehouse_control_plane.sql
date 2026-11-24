-- CLARY Sklad control-plane tables.
-- These are additive and deliberately do not alter CLARY Clinic tables,
-- policies, triggers, or the existing clinics tenant lifecycle.

BEGIN;

CREATE TABLE IF NOT EXISTS public.warehouse_tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 160),
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$|^[a-z0-9]$'),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  plan_code TEXT NOT NULL DEFAULT 'starter',
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROVISIONING', 'ACTIVE', 'SUSPENDED', 'FAILED', 'DELETING')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.warehouse_tenant_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.warehouse_tenants(id) ON DELETE CASCADE,
  hostname TEXT NOT NULL UNIQUE,
  is_primary BOOLEAN NOT NULL DEFAULT TRUE,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, hostname)
);

CREATE TABLE IF NOT EXISTS public.warehouse_tenant_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.warehouse_tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('warehouse_owner', 'warehouse_admin', 'warehouse_manager', 'warehouse_operator', 'warehouse_viewer')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INVITED', 'SUSPENDED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.warehouse_tenant_databases (
  tenant_id UUID PRIMARY KEY REFERENCES public.warehouse_tenants(id) ON DELETE CASCADE,
  server_key TEXT NOT NULL DEFAULT 'primary',
  database_name TEXT UNIQUE,
  database_role TEXT UNIQUE,
  vault_secret_id UUID,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROVISIONING', 'READY', 'FAILED')),
  last_error TEXT,
  provisioned_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.warehouse_provisioning_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.warehouse_tenants(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('INFO', 'SUCCESS', 'WARNING', 'ERROR')),
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_warehouse_tenants_status
  ON public.warehouse_tenants(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_warehouse_memberships_user
  ON public.warehouse_tenant_memberships(user_id, status);
CREATE INDEX IF NOT EXISTS idx_warehouse_provisioning_events_tenant
  ON public.warehouse_provisioning_events(tenant_id, created_at DESC);

ALTER TABLE public.warehouse_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_tenant_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_tenant_databases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_provisioning_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.warehouse_tenants FROM anon, authenticated;
REVOKE ALL ON public.warehouse_tenant_domains FROM anon, authenticated;
REVOKE ALL ON public.warehouse_tenant_memberships FROM anon, authenticated;
REVOKE ALL ON public.warehouse_tenant_databases FROM anon, authenticated;
REVOKE ALL ON public.warehouse_provisioning_events FROM anon, authenticated;

GRANT ALL ON public.warehouse_tenants TO service_role;
GRANT ALL ON public.warehouse_tenant_domains TO service_role;
GRANT ALL ON public.warehouse_tenant_memberships TO service_role;
GRANT ALL ON public.warehouse_tenant_databases TO service_role;
GRANT ALL ON public.warehouse_provisioning_events TO service_role;

-- Atomic creation of the warehouse control-plane records.
CREATE OR REPLACE FUNCTION public.create_warehouse_tenant(
  p_name TEXT,
  p_slug TEXT,
  p_hostname TEXT,
  p_owner_user_id UUID,
  p_created_by UUID,
  p_plan_code TEXT DEFAULT 'starter'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  IF p_slug !~ '^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$|^[a-z0-9]$' THEN
    RAISE EXCEPTION 'Invalid warehouse slug';
  END IF;
  IF p_hostname !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' THEN
    RAISE EXCEPTION 'Invalid warehouse hostname';
  END IF;

  INSERT INTO public.warehouse_tenants (name, slug, owner_user_id, created_by, plan_code)
  VALUES (trim(p_name), p_slug, p_owner_user_id, p_created_by, coalesce(nullif(trim(p_plan_code), ''), 'starter'))
  RETURNING id INTO v_tenant_id;

  INSERT INTO public.warehouse_tenant_domains (tenant_id, hostname, is_primary)
  VALUES (v_tenant_id, p_hostname, TRUE);

  INSERT INTO public.warehouse_tenant_memberships (tenant_id, user_id, role, status)
  VALUES (v_tenant_id, p_owner_user_id, 'warehouse_owner', 'ACTIVE');

  INSERT INTO public.warehouse_tenant_databases (tenant_id, server_key, status)
  VALUES (v_tenant_id, 'primary', 'PENDING');

  INSERT INTO public.warehouse_provisioning_events (tenant_id, event_type, status, message)
  VALUES (v_tenant_id, 'tenant.created', 'SUCCESS', 'Warehouse tenant created; database provisioning queued.');

  RETURN v_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_warehouse_tenant(TEXT, TEXT, TEXT, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_warehouse_tenant(TEXT, TEXT, TEXT, UUID, UUID, TEXT)
  TO service_role;

-- Connection strings are stored encrypted in Supabase Vault, never in the
-- tenant registry or application logs.
CREATE OR REPLACE FUNCTION public.create_warehouse_db_secret(p_secret TEXT, p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret_id UUID;
BEGIN
  IF p_secret IS NULL OR length(p_secret) < 20 THEN
    RAISE EXCEPTION 'Invalid warehouse database secret';
  END IF;
  SELECT vault.create_secret(p_secret, p_name, 'CLARY Sklad tenant database connection')
    INTO v_secret_id;
  RETURN v_secret_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_warehouse_db_secret(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_warehouse_db_secret(TEXT, TEXT)
  TO service_role;

-- Resolve a tenant connection secret without exposing the Vault schema to PostgREST.
CREATE OR REPLACE FUNCTION public.get_warehouse_db_secret(p_tenant_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $
DECLARE
  v_secret TEXT;
BEGIN
  SELECT ds.decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets AS ds
  JOIN public.warehouse_tenant_databases AS wtd
    ON wtd.vault_secret_id = ds.id
  WHERE wtd.tenant_id = p_tenant_id
    AND wtd.status = 'READY';
  RETURN v_secret;
END;
$;

REVOKE ALL ON FUNCTION public.get_warehouse_db_secret(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_warehouse_db_secret(UUID)
  TO service_role;

COMMIT;
