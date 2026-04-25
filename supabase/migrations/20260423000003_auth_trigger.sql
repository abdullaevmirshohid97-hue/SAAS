-- =============================================================================
-- Clary v2 — Migration 000003: Auth trigger (sets app_metadata on signup)
-- =============================================================================
-- On every new auth.users row, create a matching public.profiles row and
-- write clinic_id + role into app_metadata so JWT carries them.
-- Clinic creation is a separate step (wizard) that UPDATES the profile.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_full_name TEXT;
BEGIN
  v_full_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email, '@', 1)
  );

  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (NEW.id, NEW.email, v_full_name, 'staff')
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email;

  -- Seed app_metadata with null clinic_id (filled during onboarding)
  UPDATE auth.users
  SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object(
    'clinic_id', null,
    'role', 'staff'
  )
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Helper: promote a profile to clinic_admin + set clinic_id in JWT
CREATE OR REPLACE FUNCTION public.set_user_clinic(
  p_user_id UUID,
  p_clinic_id UUID,
  p_role user_role DEFAULT 'clinic_admin'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  UPDATE public.profiles SET clinic_id = p_clinic_id, role = p_role WHERE id = p_user_id;

  UPDATE auth.users
  SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object(
    'clinic_id', p_clinic_id::text,
    'role', p_role::text
  )
  WHERE id = p_user_id;
END;
$$;
