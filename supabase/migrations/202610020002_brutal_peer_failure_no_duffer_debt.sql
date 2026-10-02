-- Migration: 202610020002_brutal_peer_failure_no_duffer_debt.sql
-- Philosophy: "You do -> nothing happens (stake released). You don't do -> you lose (stake forfeited)."
-- No +2 duffer debt, no reputation gamification.
-- If a peer fails to review within 24 hours, the submitter loses because of their peers:
-- Notification: "You lost because of your peers and not others. Your peer failed to review within 24 hours. It is not on us."

-- 1. Upgrade public.submit_oath_proof
DROP FUNCTION IF EXISTS public.submit_oath_proof(UUID, TEXT, TEXT, TEXT);
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
  v_wallet_id UUID;
  v_locked NUMERIC;
  v_release NUMERIC;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_oath
  FROM public.oaths
  WHERE id = p_oath_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oath not found';
  END IF;

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

  IF p_proof_type NOT IN ('photo','video','screenshot','link','text') THEN 
    RAISE EXCEPTION 'Unsupported proof type'; 
  END IF;

  IF p_proof_type IN ('photo','video','screenshot') THEN
    IF p_proof_url IS NULL OR p_proof_url NOT LIKE p_oath_id::text || '/' || v_user::text || '/%' THEN
      RAISE EXCEPTION 'Uploaded proof must use your private oath storage path';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'oath-proofs' AND so.name = p_proof_url) THEN
      RAISE EXCEPTION 'Proof file was not uploaded to private storage';
    END IF;
  END IF;

  IF p_proof_type = 'link' AND (p_proof_url IS NULL OR p_proof_url !~ '^https?://[^[:space:]]+$') THEN 
    RAISE EXCEPTION 'Proof link must be a valid HTTP(S) URL'; 
  END IF;

  IF p_proof_type = 'text' AND (coalesce(length(trim(p_proof_text)), 0) < 10 OR length(p_proof_text) > 5000) THEN 
    RAISE EXCEPTION 'Proof text must be between 10 and 5000 characters'; 
  END IF;

  -- Insert proof with strict 24-hour review window
  INSERT INTO public.proofs (
    oath_id, submitted_by, proof_type, proof_url, proof_text, status, review_deadline
  ) VALUES (
    p_oath_id, v_user, p_proof_type, p_proof_url, left(p_proof_text, 5000), 'pending_review'::public.proof_status, now() + interval '24 hours'
  )
  RETURNING id INTO v_id;

  -- Update group_members proof status
  UPDATE public.group_members
  SET proof_submitted = true
  WHERE oath_id = p_oath_id AND user_id = v_user;

  -- DISPATCH NOTIFICATIONS WITH 24H WINDOW NOTICE
  IF v_oath.verification_method = 'nominee' THEN
    SELECT * INTO v_nominee FROM public.nominees WHERE oath_id = p_oath_id LIMIT 1;
    IF v_nominee.nominee_user_id IS NOT NULL THEN
      INSERT INTO public.notifications (
        user_id, oath_id, proof_id, type, title, message, actor_id, status
      ) VALUES (
        v_nominee.nominee_user_id,
        p_oath_id,
        v_id,
        'verify_proof',
        'Proof Submitted for Verification',
        '@' || coalesce((SELECT username FROM public.profiles WHERE id = v_user), 'User') || ' submitted proof for "' || left(v_oath.oath_statement, 50) || '". You have 24 hours to review or they lose their stake.',
        v_user,
        'pending'
      );
    END IF;

  ELSIF v_oath.verification_method = 'peer' THEN
    IF v_user = v_oath.creator_id THEN
      v_peer := v_oath.opponent_id;
    ELSE
      v_peer := v_oath.creator_id;
    END IF;

    IF v_peer IS NOT NULL THEN
      INSERT INTO public.notifications (
        user_id, oath_id, proof_id, type, title, message, actor_id, status
      ) VALUES (
        v_peer,
        p_oath_id,
        v_id,
        'verify_proof',
        'Duel Proof Submitted',
        '@' || coalesce((SELECT username FROM public.profiles WHERE id = v_user), 'Opponent') || ' submitted duel proof. You have 24 hours to review or they lose their stake.',
        v_user,
        'pending'
      );
    END IF;

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
        '@' || coalesce((SELECT username FROM public.profiles WHERE id = v_user), 'Member') || ' submitted proof. Cast your vote within 24 hours or they lose their stake.',
        v_user,
        'pending'
      );
    END LOOP;

  ELSIF v_oath.verification_method = 'solo_lonely' THEN
    -- Photo evidence self-verifies: you do -> nothing happens (stake released)
    UPDATE public.proofs
    SET status = 'verified'::public.proof_status,
        reviewed_at = now(),
        review_note = 'Auto-verified solo photo proof'
    WHERE id = v_id;

    UPDATE public.group_members
    SET status = 'completed', is_winner = true
    WHERE oath_id = p_oath_id AND user_id = v_user;

    IF v_oath.status = 'active' THEN
      UPDATE public.oaths
      SET status = 'completed', updated_at = now()
      WHERE id = p_oath_id;

      IF v_oath.stake_amount > 0 THEN
        SELECT id, coalesce(escrow_locked, 0)
        INTO v_wallet_id, v_locked
        FROM public.wallets
        WHERE user_id = v_user
        FOR UPDATE;

        IF v_wallet_id IS NOT NULL THEN
          v_release := least(v_locked, v_oath.stake_amount);
          IF v_release > 0 THEN
            UPDATE public.wallets
            SET balance = balance + v_release,
                escrow_locked = escrow_locked - v_release,
                updated_at = now()
            WHERE id = v_wallet_id;

            INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
            VALUES (v_wallet_id, p_oath_id, 'escrow_release', v_release, 'Solo oath completed; escrow returned');
          END IF;
        END IF;
      END IF;

      -- Update submitter profile stats: NO duffer_debt, NO reputation_score modifications
      UPDATE public.profiles
      SET oaths_completed = coalesce(oaths_completed, 0) + 1,
          updated_at = now()
      WHERE id = v_user;

      IF v_oath.consequence_type = 'public_shame' THEN
        INSERT INTO public.wall_entries (oath_id, user_id, wall_type, oath_statement, stake_amount, excuse, username)
        SELECT p_oath_id, v_user, 'honor'::public.wall_type,
          v_oath.oath_statement, v_oath.stake_amount, NULL,
          (SELECT username FROM public.profiles WHERE id = v_user);
      END IF;
    END IF;
  END IF;

  RETURN v_id;
