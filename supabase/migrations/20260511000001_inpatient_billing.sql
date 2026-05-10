-- =============================================================================
-- Sprint 2C — Inpatient billing: room tier, included services,
--   daily charge cron, discharge metadata
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) rooms.tier
-- -----------------------------------------------------------------------------
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS tier TEXT
    CHECK (tier IN ('lyuks','standart','comfort','depozit'));

COMMENT ON COLUMN rooms.tier IS
  'Xona toifasi: lyuks (qo''shilgan xizmatlar bilan), standart (faqat yotoq), '
  'comfort (oraliq), depozit (depozit hisobi uchun virtual xona).';

CREATE INDEX IF NOT EXISTS idx_rooms_tier
  ON rooms(clinic_id, tier)
  WHERE is_archived = false;

-- -----------------------------------------------------------------------------
-- 2) room_included_services — har tier'da avto-ulanadigan xizmatlar (UI preview)
--    Bu xizmatlar admit modal'da ko'rsatiladi; cron auto-charge qilmaydi
--    (operator manual qiladi).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS room_included_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  frequency_per_week INT NOT NULL DEFAULT 1
    CHECK (frequency_per_week BETWEEN 1 AND 14),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_room_included_services_room
  ON room_included_services(room_id);

ALTER TABLE room_included_services ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_room_included_services_tenant ON room_included_services;
CREATE POLICY p_room_included_services_tenant ON room_included_services
  FOR ALL
  USING (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin')
  WITH CHECK (clinic_id = public.get_my_clinic_id() OR public.get_my_role() = 'super_admin');

COMMENT ON TABLE room_included_services IS
  'Xona toifasi (tier) bilan birga keladigan xizmatlar ro''yxati. '
  'Misol: lyuks → massaj 2/hafta + parafin 1/hafta. Admit modal''da '
  'preview ko''rsatiladi. Hamshira/operator manual care_item yaratadi.';

-- -----------------------------------------------------------------------------
-- 3) inpatient_stays: discharge metadata + daily charge idempotency + extras
-- -----------------------------------------------------------------------------
ALTER TABLE inpatient_stays
  ADD COLUMN IF NOT EXISTS discharge_reason TEXT
    CHECK (discharge_reason IN ('recovery','treatment_refused','negative_review','admin','transferred','deceased','other')),
  ADD COLUMN IF NOT EXISTS discharge_payment_method TEXT,
  ADD COLUMN IF NOT EXISTS outstanding_settled_uzs BIGINT,
  ADD COLUMN IF NOT EXISTS deceased_writeoff BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS discharged_with_debt BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_charged_date DATE,
  ADD COLUMN IF NOT EXISTS daily_extras_uzs BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN inpatient_stays.daily_extras_uzs IS
  'Qo''shimcha kunlik xizmat narxi (xona daily_price ustida). Operator stay '
  'davomida tahrirlay oladi. Cron daily_price + daily_extras ni charge qiladi.';

COMMENT ON COLUMN inpatient_stays.last_charged_date IS
  'Oxirgi cron charge sanasi. Idempotency: faqat shu sanadan keyingi kunlar '
  'charge qilinadi.';

-- Mavjud admit'lar uchun backfill: ertangi cron to'g'ri ishlashi uchun
UPDATE inpatient_stays
   SET last_charged_date = (admitted_at AT TIME ZONE 'UTC')::date - 1
 WHERE last_charged_date IS NULL
   AND status = 'admitted'
   AND discharged_at IS NULL;

-- -----------------------------------------------------------------------------
-- 4) patient_ledger.recorded_by: NULL = system (cron)
-- -----------------------------------------------------------------------------
ALTER TABLE patient_ledger
  ALTER COLUMN recorded_by DROP NOT NULL;

COMMENT ON COLUMN patient_ledger.recorded_by IS
  'Yozuvni yaratgan profile. NULL = system (cron yoki avtomatik ledger entry).';

-- -----------------------------------------------------------------------------
-- 5) RPC: kunlik charge (idempotent, multi-day catch-up)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION charge_daily_inpatient_stays() RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
  v_stay RECORD;
  v_daily_price BIGINT;
  v_target_date DATE;
  v_cutoff DATE := CURRENT_DATE;
BEGIN
  FOR v_stay IN
    SELECT s.id, s.clinic_id, s.patient_id, s.room_id, s.tariff_id,
           s.last_charged_date, s.admitted_at,
           s.daily_extras_uzs,
           COALESCE(rt.price_uzs, r.daily_price_uzs, 0) AS daily_price
      FROM inpatient_stays s
      LEFT JOIN rooms r ON r.id = s.room_id
      LEFT JOIN room_tariffs rt ON rt.id = s.tariff_id
     WHERE s.status = 'admitted'
       AND s.discharged_at IS NULL
       AND COALESCE(s.last_charged_date, (s.admitted_at AT TIME ZONE 'UTC')::date - 1) < v_cutoff
  LOOP
    v_daily_price := COALESCE(v_stay.daily_price, 0) + COALESCE(v_stay.daily_extras_uzs, 0);
    IF v_daily_price <= 0 THEN
      -- Narx 0 bo'lsa skip (depozit xonalari uchun)
      UPDATE inpatient_stays SET last_charged_date = v_cutoff WHERE id = v_stay.id;
      CONTINUE;
    END IF;

    v_target_date := COALESCE(
      v_stay.last_charged_date + 1,
      (v_stay.admitted_at AT TIME ZONE 'UTC')::date
    );

    WHILE v_target_date <= v_cutoff LOOP
      INSERT INTO patient_ledger (
        clinic_id, patient_id, stay_id, entry_kind, amount_uzs,
        description, recorded_by
      ) VALUES (
        v_stay.clinic_id, v_stay.patient_id, v_stay.id, 'charge',
        -v_daily_price,
        'Statsionar kunlik to''lov: ' || v_target_date::TEXT,
        NULL
      );
      v_count := v_count + 1;
      v_target_date := v_target_date + 1;
    END LOOP;

    UPDATE inpatient_stays SET last_charged_date = v_cutoff WHERE id = v_stay.id;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION charge_daily_inpatient_stays() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION charge_daily_inpatient_stays() TO service_role;

COMMENT ON FUNCTION charge_daily_inpatient_stays IS
  'Har faol stay uchun bugungi va o''tkazib yuborilgan kunlar ('
  'last_charged_date + 1 ... CURRENT_DATE) uchun patient_ledger ga '
  '''charge'' yozadi. Idempotent: keyingi run faqat yangi kunlarni charge '
  'qiladi. daily_extras_uzs ham qo''shiladi.';

-- -----------------------------------------------------------------------------
-- 6) pg_cron schedule (00:05 har kun)
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  PERFORM cron.unschedule('inpatient-daily-charge');
EXCEPTION WHEN OTHERS THEN
  -- Schedule mavjud bo'lmasa unschedule xato beradi, e'tibor bermaymiz
  NULL;
END $$;

SELECT cron.schedule(
  'inpatient-daily-charge',
  '5 0 * * *',
  $$SELECT public.charge_daily_inpatient_stays();$$
);
