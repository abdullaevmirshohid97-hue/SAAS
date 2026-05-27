-- Supabase linter INFO (rls_enabled_no_policy): inpatient_meal_periods
-- jadvalida RLS yoqilgan, lekin policy yo'q — service_role'dan boshqa hech
-- kim o'qiy/yoza olmaydi.
--
-- Jadvalda clinic_id ustuni yo'q, shuning uchun tenancy stay_id orqali
-- inpatient_stays jadvali bilan join qilib tekshiriladi (boshqa shu kabi
-- bog'liq jadvallar uchun ishlatilgan pattern).

CREATE POLICY "p_meal_periods_tenant"
  ON public.inpatient_meal_periods
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.inpatient_stays s
      WHERE s.id = inpatient_meal_periods.stay_id
        AND (s.clinic_id = get_my_clinic_id() OR get_my_role() = 'super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.inpatient_stays s
      WHERE s.id = inpatient_meal_periods.stay_id
        AND (s.clinic_id = get_my_clinic_id() OR get_my_role() = 'super_admin')
    )
  );
