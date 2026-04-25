-- =============================================================================
-- Clary v2 — Migration 000050: Support chat + Telegram backup runs
-- =============================================================================

CREATE TABLE support_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  opened_by UUID NOT NULL REFERENCES profiles(id),
  assigned_to UUID REFERENCES profiles(id), -- super admin
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open, waiting, closed
  priority TEXT NOT NULL DEFAULT 'normal', -- low, normal, high, urgent
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_response_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  sla_breached BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_st_clinic_status ON support_threads(clinic_id, status);
CREATE INDEX idx_st_assigned ON support_threads(assigned_to, status);

CREATE TABLE support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
  clinic_id UUID NOT NULL,
  author_id UUID NOT NULL REFERENCES profiles(id),
  author_kind TEXT NOT NULL, -- 'clinic' | 'super_admin' | 'system'
  content TEXT NOT NULL,
  is_internal_note BOOLEAN NOT NULL DEFAULT false,
  attachments JSONB DEFAULT '[]'::jsonb,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_sm_thread ON support_messages(thread_id, sent_at DESC);

CREATE TABLE support_typing_indicators (
  thread_id UUID NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id),
  last_typed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, user_id)
);

CREATE TABLE support_canned_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  content_i18n JSONB NOT NULL,
  category TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add chat update triggers
CREATE TRIGGER tg_support_threads_updated BEFORE UPDATE ON support_threads
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Telegram backup runs (daily)
CREATE TABLE backup_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL, -- 'daily_summary' | 'weekly_dump'
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running', -- running, success, failed
  summary JSONB,
  artifact_url TEXT,
  size_bytes BIGINT,
  duration_ms INT,
  telegram_message_id BIGINT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_backup_runs_date ON backup_runs(started_at DESC);

-- Webhook deliveries (outbound)
CREATE TABLE webhook_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT NOT NULL, -- HMAC key
  events TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INT NOT NULL DEFAULT 1
);

CREATE TABLE webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL,
  endpoint_id UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  payload JSONB NOT NULL,
  signature TEXT NOT NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  response_status INT,
  response_body TEXT,
  succeeded_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ,
  dead_lettered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Impersonation sessions
CREATE TABLE admin_impersonation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  super_admin_id UUID NOT NULL REFERENCES profiles(id),
  target_clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  target_user_id UUID NOT NULL REFERENCES profiles(id),
  support_ticket_id UUID REFERENCES support_threads(id),
  reason TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES profiles(id),
  jwt_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ais_admin ON admin_impersonation_sessions(super_admin_id, started_at DESC);

-- Clinic feature flags (super admin can toggle per tenant)
CREATE TABLE clinic_features (
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  reason TEXT,
  enabled_at TIMESTAMPTZ,
  enabled_by UUID REFERENCES profiles(id),
  PRIMARY KEY (clinic_id, feature)
);

-- Public signups waitlist (pre-signup email captures)
CREATE TABLE newsletter_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  locale TEXT NOT NULL DEFAULT 'uz-Latn',
  source TEXT,
  subscribed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  unsubscribed_at TIMESTAMPTZ
);

-- Sales leads (from landing contact/demo forms)
CREATE TABLE sales_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  clinic_name TEXT,
  organization_type organization_type,
  staff_count_bucket TEXT,
  message TEXT,
  source TEXT, -- 'contact_form' | 'demo_form' | 'partner_form'
  status TEXT NOT NULL DEFAULT 'new', -- new, contacted, qualified, converted, lost
  assigned_to UUID REFERENCES profiles(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sl_status ON sales_leads(status, created_at DESC);
