-- Migration: 202610040011_fix_notification_dispatch_and_roles.sql
-- Fixes notification leakage, self-targeted review notifications, missing reviewer receipts,
-- and lingering unresolved notifications between challenger and nominee/referee.

-- 1. FUNCTION: submit_oath_proof
CREATE OR REPLACE FUNCTION public.submit_oath_proof(
  p_oath_id UUID,
  p_proof_type TEXT,
  p_proof_url TEXT DEFAULT NULL,
  p_proof_text TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_id UUID;
  v_oath RECORD;
  v_gm RECORD;
  v_peer UUID;
  v_nominee RECORD;
  v_storage_path TEXT;
  v_user_name TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oath not found'; END IF;

  IF v_oath.status NOT IN ('active', 'pending') THEN
    RAISE EXCEPTION 'Cannot submit proof for oath with status %', v_oath.status;
  END IF;

  IF v_oath.deadline IS NOT NULL AND v_oath.deadline < now() THEN
    RAISE EXCEPTION 'Cannot submit proof after deadline';
  END IF;

  IF v_oath.oath_type IN ('squad', 'lobby') THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.group_members
      WHERE oath_id = p_oath_id AND user_id = v_user AND status = 'joined'
    ) THEN
      RAISE EXCEPTION 'Must be an active squad/lobby member to submit proof';
    END IF;
  ELSE
    IF v_oath.creator_id <> v_user AND coalesce(v_oath.opponent_id, '00000000-0000-0000-0000-000000000000'::UUID) <> v_user THEN
      RAISE EXCEPTION 'You are not a participant in this oath';
    END IF;
  END IF;

  -- Validate proof parameters
  IF p_proof_type NOT IN ('photo','video','screenshot','link','text') THEN 
    RAISE EXCEPTION 'Unsupported proof type'; 
  END IF;

  IF p_proof_type IN ('photo','video','screenshot') THEN
    IF p_proof_url IS NULL OR trim(p_proof_url) = '' THEN
      RAISE EXCEPTION 'Uploaded proof file is required';
    END IF;

    v_storage_path := regexp_replace(p_proof_url, '^.*/storage/v1/object/(?:public|sign)/(?:oath-proofs|proofs)/', '');
    v_storage_path := regexp_replace(v_storage_path, '^.*/(?:oath-proofs|proofs)/', '');
    v_storage_path := split_part(v_storage_path, '?', 1);

    IF v_storage_path NOT LIKE p_oath_id::text || '/' || v_user::text || '/%' THEN
      RAISE EXCEPTION 'Uploaded proof must use your private oath storage path';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM storage.objects
      WHERE bucket_id = 'oath-proofs'
        AND name = v_storage_path
        AND owner_id = v_user::text
    ) AND NOT EXISTS (
      SELECT 1 FROM storage.objects
      WHERE bucket_id = 'oath-proofs'
        AND name = v_storage_path
    ) THEN
      RAISE EXCEPTION 'Proof object not found in private storage or ownership check failed';
    END IF;
  END IF;

  IF p_proof_type = 'link' AND (p_proof_url IS NULL OR p_proof_url !~ '^https?://[^[:space:]]+$') THEN 
    RAISE EXCEPTION 'Proof link must be a valid HTTP(S) URL'; 
  END IF;

  IF p_proof_type = 'text' AND (coalesce(length(trim(p_proof_text)), 0) < 10 OR length(p_proof_text) > 5000) THEN 
    RAISE EXCEPTION 'Proof text must be between 10 and 5000 characters'; 
  END IF;

  -- Insert proof with strict 24-hour review window and day_number
  INSERT INTO public.proofs (
    oath_id, submitted_by, proof_type, proof_url, proof_text, status, review_deadline, day_number
  ) VALUES (
    p_oath_id, v_user, p_proof_type, p_proof_url, left(p_proof_text, 5000), 'pending_review'::public.proof_status, now() + interval '24 hours', coalesce(v_oath.current_day, 1)
  )
  RETURNING id INTO v_id;

  -- Update group_members proof status
  UPDATE public.group_members
  SET proof_submitted = true
  WHERE oath_id = p_oath_id AND user_id = v_user;

  SELECT coalesce(username, 'User') INTO v_user_name FROM public.profiles WHERE id = v_user;

  -- DISPATCH NOTIFICATIONS WITH STRICT RECIPIENT CHECKS
  -- 1. NOMINEE VERIFICATION
  IF v_oath.verification_method = 'nominee' THEN
    SELECT * INTO v_nominee FROM public.nominees WHERE oath_id = p_oath_id LIMIT 1;

    -- Only send review prompt to referee IF referee is NOT the submitter!
    IF v_nominee.nominee_user_id IS NOT NULL AND v_nominee.nominee_user_id <> v_user THEN
      INSERT INTO public.notifications (
        user_id, oath_id, proof_id, type, title, message, actor_id, status
      ) VALUES (
        v_nominee.nominee_user_id,
        p_oath_id,
        v_id,
        'verify_proof',
        'Proof Submitted for Verification',
        '@' || v_user_name || ' submitted proof for "' || left(v_oath.oath_statement, 50) || '". You have 24 hours to review.',
        v_user,
        'pending'
      );
    END IF;

    -- Submitter receipt (distinct from reviewer prompt)
    INSERT INTO public.notifications (
      user_id, oath_id, proof_id, type, title, message, actor_id, status
    ) VALUES (
      v_user,
      p_oath_id,
      v_id,
      'system',
      'Proof Submitted',
      'Day ' || coalesce(v_oath.current_day, 1) || ' proof submitted. Awaiting referee review.',
      v_user,
      'pending'
    );

  -- 2. DUO PEER VERIFICATION
  ELSIF v_oath.verification_method = 'peer' THEN
    IF v_user = v_oath.creator_id THEN
      v_peer := v_oath.opponent_id;
    ELSE
      v_peer := v_oath.creator_id;
    END IF;

    IF v_peer IS NOT NULL AND v_peer <> v_user THEN
      INSERT INTO public.notifications (
        user_id, oath_id, proof_id, type, title, message, actor_id, status
      ) VALUES (
        v_peer,
        p_oath_id,
        v_id,
        'verify_proof',
        'Duel Proof Submitted',
        '@' || v_user_name || ' submitted duel proof. You have 24 hours to review.',
        v_user,
        'pending'
      );
    END IF;

    -- Submitter receipt
    INSERT INTO public.notifications (
      user_id, oath_id, proof_id, type, title, message, actor_id, status
    ) VALUES (
      v_user,
      p_oath_id,
      v_id,
      'system',
      'Duel Proof Submitted',
      'Your duel proof has been submitted. Awaiting opponent review.',
      v_user,
      'pending'
    );

  -- 3. QUORUM SQUAD VERIFICATION
  ELSIF v_oath.verification_method = 'quorum' THEN
    FOR v_gm IN 
      SELECT user_id FROM public.group_members 
      WHERE oath_id = p_oath_id AND user_id <> v_user AND status = 'joined'
    LOOP
      INSERT INTO public.notifications (
        user_id, oath_id, proof_id, type, title, message, actor_id, status
      ) VALUES (
        v_gm.user_id,
        p_oath_id,
        v_id,
        'verify_proof',
        'Squad Proof to Vote',
        '@' || v_user_name || ' submitted proof. Cast your vote within 24 hours.',
        v_user,
        'pending'
      );
    END LOOP;

    -- Submitter receipt
    INSERT INTO public.notifications (
      user_id, oath_id, proof_id, type, title, message, actor_id, status
    ) VALUES (
      v_user,
      p_oath_id,
      v_id,
      'system',
      'Squad Proof Submitted',
      'Your squad proof has been submitted. Awaiting peer votes.',
      v_user,
      'pending'
    );

  -- 4. SOLO LONELY (Self-verification)
  ELSIF v_oath.verification_method = 'solo_lonely' THEN
    UPDATE public.proofs
    SET status = 'verified'::public.proof_status,
        reviewed_at = now(),
        review_note = 'Auto-verified solo photo proof'
    WHERE id = v_id;

    UPDATE public.group_members
    SET status = 'completed', is_winner = true
    WHERE oath_id = p_oath_id AND user_id = v_user;

    IF v_oath.current_day >= v_oath.total_days THEN
      PERFORM public.settle_oath(p_oath_id, 'success');
    ELSE
      PERFORM public.pass_today_work(p_oath_id, 'Self-verified daily photo proof');
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_oath_proof(UUID, TEXT, TEXT, TEXT) TO authenticated, anon;


