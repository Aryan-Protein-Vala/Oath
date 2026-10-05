-- Migration 202610050001: Individual Buy-In, Daily Midnight Boundaries, and Resilient Rejections

-- 1. Ensure Per-User Streak Tracking Columns on group_members and oaths
ALTER TABLE public.group_members ADD COLUMN IF NOT EXISTS current_day INT DEFAULT 1;
ALTER TABLE public.group_members ADD COLUMN IF NOT EXISTS day_streak INT DEFAULT 0;
ALTER TABLE public.group_members ADD COLUMN IF NOT EXISTS last_verified_day INT DEFAULT 0;
ALTER TABLE public.group_members ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE public.oaths ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ DEFAULT NULL;

-- 2. CREATE OATH WITH STAKE: Leader pays ONLY 1x Stake + 10% fee upfront for ALL oath types
CREATE OR REPLACE FUNCTION public.create_oath_with_stake(
  p_oath_statement TEXT,
  p_deadline TIMESTAMPTZ,
  p_oath_type public.oath_type,
  p_verification_method public.verification_method,
  p_consequence_type public.consequence_type,
  p_stake_amount NUMERIC(12,2) DEFAULT 0,
  p_min_players INT DEFAULT 1,
  p_max_players INT DEFAULT 1,
  p_opponent_id UUID DEFAULT NULL,
  p_nominee_email TEXT DEFAULT NULL,
  p_social_phone TEXT DEFAULT NULL,
  p_social_msg TEXT DEFAULT NULL,
  p_anti_charity_cause TEXT DEFAULT NULL,
  p_group_mode public.group_mode DEFAULT NULL,
  p_cadence TEXT DEFAULT 'daily'
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_wallet_id UUID;
  v_oath_id UUID;
  v_total_stake NUMERIC;
  v_platform_fee NUMERIC;
  v_total_deduction NUMERIC;
  v_min_players INT;
  v_max_players INT;
  v_nominee_user_id UUID;
  v_initial_status public.oath_status;
  v_cadence TEXT := coalesce(p_cadence, 'daily');
  v_total_days INT := 1;
  v_daily_deadline TIMESTAMPTZ;
  v_penalty_box TIMESTAMPTZ;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  
  -- Penalty box check
  SELECT penalty_box_until INTO v_penalty_box FROM public.profiles WHERE id = v_user;
  IF v_penalty_box IS NOT NULL AND v_penalty_box > now() THEN
    RAISE EXCEPTION 'You are locked in The Penalty Box until % UTC for 3 consecutive oath failures. You cannot create oaths.', to_char(v_penalty_box, 'Mon DD, YYYY HH24:MI');
  END IF;

  IF p_deadline <= now() THEN RAISE EXCEPTION 'Deadline must be in the future'; END IF;
  IF p_stake_amount < 0 THEN RAISE EXCEPTION 'Stake amount cannot be negative'; END IF;

  -- INDIVIDUAL BUY-IN MODEL: Leader always pays 1x stake upfront!
  -- Team members pay their own stake when accepting the invite.
  v_total_stake := p_stake_amount;

  IF p_oath_type = 'duo' THEN
    v_min_players := 2;
    v_max_players := 2;
    v_initial_status := 'pending';
  ELSIF p_oath_type = 'squad' THEN
    IF p_min_players IS NOT NULL AND p_max_players IS NOT NULL AND (p_min_players > p_max_players OR p_min_players < 3 OR p_max_players > 10) THEN
      RAISE EXCEPTION 'Invalid squad size: must have between 3 and 10 players, and min cannot exceed max';
    END IF;
    v_min_players := greatest(3, coalesce(p_min_players, 4));
    v_max_players := least(10, greatest(v_min_players, coalesce(p_max_players, 8)));
    v_initial_status := 'pending';
  ELSIF p_oath_type = 'lobby' THEN
    v_min_players := greatest(2, coalesce(p_min_players, 2));
    v_max_players := least(10, greatest(v_min_players, coalesce(p_max_players, 10)));
    v_initial_status := 'pending';
  ELSE
    v_min_players := 1;
    v_max_players := 1;
    v_initial_status := 'active';
  END IF;

  -- Upfront 10% platform fee calculation for leader's 1x stake
  v_platform_fee := round(v_total_stake * 0.10, 2);
  v_total_deduction := v_total_stake + v_platform_fee;

  -- Deduct creator stake + 10% platform fee upfront
  IF v_total_deduction > 0 THEN
    UPDATE public.wallets 
    SET balance = balance - v_total_deduction,
        escrow_locked = escrow_locked + v_total_stake, 
        updated_at = now()
    WHERE user_id = v_user AND balance >= v_total_deduction
    RETURNING id INTO v_wallet_id;
    
    IF v_wallet_id IS NULL THEN 
      RAISE EXCEPTION 'Insufficient balance to cover total charge ($% required: $% stake + 10%% fee)', v_total_deduction, v_total_stake; 
    END IF;

    -- Record transactions
    INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
    VALUES (v_wallet_id, NULL, 'escrow_lock', v_total_stake, 'Stake locked in escrow');

    IF v_platform_fee > 0 THEN
      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_wallet_id, NULL, 'house_cut', v_platform_fee, '10% Upfront Platform Protocol Fee');
    END IF;
  END IF;

  -- Calculate Cadence, total_days, and initial daily_deadline (next midnight 12:00 AM)
  IF v_cadence = 'daily' THEN
    v_total_days := greatest(1, ceil(extract(epoch from (p_deadline - now())) / 86400.0)::int);
    v_daily_deadline := least(p_deadline, (date_trunc('day', now()) + interval '1 day'));
  ELSE
    v_cadence := 'once';
    v_total_days := 1;
    v_daily_deadline := p_deadline;
  END IF;
  
  -- Create Oath
  INSERT INTO public.oaths (
    creator_id, oath_statement, deadline, oath_type, verification_method, 
    consequence_type, stake_amount, status, min_players, max_players, opponent_id, group_mode,
    cadence, total_days, current_day, current_streak, daily_deadline
  )
  VALUES (
    v_user, p_oath_statement, p_deadline, p_oath_type, p_verification_method,
    p_consequence_type, p_stake_amount, 
    v_initial_status,
    v_min_players, v_max_players, p_opponent_id, p_group_mode,
    v_cadence, v_total_days, 1, 0, v_daily_deadline
  )
  RETURNING id INTO v_oath_id;

  -- Update transactions with oath_id
  IF v_wallet_id IS NOT NULL THEN
    UPDATE public.transactions SET oath_id = v_oath_id WHERE wallet_id = v_wallet_id AND oath_id IS NULL;
  END IF;

  IF coalesce(p_social_phone, '') <> '' OR coalesce(p_social_msg, '') <> '' OR coalesce(p_nominee_email, '') <> '' OR coalesce(p_anti_charity_cause, '') <> '' THEN
    INSERT INTO public.oath_private_details (oath_id, social_ransom_phone, social_ransom_message, nominee_email, anti_charity_cause)
    VALUES (v_oath_id, p_social_phone, p_social_msg, p_nominee_email, p_anti_charity_cause);
  END IF;

  IF p_verification_method = 'nominee' AND p_nominee_email IS NOT NULL THEN
    SELECT id INTO v_nominee_user_id
    FROM public.profiles
    WHERE lower(username) = lower(ltrim(p_nominee_email, '@'))
    LIMIT 1;

    INSERT INTO public.nominees (oath_id, email, nominee_user_id, verification_token)
    VALUES (v_oath_id, p_nominee_email, v_nominee_user_id, gen_random_uuid());
  END IF;

  IF p_oath_type IN ('squad', 'duo', 'lobby') THEN
    INSERT INTO public.group_members (oath_id, user_id, stake_amount, status, votes_needed, current_day, day_streak)
    VALUES (v_oath_id, v_user, p_stake_amount, 'joined', CASE WHEN p_oath_type = 'duo' THEN 1 ELSE 3 END, 1, 0);

    -- If duo has opponent pre-selected, create pending invited record
    IF p_oath_type = 'duo' AND p_opponent_id IS NOT NULL THEN
      INSERT INTO public.group_members (oath_id, user_id, stake_amount, status, votes_needed, current_day, day_streak)
      VALUES (v_oath_id, p_opponent_id, p_stake_amount, 'invited', 1, 1, 0)
      ON CONFLICT (oath_id, user_id) DO NOTHING;
    END IF;
  END IF;

  UPDATE public.profiles SET
    oaths_created = coalesce(oaths_created, 0) + 1,
    total_staked = coalesce(total_staked, 0) + v_total_stake,
    updated_at = now()
  WHERE id = v_user;

  RETURN v_oath_id;
