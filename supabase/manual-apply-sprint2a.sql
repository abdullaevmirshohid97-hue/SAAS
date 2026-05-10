-- ============================================================================
-- Clary Sprint 2A — Klinik routing chain (manual apply)
-- ============================================================================
-- Supabase Dashboard → SQL Editor → ushbu butun faylni paste qiling → Run.
-- Idempotent: ALTER ... ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS,
-- CREATE INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION ishlatiladi.
--
-- Manba migration: supabase/migrations/20260510000003_clinical_routing.sql
-- ============================================================================

BEGIN;

-- 1) prescriptions: apteka avto-intake + pharmacy_id link
ALTER TABLE prescriptions
  ADD COLUMN IF NOT EXISTS dispense_at_pharmacy BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pharmacy_id UUID REFERENCES rooms(id);

-- 2) prescription_items: vaqt jadvali + days_count + manual nurse
ALTER TABLE prescription_items
  ADD COLUMN IF NOT EXISTS schedule_times JSONB,
  ADD COLUMN IF NOT EXISTS days_count INT,
  ADD COLUMN IF NOT EXISTS assigned_nurse_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- 3) nurse_tasks: prescription source + scheduled_at
ALTER TABLE nurse_tasks
  ADD COLUMN IF NOT EXISTS prescription_id UUID REFERENCES prescriptions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS prescription_item_id UUID REFERENCES prescription_items(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_nurse_tasks_scheduled
  ON nurse_tasks(clinic_id, assigned_to, scheduled_at)
  WHERE status IN ('pending', 'in_progress');

CREATE INDEX IF NOT EXISTS idx_nurse_tasks_prescription
  ON nurse_tasks(prescription_id)
  WHERE prescription_id IS NOT NULL;

-- 4) nurse_schedules: hamshira × qavat × kun
CREATE TABLE IF NOT EXISTS nurse_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  nurse_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  floor INT NOT NULL,
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL DEFAULT '08:00',
  end_time   TIME NOT NULL DEFAULT '20:00',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clinic_id, nurse_id, floor, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_nurse_schedules_lookup
  ON nurse_schedules(clinic_id, floor, day_of_week, is_active)
  WHERE is_active = TRUE;

DROP TRIGGER IF EXISTS tg_nurse_schedules_updated ON nurse_schedules;
CREATE TRIGGER tg_nurse_schedules_updated
  BEFORE UPDATE ON nurse_schedules
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE nurse_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_nurse_schedules_tenant ON nurse_schedules;
CREATE POLICY p_nurse_schedules_tenant ON nurse_schedules
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

-- 5) service_referrals: specialist routing
ALTER TABLE service_referrals
  ADD COLUMN IF NOT EXISTS target_specialty TEXT,
  ADD COLUMN IF NOT EXISTS target_doctor_id UUID REFERENCES profiles(id);

CREATE INDEX IF NOT EXISTS idx_service_referrals_specialty
  ON service_referrals(clinic_id, target_specialty, status)
  WHERE status IN ('pending', 'received');

-- 6) RPC: prescription → nurse_tasks fan-out
CREATE OR REPLACE FUNCTION expand_prescription_to_nurse_tasks(p_prescription_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clinic_id     UUID;
  v_patient_id    UUID;
  v_doctor_id     UUID;
  v_stay_id       UUID;
  v_floor         INT;
  v_total_created INT := 0;
  v_item          RECORD;
  v_slot          JSONB;
  v_day_offset    INT;
  v_target_date   DATE;
  v_dow           INT;
  v_scheduled_at  TIMESTAMPTZ;
  v_nurse_id      UUID;
  v_today         DATE := CURRENT_DATE;
BEGIN
  SELECT clinic_id, patient_id, doctor_id, stay_id
    INTO v_clinic_id, v_patient_id, v_doctor_id, v_stay_id
    FROM prescriptions
   WHERE id = p_prescription_id;

  IF v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'Prescription % topilmadi', p_prescription_id;
  END IF;

  IF v_stay_id IS NOT NULL THEN
    SELECT r.floor INTO v_floor
      FROM inpatient_stays s
      JOIN rooms r ON r.id = s.room_id
     WHERE s.id = v_stay_id;
  END IF;
  IF v_floor IS NULL THEN
    SELECT r.floor INTO v_floor
      FROM inpatient_stays s
      JOIN rooms r ON r.id = s.room_id
     WHERE s.patient_id = v_patient_id
       AND s.discharged_at IS NULL
     ORDER BY s.admitted_at DESC
     LIMIT 1;
  END IF;

  FOR v_item IN
    SELECT id, schedule_times, days_count, assigned_nurse_id
      FROM prescription_items
     WHERE prescription_id = p_prescription_id
       AND schedule_times IS NOT NULL
       AND jsonb_array_length(schedule_times) > 0
  LOOP
    FOR v_day_offset IN 0..COALESCE(v_item.days_count, 1) - 1 LOOP
      v_target_date := v_today + v_day_offset;
      v_dow := EXTRACT(DOW FROM v_target_date)::INT;

      FOR v_slot IN SELECT * FROM jsonb_array_elements(v_item.schedule_times) LOOP
        v_scheduled_at := (v_target_date::TEXT || ' ' || (v_slot->>'time') || ':00')::TIMESTAMPTZ;

        IF v_item.assigned_nurse_id IS NOT NULL THEN
          v_nurse_id := v_item.assigned_nurse_id;
        ELSE
          v_nurse_id := NULL;
          IF v_floor IS NOT NULL THEN
            SELECT ns.nurse_id INTO v_nurse_id
              FROM nurse_schedules ns
             WHERE ns.clinic_id = v_clinic_id
               AND ns.floor = v_floor
               AND ns.day_of_week = v_dow
               AND ns.is_active = TRUE
               AND (v_slot->>'time')::TIME BETWEEN ns.start_time AND ns.end_time
             ORDER BY ns.start_time
             LIMIT 1;
          END IF;
        END IF;

        INSERT INTO nurse_tasks (
          clinic_id, patient_id, stay_id,
          assigned_to, title, category, priority,
          due_at, scheduled_at, status,
          prescription_id, prescription_item_id,
          created_by
        )
        VALUES (
          v_clinic_id, v_patient_id, v_stay_id,
          v_nurse_id,
          'Rx: ' || COALESCE((SELECT medication_name_snapshot FROM prescription_items WHERE id = v_item.id), 'medication'),
          'medication',
          0,
          v_scheduled_at, v_scheduled_at,
          'pending',
          p_prescription_id, v_item.id,
          v_doctor_id
        );
        v_total_created := v_total_created + 1;
      END LOOP;
    END LOOP;
  END LOOP;

  RETURN v_total_created;
END;
$$;

REVOKE ALL ON FUNCTION expand_prescription_to_nurse_tasks(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION expand_prescription_to_nurse_tasks(UUID) TO service_role;

COMMIT;

-- ============================================================================
-- Tekshirish (run after COMMIT):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='prescription_items' AND column_name IN ('schedule_times','days_count','assigned_nurse_id');
--   SELECT pg_get_functiondef('expand_prescription_to_nurse_tasks(uuid)'::regprocedure);
--   SELECT count(*) FROM nurse_schedules;
-- ============================================================================