END;
$$;


-- 2. Brutal auto_resolve_ghosted_proofs: If peer fails to review, submitter loses because of their peers
DROP FUNCTION IF EXISTS public.auto_resolve_ghosted_proofs();
CREATE OR REPLACE FUNCTION public.auto_resolve_ghosted_proofs()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_proof RECORD;
  v_oath RECORD;
  v_count INTEGER := 0;
  v_creator_wallet UUID;
  v_creator_escrow NUMERIC;
  v_submitter_wallet UUID;
  v_submitter_escrow NUMERIC;
  v_total_pot NUMERIC;
  v_squad_total NUMERIC;
  v_release NUMERIC;
  v_gm RECORD;
BEGIN
  FOR v_proof IN 
    SELECT p.id, p.oath_id, p.submitted_by, p.created_at, p.review_deadline
    FROM public.proofs p
    WHERE p.status = 'pending_review'
      AND p.review_deadline IS NOT NULL
      AND p.review_deadline < now()
    ORDER BY p.created_at ASC
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT * INTO v_oath
    FROM public.oaths
    WHERE id = v_proof.oath_id
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    -- Reject the proof because peer failed to review within 24 hours
    UPDATE public.proofs
    SET status = 'rejected'::public.proof_status,
        reviewed_at = now(),
        review_note = 'Failed: Peer failed to review proof within 24 hours'
    WHERE id = v_proof.id;

    -- CASE A: Nominee Verification
    IF v_oath.verification_method = 'nominee' THEN
      UPDATE public.nominees
      SET verified = false,
          responded_at = now()
      WHERE oath_id = v_oath.id;

      UPDATE public.group_members
      SET status = 'failed',
          is_winner = false
      WHERE oath_id = v_oath.id AND user_id = v_proof.submitted_by;

      IF v_oath.status = 'active' THEN
        UPDATE public.oaths
        SET status = 'failed',
            updated_at = now()
        WHERE id = v_oath.id;

        IF v_oath.stake_amount > 0 THEN
          SELECT id, coalesce(escrow_locked, 0)
          INTO v_submitter_wallet, v_submitter_escrow
          FROM public.wallets
          WHERE user_id = v_proof.submitted_by
          FOR UPDATE;

          IF v_submitter_wallet IS NOT NULL THEN
            v_release := least(v_submitter_escrow, v_oath.stake_amount);
            IF v_release > 0 THEN
              UPDATE public.wallets
              SET escrow_locked = escrow_locked - v_release,
                  total_lost = coalesce(total_lost, 0) + v_release,
                  updated_at = now()
              WHERE id = v_submitter_wallet;

              INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
              VALUES (v_submitter_wallet, v_oath.id, 'penalty', v_release, 'Lost oath: Referee failed to review proof within 24 hours');
            END IF;
          END IF;
        END IF;

        UPDATE public.profiles
        SET oaths_failed = coalesce(oaths_failed, 0) + 1,
            total_lost = coalesce(total_lost, 0) + coalesce(v_release, 0),
            updated_at = now()
        WHERE id = v_proof.submitted_by;

        IF v_oath.consequence_type = 'public_shame' THEN
          INSERT INTO public.wall_entries (oath_id, user_id, wall_type, oath_statement, stake_amount, excuse, username)
          VALUES (v_oath.id, v_proof.submitted_by, 'shame'::public.wall_type,
            v_oath.oath_statement, v_oath.stake_amount, 'My peer failed to verify my proof in time',
            (SELECT username FROM public.profiles WHERE id = v_proof.submitted_by));
        END IF;

        -- Notification: You lost because of your peers, not on us
        INSERT INTO public.notifications (
          user_id, oath_id, proof_id, type, title, message, status
        ) VALUES (
          v_proof.submitted_by,
          v_oath.id,
          v_proof.id,
          'system',
          'You Lost (Peer Failed to Review)',
          'You lost because of your peers and not others. Your referee failed to review within 24 hours. It is not on us.',
          'pending'
        );
      END IF;

    -- CASE B: Duo Duel Peer Verification
    ELSIF v_oath.verification_method = 'peer' THEN
      UPDATE public.group_members
      SET status = 'failed',
          is_winner = false
      WHERE oath_id = v_oath.id;

      IF v_oath.status = 'active' THEN
        UPDATE public.oaths
        SET status = 'failed',
            updated_at = now()
        WHERE id = v_oath.id;

        v_total_pot := v_oath.stake_amount * 2;

        SELECT id, coalesce(escrow_locked, 0)
        INTO v_creator_wallet, v_creator_escrow
        FROM public.wallets
        WHERE user_id = v_oath.creator_id
        FOR UPDATE;

        IF v_creator_wallet IS NOT NULL AND v_creator_escrow > 0 THEN
          v_release := least(v_creator_escrow, v_total_pot);
          UPDATE public.wallets
          SET escrow_locked = escrow_locked - v_release,
              total_lost = coalesce(total_lost, 0) + v_release,
              updated_at = now()
          WHERE id = v_creator_wallet;

          INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
          VALUES (v_creator_wallet, v_oath.id, 'penalty', v_release, 'Lost duel: Opponent failed to review proof within 24 hours');
        END IF;

        UPDATE public.profiles
        SET oaths_failed = coalesce(oaths_failed, 0) + 1,
            total_lost = coalesce(total_lost, 0) + coalesce(v_release, 0),
            updated_at = now()
        WHERE id = v_oath.creator_id;

        -- Notification: You lost because of your peers, not on us
        INSERT INTO public.notifications (
          user_id, oath_id, proof_id, type, title, message, status
        ) VALUES (
          v_proof.submitted_by,
          v_oath.id,
          v_proof.id,
          'system',
          'You Lost (Peer Failed to Review)',
          'You lost because of your peers and not others. Your opponent failed to review within 24 hours. It is not on us.',
          'pending'
        );

        IF v_oath.opponent_id IS NOT NULL AND v_oath.opponent_id <> v_proof.submitted_by THEN
          INSERT INTO public.notifications (
            user_id, oath_id, proof_id, type, title, message, status
          ) VALUES (
            v_oath.opponent_id,
            v_oath.id,
            v_proof.id,
            'system',
            'Duel Forfeited (Review Expired)',
            'The 24-hour review window expired without review. The duel has been marked as failed.',
            'pending'
          );
        END IF;
      END IF;

    -- CASE C: Quorum Squad / Lobby Verification
    ELSIF v_oath.verification_method = 'quorum' THEN
      UPDATE public.group_members
      SET status = 'failed',
          is_winner = false
      WHERE oath_id = v_oath.id AND user_id = v_proof.submitted_by;

      IF v_oath.oath_type = 'lobby' THEN
        SELECT id, coalesce(escrow_locked, 0)
        INTO v_submitter_wallet, v_submitter_escrow
        FROM public.wallets
        WHERE user_id = v_proof.submitted_by
        FOR UPDATE;

        IF v_submitter_wallet IS NOT NULL AND v_submitter_escrow > 0 THEN
          v_release := least(v_submitter_escrow, v_oath.stake_amount);
          UPDATE public.wallets
          SET escrow_locked = escrow_locked - v_release,
              total_lost = coalesce(total_lost, 0) + v_release,
              updated_at = now()
          WHERE id = v_submitter_wallet;

          INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
          VALUES (v_submitter_wallet, v_oath.id, 'penalty', v_release, 'Lost lobby: Quorum failed to review proof within 24 hours');
        END IF;

        UPDATE public.profiles
        SET oaths_failed = coalesce(oaths_failed, 0) + 1,
            total_lost = coalesce(total_lost, 0) + coalesce(v_release, 0),
            updated_at = now()
        WHERE id = v_proof.submitted_by;

        INSERT INTO public.notifications (
          user_id, oath_id, proof_id, type, title, message, status
        ) VALUES (
          v_proof.submitted_by,
          v_oath.id,
          v_proof.id,
          'system',
          'You Lost (Peer Failed to Review)',
          'You lost because of your peers and not others. Squad peers failed to review within 24 hours. It is not on us.',
          'pending'
        );

      ELSIF v_oath.group_mode = 'weakest_link' THEN
        UPDATE public.oaths
        SET status = 'failed', updated_at = now()
        WHERE id = v_oath.id;

        UPDATE public.group_members
        SET status = 'failed', is_winner = false
        WHERE oath_id = v_oath.id;

        v_squad_total := v_oath.stake_amount * greatest(1, coalesce(v_oath.max_players, 1));

        SELECT id, coalesce(escrow_locked, 0)
        INTO v_creator_wallet, v_creator_escrow
        FROM public.wallets
        WHERE user_id = v_oath.creator_id
        FOR UPDATE;

        IF v_creator_wallet IS NOT NULL AND v_creator_escrow > 0 THEN
          v_release := least(v_creator_escrow, v_squad_total);
          UPDATE public.wallets
          SET escrow_locked = escrow_locked - v_release,
              total_lost = coalesce(total_lost, 0) + v_release,
              updated_at = now()
          WHERE id = v_creator_wallet;

          INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
          VALUES (v_creator_wallet, v_oath.id, 'penalty', v_release, 'Weakest Link broken: Squad failed to review within 24 hours');
        END IF;

        UPDATE public.profiles
        SET oaths_failed = coalesce(oaths_failed, 0) + 1,
            total_lost = coalesce(total_lost, 0) + coalesce(v_release, 0),
            updated_at = now()
        WHERE id = v_oath.creator_id;

        FOR v_gm IN SELECT user_id FROM public.group_members WHERE oath_id = v_oath.id LOOP
          INSERT INTO public.notifications (
            user_id, oath_id, proof_id, type, title, message, status
          ) VALUES (
            v_gm.user_id,
            v_oath.id,
            v_proof.id,
            'system',
            'You Lost (Peer Failed to Review)',
            'You lost because of your peers and not others. Squad peers failed to review within 24 hours. It is not on us.',
            'pending'
          );
        END LOOP;

      ELSIF v_oath.group_mode = 'survival' THEN
        SELECT id, coalesce(escrow_locked, 0)
        INTO v_creator_wallet, v_creator_escrow
        FROM public.wallets
        WHERE user_id = v_oath.creator_id
        FOR UPDATE;

        IF v_creator_wallet IS NOT NULL AND v_creator_escrow > 0 THEN
          v_release := least(v_creator_escrow, v_oath.stake_amount);
          UPDATE public.wallets
          SET escrow_locked = escrow_locked - v_release,
              total_lost = coalesce(total_lost, 0) + v_release,
              updated_at = now()
          WHERE id = v_creator_wallet;

          INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
          VALUES (v_creator_wallet, v_oath.id, 'penalty', v_release, 'Member failed in survival: Quorum failed to review within 24 hours');
        END IF;

        UPDATE public.profiles
        SET oaths_failed = coalesce(oaths_failed, 0) + 1,
            total_lost = coalesce(total_lost, 0) + coalesce(v_release, 0),
            updated_at = now()
        WHERE id = v_proof.submitted_by;

        INSERT INTO public.notifications (
          user_id, oath_id, proof_id, type, title, message, status
        ) VALUES (
          v_proof.submitted_by,
          v_oath.id,
          v_proof.id,
          'system',
          'You Lost (Peer Failed to Review)',
          'You lost because of your peers and not others. Squad peers failed to review within 24 hours. It is not on us.',
          'pending'
        );
      END IF;
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;


