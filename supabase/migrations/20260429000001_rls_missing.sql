-- Fix: support_typing_indicators has RLS enabled but no policies
-- Without a policy, ALL rows are blocked for non-superusers (deny by default)

CREATE POLICY "clinic_isolation"
ON public.support_typing_indicators
FOR ALL
USING (EXISTS (SELECT 1 FROM support_threads st WHERE st.id = thread_id AND st.clinic_id = public.get_my_clinic_id()) OR public.is_super_admin())
WITH CHECK (EXISTS (SELECT 1 FROM support_threads st WHERE st.id = thread_id AND st.clinic_id = public.get_my_clinic_id()));
