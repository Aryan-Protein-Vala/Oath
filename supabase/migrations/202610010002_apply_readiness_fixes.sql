-- Migration 202610010001: Complete Production Readiness
-- 1. Add reputation_score to profiles
-- 2. Enhanced get_nominee_challenge returning proof evidence for referees
-- 3. Update is_oath_member to include registered nominees
-- 4. Transition proofs status in settle_oath_atomically, verify_nominee, and cast_squad_vote
-- 5. Refund unfilled squad slots to prevent escrow trap
-- 6. Opponent forfeit support and wall entries for public shame across all oath types
-- 7. Comprehensive profile stats (total_lost, duffer_debt, reputation_score)

-- 1. Add reputation_score column to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS reputation_score INT NOT NULL DEFAULT 100;

-- 2. Enhanced get_nominee_challenge returning proof details
DROP FUNCTION IF EXISTS public.get_nominee_challenge(TEXT);
CREATE OR REPLACE FUNCTION public.get_nominee_challenge(p_token TEXT)
RETURNS TABLE (
  oath_id UUID,
  oath_statement TEXT,
  deadline TIMESTAMPTZ,
  stake_amount NUMERIC,
  oath_type public.oath_type,
  challenge_status public.oath_status,
  creator_username TEXT,
  proof_type TEXT,
  proof_url TEXT,
  proof_text TEXT,
  proof_created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT 
    o.id, 
    o.oath_statement, 
    o.deadline, 
    o.stake_amount, 
    o.oath_type, 
    o.status, 
    p.username,
    pr.proof_type::text,
    pr.proof_url,
    pr.proof_text,
    pr.created_at
  FROM public.nominees n
  JOIN public.oaths o ON o.id = n.oath_id
  JOIN public.profiles p ON p.id = o.creator_id
  LEFT JOIN LATERAL (
    SELECT proof_type, proof_url, proof_text, created_at
    FROM public.proofs
    WHERE oath_id = o.id
    ORDER BY created_at DESC
    LIMIT 1
  ) pr ON TRUE
  WHERE (n.verification_token::text = p_token OR o.id::text = p_token)
    AND n.verified = false
    AND o.status = 'active'
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_nominee_challenge(TEXT) TO anon, authenticated;

-- 3. Enhance is_oath_member to include assigned nominees
CREATE OR REPLACE FUNCTION public.is_oath_member(p_oath_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET row_security = off AS $$
  SELECT EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.oath_id = p_oath_id AND gm.user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.oaths o WHERE o.id = p_oath_id AND (o.creator_id = auth.uid() OR o.opponent_id = auth.uid()))
      OR EXISTS (
        SELECT 1 FROM public.nominees n 
        WHERE n.oath_id = p_oath_id 
          AND (n.nominee_user_id = auth.uid() OR n.email = (SELECT email FROM auth.users WHERE id = auth.uid()))
      );
$$;

GRANT EXECUTE ON FUNCTION public.is_oath_member(UUID) TO anon, authenticated;

-- 4. Enhance verify_nominee to update proof status
CREATE OR REPLACE FUNCTION public.verify_nominee(p_token TEXT, p_success BOOLEAN, p_note TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE 
  v_oath_id UUID;
  v_actual_token TEXT;
BEGIN
  SELECT oath_id, verification_token::text INTO v_oath_id, v_actual_token
  FROM public.nominees
  WHERE (verification_token::text = p_token OR oath_id::text = p_token) AND verified = false
  LIMIT 1
  FOR UPDATE;

  IF v_oath_id IS NULL THEN 
    RAISE EXCEPTION 'Invalid or already used verification token'; 
  END IF;

  UPDATE public.proofs
  SET status = CASE WHEN p_success THEN 'verified'::public.proof_status ELSE 'rejected'::public.proof_status END
  WHERE oath_id = v_oath_id;

  PERFORM public.settle_oath_atomically(v_oath_id, p_success, p_note, coalesce(v_actual_token, p_token), FALSE);
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_nominee(TEXT, BOOLEAN, TEXT) TO anon, authenticated;

-- 5. Enhanced settle_oath_atomically
CREATE OR REPLACE FUNCTION public.settle_oath_atomically(
  p_oath_id UUID,
  p_success BOOLEAN,
  p_note TEXT DEFAULT NULL,
  p_verification_token TEXT DEFAULT NULL,
  p_forfeit BOOLEAN DEFAULT FALSE
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_oath public.oaths%ROWTYPE;
  v_creator_wallet UUID;
  v_nominee RECORD;
  v_user UUID := auth.uid();
  v_is_registered_nominee BOOLEAN := FALSE;
BEGIN
  IF p_verification_token IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.nominees n 
      WHERE n.oath_id = p_oath_id 
        AND (n.verification_token::text = p_verification_token OR n.oath_id::text = p_verification_token)
        AND n.verified = false
    ) THEN
      RAISE EXCEPTION 'Invalid or already used verification token';
    END IF;
    UPDATE public.nominees SET verified = TRUE, responded_at = now() 
    WHERE oath_id = p_oath_id AND (verification_token::text = p_verification_token OR oath_id::text = p_verification_token);
  END IF;

  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oath not found'; END IF;
  IF v_oath.status <> 'active' THEN RAISE EXCEPTION 'Oath is not active'; END IF;

  SELECT id INTO v_creator_wallet FROM public.wallets WHERE user_id = v_oath.creator_id;
  IF v_creator_wallet IS NULL THEN RAISE EXCEPTION 'Creator wallet not found'; END IF;

  IF v_oath.verification_method = 'nominee' THEN
    SELECT * INTO v_nominee FROM public.nominees WHERE oath_id = p_oath_id FOR UPDATE;
    IF v_nominee.oath_id IS NULL THEN RAISE EXCEPTION 'Nominee record missing'; END IF;

    -- Check if user is registered nominee by user_id or email
    IF v_user IS NOT NULL AND (
      v_nominee.nominee_user_id = v_user 
      OR v_nominee.email = (SELECT email FROM auth.users WHERE id = v_user)
    ) THEN
      v_is_registered_nominee := TRUE;
    END IF;

    IF p_verification_token IS NOT NULL THEN
      UPDATE public.nominees SET verified = TRUE WHERE oath_id = p_oath_id;
    ELSIF v_is_registered_nominee THEN
      UPDATE public.nominees SET verified = TRUE WHERE oath_id = p_oath_id;
    ELSIF NOT p_forfeit THEN
      RAISE EXCEPTION 'A valid nominee token or registered referee is required';
    END IF;
  ELSIF v_oath.verification_method = 'peer' THEN
    IF NOT p_forfeit AND (v_user IS NULL OR (v_user <> v_oath.creator_id AND v_user <> v_oath.opponent_id)) THEN
      RAISE EXCEPTION 'Only participants can settle this duel';
    END IF;
  ELSIF v_oath.verification_method = 'quorum' THEN
    RAISE EXCEPTION 'Quorum oaths must be resolved via cast_squad_vote';
  ELSE
    IF v_user IS NULL OR v_user <> v_oath.creator_id THEN
      RAISE EXCEPTION 'Only the oath creator can settle an automated oath';
    END IF;
  END IF;

  IF NOT p_success AND NOT p_forfeit AND v_oath.deadline > now() THEN
    RAISE EXCEPTION 'A penalty can only be recorded after the deadline; use forfeit to fail early';
  END IF;

  -- Update proof statuses
  UPDATE public.proofs
  SET status = CASE WHEN p_success THEN 'verified'::public.proof_status ELSE 'rejected'::public.proof_status END
  WHERE oath_id = p_oath_id;

  IF p_success THEN
    UPDATE public.oaths
    SET status = 'completed', updated_at = now()
    WHERE id = p_oath_id;

    IF v_oath.stake_amount > 0 THEN
      UPDATE public.wallets
      SET balance = balance + v_oath.stake_amount,
          escrow_locked = escrow_locked - v_oath.stake_amount,
          updated_at = now()
      WHERE id = v_creator_wallet;

      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_creator_wallet, p_oath_id, 'escrow_release', v_oath.stake_amount, 'Escrow returned: Oath completed successfully');
    END IF;

    UPDATE public.profiles
    SET oaths_completed = coalesce(oaths_completed, 0) + 1,
        duffer_debt = greatest(0, coalesce(duffer_debt, 0) - 1),
        reputation_score = least(100, coalesce(reputation_score, 100) + 2)
    WHERE id = v_oath.creator_id;

    IF v_oath.consequence_type = 'public_shame' THEN
      INSERT INTO public.wall_entries (oath_id, user_id, wall_type, oath_statement, stake_amount, excuse, username)
      SELECT p_oath_id, v_oath.creator_id, 'honor'::public.wall_type,
        v_oath.oath_statement, v_oath.stake_amount, NULL,
        (SELECT username FROM public.profiles WHERE id = v_oath.creator_id);
    END IF;
  ELSE
    UPDATE public.oaths
    SET status = 'failed',
        failure_excuse = coalesce(p_note, failure_excuse),
        updated_at = now()
    WHERE id = p_oath_id;

    IF v_oath.stake_amount > 0 THEN
      UPDATE public.wallets
      SET escrow_locked = escrow_locked - v_oath.stake_amount,
          total_lost = coalesce(total_lost, 0) + v_oath.stake_amount,
          updated_at = now()
      WHERE id = v_creator_wallet;

      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_creator_wallet, p_oath_id, 'penalty', v_oath.stake_amount, coalesce(p_note, 'Penalty: Oath failed'));
    END IF;

    UPDATE public.profiles
    SET oaths_failed = coalesce(oaths_failed, 0) + 1,
        total_lost = coalesce(total_lost, 0) + v_oath.stake_amount,
        duffer_debt = coalesce(duffer_debt, 0) + 2,
        reputation_score = greatest(0, coalesce(reputation_score, 100) - 5)
    WHERE id = v_oath.creator_id;

    IF v_oath.consequence_type = 'public_shame' THEN
      INSERT INTO public.wall_entries (oath_id, user_id, wall_type, oath_statement, stake_amount, excuse, username)
      SELECT p_oath_id, v_oath.creator_id, 'shame'::public.wall_type,
        v_oath.oath_statement, v_oath.stake_amount, coalesce(p_note, 'I gave up under pressure.'),
        (SELECT username FROM public.profiles WHERE id = v_oath.creator_id);
    END IF;
  END IF;
