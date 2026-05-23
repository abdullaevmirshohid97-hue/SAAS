-- =============================================================================
-- Clary v2 — Migration: inpatient_meal_periods (ovqat oraliqlari)
--
-- MUAMMO:
--   Hozir inpatient_stays.with_meal bitta BOOLEAN — bemor bir kun ovqatsiz,
--   keyin ovqat bilan tarif olsa, tarix saqlanmaydi. Charge RPC butun stay
--   davomida bir xil ovqat narxi qo'shadi (yoki umuman qo'shmaydi).
--
-- YECHIM:
--   inpatient_meal_periods(stay_id, from_date, to_date, daily_uzs) — har
--   o'zgarish alohida qator. to_date NULL = hozircha davom etyapti (open period).
--   Charge RPC har kunni periodlar bilan tekshirib ovqat qo'shadi yoki
--   qo'shmaydi.
--
-- MULTI-TENANT: clinic_id stay_id orqali derive bo'ladi. RLS faqat
-- stay'ning clinic_id'siga binoan, alohida RLS qo'yilmagan (endpoint himoya
-- qiladi).
-- =============================================================================

CREATE TABLE IF NOT EXISTS inpatient_meal_periods (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stay_id     UUID NOT NULL REFERENCES inpatient_stays(id) ON DELETE CASCADE,
  from_date   DATE NOT NULL,
  to_date     DATE,  -- NULL = ochiq (hozircha davom etyapti)
  daily_uzs   BIGINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID,
  CONSTRAINT meal_period_dates_valid CHECK (to_date IS NULL OR to_date >= from_date)
);

CREATE INDEX IF NOT EXISTS idx_meal_periods_stay ON inpatient_meal_periods(stay_id);
CREATE INDEX IF NOT EXISTS idx_meal_periods_dates ON inpatient_meal_periods(stay_id, from_date, to_date);

COMMENT ON TABLE inpatient_meal_periods IS
  'Bemor stay davomida ovqat oraliqlari. Har o''zgarish (yoqish/o''chirish) yangi qator yoki ochiq qatorning to_date sini yopadi.';

-- -----------------------------------------------------------------------------
-- charge_daily_inpatient_stays — ovqat hisobini meal_periods orqali olish
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION charge_daily_inpatient_stays() RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
  v_stay RECORD;
  v_base_price BIGINT;
  v_meal_price BIGINT;
  v_target_date DATE;
  v_cutoff DATE := (now() AT TIME ZONE 'Asia/Tashkent')::date;
  v_is_first_day BOOLEAN;
  v_first_charge_date DATE;
BEGIN
  FOR v_stay IN
    SELECT s.id, s.clinic_id, s.patient_id, s.room_id, s.tariff_id,
           s.last_charged_date, s.admitted_at,
           s.daily_extras_uzs,
           s.is_half_day,
           COALESCE(rt.price_uzs, r.daily_price_uzs, 0)  AS daily_price,
           COALESCE(r.half_day_price_uzs, FLOOR(COALESCE(rt.price_uzs, r.daily_price_uzs, 0) / 2)::BIGINT) AS half_day_price
      FROM inpatient_stays s
      LEFT JOIN rooms r ON r.id = s.room_id
      LEFT JOIN room_tariffs rt ON rt.id = s.tariff_id
     WHERE s.status = 'admitted'
       AND s.discharged_at IS NULL
       AND COALESCE(
             s.last_charged_date,
             (s.admitted_at AT TIME ZONE 'Asia/Tashkent')::date - 1
           ) < v_cutoff
  LOOP
    v_first_charge_date := (v_stay.admitted_at AT TIME ZONE 'Asia/Tashkent')::date;
    v_target_date := COALESCE(v_stay.last_charged_date + 1, v_first_charge_date);

    WHILE v_target_date <= v_cutoff LOOP
      v_is_first_day := (v_target_date = v_first_charge_date);

      -- Asosiy xona narxi (yarim kunlik faqat birinchi kun)
      IF v_is_first_day AND v_stay.is_half_day THEN
        v_base_price := v_stay.half_day_price;
      ELSE
        v_base_price := v_stay.daily_price;
      END IF;

      -- Ovqat narxi: shu kun uchun ochiq period bormi?
      SELECT COALESCE(SUM(mp.daily_uzs), 0) INTO v_meal_price
        FROM inpatient_meal_periods mp
       WHERE mp.stay_id = v_stay.id
         AND mp.from_date <= v_target_date
         AND (mp.to_date IS NULL OR v_target_date <= mp.to_date);

      v_base_price := COALESCE(v_base_price, 0)
                    + COALESCE(v_stay.daily_extras_uzs, 0)
                    + COALESCE(v_meal_price, 0);

      IF v_base_price > 0 THEN
        INSERT INTO patient_ledger (
          clinic_id, patient_id, stay_id, entry_kind, amount_uzs,
          description, recorded_by
        ) VALUES (
          v_stay.clinic_id, v_stay.patient_id, v_stay.id, 'charge',
          -v_base_price,
          'Statsionar kunlik to''lov: ' || v_target_date::TEXT
            || CASE WHEN v_is_first_day AND v_stay.is_half_day THEN ' (yarim kun)' ELSE '' END
            || CASE WHEN v_meal_price > 0 THEN ' + ovqat' ELSE '' END,
          NULL
        );
        v_count := v_count + 1;
      END IF;

      v_target_date := v_target_date + 1;
    END LOOP;

    UPDATE inpatient_stays
       SET last_charged_date = v_cutoff
     WHERE id = v_stay.id;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION charge_daily_inpatient_stays IS
  'Kunlik statsionar to''lov (Toshkent TZ). Ovqat — inpatient_meal_periods orqali (sana oraliqlari). Yarim kun faqat birinchi kun.';

-- -----------------------------------------------------------------------------
-- Backfill: mavjud stay'larda with_meal=true bo'lganlar uchun period yaratish
-- (to_date NULL — hozircha ochiq)
-- -----------------------------------------------------------------------------
INSERT INTO inpatient_meal_periods (stay_id, from_date, to_date, daily_uzs)
SELECT s.id,
       (s.admitted_at AT TIME ZONE 'Asia/Tashkent')::date,
       NULL,
       COALESCE(s.meal_daily_uzs, r.meal_daily_uzs, 0)
  FROM inpatient_stays s
  LEFT JOIN rooms r ON r.id = s.room_id
 WHERE s.with_meal = true
   AND s.status = 'admitted'
   AND NOT EXISTS (
     SELECT 1 FROM inpatient_meal_periods mp WHERE mp.stay_id = s.id
   );
