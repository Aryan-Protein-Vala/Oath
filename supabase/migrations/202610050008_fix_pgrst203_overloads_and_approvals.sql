-- Migration 202610050008: Eliminate PGRST203 ambiguous overloads and harden approval/rejection flows
-- Root Causes Fixed:
-- 1. PostgREST PGRST203 on create_oath_with_stake due to multiple overloads with differing parameter orders/counts.
-- 2. PostgREST PGRST203 on pass_today_work due to coexistence of (UUID, TEXT) and (UUID, TEXT, UUID).
-- 3. Resilient nominee permission matching (email, username, @username) in settle_oath and request_more_proof.
-- 4. Unified signature for request_more_proof(p_oath_id, p_note, p_proof_id).
-- 5. Support forfeit_squad_member with optional p_member_id.

-- ============================================================
-- 1. CLEAN DROP ALL OLD OVERLOADS OF create_oath_with_stake
-- ============================================================
DROP FUNCTION IF EXISTS public.create_oath_with_stake(TEXT, TIMESTAMPTZ, public.oath_type, public.verification_method, public.consequence_type, NUMERIC, INT, INT, UUID, TEXT, TEXT, TEXT, TEXT, public.group_mode, UUID[]);
DROP FUNCTION IF EXISTS public.create_oath_with_stake(TEXT, TIMESTAMPTZ, public.oath_type, public.verification_method, public.consequence_type, NUMERIC, INT, INT, UUID, TEXT, TEXT, TEXT, TEXT, public.group_mode, TEXT, UUID[]);
DROP FUNCTION IF EXISTS public.create_oath_with_stake(TEXT, TIMESTAMPTZ, public.oath_type, public.verification_method, public.consequence_type, NUMERIC, INT, INT, UUID, TEXT, TEXT, TEXT, TEXT, public.group_mode, UUID[], TEXT);
DROP FUNCTION IF EXISTS public.create_oath_with_stake(TEXT, TIMESTAMPTZ, public.oath_type, public.verification_method, public.consequence_type, NUMERIC, INT, INT, UUID, TEXT, TEXT, TEXT, TEXT, public.group_mode, TEXT);
DROP FUNCTION IF EXISTS public.create_oath_with_stake(TEXT, TIMESTAMPTZ, public.oath_type, public.verification_method, public.consequence_type, NUMERIC, INT, INT, UUID, TEXT, TEXT, TEXT, TEXT, public.group_mode);
DROP FUNCTION IF EXISTS public.create_oath_with_stake(TEXT, TIMESTAMPTZ, public.oath_type, public.verification_method, public.consequence_type, NUMERIC, INT, INT, UUID, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.create_oath_with_stake(TEXT, TIMESTAMPTZ, public.oath_type, public.verification_method, public.consequence_type, NUMERIC, TEXT, TEXT, TEXT, INTEGER, INTEGER, UUID);
DROP FUNCTION IF EXISTS public.create_oath_with_stake(TEXT, TIMESTAMPTZ, public.oath_type, public.verification_method, public.consequence_type, NUMERIC, INT, INT, UUID, TEXT, TEXT, TEXT, TEXT, public.group_mode, TEXT, UUID[]);

-- Single canonical create_oath_with_stake
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

  -- Deduct balance and lock escrow
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

  -- Compute cadence/deadline BEFORE inserting oath
  IF v_cadence = 'daily' THEN
    v_total_days := greatest(1, ceil(extract(epoch from (p_deadline - now())) / 86400.0)::int);
    v_daily_deadline := (date_trunc('day', now()) + interval '1 day');
  ELSE
    v_cadence := 'once';
    v_total_days := 1;
    v_daily_deadline := p_deadline;
  END IF;

  -- 1. INSERT OATH FIRST (so FK on transactions is valid)
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


-- ============================================================
-- 2. CLEAN DROP ALL OLD OVERLOADS OF pass_today_work
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
  v_submitter_wallet UUID;
  v_release NUMERIC;
  v_member public.group_members%ROWTYPE;
  v_reviewer_name TEXT;
  v_new_streak INT := 1;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oath not found'; END IF;
  IF v_oath.status <> 'active' THEN RAISE EXCEPTION 'Oath is not active'; END IF;

  -- Resilient role verification (checks creator, opponent, nominee by id/email/username, group member, admin)
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

  -- Check cadence & streak
  IF coalesce(v_oath.cadence, 'daily') = 'daily' THEN
    IF v_oath.total_days <= 1 AND v_oath.deadline > (now() + interval '24 hours') THEN
      v_oath.total_days := greatest(2, ceil(extract(epoch from (v_oath.deadline - v_oath.created_at)) / 86400.0)::int);
      UPDATE public.oaths SET total_days = v_oath.total_days WHERE id = p_oath_id;
    END IF;

    -- Update member record for submitter
    SELECT * INTO v_member FROM public.group_members WHERE oath_id = p_oath_id AND user_id = v_proof.submitted_by FOR UPDATE;
    IF FOUND THEN
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

    -- Solo oath level update
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

GRANT EXECUTE ON FUNCTION public.pass_today_work(UUID, TEXT, UUID) TO authenticated, anon;


-- ============================================================
-- 3. CLEAN DROP ALL OLD OVERLOADS OF reject_proof
-- ============================================================
DROP FUNCTION IF EXISTS public.reject_proof(UUID, UUID, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.reject_proof(UUID, TEXT);

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
  v_reviewer_name TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oath not found'; END IF;

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
    RAISE EXCEPTION 'No pending proof found to reject';
  END IF;

  v_clean_reason := coalesce(nullif(trim(p_reason), ''), 'Proof was rejected by reviewer');

  UPDATE public.proofs
  SET status = 'rejected'::public.proof_status,
      reviewer_id = v_user,
      review_note = v_clean_reason,
      reviewed_at = now()
  WHERE id = v_proof.id;

  UPDATE public.nominees
  SET verified = TRUE,
      verdict = 'penalty',
      verdict_note = v_clean_reason,
      responded_at = now()
  WHERE oath_id = p_oath_id;

  UPDATE public.notifications
  SET status = 'accepted', updated_at = now()
  WHERE user_id = v_user AND oath_id = p_oath_id AND type = 'verify_proof' AND status = 'pending';

  UPDATE public.group_members
  SET proof_submitted = FALSE
  WHERE oath_id = p_oath_id AND user_id = v_proof.submitted_by;

  SELECT username INTO v_reviewer_name FROM public.profiles WHERE id = v_user;

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

  IF coalesce(v_oath.cadence, 'daily') <> 'daily' OR p_fail_oath THEN
    IF v_oath.oath_type = 'duo' THEN
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

GRANT EXECUTE ON FUNCTION public.reject_proof(UUID, UUID, TEXT, BOOLEAN) TO authenticated, anon;


-- ============================================================
-- 4. CLEAN DROP AND UNIFY request_more_proof
-- ============================================================
DROP FUNCTION IF EXISTS public.request_more_proof(UUID, TEXT);
DROP FUNCTION IF EXISTS public.request_more_proof(UUID, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.request_more_proof(
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
  v_clean_note TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oath not found'; END IF;

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
    SELECT * INTO v_proof FROM public.proofs WHERE oath_id = p_oath_id AND status = 'pending_review' ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending proof found to request changes for';
  END IF;

  v_clean_note := coalesce(nullif(trim(p_note), ''), 'Reviewer requested clearer evidence (better lighting, timestamp, or angle).');

  UPDATE public.proofs
  SET status = 'needs_more_proof'::public.proof_status,
      reviewer_id = v_user,
      review_note = v_clean_note,
      reviewed_at = now()
  WHERE id = v_proof.id;

  UPDATE public.group_members
  SET proof_submitted = FALSE
  WHERE oath_id = p_oath_id AND user_id = v_proof.submitted_by;

  INSERT INTO public.messages (oath_id, sender_id, content, type, proof_id)
  VALUES (
    p_oath_id,
    v_user,
    '⚠️ Need More Proof: ' || v_clean_note,
    'text',
    v_proof.id
  );

  INSERT INTO public.notifications (user_id, oath_id, proof_id, type, title, message, status)
  VALUES (
    v_proof.submitted_by,
    p_oath_id,
    v_proof.id,
    'system',
    'Action Required: More Proof Needed',
    'Reviewer requested clearer proof: ' || left(v_clean_note, 120),
    'pending'
  );

  RETURN jsonb_build_object('success', true, 'proof_id', v_proof.id, 'status', 'needs_more_proof');
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_more_proof(UUID, TEXT, UUID) TO authenticated, anon;


-- ============================================================
-- 5. RESILIENT settle_oath WITH COMPREHENSIVE NOMINEE CHECK
-- ============================================================
CREATE OR REPLACE FUNCTION public.settle_oath(p_oath_id UUID, p_outcome TEXT) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_oath public.oaths%ROWTYPE;
  v_creator_wallet UUID;
  v_opponent_wallet UUID;
  v_total_pot NUMERIC;
  v_cut NUMERIC;
  v_payout NUMERIC;
  v_is_nominee BOOLEAN := FALSE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND OR (v_oath.status <> 'active' AND v_oath.status::text <> 'in_review') THEN 
    RAISE EXCEPTION 'Oath is not active (current: %)', v_oath.status; 
  END IF;

  IF v_oath.oath_type = 'duo' THEN
    IF v_user NOT IN (v_oath.creator_id, coalesce(v_oath.opponent_id, '00000000-0000-0000-0000-000000000000'::uuid))
       AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'Only the assigned verifier can settle this challenge';
    END IF;

    v_total_pot := coalesce(v_oath.stake_amount, 0) * 2;
    v_cut := round((v_total_pot * coalesce(v_oath.house_cut_percent, 10)) / 100, 2);
    v_payout := v_total_pot - v_cut;

    SELECT id INTO v_creator_wallet FROM public.wallets WHERE user_id = v_oath.creator_id FOR UPDATE;
    IF v_oath.opponent_id IS NOT NULL THEN
      SELECT id INTO v_opponent_wallet FROM public.wallets WHERE user_id = v_oath.opponent_id FOR UPDATE;
    END IF;

    IF v_total_pot > 0 AND v_creator_wallet IS NOT NULL THEN
      UPDATE public.wallets 
      SET escrow_locked = greatest(0, escrow_locked - v_total_pot), updated_at = now()
      WHERE id = v_creator_wallet;
    END IF;

    IF p_outcome = 'creator_won' THEN
      IF v_creator_wallet IS NOT NULL THEN
        IF coalesce(v_payout, 0) > 0 THEN
          UPDATE public.wallets 
          SET balance = balance + v_payout, 
              total_won = coalesce(total_won, 0) + (v_payout - coalesce(v_oath.stake_amount, 0)), 
              updated_at = now() 
          WHERE id = v_creator_wallet;

          INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description) 
          VALUES (v_creator_wallet, p_oath_id, 'reward', v_payout, 'Won Duo Challenge');
        END IF;

        IF coalesce(v_cut, 0) > 0 THEN
          INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description) 
          VALUES (v_creator_wallet, p_oath_id, 'house_cut', v_cut, 'Platform fee (Duo Challenge)');
        END IF;
      END IF;

      PERFORM public.handle_profile_success(v_oath.creator_id, CASE WHEN coalesce(v_payout, 0) > coalesce(v_oath.stake_amount, 0) THEN v_payout - v_oath.stake_amount ELSE 0 END);
      IF v_oath.opponent_id IS NOT NULL THEN
        PERFORM public.handle_profile_failure(v_oath.opponent_id, coalesce(v_oath.stake_amount, 0), p_oath_id);
      END IF;
      
      UPDATE public.oaths SET status = 'completed', updated_at = now() WHERE id = p_oath_id;
      UPDATE public.group_members SET status = CASE WHEN user_id = v_oath.creator_id THEN 'completed' ELSE 'failed' END, updated_at = now() WHERE oath_id = p_oath_id;

    ELSIF p_outcome = 'opponent_won' AND v_opponent_wallet IS NOT NULL THEN
      IF coalesce(v_payout, 0) > 0 THEN
        UPDATE public.wallets 
        SET balance = balance + v_payout, 
            total_won = coalesce(total_won, 0) + v_payout, 
            updated_at = now() 
        WHERE id = v_opponent_wallet;

        INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description) 
        VALUES (v_opponent_wallet, p_oath_id, 'reward', v_payout, 'Won Duo Challenge');
      END IF;

      IF v_creator_wallet IS NOT NULL THEN
        IF coalesce(v_total_pot, 0) > 0 THEN
          UPDATE public.wallets 
          SET total_lost = coalesce(total_lost, 0) + v_total_pot, 
              updated_at = now() 
          WHERE id = v_creator_wallet;

          INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description) 
          VALUES (v_creator_wallet, p_oath_id, 'penalty', v_total_pot, 'Lost Duo Challenge');
        END IF;

        IF coalesce(v_cut, 0) > 0 THEN
          INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description) 
          VALUES (v_creator_wallet, p_oath_id, 'house_cut', v_cut, 'Platform fee (Duo Challenge)');
        END IF;
      END IF;

      IF v_oath.opponent_id IS NOT NULL THEN
        PERFORM public.handle_profile_success(v_oath.opponent_id, v_payout);
      END IF;
      PERFORM public.handle_profile_failure(v_oath.creator_id, v_total_pot, p_oath_id);

      UPDATE public.oaths SET status = 'completed', updated_at = now() WHERE id = p_oath_id;
      UPDATE public.group_members SET status = CASE WHEN user_id = v_oath.opponent_id THEN 'completed' ELSE 'failed' END, updated_at = now() WHERE oath_id = p_oath_id;

    ELSE
      -- Mutual failure / forfeiture
      IF v_creator_wallet IS NOT NULL AND coalesce(v_total_pot, 0) > 0 THEN
        UPDATE public.wallets 
        SET total_lost = coalesce(total_lost, 0) + v_total_pot, 
            updated_at = now() 
        WHERE id = v_creator_wallet;

        INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description) 
        VALUES (v_creator_wallet, p_oath_id, 'penalty', v_total_pot, 'Duo challenge mutual failure');
      END IF;

      PERFORM public.handle_profile_failure(v_oath.creator_id, v_total_pot, p_oath_id);
      IF v_oath.opponent_id IS NOT NULL THEN
        PERFORM public.handle_profile_failure(v_oath.opponent_id, coalesce(v_oath.stake_amount, 0), p_oath_id);
      END IF;

      UPDATE public.oaths SET status = 'failed', updated_at = now() WHERE id = p_oath_id;
      UPDATE public.group_members SET status = 'failed', updated_at = now() WHERE oath_id = p_oath_id;
    END IF;

    UPDATE public.proofs
    SET status = CASE 
          WHEN p_outcome = 'creator_won' AND submitted_by = v_oath.creator_id THEN 'verified'::public.proof_status
          WHEN p_outcome = 'opponent_won' AND submitted_by = v_oath.opponent_id THEN 'verified'::public.proof_status
          ELSE 'rejected'::public.proof_status
        END,
        reviewer_id = v_user,
        reviewed_at = now()
    WHERE oath_id = p_oath_id AND status IN ('pending_review', 'needs_more_proof');

  ELSIF v_oath.oath_type = 'solo' THEN
    SELECT EXISTS (
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
    ) INTO v_is_nominee;

    IF v_oath.creator_id <> v_user AND NOT v_is_nominee AND NOT public.is_admin() THEN 
      RAISE EXCEPTION 'Not authorized'; 
    END IF;

    SELECT id INTO v_creator_wallet FROM public.wallets WHERE user_id = v_oath.creator_id FOR UPDATE;
    
    IF p_outcome = 'completed' THEN
      IF coalesce(v_oath.stake_amount, 0) > 0 AND v_creator_wallet IS NOT NULL THEN
        UPDATE public.wallets 
        SET balance = balance + v_oath.stake_amount, 
            escrow_locked = greatest(0, escrow_locked - v_oath.stake_amount), 
            updated_at = now()
        WHERE id = v_creator_wallet;

        INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description) 
        VALUES (v_creator_wallet, p_oath_id, 'escrow_release', v_oath.stake_amount, 'Solo oath fulfilled');
      END IF;

      PERFORM public.handle_profile_success(v_oath.creator_id, 0);
      UPDATE public.oaths SET status = 'completed', updated_at = now() WHERE id = p_oath_id;

      UPDATE public.nominees
      SET verified = TRUE,
          verdict = 'success',
          responded_at = now()
      WHERE oath_id = p_oath_id;

    ELSE
      IF coalesce(v_oath.stake_amount, 0) > 0 AND v_creator_wallet IS NOT NULL THEN
        UPDATE public.wallets 
        SET total_lost = coalesce(total_lost, 0) + v_oath.stake_amount, 
            escrow_locked = greatest(0, escrow_locked - v_oath.stake_amount), 
            updated_at = now()
        WHERE id = v_creator_wallet;

        INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description) 
        VALUES (v_creator_wallet, p_oath_id, 'penalty', v_oath.stake_amount, 'Solo oath forfeited');
      END IF;

      PERFORM public.handle_profile_failure(v_oath.creator_id, coalesce(v_oath.stake_amount, 0), p_oath_id);
      UPDATE public.oaths SET status = 'failed', updated_at = now() WHERE id = p_oath_id;

      UPDATE public.nominees
      SET verified = TRUE,
          verdict = 'penalty',
          responded_at = now()
      WHERE oath_id = p_oath_id;
    END IF;

    UPDATE public.proofs
    SET status = CASE WHEN p_outcome = 'completed' THEN 'verified'::public.proof_status ELSE 'rejected'::public.proof_status END,
        reviewer_id = v_user,
        reviewed_at = now()
    WHERE oath_id = p_oath_id AND status IN ('pending_review', 'needs_more_proof');

    IF v_oath.consequence_type = 'public_shame' THEN
      INSERT INTO public.wall_entries (oath_id, user_id, wall_type, oath_statement, stake_amount, excuse, username)
      SELECT p_oath_id, v_oath.creator_id, CASE WHEN p_outcome = 'completed' THEN 'honor'::public.wall_type ELSE 'shame'::public.wall_type END,
        v_oath.oath_statement, v_oath.stake_amount, CASE WHEN p_outcome = 'completed' THEN NULL ELSE v_oath.failure_excuse END,
        (SELECT username FROM public.profiles WHERE id = v_oath.creator_id);
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.settle_oath(UUID, TEXT) TO authenticated, anon;