END;
$$;


-- 3. ACCEPT DUO CHALLENGE: Deducts Opponent's 1x Stake + 10% fee
CREATE OR REPLACE FUNCTION public.accept_duo_challenge(p_oath_id UUID) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user UUID := auth.uid(); 
  v_oath public.oaths%ROWTYPE;
  v_wallet_id UUID;
  v_stake NUMERIC;
  v_fee NUMERIC;
  v_total NUMERIC;
  v_penalty_box TIMESTAMPTZ;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT penalty_box_until INTO v_penalty_box FROM public.profiles WHERE id = v_user;
  IF v_penalty_box IS NOT NULL AND v_penalty_box > now() THEN
    RAISE EXCEPTION 'You are locked in The Penalty Box until % UTC for 3 consecutive oath failures. You cannot join challenges.', to_char(v_penalty_box, 'Mon DD, YYYY HH24:MI');
  END IF;

  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND OR v_oath.oath_type <> 'duo' OR v_oath.status <> 'pending' THEN 
    RAISE EXCEPTION 'Challenge is unavailable'; 
  END IF;
  IF v_oath.creator_id = v_user THEN 
    RAISE EXCEPTION 'You cannot accept your own challenge'; 
  END IF;
  IF v_oath.opponent_id IS NOT NULL AND v_oath.opponent_id <> v_user THEN 
    RAISE EXCEPTION 'Challenge is addressed to another user'; 
  END IF;
  IF v_oath.deadline <= now() THEN 
    RAISE EXCEPTION 'This challenge has expired'; 
  END IF;

  v_stake := coalesce(v_oath.stake_amount, 0);
  v_fee := round(v_stake * 0.10, 2);
  v_total := v_stake + v_fee;

  -- Deduct stake + 10% fee from opponent's wallet
  IF v_total > 0 THEN
    UPDATE public.wallets 
    SET balance = balance - v_total,
        escrow_locked = escrow_locked + v_stake,
        updated_at = now()
    WHERE user_id = v_user AND balance >= v_total
    RETURNING id INTO v_wallet_id;

    IF v_wallet_id IS NULL THEN
      RAISE EXCEPTION 'Insufficient balance. You need $% ($% stake + 10%% fee) to accept this challenge. Please deposit funds first.', v_total, v_stake;
    END IF;

    INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
    VALUES (v_wallet_id, p_oath_id, 'escrow_lock', v_stake, 'Duo challenge stake locked in escrow');

    IF v_fee > 0 THEN
      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_wallet_id, p_oath_id, 'house_cut', v_fee, '10% Platform Protocol Fee (Duo Challenge)');
    END IF;
  END IF;
  
  UPDATE public.oaths 
  SET opponent_id = v_user, status = 'active', updated_at = now() 
  WHERE id = p_oath_id;
  
  INSERT INTO public.group_members (oath_id, user_id, stake_amount, status, votes_needed, current_day, day_streak)
  VALUES (p_oath_id, v_user, v_stake, 'joined', 1, 1, 0) 
  ON CONFLICT (oath_id, user_id) DO UPDATE SET status = 'joined', stake_amount = v_stake;

  -- Notify creator
  INSERT INTO public.notifications (user_id, oath_id, type, title, message, status)
  VALUES (
    v_oath.creator_id, p_oath_id, 'system', 'Duo Challenge Accepted!',
    '@' || (SELECT username FROM public.profiles WHERE id = v_user) || ' accepted your challenge and locked their stake. Duel is live!',
    'pending'
  );
