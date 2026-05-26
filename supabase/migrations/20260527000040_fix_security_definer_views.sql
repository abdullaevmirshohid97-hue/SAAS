-- Supabase linter ERROR (0010_security_definer_view): 7 ta view
-- default SECURITY DEFINER edi (view egasi = postgres superuser).
-- Bu multi-tenant SaaS uchun xavfli: RLS chetlab o'tilishi mumkin.
--
-- Yechim: security_invoker=true — view query qiluvchi user huquqlari
-- bilan ishlaydi, RLS to'liq amal qiladi.

ALTER VIEW public.doctor_balances_view SET (security_invoker = true);
ALTER VIEW public.doctor_anomaly_view SET (security_invoker = true);
ALTER VIEW public.daily_revenue_history_view SET (security_invoker = true);
ALTER VIEW public.cashier_refund_ratio_view SET (security_invoker = true);
ALTER VIEW public.shift_cash_anomaly_view SET (security_invoker = true);
ALTER VIEW public.payroll_unaccrued_view SET (security_invoker = true);
ALTER VIEW public.patient_segments_view SET (security_invoker = true);
