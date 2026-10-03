-- Migration: 202610030005_upfront_fee_and_purge_duffer.sql
-- 1. Permanently remove duffer_debt column from public.profiles
-- 2. Switch 10% protocol fee from settlement to UPFRONT creation/wager (stake X + 10% fee charged from balance)
-- 3. Remove settlement fee cuts so winners and verified members receive 100% of their escrow pot

-- ============================================================
-- 1. PURGE DUFFER DEBT COLUMN
-- ============================================================
ALTER TABLE public.profiles DROP COLUMN IF EXISTS duffer_debt;

-- ============================================================
-- 2. CREATE OATH WITH STAKE (UPFRONT 10% PROTOCOL FEE)
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
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
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
-- 3. JOIN SQUAD / LOBBY (UPFRONT 10% FEE ON LOBBY BUY-IN)
-- ============================================================
CREATE OR REPLACE FUNCTION public.join_squad(p_oath_id UUID, p_stake_amount NUMERIC) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE 
  v_user UUID := auth.uid(); 
  v_member UUID; 
  v_oath public.oaths%ROWTYPE;
  v_wallet_id UUID;
  v_join_stake NUMERIC := 0;
  v_join_fee NUMERIC := 0;
  v_total_join NUMERIC := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_oath FROM public.oaths WHERE id=p_oath_id AND oath_type IN ('squad', 'lobby', 'duo') AND status IN ('pending','active') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oath is not open for joining'; END IF;
  IF v_oath.deadline <= now() THEN RAISE EXCEPTION 'Deadline has passed'; END IF;
  IF EXISTS (SELECT 1 FROM public.group_members WHERE oath_id=p_oath_id AND user_id=v_user) THEN RAISE EXCEPTION 'Already joined'; END IF;
  IF v_oath.max_players > 0 AND (SELECT count(*) FROM public.group_members WHERE oath_id=p_oath_id) >= v_oath.max_players THEN 
    RAISE EXCEPTION 'This oath is full'; 
  END IF;
  
  -- In a lobby, each joining user pays their individual buy-in + 10% protocol fee
  IF v_oath.oath_type = 'lobby' AND coalesce(v_oath.stake_amount, 0) > 0 THEN
    v_join_stake := v_oath.stake_amount;
    v_join_fee := round(v_join_stake * 0.10, 2);
    v_total_join := v_join_stake + v_join_fee;

    UPDATE public.wallets 
    SET balance = balance - v_total_join,
        escrow_locked = escrow_locked + v_join_stake,
        updated_at = now()
    WHERE user_id = v_user AND balance >= v_total_join
    RETURNING id INTO v_wallet_id;

    IF v_wallet_id IS NULL THEN
      RAISE EXCEPTION 'Insufficient balance to cover lobby buy-in (% required: % stake + 10%% fee)', v_total_join, v_join_stake;
    END IF;

    INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
    VALUES (v_wallet_id, p_oath_id, 'escrow_lock', v_join_stake, 'Stake locked for joining lobby');

    IF v_join_fee > 0 THEN
      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_wallet_id, p_oath_id, 'house_cut', v_join_fee, '10% Upfront Platform Protocol Fee');
    END IF;

    UPDATE public.profiles SET
      total_staked = coalesce(total_staked, 0) + v_join_stake,
      updated_at = now()
    WHERE id = v_user;
  END IF;

  INSERT INTO public.group_members (oath_id, user_id, stake_amount, status, votes_needed)
  VALUES (p_oath_id, v_user, v_oath.stake_amount, 'joined', CASE WHEN v_oath.oath_type = 'duo' THEN 1 ELSE 3 END)
  RETURNING id INTO v_member;

  -- If min_players reached, activate the lobby or squad
  IF (SELECT count(*) FROM public.group_members WHERE oath_id=p_oath_id) >= v_oath.min_players THEN
    UPDATE public.oaths SET status = 'active' WHERE id = p_oath_id AND status = 'pending';
  END IF;

  RETURN v_member;