END;
$$;


-- 4. JOIN SQUAD: Deducts Member's 1x Stake + 10% fee
CREATE OR REPLACE FUNCTION public.join_squad(p_oath_id UUID, p_stake_amount NUMERIC) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_oath public.oaths%ROWTYPE;
  v_user UUID := auth.uid();
  v_member_id UUID;
  v_member_count INT;
  v_min_players INT;
  v_max_players INT;
  v_wallet_id UUID;
  v_join_stake NUMERIC := 0;
  v_join_fee NUMERIC := 0;
  v_total_deduction NUMERIC := 0;
  v_penalty_box TIMESTAMPTZ;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT penalty_box_until INTO v_penalty_box FROM public.profiles WHERE id = v_user;
  IF v_penalty_box IS NOT NULL AND v_penalty_box > now() THEN
    RAISE EXCEPTION 'You are locked in The Penalty Box until % UTC for 3 consecutive oath failures. You cannot join lobbies or squads.', to_char(v_penalty_box, 'Mon DD, YYYY HH24:MI');
  END IF;

  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Challenge pool not found'; END IF;
  IF v_oath.status NOT IN ('pending', 'active') THEN RAISE EXCEPTION 'Challenge pool is no longer accepting members (status: %)', v_oath.status; END IF;
  IF v_oath.deadline <= now() THEN RAISE EXCEPTION 'Cannot join an expired challenge'; END IF;

  IF EXISTS (SELECT 1 FROM public.group_members WHERE oath_id = p_oath_id AND user_id = v_user AND status = 'joined') THEN
    RAISE EXCEPTION 'You have already joined this challenge';
  END IF;

  SELECT count(*) INTO v_member_count FROM public.group_members WHERE oath_id = p_oath_id AND status = 'joined';
  v_max_players := coalesce(v_oath.max_players, 8);
  IF v_member_count >= v_max_players THEN RAISE EXCEPTION 'Challenge pool is full'; END IF;

  -- Every player pays their own stake + 10% fee for squad and lobby
  v_join_stake := coalesce(v_oath.stake_amount, p_stake_amount, 0);
  v_join_fee := round(v_join_stake * 0.10, 2);
  v_total_deduction := v_join_stake + v_join_fee;

  IF v_total_deduction > 0 THEN
    UPDATE public.wallets 
    SET balance = balance - v_total_deduction, 
        escrow_locked = escrow_locked + v_join_stake, 
        updated_at = now()
    WHERE user_id = v_user AND balance >= v_total_deduction
    RETURNING id INTO v_wallet_id;
    
    IF v_wallet_id IS NULL THEN 
      RAISE EXCEPTION 'Insufficient balance. You need $% ($% stake + 10%% fee) to join this squad. Please deposit funds first.', v_total_deduction, v_join_stake; 
    END IF;

    INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
    VALUES (v_wallet_id, p_oath_id, 'escrow_lock', v_join_stake, 'Squad buy-in stake locked in escrow');

    IF v_join_fee > 0 THEN
      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_wallet_id, p_oath_id, 'house_cut', v_join_fee, '10% Upfront Platform Protocol Fee');
    END IF;
  END IF;

  INSERT INTO public.group_members (oath_id, user_id, stake_amount, status, votes_needed, current_day, day_streak)
  VALUES (p_oath_id, v_user, v_join_stake, 'joined', CASE WHEN v_oath.oath_type = 'duo' THEN 1 ELSE 3 END, 1, 0)
  ON CONFLICT (oath_id, user_id) 
  DO UPDATE SET status = 'joined', stake_amount = v_join_stake
  RETURNING id INTO v_member_id;

  -- Auto-activate if minimum players reached
  v_min_players := coalesce(v_oath.min_players, 2);
  IF (v_member_count + 1) >= v_min_players AND v_oath.status = 'pending' THEN
    UPDATE public.oaths SET status = 'active', updated_at = now() WHERE id = p_oath_id;
  END IF;

  UPDATE public.profiles SET oaths_joined = coalesce(oaths_joined, 0) + 1, total_staked = coalesce(total_staked, 0) + v_join_stake, updated_at = now() WHERE id = v_user;

  RETURN v_member_id;