-- 3. Update verify_nominee to strip duffer_debt and reputation_score modifications
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
SET row_security = off
AS $$
DECLARE
  v_nominee RECORD;
  v_oath RECORD;
  v_proof RECORD;
  v_creator_wallet UUID;
BEGIN
  SELECT * INTO v_nominee
  FROM public.nominees
  WHERE verification_token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid verification token');
  END IF;

  IF v_nominee.verified THEN
    RETURN jsonb_build_object('success', false, 'error', 'This oath has already been reviewed');
  END IF;

  SELECT * INTO v_oath
  FROM public.oaths
  WHERE id = v_nominee.oath_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Oath not found');
  END IF;

  SELECT * INTO v_proof
  FROM public.proofs
  WHERE oath_id = v_oath.id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  SELECT id INTO v_creator_wallet
  FROM public.wallets
  WHERE user_id = v_oath.creator_id
  FOR UPDATE;

  UPDATE public.nominees
  SET verified = true,
      responded_at = now()
  WHERE id = v_nominee.id;

  IF p_approved THEN
    UPDATE public.oaths
    SET status = 'completed',
        updated_at = now()
    WHERE id = v_oath.id;

    IF v_proof.id IS NOT NULL THEN
      UPDATE public.proofs
      SET status = 'verified'::public.proof_status,
          reviewed_at = now(),
          review_note = p_note
      WHERE id = v_proof.id;
    END IF;

    IF v_creator_wallet IS NOT NULL AND v_oath.stake_amount > 0 THEN
      UPDATE public.wallets
      SET balance = balance + v_oath.stake_amount,
          escrow_locked = escrow_locked - v_oath.stake_amount,
          updated_at = now()
      WHERE id = v_creator_wallet;

      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_creator_wallet, v_oath.id, 'escrow_release', v_oath.stake_amount, 'Escrow returned: Oath verified by nominee');
    END IF;

    UPDATE public.profiles
    SET oaths_completed = coalesce(oaths_completed, 0) + 1,
        updated_at = now()
    WHERE id = v_oath.creator_id;

    IF v_oath.consequence_type = 'public_shame' THEN
      INSERT INTO public.wall_entries (oath_id, user_id, wall_type, oath_statement, stake_amount, excuse, username)
      VALUES (v_oath.id, v_oath.creator_id, 'honor'::public.wall_type, v_oath.oath_statement, v_oath.stake_amount, NULL, (SELECT username FROM public.profiles WHERE id = v_oath.creator_id));
    END IF;

    INSERT INTO public.notifications (user_id, oath_id, type, title, message, status)
    VALUES (v_oath.creator_id, v_oath.id, 'system', 'Oath Verified', 'Your referee verified your oath proof. Escrow returned.', 'pending');

    RETURN jsonb_build_object('success', true, 'status', 'completed');
  ELSE
    UPDATE public.oaths
    SET status = 'failed',
        failure_excuse = coalesce(p_note, 'Rejected by nominee'),
        updated_at = now()
    WHERE id = v_oath.id;

    IF v_proof.id IS NOT NULL THEN
      UPDATE public.proofs
      SET status = 'rejected'::public.proof_status,
          reviewed_at = now(),
          review_note = p_note
      WHERE id = v_proof.id;
    END IF;

    IF v_creator_wallet IS NOT NULL AND v_oath.stake_amount > 0 THEN
      UPDATE public.wallets
      SET escrow_locked = escrow_locked - v_oath.stake_amount,
          total_lost = coalesce(total_lost, 0) + v_oath.stake_amount,
          updated_at = now()
      WHERE id = v_creator_wallet;

      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_creator_wallet, v_oath.id, 'penalty', v_oath.stake_amount, coalesce(p_note, 'Forfeited: Rejected by nominee'));
    END IF;

    UPDATE public.profiles
    SET oaths_failed = coalesce(oaths_failed, 0) + 1,
        total_lost = coalesce(total_lost, 0) + v_oath.stake_amount,
        updated_at = now()
    WHERE id = v_oath.creator_id;

    IF v_oath.consequence_type = 'public_shame' THEN
      INSERT INTO public.wall_entries (oath_id, user_id, wall_type, oath_statement, stake_amount, excuse, username)
      VALUES (v_oath.id, v_oath.creator_id, 'shame'::public.wall_type, v_oath.oath_statement, v_oath.stake_amount, coalesce(p_note, 'Rejected by nominee'), (SELECT username FROM public.profiles WHERE id = v_oath.creator_id));
    END IF;

    INSERT INTO public.notifications (user_id, oath_id, type, title, message, status)
    VALUES (v_oath.creator_id, v_oath.id, 'system', 'Oath Rejected', 'Your referee rejected your proof. Stake forfeited.', 'pending');

    RETURN jsonb_build_object('success', true, 'status', 'failed');
  END IF;
