-- =============================================================================
-- Clary v2 — Migration 000040: Marketing 2.0
-- =============================================================================

-- marketing_segments
CREATE TABLE marketing_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  filter_query JSONB NOT NULL,
  is_dynamic BOOLEAN NOT NULL DEFAULT true,
  patient_count_cached INT,
  last_calculated_at TIMESTAMPTZ,
  sort_order INT NOT NULL DEFAULT 0,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES profiles(id),
  updated_by UUID REFERENCES profiles(id)
);

-- marketing_campaigns
CREATE TABLE marketing_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('oneshot', 'drip', 'triggered')),
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'email', 'push', 'multi')),
  status TEXT NOT NULL DEFAULT 'draft', -- draft, scheduled, running, paused, completed, canceled
  target_segment_id UUID REFERENCES marketing_segments(id),
  template_id UUID,
  variants JSONB, -- A/B test variants
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  stats JSONB NOT NULL DEFAULT '{"sent":0,"delivered":0,"opened":0,"clicked":0,"converted":0,"unsubscribed":0}'::jsonb,
  budget_uzs BIGINT,
  actual_cost_uzs BIGINT,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES profiles(id),
  updated_by UUID REFERENCES profiles(id)
);
CREATE INDEX idx_mc_clinic_status ON marketing_campaigns(clinic_id, status);

-- marketing_campaign_sends
CREATE TABLE marketing_campaign_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL,
  campaign_id UUID NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id),
  variant TEXT,
  channel TEXT NOT NULL,
  provider TEXT,
  provider_message_id TEXT,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  converted_at TIMESTAMPTZ,
  bounced BOOLEAN DEFAULT false,
  unsubscribed BOOLEAN DEFAULT false,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_mcs_campaign ON marketing_campaign_sends(campaign_id);
CREATE INDEX idx_mcs_patient ON marketing_campaign_sends(patient_id);

-- marketing_journeys (drip campaigns)
CREATE TABLE marketing_journeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger_event TEXT NOT NULL, -- 'patient.registered', 'appointment.completed', ...
  steps JSONB NOT NULL, -- [{delay: '1d', channel: 'sms', template_key: '...'}, ...]
  is_active BOOLEAN NOT NULL DEFAULT false,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES profiles(id),
  updated_by UUID REFERENCES profiles(id)
);

CREATE TABLE marketing_journey_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL,
  journey_id UUID NOT NULL REFERENCES marketing_journeys(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id),
  current_step INT NOT NULL DEFAULT 0,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_action_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  exited_at TIMESTAMPTZ,
  exit_reason TEXT
);
CREATE INDEX idx_mje_next_action ON marketing_journey_enrollments(next_action_at) WHERE completed_at IS NULL AND exited_at IS NULL;

-- loyalty_rules + ledger
CREATE TABLE loyalty_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger_event TEXT NOT NULL,
  points_awarded INT NOT NULL,
  condition JSONB,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES profiles(id),
  updated_by UUID REFERENCES profiles(id)
);

CREATE TABLE loyalty_points_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id),
  delta INT NOT NULL,
  reason TEXT NOT NULL,
  source_event JSONB,
  rule_id UUID REFERENCES loyalty_rules(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- nps_responses
CREATE TABLE nps_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id),
  appointment_id UUID REFERENCES appointments(id),
  score INT CHECK (score BETWEEN 0 AND 10),
  comment TEXT,
  survey_sent_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_nps_clinic_date ON nps_responses(clinic_id, responded_at DESC);

-- Apply triggers
DO $$
DECLARE tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'marketing_segments', 'marketing_campaigns', 'marketing_journeys', 'loyalty_rules'
  ])
  LOOP
    EXECUTE format('CREATE TRIGGER tg_%I_updated BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();', tbl, tbl);
    EXECUTE format('CREATE TRIGGER tg_%I_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION public.log_settings_audit();', tbl, tbl);
  END LOOP;
END $$;