END;
$$;


-- 5. CANCEL DUO CHALLENGE: Refunds Creator's 1x Stake
CREATE OR REPLACE FUNCTION public.cancel_duo_challenge(p_oath_id UUID) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user UUID := auth.uid(); 
  v_oath public.oaths%ROWTYPE;
  v_wallet_id UUID;
  v_refund NUMERIC;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND OR v_oath.oath_type <> 'duo' OR v_oath.creator_id <> v_user THEN 
    RAISE EXCEPTION 'Challenge not found or unauthorized'; 
  END IF;
  IF v_oath.status <> 'pending' THEN RAISE EXCEPTION 'Only pending challenges can be cancelled'; END IF;

  -- Creator only locked 1x stake
  v_refund := coalesce(v_oath.stake_amount, 0);
  IF v_refund > 0 THEN
    UPDATE public.wallets 
    SET balance = balance + v_refund, escrow_locked = greatest(0, escrow_locked - v_refund), updated_at = now()
    WHERE user_id = v_user AND escrow_locked >= v_refund
    RETURNING id INTO v_wallet_id;
    
    IF v_wallet_id IS NULL THEN RAISE EXCEPTION 'Escrow inconsistent'; END IF;
    
    INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
    VALUES (v_wallet_id, p_oath_id, 'escrow_release', v_refund, 'Duo challenge cancelled by creator; stake refunded');
  END IF;

  UPDATE public.oaths SET status = 'cancelled', updated_at = now() WHERE id = p_oath_id;
  UPDATE public.group_members SET status = 'failed', updated_at = now() WHERE oath_id = p_oath_id;
