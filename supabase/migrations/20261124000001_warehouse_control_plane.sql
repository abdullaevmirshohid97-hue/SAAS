-- =============================================================================
-- CLARY Sklad — control-plane (kompaniyalar ro'yxati) jadvallari
-- =============================================================================
-- Faqat QO'SHIMCHA: CLARY Clinic jadvallari, siyosatlari, triggerlari va
-- klinika tenant oqimiga TEGILMAYDI. Har ombor kompaniyasining o'z ma'lumoti
-- alohida PostgreSQL bazasida (data-plane) — bu yerda faqat ro'yxat, domen,
-- a'zolik va ulanish sirining Vault ID'si.
--
-- C0 (2026-11-25) o'zgarishlari (migratsiya hali hech qayerda qo'llanmagan):
--   • BullMQ/Redis o'rniga BAZADAGI navbat: `claim_warehouse_provisioning`
--     (FOR UPDATE SKIP LOCKED + lease) — ikki ishchi bitta kompaniyani bir
--     vaqtda yarata olmaydi, qo'lda "qayta urinish" avto-urinish bilan poyga
--     qilmaydi, jarayon qulasa lease tugagach qayta olinadi.
--   • Vault siri UPSERT (`upsert_warehouse_db_secret`) — qayta urinishda
--     "nom band" xatosi bilan abadiy yiqilmaydi, eski parol qolmaydi.
--   • Clinic foydalanuvchisini o'chirish Sklad a'zoligi tufayli bloklanmaydi
--     (a'zolik CASCADE, created_by SET NULL). Kompaniya EGASI esa o'chirilmaydi
--     (RESTRICT) — avval egalik boshqa odamga o'tkaziladi.
--   • BEGIN/COMMIT yo'q — deploy `psql -1` bilan bitta tranzaksiyada qo'llaydi.
-- Idempotent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.warehouse_tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 160),
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$|^[a-z0-9]$'),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
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
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
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
  -- Bazadagi navbat: nechanchi urinish, keyingisi qachon, ishchi qachongacha band.
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_expires_at TIMESTAMPTZ,
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
CREATE INDEX IF NOT EXISTS idx_warehouse_databases_queue
  ON public.warehouse_tenant_databases(status, next_attempt_at);

ALTER TABLE public.warehouse_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_tenant_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_tenant_databases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_provisioning_events ENABLE ROW LEVEL SECURITY;

-- Brauzer (anon/authenticated) to'g'ridan-to'g'ri o'qiy olmaydi — faqat Sklad API.
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

-- Kompaniyani bir yo'la (atomar) ro'yxatga olish.
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

-- Navbatdan bitta ishni olish (atomar). Olinadi:
--   • PENDING va vaqti kelgan, yoki
--   • PROVISIONING, lekin lease tugagan (ishchi jarayoni qulagan).
-- SKIP LOCKED — bir nechta Sklad API nusxasi bo'lsa ham har ish bittaga tushadi.
CREATE OR REPLACE FUNCTION public.claim_warehouse_provisioning(p_lease_seconds INT DEFAULT 600)
RETURNS TABLE (tenant_id UUID, attempts INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id UUID;
  v_attempts INT;
BEGIN
  SELECT d.tenant_id INTO v_id
    FROM public.warehouse_tenant_databases d
    JOIN public.warehouse_tenants t ON t.id = d.tenant_id
   WHERE t.status IN ('PENDING', 'PROVISIONING')
     AND ((d.status = 'PENDING' AND d.next_attempt_at <= now())
          OR (d.status = 'PROVISIONING' AND d.lease_expires_at < now()))
   ORDER BY d.next_attempt_at
   LIMIT 1
   FOR UPDATE OF d SKIP LOCKED;
  IF v_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.warehouse_tenant_databases d
     SET status = 'PROVISIONING',
         attempts = d.attempts + 1,
         lease_expires_at = now() + make_interval(secs => GREATEST(p_lease_seconds, 60)),
         updated_at = now()
   WHERE d.tenant_id = v_id
  RETURNING d.attempts INTO v_attempts;

  UPDATE public.warehouse_tenants SET status = 'PROVISIONING', updated_at = now() WHERE id = v_id;

  tenant_id := v_id;
  attempts := v_attempts;
  RETURN NEXT;
END;
$$;

-- Ulanish satri Supabase Vault'da shifrlangan holda (registr va loglarda emas).
-- UPSERT: qayta urinishda shu nomdagi sir yangilanadi (yangi parol bilan).
CREATE OR REPLACE FUNCTION public.upsert_warehouse_db_secret(p_secret TEXT, p_name TEXT)
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
  IF p_name IS NULL OR p_name !~ '^clary-warehouse-[0-9a-f-]{36}$' THEN
    RAISE EXCEPTION 'Invalid warehouse secret name';
  END IF;
  SELECT s.id INTO v_secret_id FROM vault.secrets s WHERE s.name = p_name;
  IF v_secret_id IS NULL THEN
    SELECT vault.create_secret(p_secret, p_name, 'CLARY Sklad tenant database connection')
      INTO v_secret_id;
  ELSE
    PERFORM vault.update_secret(v_secret_id, p_secret);
  END IF;
  RETURN v_secret_id;
END;
$$;

-- Avvalgi nom (eski branch kodi) — qoldirilmaydi, aralashmasin.
DROP FUNCTION IF EXISTS public.create_warehouse_db_secret(TEXT, TEXT);

-- Ulanish sirini PostgREST'ga vault sxemasini ochmasdan olish (faqat READY baza).
CREATE OR REPLACE FUNCTION public.get_warehouse_db_secret(p_tenant_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.create_warehouse_tenant(TEXT, TEXT, TEXT, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_warehouse_provisioning(INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.upsert_warehouse_db_secret(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_warehouse_db_secret(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_warehouse_tenant(TEXT, TEXT, TEXT, UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_warehouse_provisioning(INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_warehouse_db_secret(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_warehouse_db_secret(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
