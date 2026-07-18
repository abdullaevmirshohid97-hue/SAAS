-- =============================================================================
-- tg_set_updated_at — HIMOYALANGAN versiya (jonli hodisa fix)
-- =============================================================================
-- Muammo: funksiya NEW.version'ni shartsiz o'rnatardi. version ustuni YO'Q
-- jadvallarda (17 ta: lab_samples, leads, dental_*, nurse_schedules,
-- support_threads, pharmacy_stock_movements, ...) HAR QANDAY UPDATE
-- "record new has no field version" (42703) bilan yiqilardi — prod'da namuna
-- holati, sayt lidi statusi va boshqalar yangilanmasdi.
--
-- 20260710000002 shu sinfni 4 jadvalga version qo'shib "tuzatgan", lekin 17
-- jadval qolib ketgan. Ildiz yechim: funksiya ustun bor-yo'qligiga chidamli
-- bo'lsin — keyin yangi jadval trigger olsa ham hech qachon sinmaydi.
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    NEW.updated_at := now();
  EXCEPTION WHEN undefined_column THEN
    NULL; -- jadvalda updated_at yo'q — e'tiborsiz
  END;
  BEGIN
    NEW.version := COALESCE(OLD.version, 0) + 1;
  EXCEPTION WHEN undefined_column THEN
    NULL; -- jadvalda version yo'q — e'tiborsiz
  END;
  RETURN NEW;
END;
$$;
