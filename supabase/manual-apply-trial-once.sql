-- ============================================================================
-- Trial bir martalik + plan tavsiya RPC
-- Supabase Dashboard → SQL Editor → paste → Run
-- ============================================================================

BEGIN;

-- 1) clinics.trial_used
ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS trial_used BOOLEAN NOT NULL DEFAULT false;

-- 2) start_trial RPC — 1-martalik tekshiruv bilan
CREATE OR REPLACE FUNCTION start_trial(p_clinic_id UUID, p_plan subscription_plan)
RETURNS TABLE (status subscription_status, trial_ends_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_trial_end TIMESTAMPTZ := NOW() + INTERVAL '30 days';
  v_used BOOLEAN;
BEGIN
  IF p_plan = 'demo' THEN
    RAISE EXCEPTION 'Trial uchun pullik tarif tanlang (Base/Pro/Enterprise)';
  END IF;
  SELECT trial_used INTO v_used FROM clinics WHERE id = p_clinic_id;
  IF v_used THEN
    RAISE EXCEPTION 'Bepul sinov allaqachon ishlatilgan. Iltimos tarifni to''lang.';
  END IF;
  UPDATE clinics
     SET current_plan = p_plan, subscription_status = 'trialing',
         trial_ends_at = v_trial_end, grace_ends_at = NULL, trial_used = true
   WHERE id = p_clinic_id;
  INSERT INTO subscriptions (clinic_id, plan_code, status, billing_period,
                             current_period_start, current_period_end)
  VALUES (p_clinic_id, p_plan, 'trialing', 'monthly', NOW(), v_trial_end);
  RETURN QUERY SELECT 'trialing'::subscription_status, v_trial_end;
END;
$$;
REVOKE ALL ON FUNCTION start_trial(UUID, subscription_plan) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION start_trial(UUID, subscription_plan) TO service_role;

-- 3) recommend_plan RPC — xodim/qurilma soniga qarab tavsiya
CREATE OR REPLACE FUNCTION recommend_plan(p_clinic_id UUID)
RETURNS TABLE (
  recommended_code subscription_plan,
  staff_count INT,
  device_count INT,
  reason TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_staff INT; v_devices INT; v_code subscription_plan; v_reason TEXT;
BEGIN
  SELECT COUNT(*) INTO v_staff
    FROM profiles WHERE clinic_id = p_clinic_id AND is_active = true;
  SELECT COUNT(*) INTO v_devices
    FROM user_devices WHERE clinic_id = p_clinic_id AND is_revoked = false;
  IF v_staff <= 2 AND v_devices <= 2 THEN
    v_code := '25pro';
    v_reason := 'Sizda ' || v_staff || ' xodim, ' || v_devices || ' qurilma — Base tarif (2/2) yetarli.';
  ELSIF v_staff <= 10 AND v_devices <= 10 THEN
    v_code := '50pro';
    v_reason := 'Sizda ' || v_staff || ' xodim, ' || v_devices || ' qurilma — Pro tarif (10/10) mos keladi.';
  ELSE
    v_code := '120pro';
    v_reason := 'Sizda ' || v_staff || ' xodim, ' || v_devices || ' qurilma — Enterprise tarif (cheksiz) kerak.';
  END IF;
  RETURN QUERY SELECT v_code, v_staff, v_devices, v_reason;
END;
$$;
REVOKE ALL ON FUNCTION recommend_plan(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION recommend_plan(UUID) TO service_role;

COMMIT;

-- Tekshirish:
--   SELECT recommended_code, staff_count, device_count, reason
--     FROM recommend_plan((SELECT id FROM clinics LIMIT 1));
