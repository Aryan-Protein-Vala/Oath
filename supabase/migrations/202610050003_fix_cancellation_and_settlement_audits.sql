-- Migration 202610050003: Fix Pending Oath Cancellation, Duo Settlement Fees, and Nominee Rejection Escrow Accounting

-- 1. Universal Pending Oath Cancellation (Individual Buy-In Aligned)
CREATE OR REPLACE FUNCTION public.cancel_pending_oath(p_oath_id UUID) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_oath public.oaths%ROWTYPE;
  v_wallet_id UUID;
  v_creator_refund NUMERIC := 0;
  v_member RECORD;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oath not found'; END IF;
  IF v_oath.creator_id <> v_user AND NOT public.is_admin() THEN 
    RAISE EXCEPTION 'Only the creator can cancel this oath'; 
  END IF;
  IF v_oath.status <> 'pending' THEN 
    RAISE EXCEPTION 'Only pending oaths can be cancelled'; 
  END IF;

  -- Under the Individual Buy-In model, creator only paid 1x stake upfront
  v_creator_refund := coalesce(v_oath.stake_amount, 0);

  IF v_creator_refund > 0 THEN
    UPDATE public.wallets 
    SET balance = balance + v_creator_refund,
        escrow_locked = greatest(0, escrow_locked - v_creator_refund),
        updated_at = now()
    WHERE user_id = v_oath.creator_id
    RETURNING id INTO v_wallet_id;

    IF v_wallet_id IS NOT NULL THEN
      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_wallet_id, p_oath_id, 'escrow_release', v_creator_refund, 'Pending ' || v_oath.oath_type::text || ' oath cancelled; 1x stake refunded');
    END IF;
  END IF;

  -- Refund any other members who joined squad or lobby with their own individual buy-in
  FOR v_member IN (
    SELECT * FROM public.group_members 
    WHERE oath_id = p_oath_id AND user_id <> v_oath.creator_id AND coalesce(stake_amount, 0) > 0
  ) LOOP
    UPDATE public.wallets
    SET balance = balance + v_member.stake_amount,
        escrow_locked = greatest(0, escrow_locked - v_member.stake_amount),
        updated_at = now()
    WHERE user_id = v_member.user_id
    RETURNING id INTO v_wallet_id;

    IF v_wallet_id IS NOT NULL THEN
      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_wallet_id, p_oath_id, 'escrow_release', v_member.stake_amount, 'Pending oath cancelled by leader; buy-in refunded');
    END IF;
  END LOOP;

  UPDATE public.oaths SET status = 'cancelled', updated_at = now() WHERE id = p_oath_id;
  UPDATE public.group_members SET status = 'failed', updated_at = now() WHERE oath_id = p_oath_id;
  
  -- Dismiss all pending invitations for this oath
  UPDATE public.notifications 
  SET status = 'rejected', updated_at = now() 
  WHERE oath_id = p_oath_id AND status = 'pending';
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_pending_oath(UUID) TO authenticated, anon;


