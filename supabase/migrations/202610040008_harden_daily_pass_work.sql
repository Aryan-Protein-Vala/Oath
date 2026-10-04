-- Migration 202610040008: Fix pass_today_work so daily oaths stay active until all days are completed

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
  IF v_oath.status <> 'active' THEN RAISE EXCEPTION 'Oath is not active'; END IF;

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
      WHERE gm.oath_id = p_oath_id AND gm.user_id = v_user
    )
  ) THEN
    RAISE EXCEPTION 'You are not authorized to review proofs for this oath';
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

  v_clean_note := coalesce(nullif(trim(p_note), ''), 'Today''s work verified by referee');

  -- Mark proof verified
  UPDATE public.proofs
  SET status = 'verified'::public.proof_status,
      reviewer_id = v_user,
      review_note = v_clean_note,
      reviewed_at = now()
  WHERE id = v_proof.id;

  -- Update nominee table
  UPDATE public.nominees
  SET verified = TRUE,
      verdict = 'success',
      verdict_note = v_clean_note,
      responded_at = now()
  WHERE oath_id = p_oath_id;

  -- Check if this is the final day or a single-day oath
  -- FOR DAILY OATHS: It is ONLY the final day if current_day >= total_days!
  IF coalesce(v_oath.cadence, 'daily') = 'daily' THEN
    -- If total_days was 1 or missing, calculate it from deadline vs created_at, or minimum 2 days if deadline is in the future
    IF v_oath.total_days <= 1 AND v_oath.deadline > (now() + interval '24 hours') THEN
      v_oath.total_days := greatest(2, ceil(extract(epoch from (v_oath.deadline - v_oath.created_at)) / 86400.0)::int);
      UPDATE public.oaths SET total_days = v_oath.total_days WHERE id = p_oath_id;
    END IF;

    IF v_oath.current_day >= v_oath.total_days THEN
      v_is_final_day := TRUE;
    ELSE
      v_is_final_day := FALSE;
    END IF;
  ELSE
    -- One-time proof oath: single verification completes the oath
    v_is_final_day := TRUE;
  END IF;

  IF v_is_final_day THEN
    -- Complete the oath and release full escrow
    UPDATE public.oaths
    SET status = 'completed',
        completed_at = now(),
        current_streak = current_streak + 1,
        updated_at = now()
    WHERE id = p_oath_id;

    -- Update group_members if present
    UPDATE public.group_members
    SET status = 'completed',
        is_winner = TRUE,
        proof_submitted = TRUE,
        day_streak = day_streak + 1
    WHERE oath_id = p_oath_id AND user_id = v_proof.submitted_by;

    -- Escrow release to creator/submitter (wrap safely against 0 amount)
    IF coalesce(v_oath.stake_amount, 0) > 0 THEN
      SELECT id, coalesce(escrow_locked, 0)
      INTO v_submitter_wallet, v_submitter_escrow
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
      '🎉 All ' || v_oath.total_days || ' days completed! Today''s proof passed and the Oath is won!',
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
      'Oath Completed Successfully! 🏆',
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
    -- Multi-day oath: Advance to next day and reset daily proof window!
    -- DO NOT COMPLETE THE OATH! IT REMAINS ACTIVE IN ACTIVE OATHS!
    UPDATE public.oaths
    SET current_day = current_day + 1,
        current_streak = current_streak + 1,
        daily_deadline = least(v_oath.deadline, now() + interval '24 hours'),
        status = 'active',
        updated_at = now()
    WHERE id = p_oath_id;

    -- Update member streak and reset proof_submitted flag so new proof can be uploaded
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
      '✅ Day ' || v_oath.current_day || ' of ' || v_oath.total_days || ' verified! Today''s work passed. Tomorrow''s proof window is now open.',
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
      'Day ' || v_oath.current_day || ' Passed! 🔥',
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
