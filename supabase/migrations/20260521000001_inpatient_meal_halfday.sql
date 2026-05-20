-- =============================================================================
-- Clary v2 — Migration: yarim kunlik tarif + ovqat narxi + eski klinikalar PIN
--
-- 1) Xonalarga half_day_price_uzs va meal_daily_uzs ustunlari
-- 2) inpatient_stays'ga snapshot ustunlari (with_meal, meal_daily_uzs, is_half_day)
--    — bemor admit qilingan paytdagi narxlar saqlanadi, keyin xona narxi
--    o'zgartirilsa ham bemorga ta'sir qilmaydi
-- 3) Eski klinikalarga jurnal PIN '0000' o'rnatish (idempotent — agar yo'q bo'lsa)
-- 4) charge_daily_inpatient_stays RPC yangilash — yarim kun va ovqat hisobga olinadi
-- =============================================================================

-- 1) rooms — yangi narx ustunlari
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS half_day_price_uzs BIGINT,
  ADD COLUMN IF NOT EXISTS meal_daily_uzs     BIGINT;

COMMENT ON COLUMN rooms.half_day_price_uzs IS 'Yarim kunlik narx so''mda. NULL bo''lsa = daily/2.';
COMMENT ON COLUMN rooms.meal_daily_uzs IS 'Ovqat kunlik narxi so''mda (xona narxiga qo''shiladi agar with_meal=true).';

-- 2) inpatient_stays — snapshot ustunlari
ALTER TABLE inpatient_stays
  ADD COLUMN IF NOT EXISTS with_meal       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS meal_daily_uzs  BIGINT,
  ADD COLUMN IF NOT EXISTS is_half_day     BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN inpatient_stays.with_meal IS 'Ovqatli bo''lib qabul qilingan — har kuni meal_daily_uzs ham hisoblanadi.';
COMMENT ON COLUMN inpatient_stays.meal_daily_uzs IS 'Admit paytdagi ovqat narxi (snapshot — xona narxi o''zgartirilsa ham qoladi).';
COMMENT ON COLUMN inpatient_stays.is_half_day IS 'Yarim kunlik tariflar — birinchi kun half_day_price_uzs charge qilinadi.';

-- 3) Eski klinikalar uchun default PIN (yangi klinikalar uchun ham himoya)
-- 0000 sha256 = 9af15b336e6a9619928537df30b2e6a2376569fcf9d7e773eccede65606529a0
UPDATE clinics
   SET journal_pin_hash   = '9af15b336e6a9619928537df30b2e6a2376569fcf9d7e773eccede65606529a0',
       journal_pin_set_at = COALESCE(journal_pin_set_at, now())
 WHERE journal_pin_hash IS NULL;

-- 4) charge_daily_inpatient_stays — yarim kun va ovqat hisobga olinadi
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
  v_cutoff DATE := CURRENT_DATE;
  v_is_first_day BOOLEAN;
  v_first_charge_date DATE;
BEGIN
  FOR v_stay IN
    SELECT s.id, s.clinic_id, s.patient_id, s.room_id, s.tariff_id,
           s.last_charged_date, s.admitted_at,
           s.daily_extras_uzs,
           s.with_meal,
           s.meal_daily_uzs        AS stay_meal_uzs,
           s.is_half_day,
           COALESCE(rt.price_uzs, r.daily_price_uzs, 0)  AS daily_price,
           COALESCE(r.half_day_price_uzs, FLOOR(COALESCE(rt.price_uzs, r.daily_price_uzs, 0) / 2)::BIGINT) AS half_day_price,
           COALESCE(r.meal_daily_uzs, 0) AS room_meal_uzs
      FROM inpatient_stays s
      LEFT JOIN rooms r ON r.id = s.room_id
      LEFT JOIN room_tariffs rt ON rt.id = s.tariff_id
     WHERE s.status = 'admitted'
       AND s.discharged_at IS NULL
       AND COALESCE(s.last_charged_date, (s.admitted_at AT TIME ZONE 'UTC')::date - 1) < v_cutoff
  LOOP
    v_first_charge_date := (v_stay.admitted_at AT TIME ZONE 'UTC')::date;
    v_target_date := COALESCE(
      v_stay.last_charged_date + 1,
      v_first_charge_date
    );

    -- Ovqat narxi — snapshot (stay) ustun olinadi, yo'q bo'lsa xonadan
    v_meal_price := CASE WHEN v_stay.with_meal
                         THEN COALESCE(v_stay.stay_meal_uzs, v_stay.room_meal_uzs, 0)
                         ELSE 0
                    END;

    WHILE v_target_date <= v_cutoff LOOP
      v_is_first_day := (v_target_date = v_first_charge_date);

      -- Asosiy narx: yarim kunlik faqat birinchi kunga, qolganlari to'liq
      IF v_is_first_day AND v_stay.is_half_day THEN
        v_base_price := v_stay.half_day_price;
      ELSE
        v_base_price := v_stay.daily_price;
      END IF;

      v_base_price := COALESCE(v_base_price, 0)
                    + COALESCE(v_stay.daily_extras_uzs, 0)
                    + v_meal_price;

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
       SET last_charged_date = v_cutoff,
           last_charged_at   = now()
     WHERE id = v_stay.id;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION charge_daily_inpatient_stays IS
  'Kunlik statsionar to''lov: yarim kun (birinchi kun) + ovqat (har kun) + daily_extras.';
