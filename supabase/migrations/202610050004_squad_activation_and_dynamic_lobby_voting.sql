-- Migration 202610050004: Squad Activation on All Members Accepted & Dynamic Quorum Voting for Lobbies

-- Drop previous signatures of create_oath_with_stake
DROP FUNCTION IF EXISTS public.create_oath_with_stake(TEXT, TIMESTAMPTZ, public.oath_type, public.verification_method, public.consequence_type, NUMERIC, INT, INT, UUID, TEXT, TEXT, TEXT, TEXT, public.group_mode, TEXT);
DROP FUNCTION IF EXISTS public.create_oath_with_stake(TEXT, TIMESTAMPTZ, public.oath_type, public.verification_method, public.consequence_type, NUMERIC, INT, INT, UUID, TEXT, TEXT, TEXT, TEXT, public.group_mode, UUID[], TEXT);
DROP FUNCTION IF EXISTS public.create_oath_with_stake(TEXT, TIMESTAMPTZ, public.oath_type, public.verification_method, public.consequence_type, NUMERIC, INT, INT, UUID, TEXT, TEXT, TEXT, TEXT, public.group_mode, TEXT, UUID[]);

-- 1. Update create_oath_with_stake to support p_opponent_ids for Squad Friends Invitations
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
    v_initial_status := 'pending'; -- Challenge will NOT start until opponent accepts
  ELSIF p_oath_type = 'squad' THEN
    IF p_opponent_ids IS NOT NULL AND array_length(p_opponent_ids, 1) > 0 THEN
      v_invited_count := array_length(p_opponent_ids, 1);
    END IF;
    -- Squad requires all invited friends + leader
    v_min_players := greatest(2, v_invited_count + 1);
    v_max_players := greatest(v_min_players, coalesce(p_max_players, 8));
    v_initial_status := 'pending'; -- Challenge will NOT start until ALL friends accept
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

    INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
    VALUES (v_wallet_id, v_oath_id, 'escrow_lock', v_total_stake, 'Stake locked in escrow');

    IF v_platform_fee > 0 THEN
      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_wallet_id, v_oath_id, 'house_cut', v_platform_fee, '10% Upfront Platform Protocol Fee');
    END IF;
  END IF;

  IF v_cadence = 'daily' THEN
    v_total_days := greatest(1, ceil(extract(epoch from (p_deadline - now())) / 86400.0)::int);
    v_daily_deadline := (date_trunc('day', now()) + interval '1 day');
  ELSE
    v_cadence := 'once';
    v_total_days := 1;
    v_daily_deadline := p_deadline;
  END IF;

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
    -- Creator is always 'joined'
    INSERT INTO public.group_members (oath_id, user_id, stake_amount, status, votes_needed, current_day, day_streak)
    VALUES (v_oath_id, v_user, p_stake_amount, 'joined', 1, 1, 0);

    -- For Duo: insert opponent as 'invited'
    IF p_oath_type = 'duo' AND p_opponent_id IS NOT NULL THEN
      INSERT INTO public.group_members (oath_id, user_id, stake_amount, status, votes_needed, current_day, day_streak)
      VALUES (v_oath_id, p_opponent_id, p_stake_amount, 'invited', 1, 1, 0)
      ON CONFLICT (oath_id, user_id) DO NOTHING;
    END IF;

    -- For Squad: insert all invited friends as 'invited'
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