END;
$$;


-- 4. Update settle_duo_oath to strip duffer_debt and reputation_score modifications
DROP FUNCTION IF EXISTS public.settle_duo_oath(UUID, UUID);
CREATE OR REPLACE FUNCTION public.settle_duo_oath(
  p_oath_id UUID,
  p_winner_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_oath RECORD;
  v_creator_wallet UUID;
  v_creator_escrow NUMERIC;
  v_opponent_wallet UUID;
  v_winner_wallet UUID;
  v_loser UUID;
  v_total_pot NUMERIC;
  v_cut NUMERIC;
  v_payout NUMERIC;
BEGIN
  SELECT * INTO v_oath
  FROM public.oaths
  WHERE id = p_oath_id AND oath_type = 'duo' AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active duo oath not found';
  END IF;

  IF p_winner_id <> v_oath.creator_id AND p_winner_id <> coalesce(v_oath.opponent_id, '00000000-0000-0000-0000-000000000000'::UUID) THEN
    RAISE EXCEPTION 'Winner must be a participant in this duo oath';
  END IF;

  IF p_winner_id = v_oath.creator_id THEN
    v_loser := v_oath.opponent_id;
  ELSE
    v_loser := v_oath.creator_id;
  END IF;

  v_total_pot := v_oath.stake_amount * 2;
  v_cut := round((v_total_pot * coalesce(v_oath.house_cut_percent, 10)) / 100, 2);
  v_payout := v_total_pot - v_cut;

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
    VALUES (v_winner_wallet, p_oath_id, 'reward', v_payout, 'Won Duo Challenge');

    IF v_cut > 0 THEN
      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_winner_wallet, p_oath_id, 'house_cut', v_cut, 'Platform fee (10%)');
    END IF;
  END IF;

  UPDATE public.oaths
  SET status = 'completed', updated_at = now()
  WHERE id = p_oath_id;

  UPDATE public.group_members
  SET status = CASE WHEN user_id = p_winner_id THEN 'completed' ELSE 'failed' END,
      is_winner = (user_id = p_winner_id)
  WHERE oath_id = p_oath_id;

  -- Pure stats: NO duffer_debt, NO reputation_score modifications
  UPDATE public.profiles
  SET oaths_completed = coalesce(oaths_completed, 0) + 1,
      total_won = coalesce(total_won, 0) + (v_payout - v_oath.stake_amount),
      updated_at = now()
  WHERE id = p_winner_id;

  IF v_loser IS NOT NULL THEN
    UPDATE public.profiles
    SET oaths_failed = coalesce(oaths_failed, 0) + 1,
        total_lost = coalesce(total_lost, 0) + (CASE WHEN v_loser = v_oath.creator_id THEN v_total_pot ELSE 0 END),
        updated_at = now()
    WHERE id = v_loser;
  END IF;
