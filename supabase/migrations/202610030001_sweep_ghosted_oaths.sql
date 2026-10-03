-- 1. Create auto_resolve_expired_oaths to seize funds from users who NEVER submit proofs before deadline
DROP FUNCTION IF EXISTS public.auto_resolve_expired_oaths();
CREATE OR REPLACE FUNCTION public.auto_resolve_expired_oaths()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_member RECORD;
  v_oath RECORD;
  v_count INTEGER := 0;
  v_member_wallet UUID;
  v_member_escrow NUMERIC;
  v_release NUMERIC;
BEGIN
  -- Find all group members who haven't submitted a valid proof before the oath deadline
  FOR v_member IN 
    SELECT gm.id, gm.oath_id, gm.user_id, gm.status
    FROM public.group_members gm
    JOIN public.oaths o ON o.id = gm.oath_id
    WHERE o.status = 'active'
      AND o.deadline < now()
      AND gm.status IN ('pending', 'joined')
      AND NOT EXISTS (
        SELECT 1 FROM public.proofs p 
        WHERE p.oath_id = gm.oath_id 
          AND p.submitted_by = gm.user_id
      )
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT * INTO v_oath FROM public.oaths WHERE id = v_member.oath_id FOR UPDATE;
    
    -- Fail the member
    UPDATE public.group_members
    SET status = 'failed',
        is_winner = false
    WHERE id = v_member.id;

    -- Seize their funds
    IF v_oath.stake_amount > 0 THEN
      SELECT id, coalesce(escrow_locked, 0)
      INTO v_member_wallet, v_member_escrow
      FROM public.wallets
      WHERE user_id = v_member.user_id
      FOR UPDATE;

      IF v_member_wallet IS NOT NULL THEN
        v_release := least(v_member_escrow, v_oath.stake_amount);
        IF v_release > 0 THEN
          UPDATE public.wallets
          SET escrow_locked = escrow_locked - v_release,
              total_lost = coalesce(total_lost, 0) + v_release,
              updated_at = now()
          WHERE id = v_member_wallet;

          INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
          VALUES (v_member_wallet, v_oath.id, 'penalty', v_release, 'Failed: Missed deadline without submitting proof');
        END IF;
      END IF;
    END IF;

    UPDATE public.profiles
    SET oaths_failed = coalesce(oaths_failed, 0) + 1,
        total_lost = coalesce(total_lost, 0) + coalesce(v_release, 0),
        updated_at = now()
    WHERE id = v_member.user_id;

    INSERT INTO public.notifications (
      user_id, oath_id, type, title, message, status
    ) VALUES (
      v_member.user_id,
      v_oath.id,
      'system',
      'You Failed the Oath',
      'You failed to submit proof before the deadline. Your stake has been seized.',
      'pending'
    );

    -- If this is a Solo or Duo or Weakest Link squad, failing one member might fail the whole oath
    IF v_oath.oath_type IN ('solo', 'duo') OR v_oath.consequence_type = 'weakest_link' THEN
      UPDATE public.oaths
      SET status = 'failed',
          updated_at = now()
      WHERE id = v_oath.id;
    END IF;
    
    v_count := v_count + 1;
  END LOOP;

  -- Wait, if it's a Survival squad and all members have now been evaluated (some failed, some completed), we might need to set the oath to completed?
  -- For now, the group_members are correctly marked as failed. If the oath was 'active', and all members are either 'completed' or 'failed', mark it 'completed'.
  UPDATE public.oaths o
  SET status = 'completed', updated_at = now()
  WHERE o.status = 'active'
    AND o.deadline < now()
    AND NOT EXISTS (
      SELECT 1 FROM public.group_members gm 
      WHERE gm.oath_id = o.id AND gm.status IN ('pending', 'joined')
    );

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_resolve_expired_oaths() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_resolve_expired_oaths() TO authenticated, anon;