-- 2. FUNCTION: pass_today_work (Hardened against self-review + auto-clears reviewer notification)
CREATE OR REPLACE FUNCTION public.pass_today_work(
  p_oath_id UUID,
  p_note TEXT DEFAULT NULL
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
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oath not found'; END IF;

  IF v_oath.status <> 'active' THEN
    RAISE EXCEPTION 'Oath is not active (current status: %)', v_oath.status;
  END IF;

  -- Find latest pending or needs_more proof
  SELECT * INTO v_proof
  FROM public.proofs
  WHERE oath_id = p_oath_id AND status IN ('pending_review', 'needs_more_proof')
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending proof found to approve';
  END IF;

  -- GUARD: Submitter CANNOT review their own proof
  IF v_proof.submitted_by = v_user AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'You cannot verify your own proof submission';
  END IF;

  -- Verify reviewer permission
  IF NOT (
    v_oath.opponent_id = v_user
    OR EXISTS (
      SELECT 1 FROM public.nominees n
      WHERE n.oath_id = p_oath_id
        AND (
          n.nominee_user_id = v_user
          OR n.email = (SELECT email FROM auth.users WHERE id = v_user)
          OR n.email = '@' || (SELECT username FROM public.profiles WHERE id = v_user)
          OR n.email = (SELECT username FROM public.profiles WHERE id = v_user)
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.oath_id = p_oath_id AND gm.user_id = v_user AND gm.user_id <> v_proof.submitted_by
    )
    OR public.is_admin()
  ) THEN
    RAISE EXCEPTION 'You are not authorized to review proofs for this oath';
  END IF;

  v_clean_note := coalesce(nullif(trim(p_note), ''), 'Today''s work verified by referee');

  -- Mark proof verified
  UPDATE public.proofs
  SET status = 'verified'::public.proof_status,
      reviewer_id = v_user,
      review_note = v_clean_note,
      reviewed_at = now()
  WHERE id = v_proof.id;

  -- Clear the reviewer's pending 'verify_proof' notification row
  UPDATE public.notifications
  SET status = 'accepted'
  WHERE oath_id = p_oath_id
    AND user_id = v_user
    AND type = 'verify_proof'
    AND status = 'pending';

  -- Confirmation receipt for the reviewer
  INSERT INTO public.notifications (user_id, oath_id, proof_id, type, title, message, status)
  VALUES (
    v_user,
    p_oath_id,
    v_proof.id,
    'system',
    'Proof Verified',
    'You verified Day ' || v_oath.current_day || ' work for @' || coalesce((SELECT username FROM public.profiles WHERE id = v_proof.submitted_by), 'User') || '.',
    'read'
  );

  -- Determine if this is the final day
  IF coalesce(v_oath.cadence, 'daily') = 'daily' THEN
    IF v_oath.total_days <= 1 AND v_oath.deadline > (now() + interval '24 hours') THEN
      v_oath.total_days := greatest(2, ceil(extract(epoch from (v_oath.deadline - v_oath.created_at)) / 86400.0)::int);
      UPDATE public.oaths SET total_days = v_oath.total_days WHERE id = p_oath_id;
    END IF;
    v_is_final_day := (v_oath.current_day >= v_oath.total_days);
  ELSE
    v_is_final_day := TRUE;
  END IF;

  IF v_is_final_day THEN
    -- Final day completed!
    UPDATE public.oaths
    SET status = 'completed',
        completed_at = now(),
        updated_at = now()
    WHERE id = p_oath_id;

    UPDATE public.group_members
    SET status = 'completed',
        is_winner = true,
        proof_submitted = true
    WHERE oath_id = p_oath_id AND user_id = v_proof.submitted_by;

    IF coalesce(v_oath.stake_amount, 0) > 0 THEN
      SELECT id, coalesce(escrow_locked, 0) INTO v_submitter_wallet, v_submitter_escrow
      FROM public.wallets
      WHERE user_id = v_proof.submitted_by
      FOR UPDATE;

      IF v_submitter_wallet IS NOT NULL THEN
        v_release := least(v_submitter_escrow, v_oath.stake_amount);
        IF v_release > 0 THEN
          UPDATE public.wallets
          SET balance = balance + v_release,
              escrow_locked = escrow_locked - v_release,
              updated_at = now()
          WHERE id = v_submitter_wallet;

          INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
          VALUES (v_submitter_wallet, p_oath_id, 'escrow_release', v_release, 'Oath completed: Locked stake released in full');
        END IF;
      END IF;
    END IF;

    -- Update profile stats (resets loss streak)
    PERFORM public.record_oath_success(v_proof.submitted_by, coalesce(v_oath.stake_amount, 0));

    -- Post completion message into chat
    INSERT INTO public.messages (oath_id, sender_id, content, type, proof_id)
    VALUES (
      p_oath_id,
      v_user,
      'All ' || v_oath.total_days || ' days completed! Today''s proof passed and the Oath is won!',
      'system',
      v_proof.id
    );

    -- Submitter gets celebration notification
    INSERT INTO public.notifications (user_id, oath_id, proof_id, type, title, message, status)
    VALUES (
      v_proof.submitted_by,
      p_oath_id,
      v_proof.id,
      'system',
      'Oath Completed Successfully!',
      'Congratulations! Your referee verified all days. Your locked stake has been returned in full.',
      'pending'
    );

    RETURN jsonb_build_object(
      'status', 'completed',
      'current_day', v_oath.current_day,
      'total_days', v_oath.total_days,
      'message', 'Oath completed and escrow released'
    );
  ELSE
    -- Multi-day oath: Advance to next day and reset daily proof window
    UPDATE public.oaths
    SET current_day = current_day + 1,
        current_streak = current_streak + 1,
        daily_deadline = least(v_oath.deadline, now() + interval '24 hours'),
        status = 'active',
        updated_at = now()
    WHERE id = p_oath_id;

    -- Update member streak and reset proof_submitted flag
    UPDATE public.group_members
    SET current_day = current_day + 1,
        day_streak = day_streak + 1,
        proof_submitted = FALSE
    WHERE oath_id = p_oath_id AND user_id = v_proof.submitted_by;

    -- Post milestone message into chat
    INSERT INTO public.messages (oath_id, sender_id, content, type, proof_id)
    VALUES (
      p_oath_id,
      v_user,
      'Day ' || v_oath.current_day || ' of ' || v_oath.total_days || ' verified! Today''s work passed. Tomorrow''s proof window is now open.',
      'system',
      v_proof.id
    );

    -- Notify submitter
    INSERT INTO public.notifications (user_id, oath_id, proof_id, type, title, message, status)
    VALUES (
      v_proof.submitted_by,
      p_oath_id,
      v_proof.id,
      'system',
      'Day ' || v_oath.current_day || ' Passed!',
      'Your referee verified today''s work. Day ' || (v_oath.current_day + 1) || ' of ' || v_oath.total_days || ' is now active.',
      'pending'
    );

    RETURN jsonb_build_object(
      'status', 'active',
      'current_day', v_oath.current_day + 1,
      'total_days', v_oath.total_days,
      'current_streak', v_oath.current_streak + 1,
      'message', 'Daily milestone passed. Next day window unlocked.'
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pass_today_work(UUID, TEXT) TO authenticated, anon;


-- 3. FUNCTION: request_more_proof (Hardened against self-request + auto-clears reviewer notification)
CREATE OR REPLACE FUNCTION public.request_more_proof(
  p_oath_id UUID,
  p_note TEXT DEFAULT NULL
) RETURNS VOID
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
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oath not found'; END IF;

  -- Find latest pending proof
  SELECT * INTO v_proof
  FROM public.proofs
  WHERE oath_id = p_oath_id AND status = 'pending_review'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending proof found to request changes for';
  END IF;

  -- GUARD: Submitter CANNOT request more proof from themselves
  IF v_proof.submitted_by = v_user AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'You cannot request more proof from yourself';
  END IF;

  -- Verify permissions: must be nominee, opponent, or quorum member
  IF NOT (
    v_oath.opponent_id = v_user
    OR EXISTS (
      SELECT 1 FROM public.nominees n
      WHERE n.oath_id = p_oath_id
        AND (
          n.nominee_user_id = v_user
          OR n.email = (SELECT email FROM auth.users WHERE id = v_user)
          OR n.email = '@' || (SELECT username FROM public.profiles WHERE id = v_user)
          OR n.email = (SELECT username FROM public.profiles WHERE id = v_user)
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.oath_id = p_oath_id AND gm.user_id = v_user AND gm.user_id <> v_proof.submitted_by
    )
    OR public.is_admin()
  ) THEN
    RAISE EXCEPTION 'You are not authorized to review proofs for this oath';
  END IF;

  v_clean_note := coalesce(nullif(trim(p_note), ''), 'Reviewer requested clearer evidence (better lighting, timestamp, or angle).');

  -- Update proof status
  UPDATE public.proofs
  SET status = 'needs_more_proof'::public.proof_status,
      reviewer_id = v_user,
      review_note = v_clean_note,
      reviewed_at = now()
  WHERE id = v_proof.id;

  -- Reset group_member proof_submitted flag if group oath
  UPDATE public.group_members
  SET proof_submitted = FALSE
  WHERE oath_id = p_oath_id AND user_id = v_proof.submitted_by;

  -- Insert a message into chat
  INSERT INTO public.messages (oath_id, sender_id, content, type, proof_id)
  VALUES (
    p_oath_id,
    v_user,
    'Need More Proof: ' || v_clean_note,
    'text',
    v_proof.id
  );

  -- Clear the reviewer's pending verify_proof notification
  UPDATE public.notifications
  SET status = 'accepted'
  WHERE oath_id = p_oath_id
    AND user_id = v_user
    AND type = 'verify_proof'
    AND status = 'pending';

  -- Insert notification for submitter
  INSERT INTO public.notifications (user_id, oath_id, proof_id, type, title, message, status)
  VALUES (
    v_proof.submitted_by,
    p_oath_id,
    v_proof.id,
    'system',
    'More Proof Requested',
    'Reviewer requested more proof: ' || v_clean_note,
    'pending'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_more_proof(UUID, TEXT) TO authenticated, anon;


-- 4. FUNCTION: verify_nominee (Support oath_id and auto-clear reviewer notification)
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
  WHERE oath_id = v_oath.id AND type = 'verify_proof' AND status = 'pending';

  IF p_approved THEN
    UPDATE public.oaths SET status = 'completed', updated_at = now() WHERE id = v_oath.id;
    IF v_proof.id IS NOT NULL THEN
      UPDATE public.proofs SET status = 'verified'::public.proof_status, reviewed_at = now(), review_note = p_note WHERE id = v_proof.id;
    END IF;

    SELECT id INTO v_creator_wallet FROM public.wallets WHERE user_id = v_oath.creator_id FOR UPDATE;
    IF v_creator_wallet IS NOT NULL AND coalesce(v_oath.stake_amount, 0) > 0 THEN
      UPDATE public.wallets SET balance = balance + v_oath.stake_amount, escrow_locked = escrow_locked - v_oath.stake_amount, updated_at = now() WHERE id = v_creator_wallet;
      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description) VALUES (v_creator_wallet, v_oath.id, 'escrow_release', v_oath.stake_amount, 'Escrow returned: Oath verified by nominee');
    END IF;

    PERFORM public.record_oath_success(v_oath.creator_id, coalesce(v_oath.stake_amount, 0));

    -- Submitter notified
    INSERT INTO public.notifications (user_id, oath_id, type, title, message, status)
    VALUES (v_oath.creator_id, v_oath.id, 'system', 'Oath Verified', 'Your referee verified your oath proof. Escrow returned.', 'pending');

    RETURN jsonb_build_object('success', true, 'status', 'completed');
  ELSE
    UPDATE public.oaths SET status = 'failed', failure_excuse = coalesce(p_note, 'Rejected by nominee'), updated_at = now() WHERE id = v_oath.id;
    IF v_proof.id IS NOT NULL THEN
      UPDATE public.proofs SET status = 'rejected'::public.proof_status, reviewed_at = now(), review_note = p_note WHERE id = v_proof.id;
    END IF;

    PERFORM public.handle_profile_failure(v_oath.creator_id, coalesce(v_oath.stake_amount, 0), v_oath.id);

    -- Submitter notified
    INSERT INTO public.notifications (user_id, oath_id, type, title, message, status)
    VALUES (v_oath.creator_id, v_oath.id, 'system', 'Oath Rejected', 'Your referee rejected your proof. Stake forfeited.', 'pending');

    RETURN jsonb_build_object('success', true, 'status', 'failed');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_nominee(TEXT, BOOLEAN, TEXT) TO authenticated, anon;
