-- Migration: 202610030010_the_penalty_box.sql
-- Implements "The Penalty Box (Forced Account Timeout)":
-- 1. Adds loss_streak and penalty_box_until columns to public.profiles
-- 2. 3 consecutive failed oaths trigger a 7-day penalty_box_until lock
-- 3. Users in the penalty box are blocked from creating oaths, joining squads, or joining lobbies
-- 4. Winning/completing any oath resets loss_streak to 0 and clears penalty_box_until

-- ============================================================
-- 1. ADD COLUMNS TO PROFILES
-- ============================================================
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS loss_streak INT NOT NULL DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS penalty_box_until TIMESTAMPTZ DEFAULT NULL;

-- Helper function to record oath failure and trigger 7-day Penalty Box lockout at 3 consecutive losses
CREATE OR REPLACE FUNCTION public.handle_profile_failure(p_user_id UUID, p_lost_amount NUMERIC, p_oath_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_new_loss_streak INT;
  v_penalty_deadline TIMESTAMPTZ;
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;

  UPDATE public.profiles
  SET oaths_failed = coalesce(oaths_failed, 0) + 1,
      total_lost = coalesce(total_lost, 0) + coalesce(p_lost_amount, 0),
      loss_streak = coalesce(loss_streak, 0) + 1,
      penalty_box_until = CASE 
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

-- Helper function to record oath success and reset loss streak / penalty box
CREATE OR REPLACE FUNCTION public.handle_profile_success(p_user_id UUID, p_won_amount NUMERIC DEFAULT 0)
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

GRANT EXECUTE ON FUNCTION public.handle_profile_failure(UUID, NUMERIC, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.handle_profile_success(UUID, NUMERIC) TO authenticated, anon;

-- ============================================================
-- 2. CREATE OATH WITH STAKE (ENFORCES PENALTY BOX LOCKOUT)
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_oath_with_stake(
  p_oath_statement TEXT,
  p_deadline TIMESTAMPTZ,
  p_oath_type public.oath_type,
  p_verification_method public.verification_method,
  p_consequence_type public.consequence_type,
  p_stake_amount NUMERIC,
  p_min_players INT DEFAULT NULL,
  p_max_players INT DEFAULT NULL,
  p_opponent_id UUID DEFAULT NULL,
  p_social_phone TEXT DEFAULT NULL,
  p_social_msg TEXT DEFAULT NULL,
  p_nominee_email TEXT DEFAULT NULL,
  p_anti_charity_cause TEXT DEFAULT NULL,
  p_group_mode public.group_mode DEFAULT NULL,
  p_opponent_ids UUID[] DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_user UUID := auth.uid();
  v_oath_id UUID;
  v_wallet_id UUID;
  v_min_players INT;
  v_max_players INT;
  v_total_stake NUMERIC := 0;
  v_platform_fee NUMERIC := 0;
  v_total_deduction NUMERIC := 0;
  v_nominee_user_id UUID;
  v_initial_status public.oath_status;
  v_penalty_box TIMESTAMPTZ;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Check if user is locked in The Penalty Box
  SELECT penalty_box_until INTO v_penalty_box FROM public.profiles WHERE id = v_user;
  IF v_penalty_box IS NOT NULL AND v_penalty_box > now() THEN
    RAISE EXCEPTION 'You are locked in The Penalty Box until % UTC for 3 consecutive oath failures. No oath creation allowed.', to_char(v_penalty_box, 'Mon DD, YYYY HH24:MI');
  END IF;

  IF length(trim(p_oath_statement)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Statement must be 1–500 chars'; END IF;
  IF p_deadline IS NULL OR p_deadline <= now() THEN RAISE EXCEPTION 'Deadline must be future'; END IF;
  IF p_stake_amount < 0 THEN RAISE EXCEPTION 'Stake must be non-negative'; END IF;

  IF p_oath_type = 'duo' AND p_opponent_id IS NOT NULL AND p_opponent_id = v_user THEN
    RAISE EXCEPTION 'You cannot challenge yourself';
  END IF;

  IF p_verification_method = 'nominee' AND coalesce(p_nominee_email, '') = '' THEN
    RAISE EXCEPTION 'Nominee verification requires a nominee email or username';
  END IF;

  IF p_consequence_type = 'social_ransom' AND (coalesce(p_social_phone, '') = '' OR coalesce(p_social_msg, '') = '') THEN
    RAISE EXCEPTION 'Social ransom requires both phone and message';
  END IF;

  IF p_oath_type IN ('duo', 'squad') AND p_group_mode IS NULL THEN
    p_group_mode := 'survival';
  END IF;

  IF p_oath_type = 'duo' THEN
    v_min_players := 2;
    v_max_players := 2;
    v_total_stake := p_stake_amount * 2; -- Leader pays 2x pot upfront so opponent can join free
    v_initial_status := 'pending';
  ELSIF p_oath_type = 'squad' THEN
    IF p_min_players IS NOT NULL AND p_max_players IS NOT NULL AND (p_min_players > p_max_players OR p_min_players < 3 OR p_max_players > 10) THEN
      RAISE EXCEPTION 'Invalid squad size: must have between 3 and 10 players, and min cannot exceed max';
    END IF;
    v_min_players := greatest(3, coalesce(p_min_players, 4));
    v_max_players := least(10, greatest(v_min_players, coalesce(p_max_players, 8)));
    v_total_stake := p_stake_amount * v_max_players;
    v_initial_status := 'pending';
  ELSIF p_oath_type = 'lobby' THEN
    v_min_players := greatest(2, coalesce(p_min_players, 2));
    v_max_players := least(10, greatest(v_min_players, coalesce(p_max_players, 10)));
    v_total_stake := p_stake_amount; -- In public lobby, creator pays 1x buy-in
    v_initial_status := 'pending';
  ELSE
    v_min_players := 1;
    v_max_players := 1;
    v_total_stake := p_stake_amount;
    v_initial_status := 'active';
  END IF;

  -- Upfront 10% platform fee calculation
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
      RAISE EXCEPTION 'Insufficient balance to cover total charge (% required: % stake + 10%% fee)', v_total_deduction, v_total_stake; 
    END IF;

    -- Record transactions
    INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
    VALUES (v_wallet_id, NULL, 'escrow_lock', v_total_stake, 'Stake locked in escrow');

    IF v_platform_fee > 0 THEN
      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_wallet_id, NULL, 'house_cut', v_platform_fee, '10% Upfront Platform Protocol Fee');
    END IF;
  END IF;
  
  -- Create Oath with proper pending status
  INSERT INTO public.oaths (
    creator_id, oath_statement, deadline, oath_type, verification_method, 
    consequence_type, stake_amount, status, min_players, max_players, opponent_id, group_mode)
  VALUES (
    v_user, p_oath_statement, p_deadline, p_oath_type, p_verification_method,
    p_consequence_type, p_stake_amount, 
    v_initial_status,
    v_min_players, v_max_players, p_opponent_id, p_group_mode)
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
    INSERT INTO public.group_members (oath_id, user_id, stake_amount, status, votes_needed)
    VALUES (v_oath_id, v_user, p_stake_amount, 'joined', CASE WHEN p_oath_type = 'duo' THEN 1 ELSE 3 END);
  END IF;

  UPDATE public.profiles SET
    oaths_created = coalesce(oaths_created, 0) + 1,
    total_staked = coalesce(total_staked, 0) + v_total_stake,
    updated_at = now()
  WHERE id = v_user;

  RETURN v_oath_id;
END;
$$;

-- ============================================================
-- 3. JOIN SQUAD / LOBBY (ENFORCES PENALTY BOX LOCKOUT)
-- ============================================================
CREATE OR REPLACE FUNCTION public.join_squad(p_oath_id UUID, p_stake_amount NUMERIC) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
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

  -- Check if user is locked in The Penalty Box
  SELECT penalty_box_until INTO v_penalty_box FROM public.profiles WHERE id = v_user;
  IF v_penalty_box IS NOT NULL AND v_penalty_box > now() THEN
    RAISE EXCEPTION 'You are locked in The Penalty Box until % UTC for 3 consecutive oath failures. You cannot join lobbies or squads.', to_char(v_penalty_box, 'Mon DD, YYYY HH24:MI');
  END IF;

  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Challenge pool not found'; END IF;
  IF v_oath.status NOT IN ('pending', 'active') THEN RAISE EXCEPTION 'Challenge pool is no longer accepting members (status: %)', v_oath.status; END IF;
  IF v_oath.deadline <= now() THEN RAISE EXCEPTION 'Cannot join an expired challenge'; END IF;

  IF EXISTS (SELECT 1 FROM public.group_members WHERE oath_id = p_oath_id AND user_id = v_user) THEN
    RAISE EXCEPTION 'You have already joined this challenge';
  END IF;

  SELECT count(*) INTO v_member_count FROM public.group_members WHERE oath_id = p_oath_id;
  v_max_players := coalesce(v_oath.max_players, 8);
  IF v_member_count >= v_max_players THEN RAISE EXCEPTION 'Challenge pool is full'; END IF;

  IF v_oath.oath_type = 'lobby' THEN
    v_join_stake := coalesce(v_oath.stake_amount, p_stake_amount);
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
        RAISE EXCEPTION 'Insufficient balance to cover buy-in (% required: % stake + 10%% fee)', v_total_deduction, v_join_stake; 
      END IF;

      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_wallet_id, p_oath_id, 'escrow_lock', v_join_stake, 'Lobby buy-in stake locked in escrow');

      IF v_join_fee > 0 THEN
        INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
        VALUES (v_wallet_id, p_oath_id, 'house_cut', v_join_fee, '10% Upfront Platform Protocol Fee (Lobby)');
      END IF;
    END IF;
  END IF;

  INSERT INTO public.group_members (oath_id, user_id, stake_amount, status, votes_needed)
  VALUES (p_oath_id, v_user, CASE WHEN v_oath.oath_type = 'lobby' THEN v_join_stake ELSE coalesce(v_oath.stake_amount, 0) END, 'joined', CASE WHEN v_oath.oath_type = 'duo' THEN 1 ELSE 3 END)
  RETURNING id INTO v_member_id;

  v_min_players := coalesce(v_oath.min_players, 3);
  IF (v_member_count + 1) >= v_min_players AND v_oath.status = 'pending' THEN
    UPDATE public.oaths SET status = 'active', updated_at = now() WHERE id = p_oath_id;
  END IF;

  RETURN v_member_id;
END;
$$;

-- ============================================================
-- 4. SETTLE OATH ATOMICALLY (UPDATES LOSS STREAK & PENALTY BOX)
-- ============================================================
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

    -- Update profile success stats & reset loss streak
    PERFORM public.handle_profile_success(v_oath.creator_id);

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

    -- Update profile failure stats, increment loss streak, trigger Penalty Box if 3 fails
    PERFORM public.handle_profile_failure(v_oath.creator_id, v_oath.stake_amount, p_oath_id);

    IF v_oath.consequence_type = 'public_shame' THEN
      INSERT INTO public.wall_entries (oath_id, user_id, wall_type, oath_statement, stake_amount, excuse, username)
      SELECT p_oath_id, v_oath.creator_id, 'shame'::public.wall_type,
        v_oath.oath_statement, v_oath.stake_amount, coalesce(p_note, 'I gave up under pressure.'),
        (SELECT username FROM public.profiles WHERE id = v_oath.creator_id);
    END IF;
  END IF;
END;
$$;

-- ============================================================
-- 5. SETTLE DUO OATH (UPDATES LOSS STREAK & PENALTY BOX)
-- ============================================================
CREATE OR REPLACE FUNCTION public.settle_duo_oath(
  p_oath_id UUID,
  p_winner_id UUID,
  p_reason TEXT DEFAULT 'Peer review settled'
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_oath public.oaths%ROWTYPE;
  v_caller UUID := auth.uid();
  v_creator_wallet UUID;
  v_opponent_wallet UUID;
  v_winner_wallet UUID;
  v_loser UUID;
  v_total_pot NUMERIC;
  v_payout NUMERIC;
  v_creator_escrow NUMERIC;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oath not found'; END IF;
  IF v_oath.oath_type <> 'duo' THEN RAISE EXCEPTION 'Not a duo oath'; END IF;
  IF v_oath.status <> 'active' AND v_oath.status <> 'in_review' THEN
    RAISE EXCEPTION 'Oath is not active or in review (current: %)', v_oath.status;
  END IF;

  IF v_caller <> v_oath.creator_id AND (v_oath.opponent_id IS NULL OR v_caller <> v_oath.opponent_id) THEN
    RAISE EXCEPTION 'Only duel participants can settle';
  END IF;

  IF p_winner_id <> v_oath.creator_id AND (v_oath.opponent_id IS NULL OR p_winner_id <> v_oath.opponent_id) THEN
    RAISE EXCEPTION 'Invalid winner ID';
  END IF;

  IF p_winner_id = v_oath.creator_id THEN
    v_loser := v_oath.opponent_id;
  ELSE
    v_loser := v_oath.creator_id;
  END IF;

  -- 100% of the pot goes to the winner because 10% fee was paid upfront at creation!
  v_total_pot := v_oath.stake_amount * 2;
  v_payout := v_total_pot;

  SELECT id, coalesce(escrow_locked, 0)
  INTO v_creator_wallet, v_creator_escrow
  FROM public.wallets
  WHERE user_id = v_oath.creator_id
  FOR UPDATE;

  IF v_oath.opponent_id IS NOT NULL THEN
    SELECT id INTO v_opponent_wallet
    FROM public.wallets
    WHERE user_id = v_oath.opponent_id
    FOR UPDATE;
  END IF;

  IF p_winner_id = v_oath.creator_id THEN
    v_winner_wallet := v_creator_wallet;
  ELSE
    v_winner_wallet := v_opponent_wallet;
  END IF;

  -- Leader paid 2x pot upfront
  IF v_creator_wallet IS NOT NULL THEN
    UPDATE public.wallets
    SET escrow_locked = escrow_locked - least(v_creator_escrow, v_total_pot),
        updated_at = now()
    WHERE id = v_creator_wallet;
  END IF;

  IF v_winner_wallet IS NOT NULL THEN
    UPDATE public.wallets
    SET balance = balance + v_payout,
        total_won = coalesce(total_won, 0) + (v_payout - v_oath.stake_amount),
        updated_at = now()
    WHERE id = v_winner_wallet;

    INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
    VALUES (v_winner_wallet, p_oath_id, 'reward', v_payout, 'Won Duo Challenge (100% pot payout)');
  END IF;

  UPDATE public.oaths
  SET status = 'completed', updated_at = now()
  WHERE id = p_oath_id;

  UPDATE public.group_members
  SET status = CASE WHEN user_id = p_winner_id THEN 'completed' ELSE 'failed' END,
      updated_at = now()
  WHERE oath_id = p_oath_id;

  -- Winner success handler (resets loss streak)
  PERFORM public.handle_profile_success(p_winner_id, v_payout - v_oath.stake_amount);

  -- Loser failure handler (increments loss streak, triggers Penalty Box on 3rd fail)
  IF v_loser IS NOT NULL THEN
    PERFORM public.handle_profile_failure(v_loser, v_oath.stake_amount, p_oath_id);
  END IF;
END;
$$;

-- ============================================================
-- 6. CRON SWEEPER (UPDATES LOSS STREAK & PENALTY BOX ON TIMEOUT)
-- ============================================================
CREATE OR REPLACE FUNCTION public.auto_resolve_expired_oaths()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_oath RECORD;
  v_count INT := 0;
  v_wallet_id UUID;
  v_release NUMERIC;
  v_winner_id UUID;
  v_winner_wallet UUID;
  v_winner_reward NUMERIC;
  v_has_creator_proof BOOLEAN;
  v_has_opponent_proof BOOLEAN;
  v_member_record RECORD;
BEGIN
  FOR v_oath IN
    SELECT *
    FROM public.oaths
    WHERE status IN ('active', 'in_review')
      AND deadline < now()
  LOOP
    IF v_oath.oath_type = 'solo' THEN
      UPDATE public.oaths
      SET status = 'failed', updated_at = now()
      WHERE id = v_oath.id;

      SELECT id INTO v_wallet_id
      FROM public.wallets
      WHERE user_id = v_oath.creator_id;

      IF v_wallet_id IS NOT NULL AND v_oath.stake_amount > 0 THEN
        UPDATE public.wallets
        SET escrow_locked = greatest(0, escrow_locked - v_oath.stake_amount),
            total_lost = total_lost + v_oath.stake_amount,
            updated_at = now()
        WHERE id = v_wallet_id;

        INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
        VALUES (v_wallet_id, v_oath.id, 'penalty', v_oath.stake_amount, 'Expired without verified proof; stake seized');
      END IF;

      -- Update failure stats & check for 3-fail penalty box
      PERFORM public.handle_profile_failure(v_oath.creator_id, v_oath.stake_amount, v_oath.id);
      v_count := v_count + 1;

    ELSIF v_oath.oath_type = 'duo' THEN
      v_has_creator_proof := EXISTS (
        SELECT 1 FROM public.proofs
        WHERE oath_id = v_oath.id AND submitted_by = v_oath.creator_id
      );
      v_has_opponent_proof := EXISTS (
        SELECT 1 FROM public.proofs
        WHERE oath_id = v_oath.id AND submitted_by = v_oath.opponent_id
      );

      IF NOT v_has_creator_proof AND NOT v_has_opponent_proof THEN
        v_release := v_oath.stake_amount * 2;

        SELECT id INTO v_wallet_id
        FROM public.wallets
        WHERE user_id = v_oath.creator_id;

        IF v_wallet_id IS NOT NULL AND v_release > 0 THEN
          UPDATE public.wallets
          SET escrow_locked = greatest(0, escrow_locked - v_release),
              total_lost = total_lost + v_release,
              updated_at = now()
          WHERE id = v_wallet_id;

          INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
          VALUES (v_wallet_id, v_oath.id, 'penalty', v_release, 'Duel abandoned by both players; creator stake seized');
        END IF;

        UPDATE public.oaths
        SET status = 'failed', updated_at = now()
        WHERE id = v_oath.id;

        UPDATE public.group_members
        SET status = 'failed', updated_at = now()
        WHERE oath_id = v_oath.id;

        PERFORM public.handle_profile_failure(v_oath.creator_id, v_oath.stake_amount, v_oath.id);
        IF v_oath.opponent_id IS NOT NULL THEN
          PERFORM public.handle_profile_failure(v_oath.opponent_id, v_oath.stake_amount, v_oath.id);
        END IF;

        v_count := v_count + 1;

      ELSIF v_has_creator_proof AND NOT v_has_opponent_proof THEN
        v_winner_id := v_oath.creator_id;
        v_release := v_oath.stake_amount * 2;

        SELECT id INTO v_wallet_id
        FROM public.wallets
        WHERE user_id = v_oath.creator_id;

        IF v_wallet_id IS NOT NULL AND v_release > 0 THEN
          v_winner_reward := v_release;
          UPDATE public.wallets
          SET escrow_locked = greatest(0, escrow_locked - v_release),
              balance = balance + v_winner_reward,
              total_won = total_won + (v_winner_reward - v_oath.stake_amount),
              updated_at = now()
          WHERE id = v_wallet_id;

          INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
          VALUES (v_wallet_id, v_oath.id, 'reward', v_winner_reward, 'Won duel by opponent ghosting timeout');
        END IF;

        UPDATE public.oaths SET status = 'completed', updated_at = now() WHERE id = v_oath.id;
        UPDATE public.group_members SET status = CASE WHEN user_id = v_winner_id THEN 'completed' ELSE 'failed' END WHERE oath_id = v_oath.id;

        PERFORM public.handle_profile_success(v_winner_id, v_release - v_oath.stake_amount);
        IF v_oath.opponent_id IS NOT NULL THEN
          PERFORM public.handle_profile_failure(v_oath.opponent_id, v_oath.stake_amount, v_oath.id);
        END IF;

        v_count := v_count + 1;

      ELSIF NOT v_has_creator_proof AND v_has_opponent_proof THEN
        v_winner_id := v_oath.opponent_id;
        v_release := v_oath.stake_amount * 2;

        SELECT id INTO v_wallet_id
        FROM public.wallets
        WHERE user_id = v_oath.creator_id;

        IF v_wallet_id IS NOT NULL AND v_release > 0 THEN
          UPDATE public.wallets
          SET escrow_locked = greatest(0, escrow_locked - v_release),
              total_lost = total_lost + v_release,
              updated_at = now()
          WHERE id = v_wallet_id;

          INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
          VALUES (v_wallet_id, v_oath.id, 'penalty', v_release, 'Lost duel by ghosting timeout; stake awarded to opponent');
        END IF;

        IF v_winner_id IS NOT NULL THEN
          SELECT id INTO v_winner_wallet FROM public.wallets WHERE user_id = v_winner_id;
          IF v_winner_wallet IS NOT NULL AND v_release > 0 THEN
            v_winner_reward := v_release;
            UPDATE public.wallets
            SET balance = balance + v_winner_reward,
                total_won = total_won + v_winner_reward,
                updated_at = now()
            WHERE id = v_winner_wallet;

            INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
            VALUES (v_winner_wallet, v_oath.id, 'reward', v_winner_reward, 'Won duel by creator ghosting timeout');
          END IF;
        END IF;

        UPDATE public.oaths SET status = 'completed', updated_at = now() WHERE id = v_oath.id;
        UPDATE public.group_members SET status = CASE WHEN user_id = v_winner_id THEN 'completed' ELSE 'failed' END WHERE oath_id = v_oath.id;

        IF v_winner_id IS NOT NULL THEN
          PERFORM public.handle_profile_success(v_winner_id, v_release);
        END IF;
        PERFORM public.handle_profile_failure(v_oath.creator_id, v_release, v_oath.id);

        v_count := v_count + 1;
      END IF;

    ELSIF v_oath.oath_type = 'squad' THEN
      IF coalesce(v_oath.group_mode, 'survival') = 'weakest_link' THEN
        IF EXISTS (
          SELECT 1 FROM public.group_members
          WHERE oath_id = v_oath.id AND status = 'joined' AND proof_submitted = false
        ) THEN
          v_release := coalesce(v_oath.stake_amount, 0) * coalesce(v_oath.max_players, 8);

          SELECT id INTO v_wallet_id
          FROM public.wallets
          WHERE user_id = v_oath.creator_id;

          IF v_wallet_id IS NOT NULL AND v_release > 0 THEN
            UPDATE public.wallets
            SET escrow_locked = greatest(0, escrow_locked - v_release),
                total_lost = total_lost + v_release,
                updated_at = now()
            WHERE id = v_wallet_id;

            INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
            VALUES (v_wallet_id, v_oath.id, 'penalty', v_release, 'Weakest Link failed on deadline: Member ghosted');
          END IF;

          UPDATE public.oaths SET status = 'failed', updated_at = now() WHERE id = v_oath.id;
          UPDATE public.group_members SET status = 'failed', updated_at = now() WHERE oath_id = v_oath.id;

          FOR v_member_record IN SELECT user_id FROM public.group_members WHERE oath_id = v_oath.id LOOP
            PERFORM public.handle_profile_failure(v_member_record.user_id, v_oath.stake_amount, v_oath.id);
          END LOOP;

          v_count := v_count + 1;
        END IF;

      ELSE
        -- Survival squad
        FOR v_member_record IN
          SELECT * FROM public.group_members
          WHERE oath_id = v_oath.id AND status = 'joined' AND proof_submitted = false
        LOOP
          UPDATE public.group_members SET status = 'failed', updated_at = now() WHERE id = v_member_record.id;
          PERFORM public.handle_profile_failure(v_member_record.user_id, v_oath.stake_amount, v_oath.id);
        END LOOP;

        IF NOT EXISTS (SELECT 1 FROM public.group_members WHERE oath_id = v_oath.id AND status = 'joined') THEN
          UPDATE public.oaths
          SET status = CASE 
            WHEN EXISTS (SELECT 1 FROM public.group_members WHERE oath_id = v_oath.id AND status = 'completed') THEN 'completed'
            ELSE 'failed'
          END,
          updated_at = now()
          WHERE id = v_oath.id;
        END IF;

        v_count := v_count + 1;
      END IF;

    ELSIF v_oath.oath_type = 'lobby' THEN
      FOR v_member_record IN
        SELECT * FROM public.group_members
        WHERE oath_id = v_oath.id AND status = 'joined' AND proof_submitted = false
      LOOP
        UPDATE public.group_members SET status = 'failed', updated_at = now() WHERE id = v_member_record.id;

        SELECT id INTO v_wallet_id
        FROM public.wallets
        WHERE user_id = v_member_record.user_id;

        IF v_wallet_id IS NOT NULL AND coalesce(v_member_record.stake_amount, 0) > 0 THEN
          UPDATE public.wallets
          SET escrow_locked = greatest(0, escrow_locked - v_member_record.stake_amount),
              total_lost = total_lost + v_member_record.stake_amount,
              updated_at = now()
          WHERE id = v_wallet_id;

          INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
          VALUES (v_wallet_id, v_oath.id, 'penalty', v_member_record.stake_amount, 'Lobby deadline expired without proof; buy-in seized');
        END IF;

        PERFORM public.handle_profile_failure(v_member_record.user_id, v_member_record.stake_amount, v_oath.id);
      END LOOP;

      IF NOT EXISTS (SELECT 1 FROM public.group_members WHERE oath_id = v_oath.id AND status = 'joined') THEN
        UPDATE public.oaths
        SET status = CASE 
          WHEN EXISTS (SELECT 1 FROM public.group_members WHERE oath_id = v_oath.id AND status = 'completed') THEN 'completed'
          ELSE 'failed'
        END,
        updated_at = now()
        WHERE id = v_oath.id;
      END IF;

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'swept_expired_count', v_count,
    'timestamp', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_resolve_expired_oaths() TO authenticated, anon;