-- 2. Fix Double-Deduction of Protocol Fee in settle_duo_oath / settle_oath
-- Since both players pay 10% fee upfront, no additional cut is taken at settlement
CREATE OR REPLACE FUNCTION public.settle_duo_oath(
  p_oath_id UUID,
  p_winner_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_oath public.oaths%ROWTYPE;
  v_user UUID := auth.uid();
  v_creator_stake NUMERIC;
  v_opponent_stake NUMERIC;
  v_total_payout NUMERIC;
  v_winner_wallet UUID;
  v_loser_id UUID;
  v_loser_wallet UUID;
  v_loser_stake NUMERIC;
BEGIN
  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oath not found'; END IF;
  IF v_oath.oath_type <> 'duo' THEN RAISE EXCEPTION 'Only duo oaths can be settled here'; END IF;
  IF v_oath.status <> 'active' THEN RAISE EXCEPTION 'Only active oaths can be settled'; END IF;

  IF v_user <> v_oath.creator_id AND v_user <> v_oath.opponent_id AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to settle this duel';
  END IF;

  IF p_winner_id <> v_oath.creator_id AND p_winner_id <> v_oath.opponent_id THEN
    RAISE EXCEPTION 'Winner must be creator or opponent';
  END IF;

  v_loser_id := CASE WHEN p_winner_id = v_oath.creator_id THEN v_oath.opponent_id ELSE v_oath.creator_id END;
  v_creator_stake := coalesce(v_oath.stake_amount, 0);
  v_opponent_stake := coalesce(v_oath.stake_amount, 0);

  -- Winner gets their 1x stake back + opponent's 1x stake
  v_total_payout := v_creator_stake + v_opponent_stake;
  v_loser_stake := v_opponent_stake;

  -- 1. Deduct loser escrow
  IF v_loser_stake > 0 AND v_loser_id IS NOT NULL THEN
    UPDATE public.wallets 
    SET escrow_locked = greatest(0, escrow_locked - v_loser_stake), updated_at = now()
    WHERE user_id = v_loser_id
    RETURNING id INTO v_loser_wallet;

    IF v_loser_wallet IS NOT NULL THEN
      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_loser_wallet, p_oath_id, 'penalty', v_loser_stake, 'Duel lost; stake forfeited to winner');
    END IF;
  END IF;

  -- 2. Release winner's own escrow and credit total pot
  IF v_total_payout > 0 THEN
    UPDATE public.wallets 
    SET balance = balance + v_total_payout, 
        escrow_locked = greatest(0, escrow_locked - (CASE WHEN p_winner_id = v_oath.creator_id THEN v_creator_stake ELSE v_opponent_stake END)),
        updated_at = now()
    WHERE user_id = p_winner_id
    RETURNING id INTO v_winner_wallet;

    IF v_winner_wallet IS NOT NULL THEN
      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_winner_wallet, p_oath_id, 'reward', v_total_payout, 'Duel won! Pot payout (2x stake)');
    END IF;
  END IF;

  UPDATE public.oaths 
  SET status = 'completed', 
      settled_at = now(), 
      updated_at = now() 
  WHERE id = p_oath_id;

  -- Update winner & loser group member status
  UPDATE public.group_members 
  SET status = 'completed', updated_at = now() 
  WHERE oath_id = p_oath_id AND user_id = p_winner_id;

  IF v_loser_id IS NOT NULL THEN
    UPDATE public.group_members 
    SET status = 'failed', updated_at = now() 
    WHERE oath_id = p_oath_id AND user_id = v_loser_id;

    -- Apply loser streak / penalty box logic
    PERFORM public.handle_profile_failure(v_loser_id);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.settle_duo_oath(UUID, UUID) TO authenticated, anon;


