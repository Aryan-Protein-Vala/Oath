-- Migration 202610050007: Fix approval/rejection flow crashes
-- handle_profile_failure is defined with 3 args (UUID, NUMERIC, UUID)
-- but several call sites in 202610050003 call it with only 1 arg.
-- Add overloads to accept 1 or 2 args without crashing.

CREATE OR REPLACE FUNCTION public.handle_profile_failure(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM public.handle_profile_failure(p_user_id, 0::NUMERIC, NULL::UUID);
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_profile_failure(p_user_id UUID, p_lost_amount NUMERIC)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM public.handle_profile_failure(p_user_id, p_lost_amount, NULL::UUID);
END;
$$;

GRANT EXECUTE ON FUNCTION public.handle_profile_failure(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.handle_profile_failure(UUID, NUMERIC) TO authenticated, anon;
