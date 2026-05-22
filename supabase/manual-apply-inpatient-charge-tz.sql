-- =============================================================================
-- Clary v2 — Migration: charge_daily_inpatient_stays Toshkent timezone fix
--
-- MUAMMO (eski versiyada):
--   1) CURRENT_DATE — Postgres server timezone (UTC) bo'yicha. Bu Toshkent
--      vaqtida 00:00–04:59 oralig'ida bemorlar uchun "kechagi sana"ni qaytaradi.
--   2) (admitted_at AT TIME ZONE 'UTC')::date — timestamptz'ni UTC kunga
--      aylantiradi. Toshkent 21:30 da admit qilingan bemor UTC'da 16:30 da
--      bo'ladi, lekin admit date UTC kuni bilan hisoblanadi. Toshkent kunidan
--      farq qiladi.
--   3) Cron '5 0 * * *' UTC = Toshkent 05:05. Yomon vaqt (mijozlar tushuncha
--      ko'rsatadi). To'g'risi: '5 19 * * *' UTC = Toshkent 00:05 (yarim tundan keyin).
--
-- YECHIM:
--   * Barcha sana hisoblari Asia/Tashkent timezone'da
--   * Cron jadvali UTC '5 19 * * *' (= Toshkent 00:05)
--   * Idempotentlik: last_charged_date < cutoff filtri saqlanadi
--   * Multi-tenant izolyatsiya: clinic_id RPC ichida boshqarilmaydi (har
--     stay o'z clinic_id'sini olib yuradi, RLS endpoint darajasida)
-- =============================================================================

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
  -- Toshkent vaqti bo'yicha bugungi sana (oxirgi charge qilinishi mumkin bo'lgan kun)
  v_cutoff DATE := (now() AT TIME ZONE 'Asia/Tashkent')::date;
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
       -- Idempotentlik: faqat last_charged_date < v_cutoff bo'lganlar
       -- (yangi admit uchun NULL → admitted_at - 1 default)
       AND COALESCE(
             s.last_charged_date,
             (s.admitted_at AT TIME ZONE 'Asia/Tashkent')::date - 1
           ) < v_cutoff
  LOOP
    -- Admit kuni — Toshkent timezone bo'yicha
    v_first_charge_date := (v_stay.admitted_at AT TIME ZONE 'Asia/Tashkent')::date;
    v_target_date := COALESCE(
      v_stay.last_charged_date + 1,
      v_first_charge_date
    );

    -- Ovqat narxi — admit paytdagi snapshot (stay), yo'q bo'lsa xonadan
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

    -- last_charged_date — Toshkent kuni (next-day idempotency uchun)
    UPDATE inpatient_stays
       SET last_charged_date = v_cutoff
     WHERE id = v_stay.id;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION charge_daily_inpatient_stays IS
  'Kunlik statsionar to''lov (Toshkent timezone). Yarim kun (birinchi kun) + '
  'ovqat (har kun) + daily_extras. Idempotent: last_charged_date < cutoff.';

-- -----------------------------------------------------------------------------
-- Cron jadvalini Toshkent 00:05 ga moslab qayta yaratish
-- '5 19 * * *' UTC = Toshkent 00:05 (UTC+5)
-- pg_cron ekstensiya mavjud bo'lishini tekshirib o'tkazadi
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Eski jadval bo'lsa olib tashlaymiz (xato beradi agar yo'q bo'lsa)
    BEGIN
      PERFORM cron.unschedule('inpatient-daily-charge');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    -- Toshkent 00:05 = UTC 19:05 (oldingi kun)
    PERFORM cron.schedule(
      'inpatient-daily-charge',
      '5 19 * * *',
      $cron$SELECT public.charge_daily_inpatient_stays();$cron$
    );
  END IF;
END $$;
