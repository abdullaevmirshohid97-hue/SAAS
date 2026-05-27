-- Statsionar shifokorlar payroll'ini har kun avtomatik hisoblash.
-- Har faol (admitted) stay uchun, attending_doctor anketasidagi rejimga
-- qarab doctor_ledger ga yozuv qo'shiladi.
--
-- Rejimlar:
--   percent : kunlik xona narxidan foiz (bonus kind)
--   monthly : oylik fix / oydagi kun soni (bonus kind)
--   bonus   : faqat admission paytida (admit() backend'da)
--   off     : hech narsa qilinmaydi
--
-- Idempotency: doctor_ledger.reference = 'inpatient:' || stay_id || ':' || charge_date

CREATE OR REPLACE FUNCTION public.charge_daily_inpatient_doctor_payroll(p_date date DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_date date := COALESCE(p_date, (now() AT TIME ZONE 'Asia/Tashkent')::date);
  v_inserted integer := 0;
  r RECORD;
  v_base_uzs bigint;
  v_amount bigint;
  v_kind text;
  v_notes text;
  v_ref text;
  v_days_in_month integer;
BEGIN
  v_days_in_month := EXTRACT(day FROM (date_trunc('month', v_date) + interval '1 month - 1 day'))::int;

  FOR r IN
    SELECT
      s.id AS stay_id,
      s.clinic_id,
      s.attending_doctor_id,
      s.is_half_day,
      s.with_meal,
      s.meal_daily_uzs,
      rm.daily_price_uzs,
      rm.half_day_price_uzs,
      sp.inpatient_payroll_mode AS mode,
      sp.inpatient_percent AS percent,
      sp.inpatient_monthly_uzs AS monthly_uzs
    FROM public.inpatient_stays s
    JOIN public.staff_profiles sp ON sp.profile_id = s.attending_doctor_id
      AND sp.clinic_id = s.clinic_id
      AND sp.is_active = true
    LEFT JOIN public.rooms rm ON rm.id = s.room_id
    WHERE s.status = 'admitted'
      AND s.attending_doctor_id IS NOT NULL
      AND sp.inpatient_payroll_mode IN ('percent', 'monthly')
      AND s.admitted_at::date <= v_date
  LOOP
    v_ref := 'inpatient:' || r.stay_id::text || ':' || v_date::text;
    IF EXISTS (
      SELECT 1 FROM public.doctor_ledger
      WHERE clinic_id = r.clinic_id
        AND doctor_id = r.attending_doctor_id
        AND reference = v_ref
    ) THEN
      CONTINUE;
    END IF;

    IF r.mode = 'percent' THEN
      v_base_uzs := COALESCE(
        CASE WHEN r.is_half_day THEN r.half_day_price_uzs ELSE r.daily_price_uzs END,
        0
      ) + CASE WHEN r.with_meal THEN COALESCE(r.meal_daily_uzs, 0) ELSE 0 END;
      v_amount := FLOOR(v_base_uzs * COALESCE(r.percent, 0) / 100.0)::bigint;
      v_notes := 'Statsionar kunlik foiz (' || v_date || ', baza ' || v_base_uzs || ' so''m × ' || r.percent || '%)';
    ELSIF r.mode = 'monthly' THEN
      v_amount := FLOOR(COALESCE(r.monthly_uzs, 0)::numeric / v_days_in_month)::bigint;
      v_notes := 'Statsionar kunlik oylik ulushi (' || v_date || ', ' || r.monthly_uzs || ' / ' || v_days_in_month || ')';
    ELSE
      CONTINUE;
    END IF;

    IF v_amount <= 0 THEN
      CONTINUE;
    END IF;

    v_kind := 'bonus';
    INSERT INTO public.doctor_ledger(clinic_id, doctor_id, kind, amount_uzs, notes, reference, status)
    VALUES (r.clinic_id, r.attending_doctor_id, v_kind, v_amount, v_notes, v_ref, 'open');
    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public.charge_daily_inpatient_doctor_payroll(date) IS
  'Statsionar attending shifokorlar uchun kunlik payroll (percent/monthly) hisoblash. Idempotent — reference=inpatient:stay_id:date orqali.';