END;
$$;

-- 6. Enhance forfeit_oath to support opponent conceding
CREATE OR REPLACE FUNCTION public.forfeit_oath(p_oath_id UUID, p_note TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_oath public.oaths%ROWTYPE;
  v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oath not found'; END IF;

  IF v_oath.oath_type = 'solo' THEN
    IF v_oath.creator_id <> v_user THEN RAISE EXCEPTION 'Only the oath creator can forfeit'; END IF;
    PERFORM public.settle_oath_atomically(p_oath_id, FALSE, coalesce(p_note, 'Oath forfeited by creator'), NULL, TRUE);
  ELSIF v_oath.oath_type = 'duo' THEN
    IF v_oath.creator_id = v_user THEN
      -- Creator forfeited -> Opponent won
      PERFORM public.settle_oath(p_oath_id, 'opponent_won', coalesce(p_note, 'Creator conceded duel'));
    ELSIF v_oath.opponent_id = v_user THEN
      -- Opponent forfeited -> Creator won
      PERFORM public.settle_oath(p_oath_id, 'creator_won', coalesce(p_note, 'Opponent conceded duel'));
    ELSE
      RAISE EXCEPTION 'Only duel participants can forfeit';
    END IF;
  ELSIF v_oath.oath_type IN ('squad', 'lobby') THEN
    -- Redirect to squad member forfeit
    PERFORM public.forfeit_squad_member(p_oath_id);
  ELSE
    RAISE EXCEPTION 'Unsupported oath type for forfeiture';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.forfeit_oath(UUID, TEXT) TO authenticated;

-- 7. Enhance cast_squad_vote: Unfilled slots refund, proof status transition, profile stats
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

  v_needed := greatest(1, v_member.votes_needed);

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
