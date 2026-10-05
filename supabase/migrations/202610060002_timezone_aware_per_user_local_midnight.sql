-- Migration 202610060002: Per-User Local Midnight & Timezone Support
-- Implements real-world wall-clock midnight support:
-- 1. Adds timezone and daily_deadline to group_members and timezone to oaths
-- 2. Each participant in a challenge follows their own country's 12:00 AM local midnight
-- 3. Provides calculate_next_local_midnight(p_timezone, p_days_ahead) helper
-- 4. Updates create_oath_with_stake, accept_duo_challenge, join_squad, pass_today_work, cast_squad_vote

-- ============================================================
-- 1. ADD TIMEZONE & MEMBER DEADLINE COLUMNS
-- ============================================================
ALTER TABLE public.oaths
  ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'UTC';

ALTER TABLE public.group_members
  ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS daily_deadline TIMESTAMPTZ DEFAULT NULL;

-- ============================================================
-- 2. HELPER FUNCTION: calculate_next_local_midnight
-- ============================================================
CREATE OR REPLACE FUNCTION public.calculate_next_local_midnight(
  p_timezone TEXT DEFAULT NULL,
  p_days_ahead INT DEFAULT 1
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_tz TEXT := coalesce(nullif(trim(p_timezone), ''), 'UTC');
  v_interval INTERVAL := (greatest(1, p_days_ahead) || ' days')::INTERVAL;
BEGIN
  BEGIN
    RETURN (date_trunc('day', now() AT TIME ZONE v_tz) + v_interval) AT TIME ZONE v_tz;
  EXCEPTION WHEN OTHERS THEN
    RETURN (date_trunc('day', now()) + v_interval);
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_next_local_midnight(TEXT, INT) TO authenticated, anon;


-- ============================================================
-- 3. UPDATE create_oath_with_stake WITH TIMEZONE SUPPORT
-- ============================================================
DROP FUNCTION IF EXISTS public.create_oath_with_stake(TEXT, TIMESTAMPTZ, public.oath_type, public.verification_method, public.consequence_type, NUMERIC, INT, INT, UUID, TEXT, TEXT, TEXT, TEXT, public.group_mode, TEXT, UUID[]);
DROP FUNCTION IF EXISTS public.create_oath_with_stake(TEXT, TIMESTAMPTZ, public.oath_type, public.verification_method, public.consequence_type, NUMERIC, INT, INT, UUID, TEXT, TEXT, TEXT, TEXT, public.group_mode, TEXT, UUID[], TEXT, TIMESTAMPTZ);

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
  p_opponent_ids UUID[] DEFAULT NULL,
  p_timezone TEXT DEFAULT NULL,
  p_daily_deadline TIMESTAMPTZ DEFAULT NULL
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
  v_tz TEXT := coalesce(nullif(trim(p_timezone), ''), 'UTC');
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
    SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_user LIMIT 1;
  END IF;

  -- Calculate Cadence & Local Midnight Deadline
  IF v_cadence = 'daily' THEN
    v_total_days := greatest(1, ceil(extract(epoch from (p_deadline - now())) / 86400.0)::int);
    IF p_daily_deadline IS NOT NULL AND p_daily_deadline > now() THEN
      v_daily_deadline := p_daily_deadline;
    ELSE
      v_daily_deadline := public.calculate_next_local_midnight(v_tz, 1);
    END IF;
  ELSE
    v_cadence := 'once';
    v_total_days := 1;
    v_daily_deadline := p_deadline;
  END IF;

  -- 1. INSERT OATH FIRST
  INSERT INTO public.oaths (
    id, creator_id, oath_statement, deadline, oath_type, verification_method,
    consequence_type, stake_amount, status, min_players, max_players, opponent_id, group_mode,
    cadence, total_days, current_day, current_streak, daily_deadline, timezone
  ) VALUES (
    v_oath_id, v_user, p_oath_statement, p_deadline, p_oath_type, p_verification_method,
    p_consequence_type, p_stake_amount, v_initial_status,
    v_min_players, v_max_players, p_opponent_id, p_group_mode,
    v_cadence, v_total_days, 1, 0, v_daily_deadline, v_tz
  );

  -- 2. INSERT TRANSACTIONS
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
    INSERT INTO public.group_members (oath_id, user_id, stake_amount, status, votes_needed, current_day, day_streak, daily_deadline, timezone)
    VALUES (v_oath_id, v_user, p_stake_amount, 'joined', 1, 1, 0, v_daily_deadline, v_tz);

    IF p_oath_type = 'duo' AND p_opponent_id IS NOT NULL THEN
      INSERT INTO public.group_members (oath_id, user_id, stake_amount, status, votes_needed, current_day, day_streak, daily_deadline, timezone)
      VALUES (v_oath_id, p_opponent_id, p_stake_amount, 'invited', 1, 1, 0, NULL, 'UTC')
      ON CONFLICT (oath_id, user_id) DO NOTHING;
    END IF;

    IF p_oath_type = 'squad' AND p_opponent_ids IS NOT NULL AND array_length(p_opponent_ids, 1) > 0 THEN
      FOREACH v_friend_id IN ARRAY p_opponent_ids LOOP
        IF v_friend_id <> v_user THEN
          INSERT INTO public.group_members (oath_id, user_id, stake_amount, status, votes_needed, current_day, day_streak, daily_deadline, timezone)
          VALUES (v_oath_id, v_friend_id, p_stake_amount, 'invited', 1, 1, 0, NULL, 'UTC')
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
  NUMERIC, INT, INT, UUID, TEXT, TEXT, TEXT, TEXT, public.group_mode, TEXT, UUID[], TEXT, TIMESTAMPTZ
) TO authenticated, anon;


