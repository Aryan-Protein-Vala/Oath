-- Migration 202611100002: Create missing handle_profile_completion helper
-- Root Cause: settle_oath, verify_nominee, and pass_today_work (on completion) call
-- public.handle_profile_completion(user_id), which was missing from the database, causing
-- "function public.handle_profile_completion(uuid) does not exist".

DROP FUNCTION IF EXISTS public.handle_profile_completion(UUID);
DROP FUNCTION IF EXISTS public.handle_profile_completion(UUID, NUMERIC);

CREATE OR REPLACE FUNCTION public.handle_profile_completion(
  p_user_id UUID,
  p_won_amount NUMERIC DEFAULT 0
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;

  UPDATE public.profiles
  SET oaths_completed = coalesce(oaths_completed, 0) + 1,
      total_won = coalesce(total_won, 0) + coalesce(p_won_amount, 0),
      loss_streak = 0,
      penalty_box_until = NULL,
      updated_at = now()
  WHERE id = p_user_id;
END;
$$;

DROP FUNCTION IF EXISTS public.handle_profile_success(UUID);
DROP FUNCTION IF EXISTS public.handle_profile_success(UUID, NUMERIC);

CREATE OR REPLACE FUNCTION public.handle_profile_success(
  p_user_id UUID,
  p_won_amount NUMERIC DEFAULT 0
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM public.handle_profile_completion(p_user_id, p_won_amount);
END;
$$;

GRANT EXECUTE ON FUNCTION public.handle_profile_completion(UUID, NUMERIC) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.handle_profile_success(UUID, NUMERIC) TO authenticated, anon, service_role;
