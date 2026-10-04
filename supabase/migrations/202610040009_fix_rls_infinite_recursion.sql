-- Migration 202610040009: Break circular RLS recursion between oaths and nominees

-- 1. Create a bulletproof, non-recursive is_oath_member function with row_security = off
CREATE OR REPLACE FUNCTION public.is_oath_member(p_oath_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_email TEXT;
  v_username TEXT;
BEGIN
  IF v_user IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Fast check 1: Creator or Opponent
  IF EXISTS (SELECT 1 FROM public.oaths WHERE id = p_oath_id AND (creator_id = v_user OR opponent_id = v_user)) THEN
    RETURN TRUE;
  END IF;

  -- Fast check 2: Group Member (Squad / Lobby)
  IF EXISTS (SELECT 1 FROM public.group_members WHERE oath_id = p_oath_id AND user_id = v_user) THEN
    RETURN TRUE;
  END IF;

  -- Fast check 3: Nominee Referee
  SELECT email INTO v_email FROM auth.users WHERE id = v_user;
  SELECT username INTO v_username FROM public.profiles WHERE id = v_user;

  IF EXISTS (
    SELECT 1 FROM public.nominees
    WHERE oath_id = p_oath_id
      AND (
        nominee_user_id = v_user
        OR (v_email IS NOT NULL AND lower(email) = lower(v_email))
        OR (v_username IS NOT NULL AND (lower(email) = '@' || lower(v_username) OR lower(email) = lower(v_username)))
      )
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_oath_member(UUID) TO anon, authenticated;

-- 2. Clean RLS on public.oaths: Avoid inline query on nominees to eliminate circular recursion
DROP POLICY IF EXISTS "Participants and open squads can read safe oath rows" ON public.oaths;
CREATE POLICY "Participants and open squads can read safe oath rows" ON public.oaths
  FOR SELECT TO authenticated USING (
    creator_id = auth.uid()
    OR opponent_id = auth.uid()
    OR (oath_type IN ('squad', 'lobby') AND status IN ('pending', 'active'))
    OR public.is_oath_member(oaths.id)
  );

-- 3. Clean RLS on public.nominees: Avoid inline query on oaths to eliminate circular recursion
DROP POLICY IF EXISTS "Nominees viewable by oath participants or assigned nominee" ON public.nominees;
CREATE POLICY "Nominees viewable by oath participants or assigned nominee" ON public.nominees
  FOR SELECT TO authenticated, anon USING (
    nominee_user_id = auth.uid()
    OR public.is_oath_member(nominees.oath_id)
  );
