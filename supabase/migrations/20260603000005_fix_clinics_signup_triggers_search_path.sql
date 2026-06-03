-- =============================================================================
-- Clary v2 — HOTFIX: klinika signup triggerlari (search_path='') buzilgan edi
--
-- MUAMMO: 20260527000060_function_search_path.sql assign_billing_code() va
-- seed_clinic_sla_rules() funksiyalariga `SET search_path = ''` qo'ygan, lekin
-- ular ichidagi obyektlar SCHEMA'siz yozilgan edi:
--   - nextval('billing_code_seq')  → "relation billing_code_seq does not exist"
--   - INSERT INTO clinic_sla_rules  → "relation clinic_sla_rules does not exist"
-- Natija: yangi klinika (mijoz) ro'yxatdan o'tolmaydi (signup INSERT trigger'da fail).
--
-- YECHIM: obyektlarni to'liq nom (public.) bilan yozamiz — search_path xavfsizligi
-- (bo'sh) saqlanadi.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.assign_billing_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.billing_code IS NULL THEN
    NEW.billing_code := 'CLR-' || LPAD(nextval('public.billing_code_seq'::regclass)::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.seed_clinic_sla_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.clinic_sla_rules (clinic_id, kind, threshold_minutes)
  VALUES
    (NEW.id, 'urgent_appointment', 15),
    (NEW.id, 'cito_lab', 120),
    (NEW.id, 'routine_lab', 1440),
    (NEW.id, 'followup', 43200)
  ON CONFLICT (clinic_id, kind) DO NOTHING;
  RETURN NEW;
END;
$function$;