END;
$$;


-- 6. SETTLE DUO OATH & SETTLE OATH: Adjusted for Individual Escrow Accounts
CREATE OR REPLACE FUNCTION public.settle_duo_oath(p_oath_id UUID, p_winner_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_oath public.oaths%ROWTYPE;
  v_creator_wallet UUID;
  v_opponent_wallet UUID;
  v_stake NUMERIC;
  v_loser_id UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND OR (v_oath.status <> 'active' AND v_oath.status::text <> 'in_review') THEN
    RAISE EXCEPTION 'Challenge is not active (current status: %)', v_oath.status;
  END IF;

  IF v_user NOT IN (v_oath.creator_id, coalesce(v_oath.opponent_id, '00000000-0000-0000-0000-000000000000'::uuid))
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only the assigned verifier can settle this challenge';
  END IF;

  v_stake := coalesce(v_oath.stake_amount, 0);

  SELECT id INTO v_creator_wallet FROM public.wallets WHERE user_id = v_oath.creator_id FOR UPDATE;
  IF v_oath.opponent_id IS NOT NULL THEN
    SELECT id INTO v_opponent_wallet FROM public.wallets WHERE user_id = v_oath.opponent_id FOR UPDATE;
  END IF;

  IF p_winner_id = v_oath.creator_id THEN
    -- Creator won!
    -- Creator's own escrow releases back to creator balance
    IF v_creator_wallet IS NOT NULL AND v_stake > 0 THEN
      UPDATE public.wallets 
      SET balance = balance + (v_stake * 2), 
          escrow_locked = greatest(0, escrow_locked - v_stake),
          total_won = coalesce(total_won, 0) + v_stake,
          updated_at = now()
      WHERE id = v_creator_wallet;

      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_creator_wallet, p_oath_id, 'escrow_release', v_stake, 'Duo stake returned to winner');

      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_creator_wallet, p_oath_id, 'reward', v_stake, 'Won opponent stake in Duo Duel');
    END IF;

    -- Opponent forfeits escrow
    IF v_opponent_wallet IS NOT NULL AND v_stake > 0 THEN
      UPDATE public.wallets 
      SET escrow_locked = greatest(0, escrow_locked - v_stake),
          total_lost = coalesce(total_lost, 0) + v_stake,
          updated_at = now()
      WHERE id = v_opponent_wallet;

      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_opponent_wallet, p_oath_id, 'penalty', v_stake, 'Lost Duo Duel');
    END IF;

    PERFORM public.handle_profile_success(v_oath.creator_id, v_stake);
    IF v_oath.opponent_id IS NOT NULL THEN
      PERFORM public.handle_profile_failure(v_oath.opponent_id, v_stake, p_oath_id);
    END IF;

  ELSIF p_winner_id = v_oath.opponent_id THEN
    -- Opponent won!
    IF v_opponent_wallet IS NOT NULL AND v_stake > 0 THEN
      UPDATE public.wallets 
      SET balance = balance + (v_stake * 2), 
          escrow_locked = greatest(0, escrow_locked - v_stake),
          total_won = coalesce(total_won, 0) + v_stake,
          updated_at = now()
      WHERE id = v_opponent_wallet;

      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_opponent_wallet, p_oath_id, 'escrow_release', v_stake, 'Duo stake returned to winner');

      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_opponent_wallet, p_oath_id, 'reward', v_stake, 'Won creator stake in Duo Duel');
    END IF;

    IF v_creator_wallet IS NOT NULL AND v_stake > 0 THEN
      UPDATE public.wallets 
      SET escrow_locked = greatest(0, escrow_locked - v_stake),
          total_lost = coalesce(total_lost, 0) + v_stake,
          updated_at = now()
      WHERE id = v_creator_wallet;

      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_creator_wallet, p_oath_id, 'penalty', v_stake, 'Lost Duo Duel');
    END IF;

    IF v_oath.opponent_id IS NOT NULL THEN
      PERFORM public.handle_profile_success(v_oath.opponent_id, v_stake);
    END IF;
    PERFORM public.handle_profile_failure(v_oath.creator_id, v_stake, p_oath_id);
  END IF;

  UPDATE public.oaths SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = p_oath_id;
  UPDATE public.group_members SET status = CASE WHEN user_id = p_winner_id THEN 'completed' ELSE 'failed' END, updated_at = now() WHERE oath_id = p_oath_id;