-- 2. accept_duo_challenge: Starts timer & activates challenge AT ACCEPTANCE TIME
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
  v_new_deadline TIMESTAMPTZ;
  v_new_daily_deadline TIMESTAMPTZ;
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

  -- THE TIMER OFFICIALLY STARTS NOW!
  IF coalesce(v_oath.cadence, 'daily') = 'daily' THEN
    v_new_deadline := now() + (greatest(1, coalesce(v_oath.total_days, 1)) * interval '1 day');
    v_new_daily_deadline := (date_trunc('day', now()) + interval '1 day');
  ELSE
    v_new_deadline := now() + greatest(interval '1 day', (v_oath.deadline - v_oath.created_at));
    v_new_daily_deadline := v_new_deadline;
  END IF;

  UPDATE public.oaths 
  SET opponent_id = v_user, 
      status = 'active', 
      deadline = v_new_deadline,
      daily_deadline = v_new_daily_deadline,
      current_day = 1,
      current_streak = 0,
      created_at = now(),
      updated_at = now() 
  WHERE id = p_oath_id;
  
  -- Update opponent status to 'joined'
  INSERT INTO public.group_members (oath_id, user_id, stake_amount, status, votes_needed, current_day, day_streak)
  VALUES (p_oath_id, v_user, v_stake, 'joined', 1, 1, 0) 
  ON CONFLICT (oath_id, user_id) DO UPDATE SET status = 'joined', stake_amount = v_stake;

  -- Reset creator group_members state so both start at Day 1
  UPDATE public.group_members 
  SET current_day = 1, day_streak = 0, last_verified_at = NULL, proof_submitted = FALSE 
  WHERE oath_id = p_oath_id;

  UPDATE public.profiles 
  SET oaths_joined = coalesce(oaths_joined, 0) + 1, 
      total_staked = coalesce(total_staked, 0) + v_stake, 
      updated_at = now() 
  WHERE id = v_user;

  -- Notify creator that duel is now live
  INSERT INTO public.notifications (user_id, oath_id, type, title, message, status)
  VALUES (
    v_oath.creator_id, p_oath_id, 'system', 'Duo Duel is LIVE!',
    '@' || (SELECT username FROM public.profiles WHERE id = v_user) || ' accepted your challenge and locked their stake. Day 1 starts now!',
    'pending'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_duo_challenge(UUID) TO authenticated, anon;


-- 3. join_squad: Starts Squad Timer ONLY when ALL invited friends have accepted
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
  v_has_pending_invites BOOLEAN;
  v_new_deadline TIMESTAMPTZ;
  v_new_daily_deadline TIMESTAMPTZ;
  v_m RECORD;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT penalty_box_until INTO v_penalty_box FROM public.profiles WHERE id = v_user;
  IF v_penalty_box IS NOT NULL AND v_penalty_box > now() THEN
    RAISE EXCEPTION 'You are locked in The Penalty Box until % UTC for 3 consecutive oath failures. You cannot join lobbies or squads.', to_char(v_penalty_box, 'Mon DD, YYYY HH24:MI');
  END IF;

  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Challenge pool not found'; END IF;
  IF v_oath.status NOT IN ('pending', 'active') THEN 
    RAISE EXCEPTION 'Challenge pool is no longer accepting members (status: %)', v_oath.status; 
  END IF;

  IF EXISTS (SELECT 1 FROM public.group_members WHERE oath_id = p_oath_id AND user_id = v_user AND status = 'joined') THEN
    RAISE EXCEPTION 'You have already joined this challenge';
  END IF;

  SELECT count(*) INTO v_member_count FROM public.group_members WHERE oath_id = p_oath_id AND status = 'joined';
  v_max_players := coalesce(v_oath.max_players, 8);
  IF v_member_count >= v_max_players THEN RAISE EXCEPTION 'Challenge pool is full'; END IF;

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
  VALUES (p_oath_id, v_user, v_join_stake, 'joined', 1, 1, 0)
  ON CONFLICT (oath_id, user_id) 
  DO UPDATE SET status = 'joined', stake_amount = v_join_stake
  RETURNING id INTO v_member_id;

  -- Check if any invited friends are still pending acceptance
  SELECT EXISTS (
    SELECT 1 FROM public.group_members 
    WHERE oath_id = p_oath_id AND status = 'invited'
  ) INTO v_has_pending_invites;

  SELECT count(*) INTO v_member_count FROM public.group_members WHERE oath_id = p_oath_id AND status = 'joined';

  -- ACTIVATION LOGIC:
  -- Private Squad: Starts ONLY when ALL invited friends have accepted (no pending invites left, at least 2 joined)
  -- Public Lobby: Auto-activates when reaching min_players
  IF v_oath.status = 'pending' THEN
    IF v_oath.oath_type = 'squad' THEN
      IF NOT v_has_pending_invites AND v_member_count >= 2 THEN
        -- Squad is now 100% full/accepted! Timer starts now!
        IF coalesce(v_oath.cadence, 'daily') = 'daily' THEN
          v_new_deadline := now() + (greatest(1, coalesce(v_oath.total_days, 1)) * interval '1 day');
          v_new_daily_deadline := (date_trunc('day', now()) + interval '1 day');
        ELSE
          v_new_deadline := now() + greatest(interval '1 day', (v_oath.deadline - v_oath.created_at));
          v_new_daily_deadline := v_new_deadline;
        END IF;

        UPDATE public.oaths 
        SET status = 'active', 
            deadline = v_new_deadline,
            daily_deadline = v_new_daily_deadline,
            current_day = 1,
            current_streak = 0,
            created_at = now(),
            updated_at = now() 
        WHERE id = p_oath_id;

        -- Reset all members to Day 1
        UPDATE public.group_members 
        SET current_day = 1, day_streak = 0, last_verified_at = NULL, proof_submitted = FALSE 
        WHERE oath_id = p_oath_id;

        -- Notify all squad members that squad challenge is now live
        FOR v_m IN (SELECT user_id FROM public.group_members WHERE oath_id = p_oath_id AND status = 'joined') LOOP
          INSERT INTO public.notifications (user_id, oath_id, type, title, message, status)
          VALUES (
            v_m.user_id, p_oath_id, 'system', 'Squad Challenge is LIVE!',
            'All members have joined the squad! The challenge has officially started. Day 1 is active!',
            'pending'
          );
        END LOOP;
      END IF;

    ELSIF v_oath.oath_type = 'lobby' THEN
      v_min_players := coalesce(v_oath.min_players, 2);
      IF v_member_count >= v_min_players THEN
        v_new_daily_deadline := (date_trunc('day', now()) + interval '1 day');
        UPDATE public.oaths 
        SET status = 'active', daily_deadline = v_new_daily_deadline, updated_at = now() 
        WHERE id = p_oath_id;
      END IF;
    END IF;
  END IF;

  UPDATE public.profiles 
  SET oaths_joined = coalesce(oaths_joined, 0) + 1, 
      total_staked = coalesce(total_staked, 0) + v_join_stake, 
      updated_at = now() 
  WHERE id = v_user;

  RETURN v_member_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_squad(UUID, NUMERIC) TO authenticated, anon;


-- 4. cast_squad_vote: DYNAMIC QUORUM VOTING FOR LOBBIES & SQUADS
-- If x members in lobby, exactly (x - 1) other members' votes are needed to approve
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
  v_clean_note TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oath not found'; END IF;
  IF v_oath.status <> 'active' THEN RAISE EXCEPTION 'Lobby or squad is not active'; END IF;

  SELECT * INTO v_member FROM public.group_members WHERE id = p_member_id AND oath_id = p_oath_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found'; END IF;
  IF v_member.status <> 'joined' THEN RAISE EXCEPTION 'Member is not in active joined status'; END IF;

  -- Only fellow joined members can vote
  IF NOT EXISTS (SELECT 1 FROM public.group_members WHERE oath_id = p_oath_id AND user_id = v_user AND status = 'joined') THEN
    RAISE EXCEPTION 'Only active joined members can vote in this lobby';
  END IF;

  -- Submitter cannot vote on their own proof
  IF v_member.user_id = v_user AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'You cannot vote on your own proof';
  END IF;

  SELECT id INTO v_proof FROM public.proofs 
  WHERE oath_id = p_oath_id AND submitted_by = v_member.user_id 
  ORDER BY created_at DESC LIMIT 1;

  IF v_proof IS NULL THEN RAISE EXCEPTION 'No proof to vote on'; END IF;

  -- Record vote
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

  -- DYNAMIC QUORUM CALCULATION:
  -- All OTHER active joined members in this lobby/squad must vote
  -- 2 members -> 1 vote needed (the 1 other person)
  -- 3 members -> 2 votes needed (the 2 other people)
  -- 4 members -> 3 votes needed (the 3 other people)
  -- x members -> (x - 1) votes needed
  SELECT greatest(1, count(*)::int - 1) INTO v_other_voters
  FROM public.group_members
  WHERE oath_id = p_oath_id AND status = 'joined';

  v_needed := greatest(1, v_other_voters);

  -- Keep votes_needed updated on the record
  UPDATE public.group_members SET votes_needed = v_needed WHERE id = p_member_id;

  -- A. QUORUM APPROVAL THRESHOLD REACHED
  IF v_yes >= v_needed THEN
    -- Mark proof verified
    UPDATE public.proofs
    SET status = 'verified'::public.proof_status,
        reviewed_at = now(),
        review_note = 'Approved by quorum (' || v_yes || '/' || v_needed || ' votes)'
    WHERE id = v_proof;

    -- Dismiss verify notifications
    UPDATE public.notifications
    SET status = 'accepted'
    WHERE oath_id = p_oath_id AND proof_id = v_proof AND type = 'verify_proof';

    -- Clear votes for next day
    DELETE FROM public.votes WHERE proof_id = v_proof;

    IF coalesce(v_oath.cadence, 'daily') = 'daily' THEN
      -- Daily cadence: advance streak & day
      IF v_member.last_verified_at IS NULL OR date_trunc('day', v_member.last_verified_at) <> date_trunc('day', now()) THEN
        UPDATE public.group_members
        SET last_verified_day = current_day,
            day_streak = coalesce(day_streak, 0) + 1,
            current_day = coalesce(current_day, 1) + 1,
            last_verified_at = now(),
            proof_submitted = FALSE,
            votes_received = 0
        WHERE id = p_member_id
        RETURNING day_streak, current_day INTO v_new_streak, v_member.current_day;
      ELSE
        v_new_streak := coalesce(v_member.day_streak, 1);
        UPDATE public.group_members SET proof_submitted = FALSE, votes_received = 0 WHERE id = p_member_id;
      END IF;

      -- Check if member reached the end of their challenge
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

        -- Check if all members completed
        SELECT NOT EXISTS (SELECT 1 FROM public.group_members WHERE oath_id = p_oath_id AND status = 'joined') INTO v_all_members_completed;
        IF v_all_members_completed THEN
          UPDATE public.oaths SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = p_oath_id;
        END IF;
      END IF;

    ELSE
      -- Single deadline: Mark completed and release escrow
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

  -- B. QUORUM REJECTION (At least 1 rejection or majority)
  ELSIF v_no >= 1 THEN
    UPDATE public.proofs
    SET status = 'rejected'::public.proof_status,
        reviewed_at = now(),
        review_note = 'Rejected by quorum (' || v_no || ' reject votes)'
    WHERE id = v_proof;

    UPDATE public.group_members
    SET proof_submitted = FALSE, votes_received = 0
    WHERE id = p_member_id;

    -- Clear votes
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
