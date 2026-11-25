-- =============================================================================
-- Klinik SLA qoidalari + in-app notifications feed + SLA tekshiruv cron
-- =============================================================================

-- 1) clinic_sla_rules — har klinika uchun SLA muddatlari
CREATE TABLE IF NOT EXISTS clinic_sla_rules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id         UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL CHECK (kind IN (
                      'urgent_appointment', 'cito_lab', 'routine_lab', 'followup'
                    )),
  threshold_minutes INT NOT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, kind)
);

ALTER TABLE clinic_sla_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_clinic_sla_rules_tenant ON clinic_sla_rules;
CREATE POLICY p_clinic_sla_rules_tenant ON clinic_sla_rules
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

DROP TRIGGER IF EXISTS tg_clinic_sla_rules_updated ON clinic_sla_rules;
CREATE TRIGGER tg_clinic_sla_rules_updated
  BEFORE UPDATE ON clinic_sla_rules
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

COMMENT ON TABLE clinic_sla_rules IS
  'Klinik SLA muddatlari — urgent qabul, CITO/oddiy lab, follow-up. '
  'check_clinic_sla() cron har 10 daqiqada buzilganlarni topadi.';

-- Mavjud klinikalarga default SLA qoidalari
INSERT INTO clinic_sla_rules (clinic_id, kind, threshold_minutes)
SELECT c.id, v.kind, v.minutes
  FROM clinics c
  CROSS JOIN (VALUES
    ('urgent_appointment', 15),
    ('cito_lab', 120),
    ('routine_lab', 1440),
    ('followup', 43200)
  ) AS v(kind, minutes)
WHERE c.deleted_at IS NULL
ON CONFLICT (clinic_id, kind) DO NOTHING;

-- Yangi klinika ochilganda default SLA qoidalari
CREATE OR REPLACE FUNCTION seed_clinic_sla_rules()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO clinic_sla_rules (clinic_id, kind, threshold_minutes)
  VALUES
    (NEW.id, 'urgent_appointment', 15),
    (NEW.id, 'cito_lab', 120),
    (NEW.id, 'routine_lab', 1440),
    (NEW.id, 'followup', 43200)
  ON CONFLICT (clinic_id, kind) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_clinics_seed_sla ON clinics;
CREATE TRIGGER tg_clinics_seed_sla
  AFTER INSERT ON clinics
  FOR EACH ROW EXECUTE FUNCTION seed_clinic_sla_rules();

-- 2) notifications_inapp — doctor workspace feed
CREATE TABLE IF NOT EXISTS notifications_inapp (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  recipient_id UUID REFERENCES profiles(id) ON DELETE CASCADE,  -- NULL = klinika bo'ylab
  kind         TEXT NOT NULL,                -- sla_lab, sla_urgent, lab_ready, followup ...
  severity     TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','urgent')),
  title        TEXT NOT NULL,
  body         TEXT,
  ref_resource TEXT,                          -- lab_orders, queues, patients ...
  ref_id       UUID,
  dedup_key    TEXT,                          -- bir xil hodisani takrorlamaslik
  is_read      BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_inapp_recipient
  ON notifications_inapp(clinic_id, recipient_id, is_read, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_inapp_dedup
  ON notifications_inapp(clinic_id, dedup_key)
  WHERE dedup_key IS NOT NULL;

ALTER TABLE notifications_inapp ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_notifications_inapp_tenant ON notifications_inapp;
CREATE POLICY p_notifications_inapp_tenant ON notifications_inapp
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

COMMENT ON TABLE notifications_inapp IS
  'Doctor workspace ichidagi xabarlar feed''i — SLA buzilishi, lab tayyor, '
  'urgent bemor, follow-up. recipient_id NULL bo''lsa klinika bo''ylab.';

-- 3) check_clinic_sla — cron har 10 daqiqada chaqiradi
CREATE OR REPLACE FUNCTION check_clinic_sla()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created INT := 0;
  r RECORD;
BEGIN
  -- A) Urgent qabul — chaqirilmagan, SLA muddati o'tgan
  FOR r IN
    SELECT q.id, q.clinic_id, q.doctor_id, q.joined_at,
           p.full_name AS patient_name,
           sla.threshold_minutes
      FROM queues q
      JOIN clinic_sla_rules sla
        ON sla.clinic_id = q.clinic_id
       AND sla.kind = 'urgent_appointment'
       AND sla.is_active
      LEFT JOIN patients p ON p.id = q.patient_id
     WHERE q.status = 'waiting'
       AND q.priority >= 1
       AND q.joined_at < NOW() - (sla.threshold_minutes || ' minutes')::INTERVAL
  LOOP
    INSERT INTO notifications_inapp
      (clinic_id, recipient_id, kind, severity, title, body, ref_resource, ref_id, dedup_key)
    VALUES
      (r.clinic_id, r.doctor_id, 'sla_urgent', 'urgent',
       'Shoshilinch bemor kutmoqda',
       COALESCE(r.patient_name, 'Bemor') || ' — ' ||
         EXTRACT(EPOCH FROM (NOW() - r.joined_at))::INT / 60 || ' daqiqa kutmoqda',
       'queues', r.id, 'sla_urgent:' || r.id)
    ON CONFLICT (clinic_id, dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING;
    v_created := v_created + 1;
  END LOOP;

  -- B) Lab — natija kechikkan (CITO va oddiy)
  FOR r IN
    SELECT lo.id, lo.clinic_id, lo.ordered_by, lo.created_at, lo.urgency,
           p.full_name AS patient_name,
           sla.threshold_minutes, sla.kind AS sla_kind
      FROM lab_orders lo
      JOIN clinic_sla_rules sla
        ON sla.clinic_id = lo.clinic_id
       AND sla.kind = (CASE WHEN lo.urgency = 'stat' THEN 'cito_lab' ELSE 'routine_lab' END)
       AND sla.is_active
      LEFT JOIN patients p ON p.id = lo.patient_id
     WHERE lo.status IN ('pending', 'collected', 'running')
       AND lo.created_at < NOW() - (sla.threshold_minutes || ' minutes')::INTERVAL
  LOOP
    INSERT INTO notifications_inapp
      (clinic_id, recipient_id, kind, severity, title, body, ref_resource, ref_id, dedup_key)
    VALUES
      (r.clinic_id, r.ordered_by, 'sla_lab',
       CASE WHEN r.sla_kind = 'cito_lab' THEN 'urgent' ELSE 'warning' END,
       CASE WHEN r.sla_kind = 'cito_lab'
            THEN 'CITO lab muddati buzildi' ELSE 'Lab natija kechikdi' END,
       COALESCE(r.patient_name, 'Bemor') || ' — tahlil ' ||
         EXTRACT(EPOCH FROM (NOW() - r.created_at))::INT / 3600 || ' soat kutdi',
       'lab_orders', r.id, 'sla_lab:' || r.id)
    ON CONFLICT (clinic_id, dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING;
    v_created := v_created + 1;
  END LOOP;

  RETURN v_created;
END;
$$;

REVOKE ALL ON FUNCTION check_clinic_sla() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_clinic_sla() TO service_role;

-- 4) Cron — har 10 daqiqada SLA tekshiruvi
DO $$ BEGIN
  PERFORM cron.unschedule('check-clinic-sla');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule('check-clinic-sla', '*/10 * * * *',
  $$SELECT public.check_clinic_sla();$$);