END;
$$;


-- 7. REJECT PROOF: Dedicated RPC Function with Resilient Role Verification
CREATE OR REPLACE FUNCTION public.reject_proof(
  p_oath_id UUID,
  p_proof_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_fail_oath BOOLEAN DEFAULT FALSE
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_oath public.oaths%ROWTYPE;
  v_proof public.proofs%ROWTYPE;
  v_clean_reason TEXT;
  v_submitter_name TEXT;
  v_reviewer_name TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oath not found'; END IF;

  -- Resilient role verification (checks user_id, auth email, and profile username)
  IF NOT (
    v_user = v_oath.creator_id
    OR v_user = coalesce(v_oath.opponent_id, '00000000-0000-0000-0000-000000000000'::uuid)
    OR EXISTS (
      SELECT 1 FROM public.nominees n
      LEFT JOIN public.profiles p ON p.id = v_user
      WHERE n.oath_id = p_oath_id
        AND (
          n.nominee_user_id = v_user
          OR n.email = (SELECT email FROM auth.users WHERE id = v_user)
          OR lower(trim(leading '@' from n.email)) = lower(p.username)
          OR n.email = p.username
          OR n.email = '@' || p.username
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.oath_id = p_oath_id AND gm.user_id = v_user
    )
    OR public.is_admin()
  ) THEN
    RAISE EXCEPTION 'You are not authorized to review proofs for this oath';
  END IF;

  -- Find proof to reject
  IF p_proof_id IS NOT NULL THEN
    SELECT * INTO v_proof FROM public.proofs WHERE id = p_proof_id AND oath_id = p_oath_id FOR UPDATE;
  ELSE
    SELECT * INTO v_proof FROM public.proofs WHERE oath_id = p_oath_id AND status IN ('pending_review', 'needs_more_proof') ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending proof found to reject';
  END IF;

  v_clean_reason := coalesce(nullif(trim(p_reason), ''), 'Proof was rejected by reviewer');

  -- Mark proof rejected
  UPDATE public.proofs
  SET status = 'rejected'::public.proof_status,
      reviewer_id = v_user,
      review_note = v_clean_reason,
      reviewed_at = now()
  WHERE id = v_proof.id;

  -- Mark nominee response
  UPDATE public.nominees
  SET verified = TRUE,
      verdict = 'penalty',
      verdict_note = v_clean_reason,
      responded_at = now()
  WHERE oath_id = p_oath_id;

  -- Dismiss reviewer's pending notification
  UPDATE public.notifications
  SET status = 'accepted', updated_at = now()
  WHERE user_id = v_user AND oath_id = p_oath_id AND type = 'verify_proof' AND status = 'pending';

  -- Reset submitter's proof_submitted flag in group_members so they can submit a new valid proof
  UPDATE public.group_members
  SET proof_submitted = FALSE
  WHERE oath_id = p_oath_id AND user_id = v_proof.submitted_by;

  SELECT username INTO v_reviewer_name FROM public.profiles WHERE id = v_user;

  -- Send notification to submitter
  INSERT INTO public.notifications (user_id, oath_id, proof_id, type, title, message, status)
  VALUES (
    v_proof.submitted_by,
    p_oath_id,
    v_proof.id,
    'system',
    'Proof Rejected',
    coalesce('@' || v_reviewer_name, 'Reviewer') || ' rejected your proof: "' || left(v_clean_reason, 120) || '". Upload a valid proof before today''s deadline.',
    'pending'
  );

  -- If one-time oath or explicit full rejection requested, fail the oath
  IF coalesce(v_oath.cadence, 'daily') <> 'daily' OR p_fail_oath THEN
    IF v_oath.oath_type = 'duo' THEN
      -- In Duo, submitter failed, opponent won
      IF v_proof.submitted_by = v_oath.creator_id THEN
        PERFORM public.settle_duo_oath(p_oath_id, v_oath.opponent_id);
      ELSE
        PERFORM public.settle_duo_oath(p_oath_id, v_oath.creator_id);
      END IF;
    ELSE
      PERFORM public.settle_oath(p_oath_id, 'failed');
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'proof_id', v_proof.id, 'status', 'rejected');
END;
$$;


-- 8. PASS TODAY WORK: Per-User Streaks, Calendar Midnight Boundaries, and Anti-Double-Increment
CREATE OR REPLACE FUNCTION public.pass_today_work(
  p_oath_id UUID,
  p_note TEXT DEFAULT NULL,
  p_proof_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_oath public.oaths%ROWTYPE;
  v_proof public.proofs%ROWTYPE;
  v_is_final_day BOOLEAN := FALSE;
  v_clean_note TEXT;
  v_submitter_wallet UUID;
  v_submitter_escrow NUMERIC;
  v_release NUMERIC;
  v_member public.group_members%ROWTYPE;
  v_reviewer_name TEXT;
  v_new_streak INT := 1;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oath not found'; END IF;
  IF v_oath.status <> 'active' THEN RAISE EXCEPTION 'Oath is not active'; END IF;

  -- Resilient role verification
  IF NOT (
    v_user = v_oath.creator_id
    OR v_user = coalesce(v_oath.opponent_id, '00000000-0000-0000-0000-000000000000'::uuid)
    OR EXISTS (
      SELECT 1 FROM public.nominees n
      LEFT JOIN public.profiles p ON p.id = v_user
      WHERE n.oath_id = p_oath_id
        AND (
          n.nominee_user_id = v_user
          OR n.email = (SELECT email FROM auth.users WHERE id = v_user)
          OR lower(trim(leading '@' from n.email)) = lower(p.username)
          OR n.email = p.username
          OR n.email = '@' || p.username
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.oath_id = p_oath_id AND gm.user_id = v_user
    )
    OR public.is_admin()
  ) THEN
    RAISE EXCEPTION 'You are not authorized to review proofs for this oath';
  END IF;

  -- Find proof to approve
  IF p_proof_id IS NOT NULL THEN
    SELECT * INTO v_proof FROM public.proofs WHERE id = p_proof_id AND oath_id = p_oath_id FOR UPDATE;
  ELSE
    SELECT * INTO v_proof FROM public.proofs WHERE oath_id = p_oath_id AND status IN ('pending_review', 'needs_more_proof') ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending proof found to approve';
  END IF;

  v_clean_note := coalesce(nullif(trim(p_note), ''), 'Today''s work verified by referee');

  -- Mark proof verified
  UPDATE public.proofs
  SET status = 'verified'::public.proof_status,
      reviewer_id = v_user,
      review_note = v_clean_note,
      reviewed_at = now()
  WHERE id = v_proof.id;

  -- Dismiss reviewer's pending notification
  UPDATE public.notifications
  SET status = 'accepted', updated_at = now()
  WHERE user_id = v_user AND oath_id = p_oath_id AND type = 'verify_proof' AND status = 'pending';

  -- Update nominee table
  UPDATE public.nominees
  SET verified = TRUE,
      verdict = 'success',
      verdict_note = v_clean_note,
      responded_at = now()
  WHERE oath_id = p_oath_id;

  -- Check if this is the final day or a single-day oath
  IF coalesce(v_oath.cadence, 'daily') = 'daily' THEN
    -- If total_days was missing, calculate from deadline
    IF v_oath.total_days <= 1 AND v_oath.deadline > (now() + interval '24 hours') THEN
      v_oath.total_days := greatest(2, ceil(extract(epoch from (v_oath.deadline - v_oath.created_at)) / 86400.0)::int);
      UPDATE public.oaths SET total_days = v_oath.total_days WHERE id = p_oath_id;
    END IF;

    -- PER-USER STREAK PROGRESSION:
    -- Update group_members record for the specific user who submitted the proof
    SELECT * INTO v_member FROM public.group_members WHERE oath_id = p_oath_id AND user_id = v_proof.submitted_by FOR UPDATE;
    IF FOUND THEN
      -- Only increment if NOT already verified on the same calendar day
      IF v_member.last_verified_at IS NULL OR date_trunc('day', v_member.last_verified_at) <> date_trunc('day', now()) THEN
        UPDATE public.group_members
        SET last_verified_day = current_day,
            day_streak = coalesce(day_streak, 0) + 1,
            current_day = coalesce(current_day, 1) + 1,
            last_verified_at = now(),
            proof_submitted = TRUE
        WHERE id = v_member.id
        RETURNING day_streak INTO v_new_streak;
      ELSE
        v_new_streak := coalesce(v_member.day_streak, 1);
      END IF;

      IF coalesce(v_member.current_day, 1) >= v_oath.total_days THEN
        v_is_final_day := TRUE;
      END IF;
    END IF;

    -- Solo oath level update (only increment once per calendar day)
    IF v_oath.last_verified_at IS NULL OR date_trunc('day', v_oath.last_verified_at) <> date_trunc('day', now()) THEN
      UPDATE public.oaths
      SET current_day = current_day + 1,
          current_streak = current_streak + 1,
          last_verified_at = now(),
          daily_deadline = (date_trunc('day', now()) + interval '1 day'),
          updated_at = now()
      WHERE id = p_oath_id
      RETURNING current_streak INTO v_new_streak;
    END IF;

    IF v_oath.current_day >= v_oath.total_days THEN
      v_is_final_day := TRUE;
    END IF;

  ELSE
    -- One-time proof oath
    v_is_final_day := TRUE;
  END IF;

  SELECT username INTO v_reviewer_name FROM public.profiles WHERE id = v_user;

  -- Notify submitter with cheer & break notice
  INSERT INTO public.notifications (user_id, oath_id, proof_id, type, title, message, status)
  VALUES (
    v_proof.submitted_by,
    p_oath_id,
    v_proof.id,
    'system',
    'Day Proof Verified!',
    coalesce('@' || v_reviewer_name, 'Referee') || ' verified your proof for today! Streak is now ' || v_new_streak || '. Take a break until midnight.',
    'pending'
  );

  IF v_is_final_day THEN
    IF v_oath.oath_type = 'duo' THEN
      PERFORM public.settle_duo_oath(p_oath_id, v_proof.submitted_by);
    ELSE
      PERFORM public.settle_oath(p_oath_id, 'completed');
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'proof_id', v_proof.id, 'streak', v_new_streak);
END;
$$;


-- 9. Permissions
GRANT EXECUTE ON FUNCTION public.create_oath_with_stake(TEXT, TIMESTAMPTZ, public.oath_type, public.verification_method, public.consequence_type, NUMERIC, INT, INT, UUID, TEXT, TEXT, TEXT, TEXT, public.group_mode, TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.accept_duo_challenge(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_squad(UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_duo_challenge(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_duo_oath(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_proof(UUID, UUID, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pass_today_work(UUID, TEXT, UUID) TO authenticated;
