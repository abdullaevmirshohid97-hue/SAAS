-- =============================================================================
-- Clary v2 — Migration: inpatient attendant (qarovchi) summasi
--
-- MUAMMO:
--   Statsionar bemorga "qarovchi" (attendant) biriktirilsa, uning kunlik
--   summasi alohida ko'rsatilmaydi. Hozir faqat umumiy daily_extras_uzs bor,
--   lekin u "qo'shimcha" deb ataladi va qarovchini alohida ajratib bo'lmaydi.
--
-- YECHIM:
--   inpatient_stays'ga attendant_daily_uzs (kunlik qarovchi narxi) +
--   attendant_name (qarovchi ismi) qo'shamiz. Kunlik charge RPC bu summani
--   ham qo'shadi (daily_extras_uzs yonida, alohida "qarovchi" izoh bilan).
-- =============================================================================

ALTER TABLE inpatient_stays
  ADD COLUMN IF NOT EXISTS attendant_daily_uzs BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attendant_name TEXT;

COMMENT ON COLUMN inpatient_stays.attendant_daily_uzs IS
  'Qarovchi (attendant) kunlik narxi. Kunlik charge''ga qo''shiladi.';
COMMENT ON COLUMN inpatient_stays.attendant_name IS
  'Qarovchi (attendant) ismi — hisob-fakturada ko''rsatish uchun.';

-- -----------------------------------------------------------------------------
-- charge_daily_inpatient_stays — qarovchi (attendant) summasini ham qo'shish
-- (20260523000002 versiyasidan ko'chirildi, attendant_daily_uzs qo'shildi)
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
           s.attendant_daily_uzs,
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
                    + COALESCE(v_stay.attendant_daily_uzs, 0)
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
            || CASE WHEN v_meal_price > 0 THEN ' + ovqat' ELSE '' END
            || CASE WHEN COALESCE(v_stay.attendant_daily_uzs, 0) > 0 THEN ' + qarovchi' ELSE '' END,
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
  'Kunlik statsionar to''lov (Toshkent TZ). Ovqat — inpatient_meal_periods orqali. Yarim kun faqat birinchi kun. daily_extras_uzs + attendant_daily_uzs qo''shiladi.';
