-- Migration 202610120002: Add is_username_custom flag, enforce unique usernames, and provide update_username RPC

-- 1. Add is_username_custom column to public.profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_username_custom BOOLEAN NOT NULL DEFAULT false;

-- 2. Backfill: users with non-placeholder usernames were created via normal form with custom username
UPDATE public.profiles
SET is_username_custom = TRUE
WHERE username NOT LIKE 'user_%' OR display_name != 'Anonymous';

-- 3. Case-insensitive unique index to guarantee no 2 usernames can ever be identical
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_lower_username ON public.profiles (lower(trim(username)));

-- 4. Update handle_new_user trigger function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_raw_username TEXT;
  v_is_custom BOOLEAN := FALSE;
  v_clean_username TEXT;
BEGIN
  v_raw_username := nullif(trim(NEW.raw_user_meta_data->>'username'), '');
  IF v_raw_username IS NOT NULL THEN
    v_clean_username := lower(regexp_replace(v_raw_username, '[^a-zA-Z0-9_]', '', 'g'));
    IF length(v_clean_username) >= 3 THEN
      v_is_custom := TRUE;
    ELSE
      v_clean_username := 'user_' || lower(left(NEW.id::text, 8));
    END IF;
  ELSE
    v_clean_username := 'user_' || lower(left(NEW.id::text, 8));
  END IF;

  INSERT INTO public.profiles (id, username, display_name, avatar_url, is_username_custom)
  VALUES (
    NEW.id,
    v_clean_username,
    COALESCE(NEW.raw_user_meta_data->>'display_name', CASE WHEN v_is_custom THEN v_clean_username ELSE 'Anonymous' END),
    NEW.raw_user_meta_data->>'avatar_url',
    v_is_custom
  )
  ON CONFLICT (id) DO UPDATE
  SET username = CASE WHEN public.profiles.is_username_custom THEN public.profiles.username ELSE EXCLUDED.username END,
      is_username_custom = (public.profiles.is_username_custom OR EXCLUDED.is_username_custom),
      updated_at = now();

  RETURN NEW;
END;
$$;

-- 5. RPC to check if a username is available (case-insensitive)
CREATE OR REPLACE FUNCTION public.check_username_available(p_username TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_clean TEXT;
BEGIN
  v_clean := lower(trim(regexp_replace(coalesce(p_username, ''), '^@+', '')));
  IF length(v_clean) < 3 OR length(v_clean) > 24 THEN
    RETURN FALSE;
  END IF;
  IF v_clean !~ '^[a-z0-9_]+$' THEN
    RETURN FALSE;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE lower(trim(username)) = v_clean
      AND (auth.uid() IS NULL OR id != auth.uid())
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_username_available(TEXT) TO anon, authenticated;

-- 6. RPC to update username safely with validation and uniqueness enforcement
CREATE OR REPLACE FUNCTION public.update_username(p_username TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_clean TEXT;
  v_exists BOOLEAN;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  v_clean := lower(trim(regexp_replace(coalesce(p_username, ''), '^@+', '')));
  
  IF length(v_clean) < 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Username must be at least 3 characters');
  END IF;
  
  IF length(v_clean) > 24 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Username cannot exceed 24 characters');
  END IF;

  IF v_clean !~ '^[a-z0-9_]+$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Username can only contain letters, numbers, and underscores');
  END IF;

  -- Case-insensitive uniqueness check against all other accounts
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE lower(trim(username)) = v_clean AND id != v_user
  ) INTO v_exists;

  IF v_exists THEN
    RETURN jsonb_build_object('success', false, 'error', 'Username is already taken');
  END IF;

  -- Update profiles
  UPDATE public.profiles
  SET username = v_clean,
      display_name = v_clean,
      is_username_custom = TRUE,
      updated_at = now()
  WHERE id = v_user;

  -- Update auth user metadata
  UPDATE auth.users
  SET raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('username', v_clean, 'display_name', v_clean)
  WHERE id = v_user;

  RETURN jsonb_build_object('success', true, 'username', v_clean);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_username(TEXT) TO authenticated;