-- ============================================================
-- 6. SUPPORT forfeit_squad_member (WITH OPTIONAL MEMBER ID)
-- ============================================================
DROP FUNCTION IF EXISTS public.forfeit_squad_member(UUID);
DROP FUNCTION IF EXISTS public.forfeit_squad_member(UUID, UUID);

CREATE OR REPLACE FUNCTION public.forfeit_squad_member(
  p_oath_id UUID,
  p_member_id UUID DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_oath public.oaths%ROWTYPE;
  v_member public.group_members%ROWTYPE;
  v_wallet_id UUID;
  v_stake NUMERIC;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oath not found'; END IF;

  IF p_member_id IS NOT NULL THEN
    SELECT * INTO v_member FROM public.group_members WHERE id = p_member_id AND oath_id = p_oath_id;
  ELSE
    SELECT * INTO v_member FROM public.group_members WHERE oath_id = p_oath_id AND user_id = v_user;
  END IF;

  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found in squad/lobby'; END IF;

  IF v_member.user_id <> v_user AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to forfeit for this member';
  END IF;

  v_stake := coalesce(v_member.stake_amount, v_oath.stake_amount, 0);

  UPDATE public.group_members
  SET status = 'failed', updated_at = now()
  WHERE id = v_member.id;

  IF v_stake > 0 THEN
    SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_member.user_id FOR UPDATE;
    IF v_wallet_id IS NOT NULL THEN
      UPDATE public.wallets
      SET escrow_locked = greatest(0, escrow_locked - v_stake),
          total_lost = coalesce(total_lost, 0) + v_stake,
          updated_at = now()
      WHERE id = v_wallet_id;

      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_wallet_id, p_oath_id, 'penalty', v_stake, 'Member forfeited lobby/squad');
    END IF;
  END IF;

  PERFORM public.handle_profile_failure(v_member.user_id, v_stake, p_oath_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.forfeit_squad_member(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.forfeit_oath(UUID, TEXT) TO authenticated, anon;