END;
$$;

-- ============================================================
-- 4. SETTLE DUO OATH (100% PAYOUT, NO FEE CUT AT SETTLEMENT)
-- ============================================================
DROP FUNCTION IF EXISTS public.settle_duo_oath(UUID, UUID);
DROP FUNCTION IF EXISTS public.settle_duo_oath(UUID, UUID, TEXT);
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
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_oath
  FROM public.oaths
  WHERE id = p_oath_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oath not found';
  END IF;

  IF v_oath.oath_type <> 'duo' THEN
    RAISE EXCEPTION 'Not a duo oath';
  END IF;

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

  UPDATE public.profiles
  SET oaths_completed = oaths_completed + 1,
      total_won = total_won + (v_payout - v_oath.stake_amount),
      updated_at = now()
  WHERE id = p_winner_id;

  IF v_loser IS NOT NULL THEN
    UPDATE public.profiles
    SET oaths_failed = oaths_failed + 1,
        total_lost = total_lost + v_oath.stake_amount,
        updated_at = now()
    WHERE id = v_loser;
  END IF;
END;
$$;

-- ============================================================
-- 5. CRON SWEEPER (100% PAYOUT, NO FEE CUT AT TIMEOUT)
-- ============================================================
DROP FUNCTION IF EXISTS public.auto_resolve_expired_oaths();
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
      IF EXISTS (
        SELECT 1 FROM public.proofs
        WHERE oath_id = v_oath.id
          AND status = 'pending_review'
      ) THEN
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
          VALUES (v_wallet_id, v_oath.id, 'penalty', v_oath.stake_amount, 'Solo oath referee timed out; stake seized');
        END IF;

        UPDATE public.profiles
        SET oaths_failed = oaths_failed + 1,
            total_lost = total_lost + v_oath.stake_amount,
            updated_at = now()
        WHERE id = v_oath.creator_id;

        v_count := v_count + 1;
      ELSE
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
          VALUES (v_wallet_id, v_oath.id, 'penalty', v_oath.stake_amount, 'Expired without proof; stake seized');
        END IF;

        UPDATE public.profiles
        SET oaths_failed = oaths_failed + 1,
            total_lost = total_lost + v_oath.stake_amount,
            updated_at = now()
        WHERE id = v_oath.creator_id;

        v_count := v_count + 1;
      END IF;

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

        UPDATE public.profiles
        SET oaths_failed = oaths_failed + 1,
            total_lost = total_lost + v_oath.stake_amount,
            updated_at = now()
        WHERE id IN (v_oath.creator_id, v_oath.opponent_id);

        v_count := v_count + 1;

      ELSIF v_has_creator_proof AND NOT v_has_opponent_proof THEN
        v_winner_id := v_oath.creator_id;
        v_release := v_oath.stake_amount * 2;

        SELECT id INTO v_wallet_id
        FROM public.wallets
        WHERE user_id = v_oath.creator_id;

        IF v_wallet_id IS NOT NULL AND v_release > 0 THEN
          -- 100% of pot to winner without settlement cut!
          v_winner_reward := v_release;
          UPDATE public.wallets
          SET escrow_locked = greatest(0, escrow_locked - v_release),
              balance = balance + v_winner_reward,
              total_won = total_won + (v_winner_reward - v_oath.stake_amount),
              updated_at = now()
          WHERE id = v_wallet_id;

          INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
          VALUES (v_wallet_id, v_oath.id, 'reward', v_winner_reward, 'Won Duo Challenge by default (opponent ghosted)');
        END IF;

        UPDATE public.oaths
        SET status = 'completed', updated_at = now()
        WHERE id = v_oath.id;

        UPDATE public.group_members
        SET status = CASE WHEN user_id = v_winner_id THEN 'completed' ELSE 'failed' END,
            updated_at = now()
        WHERE oath_id = v_oath.id;

        UPDATE public.profiles
        SET oaths_completed = oaths_completed + 1,
            total_won = total_won + (v_release - v_oath.stake_amount),
            updated_at = now()
        WHERE id = v_winner_id;

        UPDATE public.profiles
        SET oaths_failed = oaths_failed + 1,
            total_lost = total_lost + v_oath.stake_amount,
            updated_at = now()
        WHERE id = v_oath.opponent_id;

        v_count := v_count + 1;

      ELSIF NOT v_has_creator_proof AND v_has_opponent_proof THEN
        v_winner_id := v_oath.opponent_id;
        v_release := v_oath.stake_amount * 2;

        SELECT id INTO v_wallet_id
        FROM public.wallets
        WHERE user_id = v_oath.creator_id;

        SELECT id INTO v_winner_wallet
        FROM public.wallets
        WHERE user_id = v_winner_id;

        IF v_wallet_id IS NOT NULL AND v_release > 0 THEN
          UPDATE public.wallets
          SET escrow_locked = greatest(0, escrow_locked - v_release),
              total_lost = total_lost + v_release,
              updated_at = now()
          WHERE id = v_wallet_id;
        END IF;

        IF v_winner_wallet IS NOT NULL AND v_release > 0 THEN
          -- 100% of pot to winner without settlement cut!
          v_winner_reward := v_release;
          UPDATE public.wallets
          SET balance = balance + v_winner_reward,
              total_won = total_won + v_release,
              updated_at = now()
          WHERE id = v_winner_wallet;

          INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
          VALUES (v_winner_wallet, v_oath.id, 'reward', v_winner_reward, 'Won Duo Challenge by default (creator ghosted)');
        END IF;

        UPDATE public.oaths
        SET status = 'completed', updated_at = now()
        WHERE id = v_oath.id;

        UPDATE public.group_members
        SET status = CASE WHEN user_id = v_winner_id THEN 'completed' ELSE 'failed' END,
            updated_at = now()
        WHERE oath_id = v_oath.id;

        UPDATE public.profiles
        SET oaths_completed = oaths_completed + 1,
            total_won = total_won + v_release,
            updated_at = now()
        WHERE id = v_winner_id;

        UPDATE public.profiles
        SET oaths_failed = oaths_failed + 1,
            total_lost = total_lost + v_oath.stake_amount,
            updated_at = now()
        WHERE id = v_oath.creator_id;

        v_count := v_count + 1;

      ELSE
        UPDATE public.oaths
        SET status = 'disputed', updated_at = now()
        WHERE id = v_oath.id;

        v_count := v_count + 1;
      END IF;

    ELSIF v_oath.oath_type = 'squad' THEN
      IF coalesce(v_oath.group_mode, 'survival') = 'weakest_link' THEN
        IF EXISTS (
          SELECT 1 FROM public.group_members
          WHERE oath_id = v_oath.id
            AND status <> 'completed'
        ) THEN
          v_release := v_oath.stake_amount * v_oath.max_players;

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
            VALUES (v_wallet_id, v_oath.id, 'penalty', v_release, 'Weakest Link squad failed at deadline; full stake seized');
          END IF;

          UPDATE public.oaths
          SET status = 'failed', updated_at = now()
          WHERE id = v_oath.id;

          UPDATE public.group_members
          SET status = 'failed', updated_at = now()
          WHERE oath_id = v_oath.id;

          UPDATE public.profiles
          SET oaths_failed = oaths_failed + 1,
              total_lost = total_lost + v_oath.stake_amount,
              updated_at = now()
          WHERE id IN (
            SELECT user_id FROM public.group_members WHERE oath_id = v_oath.id
          );

          v_count := v_count + 1;
        END IF;

      ELSE
        FOR v_member_record IN
          SELECT * FROM public.group_members
          WHERE oath_id = v_oath.id
            AND status = 'joined'
        LOOP
          UPDATE public.group_members
          SET status = 'failed', updated_at = now()
          WHERE id = v_member_record.id;

          SELECT id INTO v_wallet_id
          FROM public.wallets
          WHERE user_id = v_oath.creator_id;

          IF v_wallet_id IS NOT NULL AND v_member_record.stake_amount > 0 THEN
            UPDATE public.wallets
            SET escrow_locked = greatest(0, escrow_locked - v_member_record.stake_amount),
                total_lost = total_lost + v_member_record.stake_amount,
                updated_at = now()
            WHERE id = v_wallet_id;

            INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
            VALUES (v_wallet_id, v_oath.id, 'penalty', v_member_record.stake_amount, 'Squad member timed out without proof; share seized');
          END IF;

          UPDATE public.profiles
          SET oaths_failed = oaths_failed + 1,
              total_lost = total_lost + v_member_record.stake_amount,
              updated_at = now()
          WHERE id = v_member_record.user_id;
        END LOOP;

        IF NOT EXISTS (
          SELECT 1 FROM public.group_members
          WHERE oath_id = v_oath.id AND status = 'joined'
        ) THEN
          IF EXISTS (
            SELECT 1 FROM public.group_members
            WHERE oath_id = v_oath.id AND status = 'completed'
          ) THEN
            UPDATE public.oaths SET status = 'completed', updated_at = now() WHERE id = v_oath.id;
          ELSE
            UPDATE public.oaths SET status = 'failed', updated_at = now() WHERE id = v_oath.id;
          END IF;
        END IF;

        v_count := v_count + 1;
      END IF;

    ELSIF v_oath.oath_type = 'lobby' THEN
      FOR v_member_record IN
        SELECT * FROM public.group_members
        WHERE oath_id = v_oath.id
          AND status = 'joined'
      LOOP
        UPDATE public.group_members
        SET status = 'failed', updated_at = now()
        WHERE id = v_member_record.id;

        SELECT id INTO v_wallet_id
        FROM public.wallets
        WHERE user_id = v_member_record.user_id;

        IF v_wallet_id IS NOT NULL AND v_member_record.stake_amount > 0 THEN
          UPDATE public.wallets
          SET escrow_locked = greatest(0, escrow_locked - v_member_record.stake_amount),
              total_lost = total_lost + v_member_record.stake_amount,
              updated_at = now()
          WHERE id = v_wallet_id;

          INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
          VALUES (v_wallet_id, v_oath.id, 'penalty', v_member_record.stake_amount, 'Lobby deadline missed; stake seized');
        END IF;

        UPDATE public.profiles
        SET oaths_failed = oaths_failed + 1,
            total_lost = total_lost + v_member_record.stake_amount,
            updated_at = now()
        WHERE id = v_member_record.user_id;
      END LOOP;

      IF NOT EXISTS (
        SELECT 1 FROM public.group_members
        WHERE oath_id = v_oath.id AND status = 'joined'
      ) THEN
        IF EXISTS (
          SELECT 1 FROM public.group_members
          WHERE oath_id = v_oath.id AND status = 'completed'
        ) THEN
          UPDATE public.oaths SET status = 'completed', updated_at = now() WHERE id = v_oath.id;
        ELSE
          UPDATE public.oaths SET status = 'failed', updated_at = now() WHERE id = v_oath.id;
        END IF;
      END IF;

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'resolved_expired_oaths', v_count,
    'timestamp', now()
  );
END;
$$;

-- Grant permissions to authenticated and anon
GRANT EXECUTE ON FUNCTION public.create_oath_with_stake(TEXT, TIMESTAMPTZ, public.oath_type, public.verification_method, public.consequence_type, NUMERIC, INT, INT, UUID, TEXT, TEXT, TEXT, TEXT, public.group_mode, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_squad(UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_duo_oath(UUID, UUID, TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.auto_resolve_expired_oaths() TO authenticated, anon;
