-- Migration: 202610030009_fix_settle_atomically_active_status.sql
-- Corrects settle_oath_atomically to check active status without in_review enum reference

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

    -- Check if user is registered nominee by user_id or email
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

    UPDATE public.profiles
    SET oaths_completed = coalesce(oaths_completed, 0) + 1,
        reputation_score = least(100, coalesce(reputation_score, 100) + 2)
    WHERE id = v_oath.creator_id;

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

    UPDATE public.profiles
    SET oaths_failed = coalesce(oaths_failed, 0) + 1,
        total_lost = coalesce(total_lost, 0) + v_oath.stake_amount,
        reputation_score = greatest(0, coalesce(reputation_score, 100) - 5)
    WHERE id = v_oath.creator_id;

    IF v_oath.consequence_type = 'public_shame' THEN
      INSERT INTO public.wall_entries (oath_id, user_id, wall_type, oath_statement, stake_amount, excuse, username)
      SELECT p_oath_id, v_oath.creator_id, 'shame'::public.wall_type,
        v_oath.oath_statement, v_oath.stake_amount, coalesce(p_note, 'I gave up under pressure.'),
        (SELECT username FROM public.profiles WHERE id = v_oath.creator_id);
    END IF;
  END IF;
END;
$$;
