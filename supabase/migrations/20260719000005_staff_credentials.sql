-- =============================================================================
-- M1 — Xodim parol boshqaruvi (admin nazorati)
-- =============================================================================
-- 1) staff_credentials: admin bergan OXIRGI parol (faqat clinic_admin API orqali
--    ko'radi). RLS yoqilgan, policy YO'Q — faqat service_role o'qiydi/yozadi;
--    PostgREST orqali hech kim (shu jumladan xodimlar) o'qiy olmaydi.
--    ⚠️ Ochiq matn saqlash — mijoz talabi ("paroli doim adminda bo'lsin");
--    xavf cheklangan: server-only jadval + faqat admin endpointi.
-- 2) ensure_email_identity: Google orqali ochilgan akkauntga "email" identity
--    qo'shadi — aks holda parol o'rnatilsa ham signInWithPassword rad etadi
--    (jonli hodisa: shox4494/clarysupport). auth sxemasi PostgREST'da yopiq,
--    shuning uchun SECURITY DEFINER RPC kerak.

CREATE TABLE IF NOT EXISTS staff_credentials (
  profile_id     UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  clinic_id      UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  password_plain TEXT NOT NULL,
  set_by         UUID REFERENCES profiles(id),
  set_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_credentials_clinic ON staff_credentials(clinic_id);
ALTER TABLE staff_credentials ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.ensure_email_identity(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_email TEXT;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = p_user_id;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'auth user topilmadi: %', p_user_id;
  END IF;
  INSERT INTO auth.identities
    (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  SELECT gen_random_uuid(), p_user_id, p_user_id::text,
         jsonb_build_object('sub', p_user_id::text, 'email', v_email, 'email_verified', true),
         'email', now(), now(), now()
  WHERE NOT EXISTS (
    SELECT 1 FROM auth.identities WHERE user_id = p_user_id AND provider = 'email'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_email_identity(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_email_identity(UUID) TO service_role;