END;
$$;


-- 5. Update cast_squad_vote: uses public.votes with dynamic quorum and NO duffer debt/reputation modifications
DROP FUNCTION IF EXISTS public.cast_squad_vote(UUID, UUID, BOOLEAN);
CREATE OR REPLACE FUNCTION public.cast_squad_vote(
  p_oath_id UUID,
  p_member_id UUID,
  p_approve BOOLEAN
) RETURNS VOID
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
  v_target_wallet UUID;
  v_creator_wallet UUID;
  v_squad_total NUMERIC;
  v_pending_count INT;
  v_actual_members INT;
  v_unfilled_refund NUMERIC;
  v_other_voters INT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oath not found'; END IF;
  IF v_oath.status <> 'active' THEN RAISE EXCEPTION 'Squad pool is not active'; END IF;

  SELECT * INTO v_member FROM public.group_members WHERE id = p_member_id AND oath_id = p_oath_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found'; END IF;
  IF v_member.status <> 'joined' THEN RAISE EXCEPTION 'Member is already settled'; END IF;
  IF NOT v_member.proof_submitted THEN RAISE EXCEPTION 'Member has not submitted proof yet'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.group_members WHERE oath_id = p_oath_id AND user_id = v_user) THEN
    RAISE EXCEPTION 'Only squad members can vote';
  END IF;

  IF v_member.user_id = v_user THEN
    RAISE EXCEPTION 'Cannot vote on your own proof';
  END IF;

  SELECT id INTO v_proof FROM public.proofs WHERE oath_id = p_oath_id AND submitted_by = v_member.user_id ORDER BY created_at DESC LIMIT 1;
  IF v_proof IS NULL THEN RAISE EXCEPTION 'No proof to vote on'; END IF;

  IF EXISTS (SELECT 1 FROM public.votes WHERE proof_id = v_proof AND voter_id = v_user) THEN
    RAISE EXCEPTION 'Already voted on this proof';
  END IF;

  INSERT INTO public.votes (proof_id, voter_id, oath_id, vote)
  VALUES (v_proof, v_user, p_oath_id, p_approve);

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
  WHERE oath_id = p_oath_id;

  v_needed := greatest(1, least(coalesce(nullif(v_member.votes_needed, 0), v_other_voters), v_other_voters));

  SELECT id INTO v_target_wallet FROM public.wallets WHERE user_id = v_member.user_id;
  SELECT id INTO v_creator_wallet FROM public.wallets WHERE user_id = v_oath.creator_id;

  -- Member approved by quorum
  IF v_yes >= v_needed THEN
    UPDATE public.group_members
    SET status = 'completed', is_winner = true
    WHERE id = p_member_id;

    UPDATE public.proofs
    SET status = 'verified'::public.proof_status
    WHERE oath_id = p_oath_id AND submitted_by = v_member.user_id;

    IF v_oath.oath_type = 'lobby' THEN
      IF v_target_wallet IS NOT NULL AND v_member.stake_amount > 0 THEN
        UPDATE public.wallets
        SET balance = balance + v_member.stake_amount,
            escrow_locked = escrow_locked - v_member.stake_amount,
            updated_at = now()
        WHERE id = v_target_wallet;

        INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
        VALUES (v_target_wallet, p_oath_id, 'escrow_release', v_member.stake_amount, 'Proof approved by quorum; buy-in returned');
      END IF;
    ELSIF v_oath.group_mode = 'survival' THEN
      IF v_creator_wallet IS NOT NULL AND v_oath.stake_amount > 0 THEN
        UPDATE public.wallets
        SET balance = balance + v_oath.stake_amount,
            escrow_locked = escrow_locked - v_oath.stake_amount,
            updated_at = now()
        WHERE id = v_creator_wallet;

        INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
        VALUES (v_creator_wallet, p_oath_id, 'escrow_release', v_oath.stake_amount, 'Member proof approved; leader stake returned');
      END IF;
    END IF;

    -- Pure stats: NO duffer_debt, NO reputation_score modifications
    UPDATE public.profiles
    SET oaths_completed = coalesce(oaths_completed, 0) + 1,
        updated_at = now()
    WHERE id = v_member.user_id;

  -- Member rejected by quorum
  ELSIF v_no >= v_needed THEN
    UPDATE public.group_members
    SET status = 'failed', is_winner = false
    WHERE id = p_member_id;

    UPDATE public.proofs
    SET status = 'rejected'::public.proof_status
    WHERE oath_id = p_oath_id AND submitted_by = v_member.user_id;

    IF v_oath.oath_type = 'lobby' THEN
      IF v_target_wallet IS NOT NULL AND v_member.stake_amount > 0 THEN
        UPDATE public.wallets
        SET escrow_locked = escrow_locked - v_member.stake_amount,
            total_lost = coalesce(total_lost, 0) + v_member.stake_amount,
            updated_at = now()
        WHERE id = v_target_wallet;

        INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
        VALUES (v_target_wallet, p_oath_id, 'penalty', v_member.stake_amount, 'Proof rejected by quorum; buy-in forfeited');
      END IF;
    ELSIF v_oath.group_mode = 'survival' THEN
      IF v_creator_wallet IS NOT NULL AND v_oath.stake_amount > 0 THEN
        UPDATE public.wallets
        SET escrow_locked = escrow_locked - v_oath.stake_amount,
            total_lost = coalesce(total_lost, 0) + v_oath.stake_amount,
            updated_at = now()
        WHERE id = v_creator_wallet;

        INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
        VALUES (v_creator_wallet, p_oath_id, 'penalty', v_oath.stake_amount, 'Member rejected in survival mode; leader stake seized');
      END IF;
    ELSIF v_oath.group_mode = 'weakest_link' THEN
      v_squad_total := v_oath.stake_amount * greatest(1, coalesce(v_oath.max_players, 1));
      IF v_creator_wallet IS NOT NULL AND v_squad_total > 0 THEN
        UPDATE public.wallets
        SET escrow_locked = escrow_locked - v_squad_total,
            total_lost = coalesce(total_lost, 0) + v_squad_total,
            updated_at = now()
        WHERE id = v_creator_wallet;

        INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
        VALUES (v_creator_wallet, p_oath_id, 'penalty', v_squad_total, 'Weakest Link broken by member; entire squad pool seized');
      END IF;

      UPDATE public.group_members
      SET status = 'failed', is_winner = false
      WHERE oath_id = p_oath_id;

      UPDATE public.oaths
      SET status = 'failed', updated_at = now()
      WHERE id = p_oath_id;

      RETURN;
    END IF;

    -- Pure stats: NO duffer_debt, NO reputation_score modifications
    UPDATE public.profiles
    SET oaths_failed = coalesce(oaths_failed, 0) + 1,
        total_lost = coalesce(total_lost, 0) + (CASE WHEN v_oath.oath_type = 'lobby' THEN v_member.stake_amount ELSE 0 END),
        updated_at = now()
    WHERE id = v_member.user_id;
  END IF;

  -- Check if all members are resolved
  SELECT count(*) INTO v_pending_count
  FROM public.group_members
  WHERE oath_id = p_oath_id AND status = 'joined';

  IF v_pending_count = 0 THEN
    IF v_oath.group_mode = 'weakest_link' AND NOT EXISTS (
      SELECT 1 FROM public.group_members WHERE oath_id = p_oath_id AND status = 'failed'
    ) THEN
      v_squad_total := v_oath.stake_amount * greatest(1, coalesce(v_oath.max_players, 1));
      IF v_creator_wallet IS NOT NULL AND v_squad_total > 0 THEN
        UPDATE public.wallets
        SET balance = balance + v_squad_total,
            escrow_locked = escrow_locked - v_squad_total,
            updated_at = now()
        WHERE id = v_creator_wallet;

        INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
        VALUES (v_creator_wallet, p_oath_id, 'escrow_release', v_squad_total, 'Weakest link squad succeeded; full escrow returned to leader');
      END IF;
    END IF;

    IF v_oath.oath_type = 'squad' AND v_oath.group_mode = 'survival' THEN
      SELECT count(*) INTO v_actual_members FROM public.group_members WHERE oath_id = p_oath_id;
      IF v_actual_members < v_oath.max_players THEN
        v_unfilled_refund := v_oath.stake_amount * (v_oath.max_players - v_actual_members);
        IF v_unfilled_refund > 0 AND v_creator_wallet IS NOT NULL THEN
          UPDATE public.wallets
          SET balance = balance + v_unfilled_refund,
              escrow_locked = escrow_locked - v_unfilled_refund,
              updated_at = now()
          WHERE id = v_creator_wallet;

          INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
          VALUES (v_creator_wallet, p_oath_id, 'escrow_release', v_unfilled_refund, 'Unfilled squad slots refund');
        END IF;
      END IF;
    END IF;

    UPDATE public.oaths
    SET status = 'completed', updated_at = now()
    WHERE id = p_oath_id;
  END IF;
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION public.submit_oath_proof(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_oath_proof(UUID, TEXT, TEXT, TEXT) TO authenticated, anon;

REVOKE ALL ON FUNCTION public.auto_resolve_ghosted_proofs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_resolve_ghosted_proofs() TO authenticated, anon;

REVOKE ALL ON FUNCTION public.verify_nominee(TEXT, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_nominee(TEXT, BOOLEAN, TEXT) TO authenticated, anon;

REVOKE ALL ON FUNCTION public.settle_duo_oath(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_duo_oath(UUID, UUID) TO authenticated, anon;

REVOKE ALL ON FUNCTION public.cast_squad_vote(UUID, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cast_squad_vote(UUID, UUID, BOOLEAN) TO authenticated, anon;
