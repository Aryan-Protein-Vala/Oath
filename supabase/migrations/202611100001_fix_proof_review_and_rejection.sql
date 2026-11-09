-- Migration: Fix Proof Review, Nominee Approval, and Prevent Premature Oath Erasure on Rejection
-- 1. Fix settle_oath solo nominee auth check (remove non-existent v_oath.nominee_email).
-- 2. Fix verify_nominee to call public.calculate_next_local_midnight(timezone, 1) instead of non-existent next_user_local_midnight, and preserve verified = false for daily/resubmissions.
-- 3. Fix reject_proof so rejecting proof marks proof as rejected and resets proof_submitted = false, but DOES NOT erase/fail active oaths unless p_fail_oath is explicitly TRUE.
-- 4. Fix pass_today_work so nominee.verified is only set to TRUE on the final day, allowing multi-day reviews.

-- ============================================================
-- 1. FIX settle_oath
-- ============================================================
CREATE OR REPLACE FUNCTION public.settle_oath(
  p_oath_id UUID,
  p_verdict TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_oath RECORD;
  v_user UUID := auth.uid();
  v_role TEXT := coalesce(auth.role(), '');
  v_stake NUMERIC;
  v_member RECORD;
  v_wallet_id UUID;
BEGIN
  IF v_user IS NULL AND v_role <> 'service_role' AND current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_verdict NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'Invalid verdict: %', p_verdict;
  END IF;

  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oath not found';
  END IF;

  IF v_oath.status IN ('completed', 'failed', 'cancelled') THEN
    RETURN jsonb_build_object('status', v_oath.status, 'already_settled', true);
  END IF;

  v_stake := COALESCE(v_oath.stake_amount, 0);

  IF v_oath.oath_type = 'solo' THEN
    IF v_user IS NOT NULL AND v_oath.creator_id != v_user AND NOT public.is_admin() THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.nominees n
        LEFT JOIN public.profiles p ON p.id = v_user
        WHERE n.oath_id = p_oath_id
          AND (
            n.nominee_user_id = v_user
            OR lower(p.username) = lower(regexp_replace(COALESCE(n.email, ''), '^@+', ''))
            OR lower(COALESCE(n.email, '')) = lower(p.username)
            OR lower(COALESCE(n.email, '')) = '@' || lower(p.username)
            OR n.email = (SELECT email FROM auth.users WHERE id = v_user)
          )
      ) THEN
        RAISE EXCEPTION 'Not authorized to settle this solo oath';
      END IF;
    END IF;

    SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_oath.creator_id FOR UPDATE;

    IF p_verdict = 'completed' THEN
      UPDATE public.oaths SET status = 'completed', completed_at = now(), settled_at = now(), updated_at = now() WHERE id = p_oath_id;
      IF v_stake > 0 AND v_wallet_id IS NOT NULL THEN
        UPDATE public.wallets
        SET escrow_locked = GREATEST(0, escrow_locked - v_stake),
            balance = balance + v_stake,
            updated_at = now()
        WHERE id = v_wallet_id;

        INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
        VALUES (v_wallet_id, p_oath_id, 'escrow_release', v_stake, 'Oath completed — stake returned');
      END IF;
      PERFORM public.handle_profile_completion(v_oath.creator_id);
      INSERT INTO public.wall_entries (oath_id, user_id, wall_type, oath_statement, stake_amount, username)
      SELECT p_oath_id, v_oath.creator_id, 'honor', v_oath.oath_statement, v_stake, username
      FROM public.profiles WHERE id = v_oath.creator_id;
    ELSE
      UPDATE public.oaths SET status = 'failed', failed_at = now(), settled_at = now(), updated_at = now() WHERE id = p_oath_id;
      IF v_stake > 0 AND v_wallet_id IS NOT NULL THEN
        UPDATE public.wallets
        SET escrow_locked = GREATEST(0, escrow_locked - v_stake),
            total_lost = COALESCE(total_lost, 0) + v_stake,
            updated_at = now()
        WHERE id = v_wallet_id;

        INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
        VALUES (v_wallet_id, p_oath_id, 'penalty', v_stake, 'Oath failed — stake slashed');
      END IF;
      PERFORM public.handle_profile_failure(v_oath.creator_id, v_stake, p_oath_id);
      INSERT INTO public.wall_entries (oath_id, user_id, wall_type, oath_statement, stake_amount, excuse, username)
      SELECT p_oath_id, v_oath.creator_id, 'shame', v_oath.oath_statement, v_stake, COALESCE(v_oath.failure_excuse, 'Failed oath'), username
      FROM public.profiles WHERE id = v_oath.creator_id;
    END IF;

    UPDATE public.nominees
    SET verified = TRUE,
        verdict = CASE WHEN p_verdict = 'completed' THEN 'success' ELSE 'penalty' END,
        responded_at = now()
    WHERE oath_id = p_oath_id;

    RETURN jsonb_build_object('status', p_verdict, 'settled', true);
  END IF;

  -- Group / Squad / Duo Settlement
  FOR v_member IN
    SELECT * FROM public.group_members
    WHERE oath_id = p_oath_id
    FOR UPDATE
  LOOP
    SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_member.user_id FOR UPDATE;
    IF p_verdict = 'completed' AND v_member.status != 'failed' THEN
      UPDATE public.group_members SET status = 'completed', is_winner = TRUE, updated_at = now() WHERE id = v_member.id;
      IF v_stake > 0 AND v_wallet_id IS NOT NULL THEN
        UPDATE public.wallets
        SET escrow_locked = GREATEST(0, escrow_locked - v_stake),
            balance = balance + v_stake,
            updated_at = now()
        WHERE id = v_wallet_id;

        INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
        VALUES (v_wallet_id, p_oath_id, 'escrow_release', v_stake, 'Squad oath completed — stake returned');
      END IF;
      PERFORM public.handle_profile_completion(v_member.user_id);
    ELSE
      UPDATE public.group_members SET status = 'failed', is_winner = FALSE, updated_at = now() WHERE id = v_member.id;
      IF v_stake > 0 AND v_wallet_id IS NOT NULL THEN
        UPDATE public.wallets
        SET escrow_locked = GREATEST(0, escrow_locked - v_stake),
            total_lost = COALESCE(total_lost, 0) + v_stake,
            updated_at = now()
        WHERE id = v_wallet_id;

        INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
        VALUES (v_wallet_id, p_oath_id, 'penalty', v_stake, 'Squad oath failed — stake slashed');
      END IF;
      PERFORM public.handle_profile_failure(v_member.user_id, v_stake, p_oath_id);
    END IF;
  END LOOP;

  UPDATE public.oaths
  SET status = CASE WHEN p_verdict = 'completed' THEN 'completed'::public.oath_status ELSE 'failed'::public.oath_status END,
      completed_at = CASE WHEN p_verdict = 'completed' THEN now() ELSE NULL END,
      failed_at = CASE WHEN p_verdict = 'failed' THEN now() ELSE NULL END,
      settled_at = now(),
      updated_at = now()
  WHERE id = p_oath_id;

  RETURN jsonb_build_object('status', p_verdict, 'settled', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.settle_oath(UUID, TEXT) TO authenticated, anon, service_role;


-- ============================================================
-- 2. FIX verify_nominee
-- ============================================================
DROP FUNCTION IF EXISTS public.verify_nominee(UUID, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.verify_nominee(TEXT, BOOLEAN, TEXT);

CREATE OR REPLACE FUNCTION public.verify_nominee(
  p_token TEXT,
  p_approved BOOLEAN,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_nominee public.nominees%ROWTYPE;
  v_oath public.oaths%ROWTYPE;
  v_proof public.proofs%ROWTYPE;
  v_stake NUMERIC;
  v_cadence TEXT;
  v_total_days INT;
  v_current_day INT;
  v_next_day INT;
  v_is_final_day BOOLEAN;
  v_wallet_id UUID;
BEGIN
  SELECT * INTO v_nominee
  FROM public.nominees
  WHERE (verification_token::text = p_token OR oath_id::text = p_token)
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    SELECT * INTO v_oath FROM public.oaths WHERE id::text = p_token FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Invalid verification token');
    END IF;
  ELSE
    IF v_nominee.verified THEN
      RETURN jsonb_build_object('success', false, 'error', 'This oath has already been reviewed');
    END IF;
    SELECT * INTO v_oath FROM public.oaths WHERE id = v_nominee.oath_id FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oath not found for verification token';
  END IF;

  IF v_oath.status != 'active' THEN
    RAISE EXCEPTION 'Oath is no longer active (current status: %)', v_oath.status;
  END IF;

  v_stake := COALESCE(v_oath.stake_amount, 0);
  v_cadence := COALESCE(v_oath.cadence, 'daily');
  v_total_days := GREATEST(1, COALESCE(v_oath.total_days, 1));
  IF v_cadence = 'daily' AND v_total_days <= 1 AND v_oath.deadline > v_oath.created_at + interval '24 hours' THEN
    v_total_days := GREATEST(2, CEIL(EXTRACT(EPOCH FROM (v_oath.deadline - v_oath.created_at)) / 86400.0)::INT);
  END IF;
  v_current_day := COALESCE(v_oath.current_day, 1);
  v_is_final_day := CASE WHEN v_cadence = 'daily' THEN (v_current_day >= v_total_days) ELSE TRUE END;

  SELECT * INTO v_proof
  FROM public.proofs
  WHERE oath_id = v_oath.id AND status = 'pending_review'
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT p_approved THEN
    IF v_proof.id IS NOT NULL THEN
      UPDATE public.proofs
      SET status = 'rejected',
          review_note = COALESCE(p_note, 'Rejected by nominee referee'),
          reviewed_at = now()
      WHERE id = v_proof.id;
    END IF;

    UPDATE public.group_members
    SET proof_submitted = FALSE
    WHERE oath_id = v_oath.id AND user_id = v_oath.creator_id;

    IF v_cadence = 'daily' THEN
      IF v_nominee.id IS NOT NULL THEN
        UPDATE public.nominees
        SET verified = FALSE,
            verdict = 'rejected',
            verdict_note = COALESCE(p_note, 'Rejected by nominee referee'),
            responded_at = now()
        WHERE id = v_nominee.id;
      END IF;

      INSERT INTO public.notifications (user_id, type, title, message, oath_id)
      VALUES (
        v_oath.creator_id,
        'proof_rejected',
        'Referee Rejected Today''s Proof',
        format('Your referee rejected today''s proof on "%s": %s. Submit valid proof before midnight!', left(v_oath.oath_statement, 40), COALESCE(p_note, 'Rejected')),
        v_oath.id
      );
      RETURN jsonb_build_object('success', true, 'status', 'active', 'verdict', 'rejected', 'mode', 'daily_rejected_keep_active');
    END IF;

    -- Single deadline rejection: fail the oath
    IF v_nominee.id IS NOT NULL THEN
      UPDATE public.nominees
      SET verified = TRUE,
          verdict = 'rejected',
          verdict_note = COALESCE(p_note, 'Rejected by nominee referee'),
          responded_at = now()
      WHERE id = v_nominee.id;
    END IF;

    UPDATE public.oaths
    SET status = 'failed',
        failed_at = now(),
        settled_at = now(),
        failure_excuse = COALESCE(p_note, 'Rejected by nominee referee'),
        updated_at = now()
    WHERE id = v_oath.id;

    IF v_stake > 0 THEN
      SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_oath.creator_id FOR UPDATE;
      UPDATE public.wallets
      SET escrow_locked = GREATEST(0, escrow_locked - v_stake),
          total_lost = COALESCE(total_lost, 0) + v_stake,
          updated_at = now()
      WHERE id = v_wallet_id;

      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_wallet_id, v_oath.id, 'penalty', v_stake, 'Oath failed — rejected by nominee referee');
    END IF;

    PERFORM public.handle_profile_failure(v_oath.creator_id, v_stake, v_oath.id);

    INSERT INTO public.notifications (user_id, type, title, message, oath_id)
    VALUES (
      v_oath.creator_id,
      'oath_settled',
      'Oath Failed — Referee Verdict',
      format('Your nominee referee failed your oath "%s". Note: %s', left(v_oath.oath_statement, 40), COALESCE(p_note, 'Failed')),
      v_oath.id
    );

    RETURN jsonb_build_object('success', true, 'status', 'failed', 'verdict', 'failed', 'mode', 'failed');
  END IF;

  -- Approving proof
  IF v_proof.id IS NOT NULL THEN
    UPDATE public.proofs
    SET status = 'verified',
        review_note = COALESCE(p_note, 'Verified by nominee referee'),
        reviewed_at = now()
    WHERE id = v_proof.id;
  END IF;

  IF NOT v_is_final_day THEN
    v_next_day := v_current_day + 1;
    UPDATE public.oaths
    SET current_day = v_next_day,
        total_days = v_total_days,
        daily_deadline = public.calculate_next_local_midnight(COALESCE(v_oath.timezone, 'UTC'), 1),
        updated_at = now()
    WHERE id = v_oath.id;

    IF v_nominee.id IS NOT NULL THEN
      UPDATE public.nominees
      SET verified = FALSE,
          verdict = 'approved_day_' || v_current_day,
          verdict_note = p_note,
          responded_at = now()
      WHERE id = v_nominee.id;
    END IF;

    INSERT INTO public.notifications (user_id, type, title, message, oath_id)
    VALUES (
      v_oath.creator_id,
      'proof_verified',
      format('Day %s/%s Verified!', v_current_day, v_total_days),
      format('Your referee passed Day %s/%s for "%s". Next deadline is tomorrow midnight.', v_current_day, v_total_days, left(v_oath.oath_statement, 40)),
      v_oath.id
    );

    RETURN jsonb_build_object('success', true, 'status', 'active', 'verdict', 'completed_day', 'mode', 'daily_pass', 'current_day', v_next_day, 'total_days', v_total_days);
  END IF;

  -- Final day verified: complete the oath
  IF v_nominee.id IS NOT NULL THEN
    UPDATE public.nominees
    SET verified = TRUE,
        verdict = 'approved',
        verdict_note = COALESCE(p_note, 'Approved by nominee referee'),
        responded_at = now()
    WHERE id = v_nominee.id;
  END IF;

  UPDATE public.oaths
  SET status = 'completed',
      completed_at = now(),
      settled_at = now(),
      updated_at = now()
  WHERE id = v_oath.id;

  IF v_stake > 0 THEN
    SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_oath.creator_id FOR UPDATE;
    UPDATE public.wallets
    SET escrow_locked = GREATEST(0, escrow_locked - v_stake),
        balance = balance + v_stake,
        updated_at = now()
    WHERE id = v_wallet_id;

    INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
    VALUES (v_wallet_id, v_oath.id, 'escrow_release', v_stake, 'Oath completed — released escrow');
  END IF;

  PERFORM public.handle_profile_completion(v_oath.creator_id);

  INSERT INTO public.notifications (user_id, type, title, message, oath_id)
  VALUES (
    v_oath.creator_id,
    'oath_settled',
    'Oath Completed! Stake Returned',
    format('Your nominee referee confirmed completion of "%s"!', left(v_oath.oath_statement, 40)),
    v_oath.id
  );

  RETURN jsonb_build_object('success', true, 'status', 'completed', 'verdict', 'completed', 'mode', 'final_settle');
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_nominee(TEXT, BOOLEAN, TEXT) TO anon, authenticated;


-- ============================================================
-- 3. FIX reject_proof
-- ============================================================
DROP FUNCTION IF EXISTS public.reject_proof(UUID, UUID, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.reject_proof(UUID, TEXT, TEXT, BOOLEAN);

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
  v_stake NUMERIC;
  v_wallet_id UUID;
  v_other_id UUID;
  v_other_member public.group_members%ROWTYPE;
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

  -- Update proof status
  UPDATE public.proofs
  SET status = 'rejected'::public.proof_status,
      reviewer_id = v_user,
      review_note = v_clean_reason,
      reviewed_at = now()
  WHERE id = v_proof.id;

  -- Reset submitter's proof_submitted state so they can submit fresh proof before deadline
  UPDATE public.group_members
  SET proof_submitted = FALSE
  WHERE oath_id = p_oath_id AND user_id = v_proof.submitted_by;

  -- For nominee records: only mark verified=true if p_fail_oath is TRUE. Otherwise keep verified=false so nominee can review the resubmitted proof.
  IF p_fail_oath THEN
    UPDATE public.nominees
    SET verified = TRUE,
        verdict = 'penalty',
        verdict_note = v_clean_reason,
        responded_at = now()
    WHERE oath_id = p_oath_id;
  ELSE
    UPDATE public.nominees
    SET verified = FALSE,
        verdict = 'rejected',
        verdict_note = v_clean_reason,
        responded_at = now()
    WHERE oath_id = p_oath_id;
  END IF;

  UPDATE public.notifications
  SET status = 'accepted', updated_at = now()
  WHERE user_id = v_user AND oath_id = p_oath_id AND type = 'verify_proof' AND status = 'pending';

  SELECT username INTO v_reviewer_name FROM public.profiles WHERE id = v_user;

  INSERT INTO public.notifications (user_id, oath_id, proof_id, type, title, message, status)
  VALUES (
    v_proof.submitted_by,
    p_oath_id,
    v_proof.id,
    'proof_rejected',
    'Proof Rejected',
    coalesce('@' || v_reviewer_name, 'Reviewer') || ' rejected your proof: "' || left(v_clean_reason, 120) || '". You can submit a new proof before the deadline.',
    'pending'
  );

  -- ONLY fail/forfeit the oath or member if p_fail_oath is explicitly TRUE!
  IF p_fail_oath THEN
    IF v_oath.oath_type = 'duo' THEN
      v_stake := coalesce(v_oath.stake_amount, 0);
      IF v_stake > 0 THEN
        UPDATE public.wallets
        SET escrow_locked = greatest(0, escrow_locked - v_stake),
            total_lost = coalesce(total_lost, 0) + v_stake,
            updated_at = now()
        WHERE user_id = v_proof.submitted_by
        RETURNING id INTO v_wallet_id;

        IF v_wallet_id IS NOT NULL THEN
          INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
          VALUES (v_wallet_id, p_oath_id, 'penalty', v_stake, 'Duo proof rejected — stake forfeited');
        END IF;
      END IF;
      UPDATE public.group_members SET status = 'failed', updated_at = now() WHERE oath_id = p_oath_id AND user_id = v_proof.submitted_by;
      PERFORM public.handle_profile_failure(v_proof.submitted_by, v_stake, p_oath_id);

      v_other_id := CASE WHEN v_proof.submitted_by = v_oath.creator_id THEN v_oath.opponent_id ELSE v_oath.creator_id END;
      IF v_other_id IS NOT NULL THEN
        SELECT * INTO v_other_member FROM public.group_members WHERE oath_id = p_oath_id AND user_id = v_other_id;
        IF v_other_member.status IN ('completed', 'failed') THEN
          UPDATE public.oaths
          SET status = CASE WHEN v_other_member.status = 'completed' THEN 'completed'::public.oath_status ELSE 'failed'::public.oath_status END,
              settled_at = now(),
              updated_at = now()
          WHERE id = p_oath_id;
        END IF;
      END IF;
    ELSE
      PERFORM public.settle_oath(p_oath_id, 'failed');
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'proof_id', v_proof.id, 'status', 'rejected', 'oath_status', v_oath.status);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_proof(UUID, UUID, TEXT, BOOLEAN) TO authenticated, anon;


-- ============================================================
-- 4. FIX pass_today_work
-- ============================================================
DROP FUNCTION IF EXISTS public.pass_today_work(UUID, TEXT, UUID);
DROP FUNCTION IF EXISTS public.pass_today_work(UUID, TEXT);

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
  v_is_sole_survivor BOOLEAN := FALSE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oath not found'; END IF;
  IF v_oath.status <> 'active' THEN RAISE EXCEPTION 'Oath is not active'; END IF;

  IF p_proof_id IS NOT NULL THEN
    SELECT * INTO v_proof FROM public.proofs WHERE id = p_proof_id AND oath_id = p_oath_id FOR UPDATE;
  ELSE
    SELECT * INTO v_proof FROM public.proofs WHERE oath_id = p_oath_id AND status IN ('pending_review', 'needs_more_proof') ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending proof found to approve';
  END IF;

  IF v_oath.oath_type IN ('duo', 'squad', 'lobby') THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM public.group_members
      WHERE oath_id = p_oath_id AND user_id <> v_proof.submitted_by AND status = 'joined'
    ) INTO v_is_sole_survivor;
  END IF;

  IF v_proof.submitted_by = v_user AND NOT public.is_admin() AND NOT v_is_sole_survivor AND v_oath.verification_method <> 'solo_lonely' THEN
    RAISE EXCEPTION 'You cannot verify your own proof submission';
  END IF;

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

  IF coalesce(v_oath.cadence, 'daily') = 'daily' THEN
    IF v_oath.total_days <= 1 AND v_oath.deadline > (now() + interval '24 hours') THEN
      v_oath.total_days := greatest(2, ceil(extract(epoch from (v_oath.deadline - v_oath.created_at)) / 86400.0)::int);
      UPDATE public.oaths SET total_days = v_oath.total_days WHERE id = p_oath_id;
    END IF;

    SELECT * INTO v_member FROM public.group_members WHERE oath_id = p_oath_id AND user_id = v_proof.submitted_by FOR UPDATE;
    IF FOUND THEN
      v_user_tz := coalesce(v_member.timezone, v_oath.timezone, 'UTC');
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

  -- Nominees table update: only mark verified=TRUE on the final day!
  UPDATE public.nominees
  SET verified = v_is_final_day,
      verdict = CASE WHEN v_is_final_day THEN 'success' ELSE 'approved_day_' || coalesce(v_oath.current_day, 1) END,
      verdict_note = v_clean_note,
      responded_at = now()
  WHERE oath_id = p_oath_id;

  SELECT username INTO v_reviewer_name FROM public.profiles WHERE id = v_user;

  INSERT INTO public.notifications (user_id, oath_id, proof_id, type, title, message, status)
  VALUES (
    v_proof.submitted_by,
    p_oath_id,
    v_proof.id,
    'system',
    'Day Proof Verified!',
    CASE WHEN v_is_sole_survivor
      THEN 'Proof auto-verified (sole surviving participant)! Streak is now ' || v_new_streak || '.'
      ELSE coalesce('@' || v_reviewer_name, 'Referee') || ' verified your proof! Streak is now ' || v_new_streak || '. Take a break until midnight.'
    END,
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
-- 5. FIX request_more_proof
-- ============================================================
DROP FUNCTION IF EXISTS public.request_more_proof(UUID, TEXT, UUID);
DROP FUNCTION IF EXISTS public.request_more_proof(UUID, TEXT);

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
  v_reviewer_name TEXT;
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

  UPDATE public.nominees
  SET verified = FALSE,
      verdict = 'needs_more_proof',
      verdict_note = v_clean_note,
      responded_at = now()
  WHERE oath_id = p_oath_id;

  SELECT username INTO v_reviewer_name FROM public.profiles WHERE id = v_user;

  INSERT INTO public.messages (oath_id, sender_id, content, type, proof_id)
  VALUES (
    p_oath_id,
    v_user,
    'Need More Proof: ' || v_clean_note,
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
    coalesce('@' || v_reviewer_name, 'Reviewer') || ' requested clearer proof: ' || left(v_clean_note, 120),
    'pending'
  );

  RETURN jsonb_build_object('success', true, 'proof_id', v_proof.id, 'status', 'needs_more_proof');
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_more_proof(UUID, TEXT, UUID) TO authenticated, anon;

