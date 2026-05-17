-- =============================================================================
-- Laboratoriya moduli — FAZA 4: Analizator integratsiya logi (kelajak skeleti)
-- =============================================================================
-- Bu FAZA ishlaydigan analizator integratsiyasi EMAS — kelajakda Mindray/Roche/
-- Abbott/Sysmex apparatlari natija yuborganda log uchun jadval. Adapter kodi
-- apps/api/src/modules/lab/analyzers/ papkasida (interfeys + skelet).

CREATE TABLE IF NOT EXISTS analyzer_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  analyzer      TEXT NOT NULL,             -- 'mindray_bc20', 'roche_cobas'...
  direction     TEXT NOT NULL DEFAULT 'inbound'
                  CHECK (direction IN ('inbound','outbound')),
  protocol      TEXT NOT NULL DEFAULT 'hl7'
                  CHECK (protocol IN ('hl7','astm','fhir','proprietary')),
  raw_payload   TEXT,                       -- xom HL7/ASTM xabar
  parsed        JSONB,                      -- adapter tomonidan parse qilingan
  sample_id     UUID REFERENCES lab_samples(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'received'
                  CHECK (status IN ('received','parsed','applied','failed')),
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analyzer_logs_clinic
  ON analyzer_logs(clinic_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analyzer_logs_sample ON analyzer_logs(sample_id);

ALTER TABLE analyzer_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_analyzer_logs_tenant ON analyzer_logs;
CREATE POLICY p_analyzer_logs_tenant ON analyzer_logs
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

COMMENT ON TABLE analyzer_logs IS
  'Laboratoriya analizatorlari integratsiya jurnali (kelajak). Mindray/Roche/'
  'Abbott/Sysmex apparatlari HL7/ASTM orqali natija yuborganda har xabar shu '
  'yerga yoziladi. Adapter qatlami: apps/api/src/modules/lab/analyzers/.';
