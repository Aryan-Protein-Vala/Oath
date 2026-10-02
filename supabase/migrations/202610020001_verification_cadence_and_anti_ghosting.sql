-- Migration 202610020001: Verification cadence (24h), notifications dispatch, and anti-ghosting auto-settlement

-- 1. Add review_deadline to proofs table
ALTER TABLE public.proofs ADD COLUMN IF NOT EXISTS review_deadline TIMESTAMPTZ DEFAULT (now() + interval '24 hours');

-- Backfill any existing proofs lacking a review_deadline
UPDATE public.proofs
SET review_deadline = created_at + interval '24 hours'
WHERE review_deadline IS NULL;

-- 2. Enhanced submit_oath_proof with 24-hour review cadence, notification triggers, and solo_lonely auto-settlement
CREATE OR REPLACE FUNCTION public.submit_oath_proof(
  p_oath_id UUID, 
  p_proof_type TEXT, 
  p_proof_url TEXT DEFAULT NULL, 
  p_proof_text TEXT DEFAULT NULL
) RETURNS UUID 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = pg_catalog, public, pg_temp 
AS $$
DECLARE 
  v_user UUID := auth.uid(); 
  v_id UUID;
  v_oath public.oaths%ROWTYPE;
  v_nominee RECORD;
  v_peer UUID;
  v_submitter_username TEXT;
  v_creator_wallet UUID;
  v_deadline TIMESTAMPTZ := now() + interval '24 hours';
BEGIN
  IF v_user IS NULL THEN 
    RAISE EXCEPTION 'Authentication required'; 
  END IF;

  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Oath not found';
  END IF;

  IF v_oath.status <> 'active' OR v_oath.deadline <= now() THEN
    RAISE EXCEPTION 'Oath is closed, expired, or you are not an active participant';
  END IF;

  IF v_oath.creator_id <> v_user 
     AND coalesce(v_oath.opponent_id, '00000000-0000-0000-0000-000000000000'::uuid) <> v_user 
     AND NOT EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.oath_id = p_oath_id AND gm.user_id = v_user) THEN
    RAISE EXCEPTION 'Oath is closed, expired, or you are not an active participant';
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

  -- Insert proof with 24-hour review deadline
  INSERT INTO public.proofs (oath_id, submitted_by, proof_type, proof_url, proof_text, review_deadline, status)
  VALUES (p_oath_id, v_user, p_proof_type, p_proof_url, left(p_proof_text, 5000), v_deadline, 'pending_review'::public.proof_status)
  RETURNING id INTO v_id;

  -- Mark group member's proof as submitted
  UPDATE public.group_members 
  SET proof_submitted = true 
  WHERE oath_id = p_oath_id AND user_id = v_user;

  SELECT username INTO v_submitter_username FROM public.profiles WHERE id = v_user;

  -- Dispatch notifications / resolve depending on verification_method
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
        '@' || coalesce(v_submitter_username, 'User') || ' submitted proof for "' || left(v_oath.oath_statement, 60) || '". You have 24 hours to review.',
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
        '@' || coalesce(v_submitter_username, 'Opponent') || ' submitted proof for duel. You have 24 hours to review.',
        v_user,
        'pending'
      );
    END IF;

  ELSIF v_oath.verification_method = 'quorum' THEN
    INSERT INTO public.notifications (
      user_id, oath_id, proof_id, type, title, message, actor_id, status
    )
    SELECT 
      gm.user_id,
      p_oath_id,
      v_id,
      'verify_proof',
      'Squad Proof to Vote',
      '@' || coalesce(v_submitter_username, 'Member') || ' submitted proof. Cast your vote within 24 hours.',
      v_user,
      'pending'
    FROM public.group_members gm
    WHERE gm.oath_id = p_oath_id 
      AND gm.user_id <> v_user 
      AND gm.status = 'joined';

  ELSIF v_oath.verification_method = 'solo_lonely' THEN
    -- Self-verified photo/evidence: auto-verify proof and settle creator escrow
    UPDATE public.proofs
    SET status = 'verified'::public.proof_status,
        reviewed_at = now(),
        review_note = 'Solo self-verified evidence'
    WHERE id = v_id;

    UPDATE public.group_members
    SET status = 'completed',
        is_winner = true,
        proof_submitted = true
    WHERE oath_id = p_oath_id AND user_id = v_user;

    IF v_oath.status = 'active' THEN
      UPDATE public.oaths
      SET status = 'completed',
          updated_at = now()
      WHERE id = p_oath_id;

      IF v_oath.stake_amount > 0 THEN
        SELECT id INTO v_creator_wallet FROM public.wallets WHERE user_id = v_oath.creator_id FOR UPDATE;
        IF v_creator_wallet IS NOT NULL THEN
          UPDATE public.wallets
          SET balance = balance + v_oath.stake_amount,
              escrow_locked = greatest(0, escrow_locked - v_oath.stake_amount),
              updated_at = now()
          WHERE id = v_creator_wallet;

          INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
          VALUES (v_creator_wallet, p_oath_id, 'escrow_release', v_oath.stake_amount, 'Solo oath self-verified; escrow released');
        END IF;
      END IF;

      UPDATE public.profiles
      SET oaths_completed = coalesce(oaths_completed, 0) + 1,
          duffer_debt = greatest(0, coalesce(duffer_debt, 0) - 1),
          reputation_score = least(100, coalesce(reputation_score, 100) + 2),
          updated_at = now()
      WHERE id = v_oath.creator_id;

      IF v_oath.consequence_type = 'public_shame' THEN
        INSERT INTO public.wall_entries (oath_id, user_id, wall_type, oath_statement, stake_amount, excuse, username)
        SELECT p_oath_id, v_oath.creator_id, 'honor'::public.wall_type,
          v_oath.oath_statement, v_oath.stake_amount, NULL,
          coalesce(v_submitter_username, (SELECT username FROM public.profiles WHERE id = v_oath.creator_id));
      END IF;
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