-- 3. Resilient verify_nominee with Proper Parameter Binding & Escrow Accounting
CREATE OR REPLACE FUNCTION public.verify_nominee(
  p_token TEXT,
  p_approved BOOLEAN,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_nominee RECORD;
  v_oath RECORD;
  v_proof RECORD;
  v_creator_wallet UUID;
  v_release NUMERIC;
BEGIN
  -- Accept either verification_token OR oath_id
  SELECT * INTO v_nominee
  FROM public.nominees
  WHERE (verification_token::text = p_token OR oath_id::text = p_token)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid verification token');
  END IF;

  IF v_nominee.verified THEN
    RETURN jsonb_build_object('success', false, 'error', 'This oath has already been reviewed');
  END IF;

  SELECT * INTO v_oath FROM public.oaths WHERE id = v_nominee.oath_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Oath not found');
  END IF;

  SELECT * INTO v_proof FROM public.proofs WHERE oath_id = v_oath.id ORDER BY created_at DESC LIMIT 1 FOR UPDATE;

  UPDATE public.nominees SET verified = true, responded_at = now() WHERE id = v_nominee.id;

  -- Dismiss the reviewer's verify_proof notification
  UPDATE public.notifications
  SET status = CASE WHEN p_approved THEN 'accepted' ELSE 'rejected' END
  WHERE oath_id = v_oath.id AND type = 'verify_proof';

  IF p_approved THEN
    -- If multi-day cadence, delegate to pass_today_work
    IF coalesce(v_oath.cadence, 'daily') = 'daily' AND coalesce(v_oath.total_days, 1) > 1 AND coalesce(v_oath.current_day, 1) < coalesce(v_oath.total_days, 1) THEN
      PERFORM public.pass_today_work(v_oath.id, coalesce(p_note, 'Verified by referee link'));
      RETURN jsonb_build_object('success', true, 'mode', 'daily_pass');
    END IF;

    -- Otherwise, mark completed & release escrow
    UPDATE public.oaths
    SET status = 'completed'::public.oath_status,
        last_verified_at = now(),
        settled_at = now(),
        updated_at = now()
    WHERE id = v_oath.id;

    IF v_proof.id IS NOT NULL THEN
      UPDATE public.proofs
      SET status = 'verified'::public.proof_status,
          review_note = coalesce(p_note, 'Verified by referee link'),
          reviewed_at = now()
      WHERE id = v_proof.id;
    END IF;

    v_release := coalesce(v_oath.stake_amount, 0);
    IF v_release > 0 THEN
      UPDATE public.wallets
      SET balance = balance + v_release,
          escrow_locked = greatest(0, escrow_locked - v_release),
          updated_at = now()
      WHERE user_id = v_oath.creator_id
      RETURNING id INTO v_creator_wallet;

      IF v_creator_wallet IS NOT NULL THEN
        INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
        VALUES (v_creator_wallet, v_oath.id, 'escrow_release', v_release, 'Oath completed; stake returned');
      END IF;
    END IF;

    INSERT INTO public.notifications (user_id, oath_id, type, title, message)
    VALUES (
      v_oath.creator_id,
      v_oath.id,
      'system',
      'Oath Verified!',
      'Your referee verified your submission. Congratulations!'
    );

    RETURN jsonb_build_object('success', true, 'mode', 'completed');
  ELSE
    -- REJECTION
    IF coalesce(v_oath.cadence, 'daily') = 'daily' AND coalesce(v_oath.total_days, 1) > 1 THEN
      -- Daily oath: Mark proof rejected, KEEP oath active, notify creator to resubmit before midnight
      IF v_proof.id IS NOT NULL THEN
        UPDATE public.proofs
        SET status = 'rejected'::public.proof_status,
            review_note = coalesce(p_note, 'Rejected by referee'),
            reviewed_at = now()
        WHERE id = v_proof.id;
      END IF;

      INSERT INTO public.notifications (user_id, oath_id, type, title, message)
      VALUES (
        v_oath.creator_id,
        v_oath.id,
        'system',
        'Proof Rejected by Referee',
        'Your daily proof was rejected: ' || coalesce(p_note, 'Insufficient evidence') || '. Please upload a corrected proof before midnight!'
      );

      RETURN jsonb_build_object('success', true, 'mode', 'daily_rejected_keep_active');
    ELSE
      -- Single deadline: Mark failed, slash escrow, record penalty
      UPDATE public.oaths
      SET status = 'failed'::public.oath_status,
          failure_excuse = coalesce(p_note, 'Rejected by referee'),
          settled_at = now(),
          updated_at = now()
      WHERE id = v_oath.id;

      IF v_proof.id IS NOT NULL THEN
        UPDATE public.proofs
        SET status = 'rejected'::public.proof_status,
            review_note = coalesce(p_note, 'Rejected by referee'),
            reviewed_at = now()
        WHERE id = v_proof.id;
      END IF;

      v_release := coalesce(v_oath.stake_amount, 0);
      IF v_release > 0 THEN
        UPDATE public.wallets
        SET escrow_locked = greatest(0, escrow_locked - v_release),
            updated_at = now()
        WHERE user_id = v_oath.creator_id
        RETURNING id INTO v_creator_wallet;

        IF v_creator_wallet IS NOT NULL THEN
          INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
          VALUES (v_creator_wallet, v_oath.id, 'penalty', v_release, 'Oath failed; stake forfeited: ' || coalesce(p_note, 'Rejected by referee'));
        END IF;
      END IF;

      PERFORM public.handle_profile_failure(v_oath.creator_id);

      INSERT INTO public.notifications (user_id, oath_id, type, title, message)
      VALUES (
        v_oath.creator_id,
        v_oath.id,
        'penalty',
        'Oath Failed',
        'Your referee rejected your proof. Stake forfeited.'
      );

      RETURN jsonb_build_object('success', true, 'mode', 'failed');
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_nominee(TEXT, BOOLEAN, TEXT) TO authenticated, anon;


-- 4. Stub / Safe implementation for forfeit_weakest_link_squad
CREATE OR REPLACE FUNCTION public.forfeit_weakest_link_squad(
  p_oath_id UUID,
  p_failed_user_id UUID,
  p_reason TEXT DEFAULT 'Member failed to submit daily proof'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_oath public.oaths%ROWTYPE;
  v_member RECORD;
  v_wallet_id UUID;
  v_stake NUMERIC;
BEGIN
  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  -- Weakest link: One member fails, whole squad fails
  UPDATE public.oaths 
  SET status = 'failed', failure_excuse = p_reason, settled_at = now(), updated_at = now()
  WHERE id = p_oath_id;

  -- Slash escrow for all joined members
  FOR v_member IN (SELECT * FROM public.group_members WHERE oath_id = p_oath_id) LOOP
    v_stake := coalesce(v_member.stake_amount, v_oath.stake_amount, 0);
    IF v_stake > 0 THEN
      UPDATE public.wallets
      SET escrow_locked = greatest(0, escrow_locked - v_stake), updated_at = now()
      WHERE user_id = v_member.user_id
      RETURNING id INTO v_wallet_id;

      IF v_wallet_id IS NOT NULL THEN
        INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
        VALUES (v_wallet_id, p_oath_id, 'penalty', v_stake, 'Weakest link squad failed: ' || p_reason);
      END IF;
    END IF;

    UPDATE public.group_members SET status = 'failed', updated_at = now() WHERE id = v_member.id;
    PERFORM public.handle_profile_failure(v_member.user_id);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.forfeit_weakest_link_squad(UUID, UUID, TEXT) TO authenticated, anon;

-- 5. AUTO RESOLVE EXPIRED OATHS (Airtight Individual Buy-In Logic)
DROP FUNCTION IF EXISTS public.auto_resolve_expired_oaths();
CREATE OR REPLACE FUNCTION public.auto_resolve_expired_oaths() RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_oath RECORD;
  v_member RECORD;
  v_count INT := 0;
  v_wallet_id UUID;
  v_stake NUMERIC;
  v_creator_has_today BOOLEAN;
  v_opponent_has_today BOOLEAN;
BEGIN
  -- A. DAILY CADENCE SWEEPER (Missed midnight deadline)
  FOR v_oath IN (
    SELECT * FROM public.oaths
    WHERE status = 'active'
      AND cadence = 'daily'
      AND daily_deadline IS NOT NULL
      AND daily_deadline < now()
    FOR UPDATE
  ) LOOP
    IF v_oath.oath_type = 'solo' THEN
      -- Check if creator submitted proof for current day
      SELECT EXISTS (
        SELECT 1 FROM public.proofs
        WHERE oath_id = v_oath.id
          AND submitted_by = v_oath.creator_id
          AND status IN ('verified', 'pending_review')
          AND created_at >= (v_oath.daily_deadline - interval '1 day')
      ) INTO v_creator_has_today;

      IF NOT v_creator_has_today THEN
        PERFORM public.settle_oath(v_oath.id, 'failed');
        v_count := v_count + 1;
      ELSE
        -- Push daily deadline to next midnight if oath still has days left
        IF v_oath.current_day < v_oath.total_days THEN
          UPDATE public.oaths
          SET daily_deadline = least(deadline, date_trunc('day', now()) + interval '1 day'),
              updated_at = now()
          WHERE id = v_oath.id;
        END IF;
      END IF;

    ELSIF v_oath.oath_type = 'duo' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.proofs
        WHERE oath_id = v_oath.id
          AND submitted_by = v_oath.creator_id
          AND status IN ('verified', 'pending_review')
          AND created_at >= (v_oath.daily_deadline - interval '1 day')
      ) INTO v_creator_has_today;

      SELECT EXISTS (
        SELECT 1 FROM public.proofs
        WHERE oath_id = v_oath.id
          AND submitted_by = v_oath.opponent_id
          AND status IN ('verified', 'pending_review')
          AND created_at >= (v_oath.daily_deadline - interval '1 day')
      ) INTO v_opponent_has_today;

      IF NOT v_creator_has_today AND NOT v_opponent_has_today THEN
        -- Both ghosted: Both forfeit 1x stake
        v_stake := coalesce(v_oath.stake_amount, 0);
        IF v_stake > 0 THEN
          -- Creator forfeiture
          UPDATE public.wallets 
          SET escrow_locked = greatest(0, escrow_locked - v_stake), updated_at = now()
          WHERE user_id = v_oath.creator_id RETURNING id INTO v_wallet_id;
          IF v_wallet_id IS NOT NULL THEN
            INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
            VALUES (v_wallet_id, v_oath.id, 'penalty', v_stake, 'Duo duel expired: Daily proof missed');
          END IF;

          -- Opponent forfeiture
          IF v_oath.opponent_id IS NOT NULL THEN
            UPDATE public.wallets 
            SET escrow_locked = greatest(0, escrow_locked - v_stake), updated_at = now()
            WHERE user_id = v_oath.opponent_id RETURNING id INTO v_wallet_id;
            IF v_wallet_id IS NOT NULL THEN
              INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
              VALUES (v_wallet_id, v_oath.id, 'penalty', v_stake, 'Duo duel expired: Daily proof missed');
            END IF;
          END IF;
        END IF;

        UPDATE public.oaths SET status = 'failed', failure_excuse = 'Both participants missed daily proof deadline', settled_at = now(), updated_at = now() WHERE id = v_oath.id;
        UPDATE public.group_members SET status = 'failed', updated_at = now() WHERE oath_id = v_oath.id;
        PERFORM public.handle_profile_failure(v_oath.creator_id);
        IF v_oath.opponent_id IS NOT NULL THEN PERFORM public.handle_profile_failure(v_oath.opponent_id); END IF;
        v_count := v_count + 1;

      ELSIF v_creator_has_today AND NOT v_opponent_has_today THEN
        -- Opponent failed, creator wins duel
        PERFORM public.settle_duo_oath(v_oath.id, v_oath.creator_id);
        v_count := v_count + 1;

      ELSIF NOT v_creator_has_today AND v_opponent_has_today THEN
        -- Creator failed, opponent wins duel
        PERFORM public.settle_duo_oath(v_oath.id, v_oath.opponent_id);
        v_count := v_count + 1;

      ELSE
        -- Both posted today, advance daily deadline
        UPDATE public.oaths
        SET daily_deadline = least(deadline, date_trunc('day', now()) + interval '1 day'),
            updated_at = now()
        WHERE id = v_oath.id;
      END IF;

    ELSIF v_oath.oath_type IN ('squad', 'lobby') THEN
      IF v_oath.group_mode = 'weakest_link' THEN
        -- If any active member missed today, fail entire squad
        FOR v_member IN (SELECT * FROM public.group_members WHERE oath_id = v_oath.id AND status = 'joined') LOOP
          SELECT EXISTS (
            SELECT 1 FROM public.proofs
            WHERE oath_id = v_oath.id
              AND submitted_by = v_member.user_id
              AND status IN ('verified', 'pending_review')
              AND created_at >= (v_oath.daily_deadline - interval '1 day')
          ) INTO v_creator_has_today;

          IF NOT v_creator_has_today THEN
            PERFORM public.forfeit_weakest_link_squad(v_oath.id, v_member.user_id, 'Member missed daily proof deadline');
            v_count := v_count + 1;
            EXIT;
          END IF;
        END LOOP;
      ELSE
        -- Survival mode: eliminate individual ghosted members
        FOR v_member IN (SELECT * FROM public.group_members WHERE oath_id = v_oath.id AND status = 'joined') LOOP
          SELECT EXISTS (
            SELECT 1 FROM public.proofs
            WHERE oath_id = v_oath.id
              AND submitted_by = v_member.user_id
              AND status IN ('verified', 'pending_review')
              AND created_at >= (v_oath.daily_deadline - interval '1 day')
          ) INTO v_creator_has_today;

          IF NOT v_creator_has_today THEN
            v_stake := coalesce(v_member.stake_amount, v_oath.stake_amount, 0);
            IF v_stake > 0 THEN
              UPDATE public.wallets
              SET escrow_locked = greatest(0, escrow_locked - v_stake), updated_at = now()
              WHERE user_id = v_member.user_id RETURNING id INTO v_wallet_id;
              IF v_wallet_id IS NOT NULL THEN
                INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
                VALUES (v_wallet_id, v_oath.id, 'penalty', v_stake, 'Survival squad member eliminated: Daily proof missed');
              END IF;
            END IF;

            UPDATE public.group_members SET status = 'failed', updated_at = now() WHERE id = v_member.id;
            PERFORM public.handle_profile_failure(v_member.user_id);
            v_count := v_count + 1;
          END IF;
        END LOOP;

        -- If no active members remain, fail squad
        IF NOT EXISTS (SELECT 1 FROM public.group_members WHERE oath_id = v_oath.id AND status = 'joined') THEN
          UPDATE public.oaths SET status = 'failed', updated_at = now() WHERE id = v_oath.id;
        ELSE
          UPDATE public.oaths
          SET daily_deadline = least(deadline, date_trunc('day', now()) + interval '1 day'),
              updated_at = now()
          WHERE id = v_oath.id;
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- B. OVERALL DEADLINE SWEEPER
  FOR v_oath IN (
    SELECT * FROM public.oaths
    WHERE status = 'active'
      AND deadline < now()
    FOR UPDATE
  ) LOOP
    PERFORM public.settle_oath(v_oath.id, 'failed');
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'resolved_count', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_resolve_expired_oaths() TO authenticated, anon;
