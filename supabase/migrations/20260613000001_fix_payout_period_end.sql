-- ============================================================================
-- Data-fix: to'langan maosh payoutlarida davr TO'LOV sanasidan oshmasin.
-- Eski kod "joriy oy" tanlanganda oy oxirini (TZ siljishi bilan kelajak sana)
-- period_start/period_end qilib yozardi → "06-09 da to'langan, lekin davr 06-29
-- (yoki 06-30) gача" kabi mantiqsiz ko'rinish. Kalendar-aniq invariant:
--   period_start <= period_end <= to'lov kuni (paid_at, Asia/Tashkent).
-- Idempotent (qayta ishga tushsa o'zgartirmaydi).
-- ============================================================================

UPDATE public.doctor_payouts
SET
  period_end   = LEAST(period_end, (paid_at AT TIME ZONE 'Asia/Tashkent')::date),
  period_start = LEAST(period_start, (paid_at AT TIME ZONE 'Asia/Tashkent')::date),
  period_label = LEAST(period_start, (paid_at AT TIME ZONE 'Asia/Tashkent')::date)::text
                 || ' → ' ||
                 LEAST(period_end, (paid_at AT TIME ZONE 'Asia/Tashkent')::date)::text
WHERE status = 'paid'
  AND paid_at IS NOT NULL
  AND (period_end   > (paid_at AT TIME ZONE 'Asia/Tashkent')::date
    OR period_start > (paid_at AT TIME ZONE 'Asia/Tashkent')::date);