-- 3. Auto-resolve ghosted proofs function
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
  v_opponent_wallet UUID;
  v_opponent_escrow NUMERIC;
  v_submitter_wallet UUID;
  v_submitter_escrow NUMERIC;
  v_peer UUID;
  v_total_pot NUMERIC;
  v_cut NUMERIC;
  v_payout NUMERIC;
  v_release NUMERIC;
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

    -- Case A: Nominee verification ghosting (>24h)
    IF v_oath.verification_method = 'nominee' THEN
      -- 1. Auto-approve proof
      UPDATE public.proofs
      SET status = 'verified'::public.proof_status,
          reviewed_at = now(),
          review_note = 'Auto-approved: Referee ghosted past 24-hour review window'
      WHERE id = v_proof.id;

      -- 2. Mark nominee as verified
      UPDATE public.nominees
      SET verified = true,
          responded_at = now()
      WHERE oath_id = v_oath.id;

      -- 3. Mark group_members if present
      UPDATE public.group_members
      SET status = 'completed',
          is_winner = true,
          proof_submitted = true
      WHERE oath_id = v_oath.id AND user_id = v_proof.submitted_by;

      -- 4. Complete oath and release escrow if still active
      IF v_oath.status = 'active' THEN
        UPDATE public.oaths
        SET status = 'completed',
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
              SET balance = balance + v_release,
                  escrow_locked = escrow_locked - v_release,
                  updated_at = now()
              WHERE id = v_submitter_wallet;

              INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
              VALUES (v_submitter_wallet, v_oath.id, 'escrow_release', v_release, 'Anti-ghosting guarantee: Stake returned after referee failed to review within 24 hours');
            END IF;
          END IF;
        END IF;

        -- Update submitter profile
        UPDATE public.profiles
        SET oaths_completed = coalesce(oaths_completed, 0) + 1,
            duffer_debt = greatest(0, coalesce(duffer_debt, 0) - 1),
            reputation_score = least(100, coalesce(reputation_score, 100) + 2),
            updated_at = now()
        WHERE id = v_proof.submitted_by;

        IF v_oath.consequence_type = 'public_shame' THEN
          INSERT INTO public.wall_entries (oath_id, user_id, wall_type, oath_statement, stake_amount, excuse, username)
          SELECT v_oath.id, v_proof.submitted_by, 'honor'::public.wall_type,
            v_oath.oath_statement, v_oath.stake_amount, NULL,
            (SELECT username FROM public.profiles WHERE id = v_proof.submitted_by);
        END IF;

        -- Dispatch notification
        INSERT INTO public.notifications (
          user_id, oath_id, proof_id, type, title, message, status
        ) VALUES (
          v_proof.submitted_by,
          v_oath.id,
          v_proof.id,
          'system',
          'Proof Auto-Approved (Anti-Ghosting)',
          'Your referee did not review within 24 hours. Your oath was successfully completed and your stake released.',
          'pending'
        );
      END IF;

      v_count := v_count + 1;

    -- Case B: Peer verification ghosting (Duo challenge)
    ELSIF v_oath.verification_method = 'peer' THEN
      IF v_proof.submitted_by = v_oath.creator_id THEN
        v_peer := v_oath.opponent_id;
      ELSE
        v_peer := v_oath.creator_id;
      END IF;

      -- 1. Auto-approve proof
      UPDATE public.proofs
      SET status = 'verified'::public.proof_status,
          reviewed_at = now(),
          review_note = 'Auto-approved: Opponent ghosted past 24-hour review window'
      WHERE id = v_proof.id;

      -- 2. Update group_members: submitter completed/winner, ghosted peer failed
      UPDATE public.group_members
      SET status = 'completed',
          is_winner = true,
          proof_submitted = true
      WHERE oath_id = v_oath.id AND user_id = v_proof.submitted_by;

      IF v_peer IS NOT NULL THEN
        UPDATE public.group_members
        SET status = 'failed',
            is_winner = false
        WHERE oath_id = v_oath.id AND user_id = v_peer;
      END IF;

      -- 3. Settle duel if active
      IF v_oath.status = 'active' THEN
        UPDATE public.oaths
        SET status = 'completed',
            updated_at = now()
        WHERE id = v_oath.id;

        v_total_pot := v_oath.stake_amount * 2;
        v_cut := round((v_total_pot * coalesce(v_oath.house_cut_percent, 10)) / 100, 2);
        v_payout := v_total_pot - v_cut;

        SELECT id, coalesce(escrow_locked, 0)
        INTO v_creator_wallet, v_creator_escrow
        FROM public.wallets
        WHERE user_id = v_oath.creator_id
        FOR UPDATE;

        IF v_oath.opponent_id IS NOT NULL THEN
          SELECT id, coalesce(escrow_locked, 0)
          INTO v_opponent_wallet, v_opponent_escrow
          FROM public.wallets
          WHERE user_id = v_oath.opponent_id
          FOR UPDATE;
        END IF;

        IF v_proof.submitted_by = v_oath.creator_id THEN
          -- Creator won because opponent ghosted
          IF v_creator_escrow >= v_total_pot THEN
            UPDATE public.wallets
            SET escrow_locked = escrow_locked - v_total_pot,
                balance = balance + v_payout,
                total_won = coalesce(total_won, 0) + (v_payout - v_oath.stake_amount),
                updated_at = now()
            WHERE id = v_creator_wallet;
          ELSE
            v_release := least(v_creator_escrow, v_total_pot);
            UPDATE public.wallets
            SET escrow_locked = escrow_locked - v_release,
                balance = balance + v_payout,
                total_won = coalesce(total_won, 0) + (v_payout - v_oath.stake_amount),
                updated_at = now()
            WHERE id = v_creator_wallet;

            IF v_opponent_wallet IS NOT NULL AND v_opponent_escrow > 0 THEN
              UPDATE public.wallets
              SET escrow_locked = escrow_locked - least(v_opponent_escrow, v_oath.stake_amount),
                  total_lost = coalesce(total_lost, 0) + least(v_opponent_escrow, v_oath.stake_amount),
                  updated_at = now()
              WHERE id = v_opponent_wallet;
            END IF;
          END IF;

          IF v_creator_wallet IS NOT NULL THEN
            INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
            VALUES (v_creator_wallet, v_oath.id, 'reward', v_payout, 'Won Duel (Opponent ghosted proof verification)');
            IF v_cut > 0 THEN
              INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
              VALUES (v_creator_wallet, v_oath.id, 'house_cut', v_cut, 'Platform fee (Duel Auto-Settlement)');
            END IF;
          END IF;

          UPDATE public.profiles
          SET oaths_completed = coalesce(oaths_completed, 0) + 1,
              total_won = coalesce(total_won, 0) + (v_payout - v_oath.stake_amount),
              duffer_debt = greatest(0, coalesce(duffer_debt, 0) - 1),
              reputation_score = least(100, coalesce(reputation_score, 100) + 2),
              updated_at = now()
          WHERE id = v_oath.creator_id;

          IF v_oath.opponent_id IS NOT NULL THEN
            UPDATE public.profiles
            SET oaths_failed = coalesce(oaths_failed, 0) + 1,
                duffer_debt = coalesce(duffer_debt, 0) + 2,
                reputation_score = greatest(0, coalesce(reputation_score, 100) - 5),
                updated_at = now()
            WHERE id = v_oath.opponent_id;
          END IF;

          INSERT INTO public.notifications (
            user_id, oath_id, proof_id, type, title, message, status
          ) VALUES (
            v_oath.creator_id,
            v_oath.id,
            v_proof.id,
            'system',
            'Duel Won by Default (Opponent Ghosted)',
            'Your opponent did not review your proof within 24 hours. You have been awarded victory in the duel!',
            'pending'
          );

        ELSE
          -- Opponent won because creator ghosted
          IF v_creator_escrow >= v_total_pot THEN
            UPDATE public.wallets
            SET escrow_locked = escrow_locked - v_total_pot,
                total_lost = coalesce(total_lost, 0) + v_total_pot,
                updated_at = now()
            WHERE id = v_creator_wallet;
          ELSE
            v_release := least(v_creator_escrow, v_total_pot);
            UPDATE public.wallets
            SET escrow_locked = escrow_locked - v_release,
                total_lost = coalesce(total_lost, 0) + v_release,
                updated_at = now()
            WHERE id = v_creator_wallet;
          END IF;

          IF v_opponent_wallet IS NOT NULL THEN
            UPDATE public.wallets
            SET balance = balance + v_payout,
                total_won = coalesce(total_won, 0) + v_payout,
                updated_at = now()
            WHERE id = v_opponent_wallet;

            INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
            VALUES (v_opponent_wallet, v_oath.id, 'reward', v_payout, 'Won Duel (Opponent ghosted proof verification)');
          END IF;

          IF v_creator_wallet IS NOT NULL THEN
            INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
            VALUES (v_creator_wallet, v_oath.id, 'penalty', v_total_pot, 'Lost Duel: Ghosted verification for 24 hours');
            IF v_cut > 0 THEN
              INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
              VALUES (v_creator_wallet, v_oath.id, 'house_cut', v_cut, 'Platform fee (Duel Auto-Settlement)');
            END IF;
          END IF;

          IF v_oath.opponent_id IS NOT NULL THEN
            UPDATE public.profiles
            SET oaths_completed = coalesce(oaths_completed, 0) + 1,
                total_won = coalesce(total_won, 0) + v_payout,
                duffer_debt = greatest(0, coalesce(duffer_debt, 0) - 1),
                reputation_score = least(100, coalesce(reputation_score, 100) + 2),
                updated_at = now()
            WHERE id = v_oath.opponent_id;
          END IF;

          UPDATE public.profiles
          SET oaths_failed = coalesce(oaths_failed, 0) + 1,
              total_lost = coalesce(total_lost, 0) + v_total_pot,
              duffer_debt = coalesce(duffer_debt, 0) + 2,
              reputation_score = greatest(0, coalesce(reputation_score, 100) - 5),
              updated_at = now()
          WHERE id = v_oath.creator_id;

          IF v_oath.opponent_id IS NOT NULL THEN
            INSERT INTO public.notifications (
              user_id, oath_id, proof_id, type, title, message, status
            ) VALUES (
              v_oath.opponent_id,
              v_oath.id,
              v_proof.id,
              'system',
              'Duel Won by Default (Opponent Ghosted)',
              'Your opponent did not review your proof within 24 hours. You have been awarded victory in the duel!',
              'pending'
            );
          END IF;
        END IF;
      END IF;

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

-- 4. Permissions grants
REVOKE ALL ON FUNCTION public.submit_oath_proof(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_oath_proof(UUID, TEXT, TEXT, TEXT) TO authenticated, anon;

REVOKE ALL ON FUNCTION public.auto_resolve_ghosted_proofs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_resolve_ghosted_proofs() TO authenticated, anon;
