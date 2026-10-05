-- Migration 202610050005: Fix FK violation in create_oath_with_stake
-- Root cause: transactions were inserted BEFORE the oath row existed,
-- violating fk_transactions_oath (REFERENCES oaths(id)).
-- Fix: reorder so oath INSERT happens first, then transactions.

DROP FUNCTION IF EXISTS public.create_oath_with_stake(TEXT, TIMESTAMPTZ, public.oath_type, public.verification_method, public.consequence_type, NUMERIC, INT, INT, UUID, TEXT, TEXT, TEXT, TEXT, public.group_mode, TEXT, UUID[]);

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
  p_cadence TEXT DEFAULT 'daily',
  p_opponent_ids UUID[] DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_wallet_id UUID;
  v_oath_id UUID := gen_random_uuid();
  v_total_stake NUMERIC;
  v_platform_fee NUMERIC;
  v_total_deduction NUMERIC;
  v_min_players INT;
  v_max_players INT;
  v_nominee_user_id UUID;
  v_initial_status public.oath_status;
  v_cadence TEXT := coalesce(nullif(trim(p_cadence), ''), 'daily');
  v_total_days INT := 1;
  v_daily_deadline TIMESTAMPTZ;
  v_penalty_box TIMESTAMPTZ;
  v_friend_id UUID;
  v_invited_count INT := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT penalty_box_until INTO v_penalty_box FROM public.profiles WHERE id = v_user;
  IF v_penalty_box IS NOT NULL AND v_penalty_box > now() THEN
    RAISE EXCEPTION 'You are locked in The Penalty Box until % UTC for 3 consecutive oath failures. You cannot create oaths.', to_char(v_penalty_box, 'Mon DD, YYYY HH24:MI');
  END IF;

  IF length(trim(p_oath_statement)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Statement must be 1–500 chars'; END IF;
  IF p_deadline <= now() THEN RAISE EXCEPTION 'Deadline must be in the future'; END IF;
  IF p_stake_amount < 0 THEN RAISE EXCEPTION 'Stake amount cannot be negative'; END IF;

  IF p_oath_type = 'duo' AND p_opponent_id IS NOT NULL AND p_opponent_id = v_user THEN
    RAISE EXCEPTION 'You cannot challenge yourself';
  END IF;

  IF p_verification_method = 'nominee' AND coalesce(trim(p_nominee_email), '') = '' THEN
    RAISE EXCEPTION 'Nominee verification requires a nominee email or username';
  END IF;

  IF p_consequence_type = 'social_ransom' AND (coalesce(trim(p_social_phone), '') = '' OR coalesce(trim(p_social_msg), '') = '') THEN
    RAISE EXCEPTION 'Social ransom requires both phone and message';
  END IF;

  IF p_oath_type IN ('duo', 'squad') AND p_group_mode IS NULL THEN
    p_group_mode := 'survival';
  END IF;

  -- 1x Stake + 10% fee upfront
  v_total_stake := p_stake_amount;

  IF p_oath_type = 'duo' THEN
    v_min_players := 2;
    v_max_players := 2;
    v_initial_status := 'pending';
  ELSIF p_oath_type = 'squad' THEN
    IF p_opponent_ids IS NOT NULL AND array_length(p_opponent_ids, 1) > 0 THEN
      v_invited_count := array_length(p_opponent_ids, 1);
    END IF;
    v_min_players := greatest(2, v_invited_count + 1);
    v_max_players := greatest(v_min_players, coalesce(p_max_players, 8));
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

  v_platform_fee := round(v_total_stake * 0.10, 2);
  v_total_deduction := v_total_stake + v_platform_fee;

  -- Deduct balance and lock escrow first (get wallet_id)
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
  ELSE
    -- No financial stake — still need wallet_id for any later use
    SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_user LIMIT 1;
  END IF;

  -- Compute cadence/deadline BEFORE inserting oath
  IF v_cadence = 'daily' THEN
    v_total_days := greatest(1, ceil(extract(epoch from (p_deadline - now())) / 86400.0)::int);
    v_daily_deadline := (date_trunc('day', now()) + interval '1 day');
  ELSE
    v_cadence := 'once';
    v_total_days := 1;
    v_daily_deadline := p_deadline;
  END IF;

  -- *** INSERT OATH FIRST so FK on transactions is satisfied ***
  INSERT INTO public.oaths (
    id, creator_id, oath_statement, deadline, oath_type, verification_method,
    consequence_type, stake_amount, status, min_players, max_players, opponent_id, group_mode,
    cadence, total_days, current_day, current_streak, daily_deadline
  ) VALUES (
    v_oath_id, v_user, p_oath_statement, p_deadline, p_oath_type, p_verification_method,
    p_consequence_type, p_stake_amount, v_initial_status,
    v_min_players, v_max_players, p_opponent_id, p_group_mode,
    v_cadence, v_total_days, 1, 0, v_daily_deadline
  );

  -- *** NOW insert transactions (oath row exists, FK satisfied) ***
  IF v_total_deduction > 0 AND v_wallet_id IS NOT NULL THEN
    INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
    VALUES (v_wallet_id, v_oath_id, 'escrow_lock', v_total_stake, 'Stake locked in escrow');

    IF v_platform_fee > 0 THEN
      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_wallet_id, v_oath_id, 'house_cut', v_platform_fee, '10% Upfront Platform Protocol Fee');
    END IF;
  END IF;

  IF coalesce(p_social_phone, '') <> '' OR coalesce(p_social_msg, '') <> '' OR coalesce(p_nominee_email, '') <> '' OR coalesce(p_anti_charity_cause, '') <> '' THEN
    INSERT INTO public.oath_private_details (oath_id, social_ransom_phone, social_ransom_message, nominee_email, anti_charity_cause)
    VALUES (v_oath_id, p_social_phone, p_social_msg, p_nominee_email, p_anti_charity_cause);
  END IF;

  IF p_verification_method = 'nominee' AND coalesce(trim(p_nominee_email), '') <> '' THEN
    SELECT p.id INTO v_nominee_user_id
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    WHERE lower(p.username) = lower(ltrim(trim(p_nominee_email), '@'))
       OR lower(u.email) = lower(trim(p_nominee_email))
    LIMIT 1;

    INSERT INTO public.nominees (oath_id, email, nominee_user_id, verification_token)
    VALUES (v_oath_id, trim(p_nominee_email), v_nominee_user_id, gen_random_uuid());
  END IF;

  IF p_oath_type IN ('squad', 'duo', 'lobby') THEN
    INSERT INTO public.group_members (oath_id, user_id, stake_amount, status, votes_needed, current_day, day_streak)
    VALUES (v_oath_id, v_user, p_stake_amount, 'joined', 1, 1, 0);

    IF p_oath_type = 'duo' AND p_opponent_id IS NOT NULL THEN
      INSERT INTO public.group_members (oath_id, user_id, stake_amount, status, votes_needed, current_day, day_streak)
      VALUES (v_oath_id, p_opponent_id, p_stake_amount, 'invited', 1, 1, 0)
      ON CONFLICT (oath_id, user_id) DO NOTHING;
    END IF;

    IF p_oath_type = 'squad' AND p_opponent_ids IS NOT NULL AND array_length(p_opponent_ids, 1) > 0 THEN
      FOREACH v_friend_id IN ARRAY p_opponent_ids LOOP
        IF v_friend_id <> v_user THEN
          INSERT INTO public.group_members (oath_id, user_id, stake_amount, status, votes_needed, current_day, day_streak)
          VALUES (v_oath_id, v_friend_id, p_stake_amount, 'invited', 1, 1, 0)
          ON CONFLICT (oath_id, user_id) DO NOTHING;
        END IF;
      END LOOP;
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

GRANT EXECUTE ON FUNCTION public.create_oath_with_stake(
  TEXT, TIMESTAMPTZ, public.oath_type, public.verification_method, public.consequence_type,
  NUMERIC, INT, INT, UUID, TEXT, TEXT, TEXT, TEXT, public.group_mode, TEXT, UUID[]
) TO authenticated, anon;
