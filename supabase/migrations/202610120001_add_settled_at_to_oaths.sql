-- Migration 202610120001: Add settled_at column to oaths and sync completed_at/failed_at

ALTER TABLE public.oaths
  ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ DEFAULT NULL;

-- Backfill settled_at from existing completed_at or failed_at
UPDATE public.oaths
SET settled_at = coalesce(completed_at, failed_at)
WHERE settled_at IS NULL AND (completed_at IS NOT NULL OR failed_at IS NOT NULL);

-- Ensure verify_nominee sets completed_at, failed_at, AND settled_at
CREATE OR REPLACE FUNCTION public.verify_nominee(
  p_token TEXT,
  p_approved BOOLEAN,
  p_note TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_nominee RECORD;
  v_oath RECORD;
  v_proof RECORD;
  v_creator_wallet UUID;
  v_release NUMERIC;
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
  WHERE oath_id = v_oath.id AND type = 'verify_proof';

  IF p_approved THEN
    -- If multi-day cadence, delegate to pass_today_work
    IF coalesce(v_oath.cadence, 'daily') = 'daily' AND coalesce(v_oath.total_days, 1) > 1 AND coalesce(v_oath.current_day, 1) < coalesce(v_oath.total_days, 1) THEN
      PERFORM public.pass_today_work(v_oath.id, coalesce(p_note, 'Verified by referee link'));
      RETURN jsonb_build_object('success', true, 'mode', 'daily_pass');
    END IF;

    -- Otherwise, mark completed & release escrow
    UPDATE public.oaths
    SET status = 'completed'::public.oath_status,
        completed_at = now(),
        last_verified_at = now(),
        settled_at = now(),
        updated_at = now()
    WHERE id = v_oath.id;

    IF v_proof.id IS NOT NULL THEN
      UPDATE public.proofs
      SET status = 'verified'::public.proof_status,
          review_note = coalesce(p_note, 'Verified by referee link'),
          reviewed_at = now()
      WHERE id = v_proof.id;
    END IF;

    v_release := coalesce(v_oath.stake_amount, 0);
    IF v_release > 0 THEN
      UPDATE public.wallets
      SET balance = balance + v_release,
          escrow_locked = greatest(0, escrow_locked - v_release),
          updated_at = now()
      WHERE user_id = v_oath.creator_id
      RETURNING id INTO v_creator_wallet;

      IF v_creator_wallet IS NOT NULL THEN
        INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
        VALUES (v_creator_wallet, v_oath.id, 'escrow_release', v_release, 'Oath completed; stake returned');
      END IF;
    END IF;

    INSERT INTO public.notifications (user_id, oath_id, type, title, message)
    VALUES (
      v_oath.creator_id,
      v_oath.id,
      'system',
      'Oath Verified!',
      'Your referee verified your submission. Congratulations!'
    );

    RETURN jsonb_build_object('success', true, 'mode', 'completed');
  ELSE
    -- REJECTION
    IF coalesce(v_oath.cadence, 'daily') = 'daily' AND coalesce(v_oath.total_days, 1) > 1 THEN
      -- Daily oath: Mark proof rejected, KEEP oath active, notify creator to resubmit before midnight
      IF v_proof.id IS NOT NULL THEN
        UPDATE public.proofs
        SET status = 'rejected'::public.proof_status,
            review_note = coalesce(p_note, 'Rejected by referee'),
            reviewed_at = now()
        WHERE id = v_proof.id;
      END IF;

      INSERT INTO public.notifications (user_id, oath_id, type, title, message)
      VALUES (
        v_oath.creator_id,
        v_oath.id,
        'system',
        'Proof Rejected by Referee',
        'Your daily proof was rejected: ' || coalesce(p_note, 'Insufficient evidence') || '. Please upload a corrected proof before midnight!'
      );

      RETURN jsonb_build_object('success', true, 'mode', 'daily_rejected_keep_active');
    ELSE
      -- Single deadline: Mark failed, slash escrow, record penalty
      UPDATE public.oaths
      SET status = 'failed'::public.oath_status,
          failed_at = now(),
          failure_excuse = coalesce(p_note, 'Rejected by referee'),
          settled_at = now(),
          updated_at = now()
      WHERE id = v_oath.id;

      IF v_proof.id IS NOT NULL THEN
        UPDATE public.proofs
        SET status = 'rejected'::public.proof_status,
            review_note = coalesce(p_note, 'Rejected by referee'),
            reviewed_at = now()
        WHERE id = v_proof.id;
      END IF;

      v_release := coalesce(v_oath.stake_amount, 0);
      IF v_release > 0 THEN
        UPDATE public.wallets
        SET escrow_locked = greatest(0, escrow_locked - v_release),
            updated_at = now()
        WHERE user_id = v_oath.creator_id
        RETURNING id INTO v_creator_wallet;

        IF v_creator_wallet IS NOT NULL THEN
          INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
          VALUES (v_creator_wallet, v_oath.id, 'penalty', v_release, 'Oath failed; stake forfeited: ' || coalesce(p_note, 'Rejected by referee'));
        END IF;
      END IF;

      PERFORM public.handle_profile_failure(v_oath.creator_id);

      INSERT INTO public.notifications (user_id, oath_id, type, title, message)
      VALUES (
        v_oath.creator_id,
        v_oath.id,
        'penalty',
        'Oath Failed',
        'Your referee rejected your proof. Stake forfeited.'
      );

      RETURN jsonb_build_object('success', true, 'mode', 'failed');
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_nominee(TEXT, BOOLEAN, TEXT) TO anon, authenticated;
