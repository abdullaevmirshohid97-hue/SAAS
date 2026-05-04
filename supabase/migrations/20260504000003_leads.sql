-- Lead capture: exit-intent forms, floating CTA, /book-demo redirects all land here.

CREATE TABLE IF NOT EXISTS leads (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT,
  phone        TEXT,
  email        TEXT,
  clinic_name  TEXT,
  message      TEXT,
  source       TEXT NOT NULL DEFAULT 'unknown',
  utm_source   TEXT,
  utm_medium   TEXT,
  utm_campaign TEXT,
  utm_content  TEXT,
  utm_term     TEXT,
  status       TEXT NOT NULL DEFAULT 'new'
                 CHECK (status IN ('new','contacted','qualified','demo_booked','won','lost','spam')),
  notes        TEXT,
  ip_hash      TEXT,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS leads_created_at_idx ON leads (created_at DESC);
CREATE INDEX IF NOT EXISTS leads_status_idx     ON leads (status) WHERE status NOT IN ('won','lost','spam');
CREATE INDEX IF NOT EXISTS leads_source_idx     ON leads (source);

CREATE TRIGGER tg_leads_updated BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- Anyone with a session can submit (write-only). Read is service-role only.
CREATE POLICY leads_no_select ON leads FOR SELECT USING (FALSE);
CREATE POLICY leads_anon_insert ON leads FOR INSERT WITH CHECK (TRUE);
CREATE POLICY leads_no_update ON leads FOR UPDATE USING (FALSE);

COMMENT ON TABLE leads IS 'Inbound leads from landing forms, exit-intent, /book-demo. Service role / API only for read & admin.';
