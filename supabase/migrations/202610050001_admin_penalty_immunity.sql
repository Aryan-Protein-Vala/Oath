-- Migration: 202610050001_admin_penalty_immunity.sql
-- Grants Penalty Box immunity to the 'real_admin' profile.

-- 1. Clear any existing penalty for real_admin
UPDATE public.profiles
SET penalty_box_until = NULL,
    loss_streak = 0
WHERE username = 'real_admin';

-- 2. Modify handle_profile_failure so real_admin never accumulates a loss_streak or gets put in the penalty box.
CREATE OR REPLACE FUNCTION public.handle_profile_failure(p_user_id UUID, p_lost_amount NUMERIC, p_oath_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_new_loss_streak INT;
  v_penalty_deadline TIMESTAMPTZ;
  v_is_admin BOOLEAN;
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;

  SELECT (username = 'real_admin') INTO v_is_admin
  FROM public.profiles
  WHERE id = p_user_id;

  UPDATE public.profiles
  SET oaths_failed = coalesce(oaths_failed, 0) + 1,
      total_lost = coalesce(total_lost, 0) + coalesce(p_lost_amount, 0),
      loss_streak = CASE WHEN v_is_admin THEN 0 ELSE coalesce(loss_streak, 0) + 1 END,
      penalty_box_until = CASE 
        WHEN v_is_admin THEN NULL
        WHEN coalesce(loss_streak, 0) + 1 >= 3 THEN now() + interval '7 days' 
        ELSE penalty_box_until 
      END,
      updated_at = now()
  WHERE id = p_user_id
  RETURNING loss_streak, penalty_box_until INTO v_new_loss_streak, v_penalty_deadline;

  -- If user reached 3 consecutive failures, notify them about the 7-day Penalty Box
  IF v_new_loss_streak >= 3 AND v_penalty_deadline IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, oath_id, type, title, message)
    VALUES (
      p_user_id,
      p_oath_id,
      'system',
      '🚨 THE PENALTY BOX: 7-Day Account Lockout',
      'You failed 3 oaths in a row. Your account is locked in The Penalty Box for 7 days. Creating and joining oaths is suspended until ' || to_char(v_penalty_deadline, 'Mon DD, YYYY HH24:MI') || ' UTC.'
    );
  END IF;
END;
$$;