-- ============================================================
-- 4. UPDATE accept_duo_challenge WITH PER-USER TIMEZONE
-- ============================================================
DROP FUNCTION IF EXISTS public.accept_duo_challenge(UUID);
DROP FUNCTION IF EXISTS public.accept_duo_challenge(UUID, TEXT, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.accept_duo_challenge(
  p_oath_id UUID,
  p_timezone TEXT DEFAULT NULL,
  p_daily_deadline TIMESTAMPTZ DEFAULT NULL
) RETURNS VOID
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
  v_new_deadline TIMESTAMPTZ;
  v_creator_daily_deadline TIMESTAMPTZ;
  v_opponent_daily_deadline TIMESTAMPTZ;
  v_opp_tz TEXT := coalesce(nullif(trim(p_timezone), ''), 'UTC');
  v_creator_tz TEXT;
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

  v_stake := coalesce(v_oath.stake_amount, 0);
  v_fee := round(v_stake * 0.10, 2);
  v_total := v_stake + v_fee;

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

  v_creator_tz := coalesce(v_oath.timezone, 'UTC');

  -- Calculate deadlines in each user's local timezone
  IF coalesce(v_oath.cadence, 'daily') = 'daily' THEN
    v_new_deadline := now() + (greatest(1, coalesce(v_oath.total_days, 1)) * interval '1 day');
    v_creator_daily_deadline := public.calculate_next_local_midnight(v_creator_tz, 1);
    IF p_daily_deadline IS NOT NULL AND p_daily_deadline > now() THEN
      v_opponent_daily_deadline := p_daily_deadline;
    ELSE
      v_opponent_daily_deadline := public.calculate_next_local_midnight(v_opp_tz, 1);
    END IF;
  ELSE
    v_new_deadline := now() + greatest(interval '1 day', (v_oath.deadline - v_oath.created_at));
    v_creator_daily_deadline := v_new_deadline;
    v_opponent_daily_deadline := v_new_deadline;
  END IF;

  -- Activate oath
  UPDATE public.oaths 
  SET opponent_id = v_user, 
      status = 'active', 
      deadline = v_new_deadline,
      daily_deadline = v_creator_daily_deadline,
      current_day = 1,
      current_streak = 0,
      created_at = now(),
      updated_at = now() 
  WHERE id = p_oath_id;
  
  -- Update opponent's group_members record with opponent's personal local midnight
  INSERT INTO public.group_members (oath_id, user_id, stake_amount, status, votes_needed, current_day, day_streak, daily_deadline, timezone)
  VALUES (p_oath_id, v_user, v_stake, 'joined', 1, 1, 0, v_opponent_daily_deadline, v_opp_tz) 
  ON CONFLICT (oath_id, user_id) DO UPDATE 
  SET status = 'joined', 
      stake_amount = v_stake,
      daily_deadline = v_opponent_daily_deadline,
      timezone = v_opp_tz,
      updated_at = now();

  -- Reset creator group_members record with creator's personal local midnight
  UPDATE public.group_members 
  SET current_day = 1, 
      day_streak = 0, 
      last_verified_at = NULL, 
      proof_submitted = FALSE,
      daily_deadline = v_creator_daily_deadline,
      timezone = v_creator_tz,
      updated_at = now()
  WHERE oath_id = p_oath_id AND user_id = v_oath.creator_id;

  UPDATE public.profiles 
  SET oaths_joined = coalesce(oaths_joined, 0) + 1, 
      total_staked = coalesce(total_staked, 0) + v_stake, 
      updated_at = now() 
  WHERE id = v_user;

  INSERT INTO public.notifications (user_id, oath_id, type, title, message, status)
  VALUES (
    v_oath.creator_id, p_oath_id, 'system', 'Duo Duel is LIVE!',
    '@' || (SELECT username FROM public.profiles WHERE id = v_user) || ' accepted your challenge. Day 1 starts now in your local timezone!',
    'pending'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_duo_challenge(UUID, TEXT, TIMESTAMPTZ) TO authenticated, anon;


-- ============================================================
-- 5. UPDATE join_squad WITH PER-USER TIMEZONE
-- ============================================================
DROP FUNCTION IF EXISTS public.join_squad(UUID, NUMERIC);
DROP FUNCTION IF EXISTS public.join_squad(UUID, NUMERIC, TEXT, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.join_squad(
  p_oath_id UUID,
  p_stake_amount NUMERIC,
  p_timezone TEXT DEFAULT NULL,
  p_daily_deadline TIMESTAMPTZ DEFAULT NULL
) RETURNS UUID
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
  v_has_pending_invites BOOLEAN;
  v_new_deadline TIMESTAMPTZ;
  v_member_daily_deadline TIMESTAMPTZ;
  v_member_tz TEXT := coalesce(nullif(trim(p_timezone), ''), 'UTC');
  v_m RECORD;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT penalty_box_until INTO v_penalty_box FROM public.profiles WHERE id = v_user;
  IF v_penalty_box IS NOT NULL AND v_penalty_box > now() THEN
    RAISE EXCEPTION 'You are locked in The Penalty Box until % UTC for 3 consecutive oath failures. You cannot join lobbies or squads.', to_char(v_penalty_box, 'Mon DD, YYYY HH24:MI');
  END IF;

  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oath not found'; END IF;

  IF v_oath.oath_type NOT IN ('squad', 'lobby') THEN
    RAISE EXCEPTION 'This oath is not a squad or lobby';
  END IF;

  IF v_oath.status <> 'pending' AND v_oath.status <> 'active' THEN
    RAISE EXCEPTION 'This group challenge is no longer accepting new members';
  END IF;

  IF v_oath.deadline <= now() THEN
    RAISE EXCEPTION 'Group deadline has passed';
  END IF;

  -- Calculate member's personal daily deadline
  IF coalesce(v_oath.cadence, 'daily') = 'daily' THEN
    IF p_daily_deadline IS NOT NULL AND p_daily_deadline > now() THEN
      v_member_daily_deadline := p_daily_deadline;
    ELSE
      v_member_daily_deadline := public.calculate_next_local_midnight(v_member_tz, 1);
    END IF;
  ELSE
    v_member_daily_deadline := v_oath.deadline;
  END IF;

  v_join_stake := coalesce(p_stake_amount, v_oath.stake_amount, 0);
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
      RAISE EXCEPTION 'Insufficient balance to join. You need $% ($% stake + 10%% fee). Please deposit funds first.', v_total_deduction, v_join_stake;
    END IF;

    INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
    VALUES (v_wallet_id, p_oath_id, 'escrow_lock', v_join_stake, 'Group challenge buy-in locked in escrow');

    IF v_join_fee > 0 THEN
      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_wallet_id, p_oath_id, 'house_cut', v_join_fee, '10% Platform Protocol Fee (Group Join)');
    END IF;
  END IF;

  -- Upsert member record with their personal local midnight and timezone
  INSERT INTO public.group_members (oath_id, user_id, stake_amount, status, votes_needed, current_day, day_streak, daily_deadline, timezone)
  VALUES (p_oath_id, v_user, v_join_stake, 'joined', 1, 1, 0, v_member_daily_deadline, v_member_tz)
  ON CONFLICT (oath_id, user_id) DO UPDATE
  SET status = 'joined',
      stake_amount = v_join_stake,
      daily_deadline = v_member_daily_deadline,
      timezone = v_member_tz,
      updated_at = now()
  RETURNING id INTO v_member_id;

  UPDATE public.profiles
  SET oaths_joined = coalesce(oaths_joined, 0) + 1,
      total_staked = coalesce(total_staked, 0) + v_join_stake,
      updated_at = now()
  WHERE id = v_user;

  -- Check if group should activate
  SELECT count(*) INTO v_member_count FROM public.group_members WHERE oath_id = p_oath_id AND status = 'joined';

  IF v_oath.oath_type = 'squad' THEN
    SELECT EXISTS (SELECT 1 FROM public.group_members WHERE oath_id = p_oath_id AND status = 'invited') INTO v_has_pending_invites;
    IF NOT v_has_pending_invites AND v_member_count >= coalesce(v_oath.min_players, 2) THEN
      IF coalesce(v_oath.cadence, 'daily') = 'daily' THEN
        v_new_deadline := now() + (greatest(1, coalesce(v_oath.total_days, 1)) * interval '1 day');
      ELSE
        v_new_deadline := now() + greatest(interval '1 day', (v_oath.deadline - v_oath.created_at));
      END IF;

      UPDATE public.oaths
      SET status = 'active',
          deadline = v_new_deadline,
          current_day = 1,
          current_streak = 0,
          created_at = now(),
          updated_at = now()
      WHERE id = p_oath_id;
    END IF;

  ELSIF v_oath.oath_type = 'lobby' THEN
    IF v_oath.status = 'pending' AND v_member_count >= coalesce(v_oath.min_players, 2) THEN
      UPDATE public.oaths SET status = 'active', updated_at = now() WHERE id = p_oath_id;
    END IF;
  END IF;

  RETURN v_member_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_squad(UUID, NUMERIC, TEXT, TIMESTAMPTZ) TO authenticated, anon;


-- ============================================================
-- 6. UPDATE pass_today_work & cast_squad_vote WITH LOCAL MIDNIGHT ROLLING
-- ============================================================
DROP FUNCTION IF EXISTS public.pass_today_work(UUID, TEXT);
DROP FUNCTION IF EXISTS public.pass_today_work(UUID, TEXT, UUID);

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
  v_member public.group_members%ROWTYPE;
  v_reviewer_name TEXT;
  v_new_streak INT := 1;
  v_user_tz TEXT;
  v_next_midnight TIMESTAMPTZ;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

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

  IF p_proof_id IS NOT NULL THEN
    SELECT * INTO v_proof FROM public.proofs WHERE id = p_proof_id AND oath_id = p_oath_id FOR UPDATE;
  ELSE
    SELECT * INTO v_proof FROM public.proofs WHERE oath_id = p_oath_id AND status IN ('pending_review', 'needs_more_proof') ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending proof found to approve';
  END IF;

  v_clean_note := coalesce(nullif(trim(p_note), ''), 'Today''s work verified by referee');

  UPDATE public.proofs
  SET status = 'verified'::public.proof_status,
      reviewer_id = v_user,
      review_note = v_clean_note,
      reviewed_at = now()
  WHERE id = v_proof.id;

  UPDATE public.notifications
  SET status = 'accepted', updated_at = now()
  WHERE user_id = v_user AND oath_id = p_oath_id AND type = 'verify_proof' AND status = 'pending';

  UPDATE public.nominees
  SET verified = TRUE,
      verdict = 'success',
      verdict_note = v_clean_note,
      responded_at = now()
  WHERE oath_id = p_oath_id;

  -- PER-USER LOCAL MIDNIGHT ADVANCEMENT
  IF coalesce(v_oath.cadence, 'daily') = 'daily' THEN
    IF v_oath.total_days <= 1 AND v_oath.deadline > (now() + interval '24 hours') THEN
      v_oath.total_days := greatest(2, ceil(extract(epoch from (v_oath.deadline - v_oath.created_at)) / 86400.0)::int);
      UPDATE public.oaths SET total_days = v_oath.total_days WHERE id = p_oath_id;
    END IF;

    -- Update group member record
    SELECT * INTO v_member FROM public.group_members WHERE oath_id = p_oath_id AND user_id = v_proof.submitted_by FOR UPDATE;
    IF FOUND THEN
      v_user_tz := coalesce(v_member.timezone, v_oath.timezone, 'UTC');
      -- Advance to next local midnight
      v_next_midnight := public.calculate_next_local_midnight(v_user_tz, 1);

      IF v_member.last_verified_at IS NULL OR date_trunc('day', v_member.last_verified_at AT TIME ZONE v_user_tz) <> date_trunc('day', now() AT TIME ZONE v_user_tz) THEN
        UPDATE public.group_members
        SET last_verified_day = current_day,
            day_streak = coalesce(day_streak, 0) + 1,
            current_day = coalesce(current_day, 1) + 1,
            last_verified_at = now(),
            proof_submitted = TRUE,
            daily_deadline = v_next_midnight,
            updated_at = now()
        WHERE id = v_member.id
        RETURNING day_streak INTO v_new_streak;
      ELSE
        v_new_streak := coalesce(v_member.day_streak, 1);
        UPDATE public.group_members SET daily_deadline = v_next_midnight, updated_at = now() WHERE id = v_member.id;
      END IF;

      IF coalesce(v_member.current_day, 1) >= v_oath.total_days THEN
        v_is_final_day := TRUE;
      END IF;
    END IF;

    -- Solo oath level update
    v_user_tz := coalesce(v_oath.timezone, 'UTC');
    v_next_midnight := public.calculate_next_local_midnight(v_user_tz, 1);

    IF v_oath.last_verified_at IS NULL OR date_trunc('day', v_oath.last_verified_at AT TIME ZONE v_user_tz) <> date_trunc('day', now() AT TIME ZONE v_user_tz) THEN
      UPDATE public.oaths
      SET current_day = current_day + 1,
          current_streak = current_streak + 1,
          last_verified_at = now(),
          daily_deadline = v_next_midnight,
          updated_at = now()
      WHERE id = p_oath_id
      RETURNING current_streak INTO v_new_streak;
    ELSE
      UPDATE public.oaths SET daily_deadline = v_next_midnight, updated_at = now() WHERE id = p_oath_id;
    END IF;

    IF v_oath.current_day >= v_oath.total_days THEN
      v_is_final_day := TRUE;
    END IF;

  ELSE
    v_is_final_day := TRUE;
  END IF;

  SELECT username INTO v_reviewer_name FROM public.profiles WHERE id = v_user;

  INSERT INTO public.notifications (user_id, oath_id, proof_id, type, title, message, status)
  VALUES (
    v_proof.submitted_by,
    p_oath_id,
    v_proof.id,
    'system',
    'Day Proof Verified!',
    coalesce('@' || v_reviewer_name, 'Referee') || ' verified your proof! Streak is now ' || v_new_streak || '. Take a break until midnight.',
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

GRANT EXECUTE ON FUNCTION public.pass_today_work(UUID, TEXT, UUID) TO authenticated, anon;


-- ============================================================
-- 7. UPDATE cast_squad_vote WITH LOCAL MIDNIGHT ROLLING
-- ============================================================
DROP FUNCTION IF EXISTS public.cast_squad_vote(UUID, UUID, BOOLEAN);

CREATE OR REPLACE FUNCTION public.cast_squad_vote(
  p_oath_id UUID,
  p_member_id UUID,
  p_approve BOOLEAN
) RETURNS JSONB
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
  v_other_voters INT;
  v_target_wallet UUID;
  v_new_streak INT := 1;
  v_all_members_completed BOOLEAN;
  v_user_tz TEXT;
  v_next_midnight TIMESTAMPTZ;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oath not found'; END IF;
  IF v_oath.status <> 'active' THEN RAISE EXCEPTION 'Lobby or squad is not active'; END IF;

  SELECT * INTO v_member FROM public.group_members WHERE id = p_member_id AND oath_id = p_oath_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found'; END IF;
  IF v_member.status <> 'joined' THEN RAISE EXCEPTION 'Member is not in active joined status'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.group_members WHERE oath_id = p_oath_id AND user_id = v_user AND status = 'joined') THEN
    RAISE EXCEPTION 'Only active joined members can vote in this lobby';
  END IF;

  IF v_member.user_id = v_user AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'You cannot vote on your own proof';
  END IF;

  SELECT id INTO v_proof FROM public.proofs 
  WHERE oath_id = p_oath_id AND submitted_by = v_member.user_id 
  ORDER BY created_at DESC LIMIT 1;

  IF v_proof IS NULL THEN RAISE EXCEPTION 'No proof to vote on'; END IF;

  INSERT INTO public.votes (proof_id, voter_id, oath_id, vote)
  VALUES (v_proof, v_user, p_oath_id, p_approve)
  ON CONFLICT (proof_id, voter_id) DO UPDATE SET vote = p_approve;

  SELECT count(*) FILTER (WHERE vote = true),
         count(*) FILTER (WHERE vote = false)
  INTO v_yes, v_no
  FROM public.votes
  WHERE proof_id = v_proof;

  UPDATE public.group_members
  SET votes_received = v_yes
  WHERE id = p_member_id;

  SELECT greatest(1, count(*)::int - 1) INTO v_other_voters
  FROM public.group_members
  WHERE oath_id = p_oath_id AND status = 'joined';

  v_needed := greatest(1, v_other_voters);
  UPDATE public.group_members SET votes_needed = v_needed WHERE id = p_member_id;

  IF v_yes >= v_needed THEN
    UPDATE public.proofs
    SET status = 'verified'::public.proof_status,
        reviewed_at = now(),
        review_note = 'Approved by quorum (' || v_yes || '/' || v_needed || ' votes)'
    WHERE id = v_proof;

    UPDATE public.notifications
    SET status = 'accepted', updated_at = now()
    WHERE oath_id = p_oath_id AND proof_id = v_proof AND type = 'verify_proof';

    DELETE FROM public.votes WHERE proof_id = v_proof;

    v_user_tz := coalesce(v_member.timezone, v_oath.timezone, 'UTC');
    v_next_midnight := public.calculate_next_local_midnight(v_user_tz, 1);

    IF coalesce(v_oath.cadence, 'daily') = 'daily' THEN
      IF v_member.last_verified_at IS NULL OR date_trunc('day', v_member.last_verified_at AT TIME ZONE v_user_tz) <> date_trunc('day', now() AT TIME ZONE v_user_tz) THEN
        UPDATE public.group_members
        SET last_verified_day = current_day,
            day_streak = coalesce(day_streak, 0) + 1,
            current_day = coalesce(current_day, 1) + 1,
            last_verified_at = now(),
            proof_submitted = FALSE,
            votes_received = 0,
            daily_deadline = v_next_midnight,
            updated_at = now()
        WHERE id = p_member_id
        RETURNING day_streak, current_day INTO v_new_streak, v_member.current_day;
      ELSE
        v_new_streak := coalesce(v_member.day_streak, 1);
        UPDATE public.group_members SET proof_submitted = FALSE, votes_received = 0, daily_deadline = v_next_midnight, updated_at = now() WHERE id = p_member_id;
      END IF;

      IF coalesce(v_member.current_day, 1) > coalesce(v_oath.total_days, 1) THEN
        UPDATE public.group_members SET status = 'completed', is_winner = TRUE, updated_at = now() WHERE id = p_member_id;

        SELECT id INTO v_target_wallet FROM public.wallets WHERE user_id = v_member.user_id FOR UPDATE;
        IF v_target_wallet IS NOT NULL AND coalesce(v_member.stake_amount, v_oath.stake_amount, 0) > 0 THEN
          UPDATE public.wallets
          SET balance = balance + coalesce(v_member.stake_amount, v_oath.stake_amount, 0),
              escrow_locked = greatest(0, escrow_locked - coalesce(v_member.stake_amount, v_oath.stake_amount, 0)),
              updated_at = now()
          WHERE id = v_target_wallet;

          INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
          VALUES (v_target_wallet, p_oath_id, 'escrow_release', coalesce(v_member.stake_amount, v_oath.stake_amount, 0), 'Lobby member finished all days: Stake released');
        END IF;

        PERFORM public.handle_profile_success(v_member.user_id, 0);

        SELECT NOT EXISTS (SELECT 1 FROM public.group_members WHERE oath_id = p_oath_id AND status = 'joined') INTO v_all_members_completed;
        IF v_all_members_completed THEN
          UPDATE public.oaths SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = p_oath_id;
        END IF;
      END IF;

    ELSE
      UPDATE public.group_members SET status = 'completed', is_winner = TRUE, updated_at = now() WHERE id = p_member_id;

      SELECT id INTO v_target_wallet FROM public.wallets WHERE user_id = v_member.user_id FOR UPDATE;
      IF v_target_wallet IS NOT NULL AND coalesce(v_member.stake_amount, v_oath.stake_amount, 0) > 0 THEN
        UPDATE public.wallets
        SET balance = balance + coalesce(v_member.stake_amount, v_oath.stake_amount, 0),
            escrow_locked = greatest(0, escrow_locked - coalesce(v_member.stake_amount, v_oath.stake_amount, 0)),
            updated_at = now()
        WHERE id = v_target_wallet;

        INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
        VALUES (v_target_wallet, p_oath_id, 'escrow_release', coalesce(v_member.stake_amount, v_oath.stake_amount, 0), 'Proof approved by quorum: Buy-in returned');
      END IF;

      PERFORM public.handle_profile_success(v_member.user_id, 0);

      SELECT NOT EXISTS (SELECT 1 FROM public.group_members WHERE oath_id = p_oath_id AND status = 'joined') INTO v_all_members_completed;
      IF v_all_members_completed THEN
        UPDATE public.oaths SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = p_oath_id;
      END IF;
    END IF;

    INSERT INTO public.notifications (user_id, oath_id, proof_id, type, title, message, status)
    VALUES (
      v_member.user_id, p_oath_id, v_proof, 'system', 'Quorum Approved Your Proof!',
      'Quorum consensus reached (' || v_yes || '/' || v_needed || ' votes)! Proof approved.',
      'pending'
    );

    RETURN jsonb_build_object('success', true, 'verdict', 'approved', 'yes', v_yes, 'needed', v_needed);

  ELSIF v_no >= 1 THEN
    UPDATE public.proofs
    SET status = 'rejected'::public.proof_status,
        reviewed_at = now(),
        review_note = 'Rejected by quorum (' || v_no || ' reject votes)'
    WHERE id = v_proof;

    UPDATE public.group_members
    SET proof_submitted = FALSE, votes_received = 0, updated_at = now()
    WHERE id = p_member_id;

    DELETE FROM public.votes WHERE proof_id = v_proof;

    INSERT INTO public.notifications (user_id, oath_id, proof_id, type, title, message, status)
    VALUES (
      v_member.user_id, p_oath_id, v_proof, 'system', 'Proof Rejected by Quorum',
      'Your proof was rejected by quorum. Please upload revised proof before midnight (12:00 AM)!',
      'pending'
    );

    RETURN jsonb_build_object('success', true, 'verdict', 'rejected', 'no', v_no);
  END IF;

  RETURN jsonb_build_object('success', true, 'verdict', 'pending', 'yes', v_yes, 'no', v_no, 'needed', v_needed);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cast_squad_vote(UUID, UUID, BOOLEAN) TO authenticated, anon;


-- ============================================================
-- 8. TIMEZONE-AWARE auto_resolve_expired_oaths
-- ============================================================
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
  v_member_has_today BOOLEAN;
  v_creator_tz TEXT;
  v_opponent_tz TEXT;
  v_creator_deadline TIMESTAMPTZ;
  v_opponent_deadline TIMESTAMPTZ;
BEGIN
  -- A. DAILY CADENCE SWEEPER (Per-User Local Midnight)
  FOR v_oath IN (
    SELECT * FROM public.oaths
    WHERE status = 'active'
      AND cadence = 'daily'
    FOR UPDATE
  ) LOOP
    v_creator_tz := coalesce(v_oath.timezone, 'UTC');

    IF v_oath.oath_type = 'solo' THEN
      IF v_oath.daily_deadline IS NOT NULL AND v_oath.daily_deadline < now() THEN
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
          -- Advance daily deadline to next local midnight if oath still has days left
          IF v_oath.current_day < v_oath.total_days THEN
            UPDATE public.oaths
            SET daily_deadline = least(deadline, public.calculate_next_local_midnight(v_creator_tz, 1)),
                updated_at = now()
            WHERE id = v_oath.id;
          END IF;
        END IF;
      END IF;

    ELSIF v_oath.oath_type = 'duo' THEN
      -- In duo, check each participant against their own personal daily_deadline
      SELECT daily_deadline, timezone INTO v_creator_deadline, v_creator_tz
      FROM public.group_members WHERE oath_id = v_oath.id AND user_id = v_oath.creator_id;
      
      SELECT daily_deadline, timezone INTO v_opponent_deadline, v_opponent_tz
      FROM public.group_members WHERE oath_id = v_oath.id AND user_id = v_oath.opponent_id;

      IF v_creator_deadline IS NULL THEN v_creator_deadline := v_oath.daily_deadline; END IF;
      IF v_opponent_deadline IS NULL THEN v_opponent_deadline := v_oath.daily_deadline; END IF;

      -- Check if creator's deadline expired
      IF v_creator_deadline IS NOT NULL AND v_creator_deadline < now() THEN
        SELECT EXISTS (
          SELECT 1 FROM public.proofs
          WHERE oath_id = v_oath.id
            AND submitted_by = v_oath.creator_id
            AND status IN ('verified', 'pending_review')
            AND created_at >= (v_creator_deadline - interval '1 day')
        ) INTO v_creator_has_today;
      ELSE
        v_creator_has_today := TRUE;
      END IF;

      -- Check if opponent's deadline expired
      IF v_opponent_deadline IS NOT NULL AND v_opponent_deadline < now() THEN
        SELECT EXISTS (
          SELECT 1 FROM public.proofs
          WHERE oath_id = v_oath.id
            AND submitted_by = v_oath.opponent_id
            AND status IN ('verified', 'pending_review')
            AND created_at >= (v_opponent_deadline - interval '1 day')
        ) INTO v_opponent_has_today;
      ELSE
        v_opponent_has_today := TRUE;
      END IF;

      IF v_creator_deadline < now() AND NOT v_creator_has_today AND (v_opponent_deadline >= now() OR v_opponent_has_today) THEN
        -- Creator failed! Opponent wins duel
        PERFORM public.settle_duo_oath(v_oath.id, v_oath.opponent_id);
        v_count := v_count + 1;
      ELSIF v_opponent_deadline < now() AND NOT v_opponent_has_today AND (v_creator_deadline >= now() OR v_creator_has_today) THEN
        -- Opponent failed! Creator wins duel
        PERFORM public.settle_duo_oath(v_oath.id, v_oath.creator_id);
        v_count := v_count + 1;
      ELSIF v_creator_deadline < now() AND NOT v_creator_has_today AND v_opponent_deadline < now() AND NOT v_opponent_has_today THEN
        -- Both failed!
        v_stake := coalesce(v_oath.stake_amount, 0);
        IF v_stake > 0 THEN
          UPDATE public.wallets SET escrow_locked = greatest(0, escrow_locked - v_stake), updated_at = now()
          WHERE user_id = v_oath.creator_id RETURNING id INTO v_wallet_id;
          IF v_wallet_id IS NOT NULL THEN
            INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
            VALUES (v_wallet_id, v_oath.id, 'penalty', v_stake, 'Duo duel expired: Daily proof missed');
          END IF;

          IF v_oath.opponent_id IS NOT NULL THEN
            UPDATE public.wallets SET escrow_locked = greatest(0, escrow_locked - v_stake), updated_at = now()
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
      ELSE
        -- Update expired deadlines for those who submitted
        IF v_creator_deadline < now() AND v_creator_has_today THEN
          UPDATE public.group_members
          SET daily_deadline = least(v_oath.deadline, public.calculate_next_local_midnight(coalesce(v_creator_tz, 'UTC'), 1)), updated_at = now()
          WHERE oath_id = v_oath.id AND user_id = v_oath.creator_id;
        END IF;
        IF v_opponent_deadline < now() AND v_opponent_has_today THEN
          UPDATE public.group_members
          SET daily_deadline = least(v_oath.deadline, public.calculate_next_local_midnight(coalesce(v_opponent_tz, 'UTC'), 1)), updated_at = now()
          WHERE oath_id = v_oath.id AND user_id = v_oath.opponent_id;
        END IF;
      END IF;

    ELSIF v_oath.oath_type IN ('squad', 'lobby') THEN
      IF v_oath.group_mode = 'weakest_link' THEN
        -- Check if any member whose deadline passed missed today
        FOR v_member IN (SELECT * FROM public.group_members WHERE oath_id = v_oath.id AND status = 'joined') LOOP
          IF v_member.daily_deadline IS NOT NULL AND v_member.daily_deadline < now() THEN
            SELECT EXISTS (
              SELECT 1 FROM public.proofs
              WHERE oath_id = v_oath.id
                AND submitted_by = v_member.user_id
                AND status IN ('verified', 'pending_review')
                AND created_at >= (v_member.daily_deadline - interval '1 day')
            ) INTO v_member_has_today;

            IF NOT v_member_has_today THEN
              PERFORM public.forfeit_weakest_link_squad(v_oath.id, v_member.user_id, 'Member missed daily proof deadline');
              v_count := v_count + 1;
              EXIT;
            ELSE
              UPDATE public.group_members
              SET daily_deadline = least(v_oath.deadline, public.calculate_next_local_midnight(coalesce(v_member.timezone, 'UTC'), 1)), updated_at = now()
              WHERE id = v_member.id;
            END IF;
          END IF;
        END LOOP;
      ELSE
        -- Survival mode: eliminate individual members whose own deadline expired without proof
        FOR v_member IN (SELECT * FROM public.group_members WHERE oath_id = v_oath.id AND status = 'joined') LOOP
          IF v_member.daily_deadline IS NOT NULL AND v_member.daily_deadline < now() THEN
            SELECT EXISTS (
              SELECT 1 FROM public.proofs
              WHERE oath_id = v_oath.id
                AND submitted_by = v_member.user_id
                AND status IN ('verified', 'pending_review')
                AND created_at >= (v_member.daily_deadline - interval '1 day')
            ) INTO v_member_has_today;

            IF NOT v_member_has_today THEN
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
            ELSE
              UPDATE public.group_members
              SET daily_deadline = least(v_oath.deadline, public.calculate_next_local_midnight(coalesce(v_member.timezone, 'UTC'), 1)), updated_at = now()
              WHERE id = v_member.id;
            END IF;
          END IF;
        END LOOP;

        IF NOT EXISTS (SELECT 1 FROM public.group_members WHERE oath_id = v_oath.id AND status = 'joined') THEN
          UPDATE public.oaths SET status = 'failed', updated_at = now() WHERE id = v_oath.id;
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

