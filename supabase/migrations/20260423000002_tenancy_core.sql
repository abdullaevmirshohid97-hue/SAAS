-- =============================================================================
-- Clary v2 — Migration 000002: Core tenancy (clinics, profiles, plans,
-- subscriptions, invoices, user_devices, tenant_vault_secrets)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- plans (system catalog; only super admin mutates)
-- -----------------------------------------------------------------------------
CREATE TABLE plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code subscription_plan UNIQUE NOT NULL,
  name TEXT NOT NULL,
  price_usd_cents INT NOT NULL,
  stripe_price_id TEXT,
  max_staff INT,
  max_devices INT,
  max_patients INT,
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INT NOT NULL DEFAULT 1
);

INSERT INTO plans (code, name, price_usd_cents, max_staff, max_devices, features, sort_order) VALUES
  ('demo',   'Demo (14 days)',   0,     2,   2,   '{"analytics": false, "custom_roles": false, "sla": false}',         0),
  ('25pro',  'Starter 25PRO',    2500,  2,   2,   '{"analytics": false, "custom_roles": false, "sla": false}',         1),
  ('50pro',  'Business 50PRO',   5000,  10,  10,  '{"analytics": true,  "custom_roles": false, "sla": false}',         2),
  ('120pro', 'Enterprise 120PRO',12000, NULL,NULL,'{"analytics": true,  "custom_roles": true,  "sla": true}',           3);

-- -----------------------------------------------------------------------------
-- clinics (tenant root)
-- -----------------------------------------------------------------------------
CREATE TABLE clinics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  legal_name TEXT,
  tax_id TEXT,
  organization_type organization_type NOT NULL DEFAULT 'clinic',
  country TEXT NOT NULL DEFAULT 'UZ',
  region TEXT,
  city TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  logo_url TEXT,
  primary_color TEXT DEFAULT '#2563EB',
  timezone TEXT NOT NULL DEFAULT 'Asia/Tashkent',
  default_locale TEXT NOT NULL DEFAULT 'uz-Latn',
  currency TEXT NOT NULL DEFAULT 'UZS',

  -- Subscription
  current_plan subscription_plan NOT NULL DEFAULT 'demo',
  subscription_status subscription_status NOT NULL DEFAULT 'trialing',
  trial_ends_at TIMESTAMPTZ,
  subscription_ends_at TIMESTAMPTZ,
  stripe_customer_id TEXT,

  -- Status
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_suspended BOOLEAN NOT NULL DEFAULT false,
  suspension_reason TEXT,

  settings JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  version INT NOT NULL DEFAULT 1
);

CREATE INDEX idx_clinics_slug ON clinics(slug) WHERE deleted_at IS NULL;
CREATE INDEX idx_clinics_status ON clinics(subscription_status) WHERE deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- profiles (tenant-scoped user profile mirroring auth.users)
-- -----------------------------------------------------------------------------
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  clinic_id UUID REFERENCES clinics(id) ON DELETE CASCADE,
  role user_role NOT NULL DEFAULT 'staff',

  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  avatar_url TEXT,

  locale TEXT NOT NULL DEFAULT 'uz-Latn',
  theme TEXT NOT NULL DEFAULT 'light',

  is_active BOOLEAN NOT NULL DEFAULT true,
  last_sign_in_at TIMESTAMPTZ,

  mfa_enabled BOOLEAN NOT NULL DEFAULT false,
  webauthn_enabled BOOLEAN NOT NULL DEFAULT false,

  custom_role_id UUID, -- FK added later (catalog migration)
  permissions_override JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  version INT NOT NULL DEFAULT 1
);

CREATE INDEX idx_profiles_clinic ON profiles(clinic_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_profiles_email ON profiles(email) WHERE deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- invitations (pending staff invites)
-- -----------------------------------------------------------------------------
CREATE TABLE invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role user_role NOT NULL,
  invited_by UUID NOT NULL REFERENCES profiles(id),
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invitations_clinic ON invitations(clinic_id) WHERE accepted_at IS NULL;
CREATE INDEX idx_invitations_token ON invitations(token) WHERE accepted_at IS NULL;

-- -----------------------------------------------------------------------------
-- user_devices (device tracking; enforces plan device limit)
-- -----------------------------------------------------------------------------
CREATE TABLE user_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind device_kind NOT NULL,
  fingerprint TEXT NOT NULL,
  name TEXT NOT NULL,
  os TEXT,
  browser TEXT,
  last_ip INET,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_trusted BOOLEAN NOT NULL DEFAULT false,
  is_revoked BOOLEAN NOT NULL DEFAULT false,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, fingerprint)
);

CREATE INDEX idx_user_devices_clinic ON user_devices(clinic_id) WHERE is_revoked = false;
CREATE INDEX idx_user_devices_user ON user_devices(user_id) WHERE is_revoked = false;

-- -----------------------------------------------------------------------------
-- subscriptions (history, current is the latest active one per clinic)
-- -----------------------------------------------------------------------------
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  plan_code subscription_plan NOT NULL,
  status subscription_status NOT NULL,
  stripe_subscription_id TEXT,
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  canceled_at TIMESTAMPTZ,
  dunning_attempts INT NOT NULL DEFAULT 0,
  grace_ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscriptions_clinic ON subscriptions(clinic_id);
CREATE INDEX idx_subscriptions_stripe ON subscriptions(stripe_subscription_id);

-- -----------------------------------------------------------------------------
-- invoices
-- -----------------------------------------------------------------------------
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions(id),
  stripe_invoice_id TEXT UNIQUE,
  number TEXT,
  amount_usd_cents INT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL, -- draft, open, paid, void, uncollectible
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  pdf_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoices_clinic ON invoices(clinic_id, issued_at DESC);

-- -----------------------------------------------------------------------------
-- payments (platform-level; for Stripe payouts to Clary)
-- -----------------------------------------------------------------------------
CREATE TABLE platform_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES invoices(id),
  amount_usd_cents INT NOT NULL,
  stripe_payment_intent_id TEXT UNIQUE,
  status TEXT NOT NULL, -- pending, succeeded, failed, refunded
  failure_reason TEXT,
  succeeded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- tenant_vault_secrets (BYO credentials metadata; values in Supabase Vault)
-- -----------------------------------------------------------------------------
CREATE TABLE tenant_vault_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  provider_kind TEXT NOT NULL, -- 'payment' | 'sms' | 'email' | 'push' | 'webhook'
  provider_name TEXT NOT NULL, -- 'click' | 'payme' | 'eskiz' | 'resend' ...
  label TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,

  -- Non-secret metadata (visible to clinic admin)
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Vault secret key (Supabase Vault id pointing to the encrypted value)
  vault_secret_id UUID NOT NULL,

  last_tested_at TIMESTAMPTZ,
  last_test_succeeded BOOLEAN,
  last_test_error TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES profiles(id),
  version INT NOT NULL DEFAULT 1
);

CREATE INDEX idx_tvs_clinic_kind ON tenant_vault_secrets(clinic_id, provider_kind) WHERE is_active = true;
CREATE UNIQUE INDEX idx_tvs_primary_per_kind
  ON tenant_vault_secrets(clinic_id, provider_kind)
  WHERE is_primary = true AND is_active = true;

-- -----------------------------------------------------------------------------
-- Triggers: updated_at + version bump
-- -----------------------------------------------------------------------------
CREATE TRIGGER tg_clinics_updated BEFORE UPDATE ON clinics
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER tg_profiles_updated BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER tg_plans_updated BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER tg_tvs_updated BEFORE UPDATE ON tenant_vault_secrets
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
