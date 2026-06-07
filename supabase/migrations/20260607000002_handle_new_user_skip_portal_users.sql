-- Bemor portali (SMS OTP) foydalanuvchilari auth.users yaratganda staff profil
-- yaratilmasin. portal_users.id auth.users(id) ga FK, lekin ular klinika xodimi emas.
-- (Bu trigger avval MCP orqali prod DB'ga qo'llangan; repo izchilligi uchun fayl.)

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_full_name TEXT;
BEGIN
  -- Bemor portali (SMS OTP) foydalanuvchilari uchun staff profili yaratilmaydi.
  IF COALESCE(NEW.raw_user_meta_data->>'portal_user', '') = 'true' THEN
    RETURN NEW;
  END IF;

  v_full_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email, '@', 1)
  );

  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (NEW.id, NEW.email, v_full_name, 'staff')
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email;

  UPDATE auth.users
  SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object(
    'clinic_id', null,
    'role', 'staff'
  )
  WHERE id = NEW.id;

  RETURN NEW;
END;
$function$;
