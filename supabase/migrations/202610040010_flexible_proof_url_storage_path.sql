-- Migration 202610040010: Flexible proof storage path extraction in submit_oath_proof
-- Fixes error "Uploaded proof must use your private oath storage path" when full Supabase storage URL is provided.

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
  v_storage_path TEXT;
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
    IF p_proof_url IS NULL OR trim(p_proof_url) = '' THEN
      RAISE EXCEPTION 'Uploaded proof file is required';
    END IF;

    -- Extract relative storage path if a full Supabase URL was provided
    -- Handles:
    -- 1) Standard path: <oath_id>/<user_id>/<filename>
    -- 2) Full public URL: https://.../storage/v1/object/public/(oath-proofs|proofs)/<oath_id>/<user_id>/<filename>
    -- 3) Full signed URL: https://.../storage/v1/object/sign/(oath-proofs|proofs)/<oath_id>/<user_id>/<filename>?token=...
    v_storage_path := regexp_replace(p_proof_url, '^.*/storage/v1/object/(?:public|sign)/(?:oath-proofs|proofs)/', '');
    v_storage_path := regexp_replace(v_storage_path, '^.*/(?:oath-proofs|proofs)/', '');
    v_storage_path := split_part(v_storage_path, '?', 1);

    IF v_storage_path NOT LIKE p_oath_id::text || '/' || v_user::text || '/%' THEN
      RAISE EXCEPTION 'Uploaded proof must use your private oath storage path';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM storage.objects so 
      WHERE so.bucket_id IN ('oath-proofs', 'proofs') 
        AND so.name = v_storage_path
    ) THEN
      RAISE EXCEPTION 'Proof file was not uploaded to private storage';
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

      -- Update submitter profile stats
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

GRANT EXECUTE ON FUNCTION public.submit_oath_proof(UUID, TEXT, TEXT, TEXT) TO authenticated;
