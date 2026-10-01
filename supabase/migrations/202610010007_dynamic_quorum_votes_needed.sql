-- Migration 202610010007: Dynamic Quorum calculation in cast_squad_vote
-- Ensures that smaller squads (e.g. 3 members where only 2 other members can vote)
-- calculate votes_needed based on available voters, preventing quorum deadlock.

CREATE OR REPLACE FUNCTION public.cast_squad_vote(
  p_oath_id UUID,
  p_member_id UUID,
  p_approve BOOLEAN
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_oath public.oaths%ROWTYPE;
  v_member public.group_members%ROWTYPE;
  v_proof UUID;
  v_yes INT;
  v_no INT;
  v_needed INT;
  v_target_wallet UUID;
  v_creator_wallet UUID;
  v_squad_total NUMERIC;
  v_pending_count INT;
  v_actual_members INT;
  v_unfilled_refund NUMERIC;
  v_other_voters INT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oath not found'; END IF;
  IF v_oath.status <> 'active' THEN RAISE EXCEPTION 'Squad pool is not active'; END IF;

  SELECT * INTO v_member FROM public.group_members WHERE id = p_member_id AND oath_id = p_oath_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found'; END IF;
  IF v_member.status <> 'joined' THEN RAISE EXCEPTION 'Member is already settled'; END IF;
  IF NOT v_member.proof_submitted THEN RAISE EXCEPTION 'Member has not submitted proof yet'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.group_members WHERE oath_id = p_oath_id AND user_id = v_user) THEN
    RAISE EXCEPTION 'Only squad members can vote';
  END IF;

  IF v_member.user_id = v_user THEN
    RAISE EXCEPTION 'Cannot vote on your own proof';
  END IF;

  SELECT id INTO v_proof FROM public.proofs WHERE oath_id = p_oath_id AND submitted_by = v_member.user_id ORDER BY created_at DESC LIMIT 1;
  IF v_proof IS NULL THEN RAISE EXCEPTION 'No proof to vote on'; END IF;

  IF EXISTS (SELECT 1 FROM public.votes WHERE proof_id = v_proof AND voter_id = v_user) THEN
    RAISE EXCEPTION 'Already voted on this proof';
  END IF;

  INSERT INTO public.votes (proof_id, voter_id, oath_id, vote)
  VALUES (v_proof, v_user, p_oath_id, p_approve);

  SELECT count(*) FILTER (WHERE vote = true),
         count(*) FILTER (WHERE vote = false)
  INTO v_yes, v_no
  FROM public.votes
  WHERE proof_id = v_proof;

  UPDATE public.group_members
  SET votes_received = v_yes
  WHERE id = p_member_id;

  -- Dynamic quorum calculation:
  -- The member submitting proof cannot vote on their own proof.
  -- Available voters = (total members in squad) - 1.
  -- votes_needed is capped by available voters so smaller squads never deadlock.
  SELECT greatest(1, count(*)::int - 1) INTO v_other_voters
  FROM public.group_members
  WHERE oath_id = p_oath_id;

  v_needed := greatest(1, least(coalesce(nullif(v_member.votes_needed, 0), v_other_voters), v_other_voters));

  SELECT id INTO v_target_wallet FROM public.wallets WHERE user_id = v_member.user_id;
  SELECT id INTO v_creator_wallet FROM public.wallets WHERE user_id = v_oath.creator_id;

  -- Member approved by quorum
  IF v_yes >= v_needed THEN
    UPDATE public.group_members
    SET status = 'completed', is_winner = true
    WHERE id = p_member_id;

    UPDATE public.proofs
    SET status = 'verified'::public.proof_status
    WHERE oath_id = p_oath_id AND submitted_by = v_member.user_id;

    IF v_oath.oath_type = 'lobby' THEN
      IF v_target_wallet IS NOT NULL AND v_member.stake_amount > 0 THEN
        UPDATE public.wallets
        SET balance = balance + v_member.stake_amount,
            escrow_locked = escrow_locked - v_member.stake_amount,
            updated_at = now()
        WHERE id = v_target_wallet;

        INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
        VALUES (v_target_wallet, p_oath_id, 'escrow_release', v_member.stake_amount, 'Proof approved by quorum; buy-in returned');
      END IF;
    ELSIF v_oath.group_mode = 'survival' THEN
      IF v_creator_wallet IS NOT NULL AND v_oath.stake_amount > 0 THEN
        UPDATE public.wallets
        SET balance = balance + v_oath.stake_amount,
            escrow_locked = escrow_locked - v_oath.stake_amount,
            updated_at = now()
        WHERE id = v_creator_wallet;

        INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
        VALUES (v_creator_wallet, p_oath_id, 'escrow_release', v_oath.stake_amount, 'Member proof approved; leader stake returned');
      END IF;
    END IF;

    UPDATE public.profiles
    SET oaths_completed = coalesce(oaths_completed, 0) + 1,
        duffer_debt = greatest(0, coalesce(duffer_debt, 0) - 1),
        reputation_score = least(100, coalesce(reputation_score, 100) + 2)
    WHERE id = v_member.user_id;

  -- Member rejected by quorum
  ELSIF v_no >= v_needed THEN
    UPDATE public.group_members
    SET status = 'failed', is_winner = false
    WHERE id = p_member_id;

    UPDATE public.proofs
    SET status = 'rejected'::public.proof_status
    WHERE oath_id = p_oath_id AND submitted_by = v_member.user_id;

    IF v_oath.oath_type = 'lobby' THEN
      IF v_target_wallet IS NOT NULL AND v_member.stake_amount > 0 THEN
        UPDATE public.wallets
        SET escrow_locked = escrow_locked - v_member.stake_amount,
            total_lost = coalesce(total_lost, 0) + v_member.stake_amount,
            updated_at = now()
        WHERE id = v_target_wallet;

        INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
        VALUES (v_target_wallet, p_oath_id, 'penalty', v_member.stake_amount, 'Proof rejected by quorum; buy-in forfeited');
      END IF;
    ELSIF v_oath.group_mode = 'survival' THEN
      IF v_creator_wallet IS NOT NULL AND v_oath.stake_amount > 0 THEN
        UPDATE public.wallets
        SET escrow_locked = escrow_locked - v_oath.stake_amount,
            total_lost = coalesce(total_lost, 0) + v_oath.stake_amount,
            updated_at = now()
        WHERE id = v_creator_wallet;

        INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
        VALUES (v_creator_wallet, p_oath_id, 'penalty', v_oath.stake_amount, 'Member rejected in survival mode; leader stake seized');
      END IF;
    ELSIF v_oath.group_mode = 'weakest_link' THEN
      -- Weakest Link collapse: entire squad fails
      v_squad_total := v_oath.stake_amount * greatest(1, coalesce(v_oath.max_players, 1));
      IF v_creator_wallet IS NOT NULL AND v_squad_total > 0 THEN
        UPDATE public.wallets
        SET escrow_locked = escrow_locked - v_squad_total,
            total_lost = coalesce(total_lost, 0) + v_squad_total,
            updated_at = now()
        WHERE id = v_creator_wallet;

        INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
        VALUES (v_creator_wallet, p_oath_id, 'penalty', v_squad_total, 'Weakest Link broken by member; entire squad pool seized');
      END IF;

      -- Mark all members failed
      UPDATE public.group_members
      SET status = 'failed', is_winner = false
      WHERE oath_id = p_oath_id;

      UPDATE public.oaths
      SET status = 'failed', updated_at = now()
      WHERE id = p_oath_id;

      RETURN;
    END IF;

    UPDATE public.profiles
    SET oaths_failed = coalesce(oaths_failed, 0) + 1,
        total_lost = coalesce(total_lost, 0) + (CASE WHEN v_oath.oath_type = 'lobby' THEN v_member.stake_amount ELSE 0 END),
        duffer_debt = coalesce(duffer_debt, 0) + 2,
        reputation_score = greatest(0, coalesce(reputation_score, 100) - 5)
    WHERE id = v_member.user_id;
  END IF;

  -- Check if all members are resolved
  SELECT count(*) INTO v_pending_count
  FROM public.group_members
  WHERE oath_id = p_oath_id AND status = 'joined';

  IF v_pending_count = 0 THEN
    -- If Weakest Link and no failures occurred, release full squad stake
    IF v_oath.group_mode = 'weakest_link' AND NOT EXISTS (
      SELECT 1 FROM public.group_members WHERE oath_id = p_oath_id AND status = 'failed'
    ) THEN
      v_squad_total := v_oath.stake_amount * greatest(1, coalesce(v_oath.max_players, 1));
      IF v_creator_wallet IS NOT NULL AND v_squad_total > 0 THEN
        UPDATE public.wallets
        SET balance = balance + v_squad_total,
            escrow_locked = escrow_locked - v_squad_total,
            updated_at = now()
        WHERE id = v_creator_wallet;

        INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
        VALUES (v_creator_wallet, p_oath_id, 'escrow_release', v_squad_total, 'Weakest link squad succeeded; full escrow returned to leader');
      END IF;
    END IF;

    -- If Squad mode: refund unfilled slots stake to creator so escrow is never trapped!
    IF v_oath.oath_type = 'squad' AND v_oath.group_mode = 'survival' THEN
      SELECT count(*) INTO v_actual_members FROM public.group_members WHERE oath_id = p_oath_id;
      IF v_actual_members < v_oath.max_players THEN
        v_unfilled_refund := v_oath.stake_amount * (v_oath.max_players - v_actual_members);
        IF v_unfilled_refund > 0 AND v_creator_wallet IS NOT NULL THEN
          UPDATE public.wallets
          SET balance = balance + v_unfilled_refund,
              escrow_locked = escrow_locked - v_unfilled_refund,
              updated_at = now()
          WHERE id = v_creator_wallet;

          INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
          VALUES (v_creator_wallet, p_oath_id, 'escrow_release', v_unfilled_refund, 'Unfilled squad slots stake refunded to leader');
        END IF;
      END IF;
    END IF;

    UPDATE public.oaths SET status = 'completed', updated_at = now() WHERE id = p_oath_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cast_squad_vote(UUID, UUID, BOOLEAN) TO authenticated;
