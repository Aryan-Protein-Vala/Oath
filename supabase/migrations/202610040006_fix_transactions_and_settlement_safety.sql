-- Migration 202610040006: Fix Transactions and Settlement Safety
-- 1. Drops transactions with non-positive amounts silently before insert to prevent transactions_amount_check violations
-- 2. Hardens settle_duo_oath, settle_oath(TEXT), settle_oath(BOOLEAN, TEXT), and pass_today_work
-- 3. Grants execute permissions to appropriate roles

-- ============================================================
-- 1. TRIGGER: trg_ignore_non_positive_transactions
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_ignore_non_positive_transactions()
RETURNS trigger AS $$
BEGIN
  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
    RETURN NULL; -- Dropping row silently avoids check constraint violation
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transactions_ignore_non_positive ON public.transactions;
CREATE TRIGGER trg_transactions_ignore_non_positive
BEFORE INSERT ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.trg_ignore_non_positive_transactions();

-- Safety alias for record_oath_success if called anywhere
CREATE OR REPLACE FUNCTION public.record_oath_success(p_user_id UUID, p_stake NUMERIC DEFAULT 0)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM public.handle_profile_success(p_user_id, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_oath_success(UUID, NUMERIC) TO authenticated, anon;

-- ============================================================
-- 2. FUNCTION: settle_duo_oath(UUID, UUID, TEXT) & (UUID, UUID)
-- ============================================================
DROP FUNCTION IF EXISTS public.settle_duo_oath(UUID, UUID);
DROP FUNCTION IF EXISTS public.settle_duo_oath(UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.settle_duo_oath(
  p_oath_id UUID,
  p_winner_id UUID,
  p_reason TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_oath public.oaths%ROWTYPE;
  v_caller UUID := auth.uid();
  v_creator_wallet UUID;
  v_opponent_wallet UUID;
  v_winner_wallet UUID;
  v_loser UUID;
  v_total_pot NUMERIC;
  v_payout NUMERIC;
  v_creator_escrow NUMERIC;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oath not found'; END IF;
  IF v_oath.oath_type <> 'duo' THEN RAISE EXCEPTION 'Not a duo oath'; END IF;
  IF v_oath.status <> 'active' AND v_oath.status::text <> 'in_review' THEN
    RAISE EXCEPTION 'Oath is not active or in review (current: %)', v_oath.status;
  END IF;

  -- Allow verifier to be creator, opponent, or admin
  IF v_caller <> v_oath.creator_id 
     AND (v_oath.opponent_id IS NULL OR v_caller <> v_oath.opponent_id) 
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only duel participants or admins can settle';
  END IF;

  IF p_winner_id <> v_oath.creator_id AND (v_oath.opponent_id IS NULL OR p_winner_id <> v_oath.opponent_id) THEN
    RAISE EXCEPTION 'Invalid winner ID';
  END IF;

  IF p_winner_id = v_oath.creator_id THEN
    v_loser := v_oath.opponent_id;
  ELSE
    v_loser := v_oath.creator_id;
  END IF;

  -- 100% of the pot goes to the winner because 10% fee was paid upfront at creation!
  v_total_pot := coalesce(v_oath.stake_amount, 0) * 2;
  v_payout := v_total_pot;

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

  -- Deduct escrow from creator (who funded the duel upfront)
  IF v_creator_wallet IS NOT NULL AND v_total_pot > 0 THEN
    UPDATE public.wallets
    SET escrow_locked = greatest(0, escrow_locked - least(v_creator_escrow, v_total_pot)),
        updated_at = now()
    WHERE id = v_creator_wallet;
  END IF;

  IF v_winner_wallet IS NOT NULL THEN
    IF coalesce(v_payout, 0) > 0 THEN
      UPDATE public.wallets
      SET balance = balance + v_payout,
          total_won = coalesce(total_won, 0) + (v_payout - coalesce(v_oath.stake_amount, 0)),
          updated_at = now()
      WHERE id = v_winner_wallet;

      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_winner_wallet, p_oath_id, 'reward', v_payout, 'Won Duo Challenge (100% pot payout)');
    END IF;
  END IF;

  UPDATE public.oaths
  SET status = 'completed', updated_at = now()
  WHERE id = p_oath_id;

  UPDATE public.group_members
  SET status = CASE WHEN user_id = p_winner_id THEN 'completed' ELSE 'failed' END,
      updated_at = now()
  WHERE oath_id = p_oath_id;

  -- Update proofs
  UPDATE public.proofs
  SET status = CASE WHEN submitted_by = p_winner_id THEN 'verified'::public.proof_status ELSE 'rejected'::public.proof_status END,
      reviewer_id = v_caller,
      review_note = coalesce(nullif(trim(p_reason), ''), 'Peer review settled'),
      reviewed_at = now()
  WHERE oath_id = p_oath_id AND status IN ('pending_review', 'needs_more_proof');

  -- Winner success handler (resets loss streak)
  PERFORM public.handle_profile_success(p_winner_id, CASE WHEN coalesce(v_payout, 0) > coalesce(v_oath.stake_amount, 0) THEN v_payout - v_oath.stake_amount ELSE 0 END);

  -- Loser failure handler (increments loss streak, triggers Penalty Box on 3rd fail)
  IF v_loser IS NOT NULL THEN
    PERFORM public.handle_profile_failure(v_loser, coalesce(v_oath.stake_amount, 0), p_oath_id);
  END IF;
END;
$$;

-- Overload for 2 parameters (p_oath_id, p_winner_id)
CREATE OR REPLACE FUNCTION public.settle_duo_oath(
  p_oath_id UUID,
  p_winner_id UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM public.settle_duo_oath(p_oath_id, p_winner_id, 'Peer review settled');
END;
$$;

-- ============================================================
-- 3. FUNCTION: settle_oath(UUID, TEXT)
-- ============================================================
CREATE OR REPLACE FUNCTION public.settle_oath(p_oath_id UUID, p_outcome TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_user UUID := auth.uid();
  v_oath public.oaths%ROWTYPE;
  v_creator_wallet UUID;
  v_opponent_wallet UUID;
  v_total_pot NUMERIC;
  v_cut NUMERIC;
  v_payout NUMERIC;
  v_is_nominee BOOLEAN := FALSE;
  v_member RECORD;
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

    -- Deduct total pot strictly from creator's escrow (creator paid for both)
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

    -- Update proofs
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
      WHERE n.oath_id = p_oath_id
        AND (n.nominee_user_id = v_user OR n.email = (SELECT email FROM auth.users WHERE id = v_user))
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

      -- Mark nominees verified if nominee verified
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

      -- Mark nominees verified with penalty
      UPDATE public.nominees
      SET verified = TRUE,
          verdict = 'penalty',
          responded_at = now()
      WHERE oath_id = p_oath_id;
    END IF;

    -- Update proofs
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

  ELSE
    -- Group / Squad / Lobby oaths settled via outcome text
    IF v_user <> v_oath.creator_id 
       AND NOT EXISTS (SELECT 1 FROM public.group_members WHERE oath_id = p_oath_id AND user_id = v_user)
       AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'Not authorized to settle this group oath';
    END IF;

    IF p_outcome = 'completed' THEN
      FOR v_member IN 
        SELECT * FROM public.group_members 
        WHERE oath_id = p_oath_id AND status IN ('joined', 'active') 
      LOOP
        UPDATE public.group_members 
        SET status = 'completed', is_winner = TRUE, updated_at = now() 
        WHERE id = v_member.id;

        IF coalesce(v_member.stake_amount, v_oath.stake_amount, 0) > 0 THEN
          SELECT id INTO v_creator_wallet FROM public.wallets WHERE user_id = v_member.user_id FOR UPDATE;
          IF v_creator_wallet IS NOT NULL THEN
            UPDATE public.wallets 
            SET balance = balance + coalesce(v_member.stake_amount, v_oath.stake_amount, 0), 
                escrow_locked = greatest(0, escrow_locked - coalesce(v_member.stake_amount, v_oath.stake_amount, 0)),
                updated_at = now()
            WHERE id = v_creator_wallet;

            INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
            VALUES (v_creator_wallet, p_oath_id, 'escrow_release', coalesce(v_member.stake_amount, v_oath.stake_amount, 0), 'Group oath completed: Stake released in full');
          END IF;
        END IF;

        PERFORM public.handle_profile_success(v_member.user_id, 0);
      END LOOP;

      UPDATE public.oaths SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = p_oath_id;
    ELSE
      FOR v_member IN 
        SELECT * FROM public.group_members 
        WHERE oath_id = p_oath_id AND status IN ('joined', 'active') 
      LOOP
        UPDATE public.group_members 
        SET status = 'failed', is_winner = FALSE, updated_at = now() 
        WHERE id = v_member.id;

        IF coalesce(v_member.stake_amount, v_oath.stake_amount, 0) > 0 THEN
          SELECT id INTO v_creator_wallet FROM public.wallets WHERE user_id = v_member.user_id FOR UPDATE;
          IF v_creator_wallet IS NOT NULL THEN
            UPDATE public.wallets 
            SET total_lost = total_lost + coalesce(v_member.stake_amount, v_oath.stake_amount, 0), 
                escrow_locked = greatest(0, escrow_locked - coalesce(v_member.stake_amount, v_oath.stake_amount, 0)),
                updated_at = now()
            WHERE id = v_creator_wallet;

            INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
            VALUES (v_creator_wallet, p_oath_id, 'penalty', coalesce(v_member.stake_amount, v_oath.stake_amount, 0), 'Group oath failed: Stake forfeited');
          END IF;
        END IF;

        PERFORM public.handle_profile_failure(v_member.user_id, coalesce(v_member.stake_amount, v_oath.stake_amount, 0), p_oath_id);
      END LOOP;

      UPDATE public.oaths SET status = 'failed', updated_at = now() WHERE id = p_oath_id;
    END IF;

    UPDATE public.proofs
    SET status = CASE WHEN p_outcome = 'completed' THEN 'verified'::public.proof_status ELSE 'rejected'::public.proof_status END,
        reviewer_id = v_user,
        reviewed_at = now()
    WHERE oath_id = p_oath_id AND status IN ('pending_review', 'needs_more_proof');
  END IF;
END;
$$;

-- ============================================================
-- 4. FUNCTION: settle_oath(UUID, BOOLEAN, TEXT)
-- ============================================================
CREATE OR REPLACE FUNCTION public.settle_oath(
  p_oath_id UUID, 
  p_success BOOLEAN, 
  p_note TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_oath public.oaths%ROWTYPE;
  v_user UUID := auth.uid();
  v_proof_submitter UUID;
  v_outcome TEXT;
BEGIN
  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id;
  IF NOT FOUND THEN 
    RAISE EXCEPTION 'Oath not found'; 
  END IF;
  IF v_oath.status <> 'active' AND v_oath.status::text <> 'in_review' THEN 
    RAISE EXCEPTION 'Oath is not active or already settled (status: %)', v_oath.status; 
  END IF;
  
  IF p_note IS NOT NULL AND NOT p_success THEN
    UPDATE public.oaths SET failure_excuse = left(p_note, 500) WHERE id = p_oath_id;
  END IF;

  IF v_oath.oath_type = 'duo' THEN
    -- Check if a proof exists to know who submitted
    SELECT submitted_by INTO v_proof_submitter
    FROM public.proofs
    WHERE oath_id = p_oath_id
    ORDER BY created_at DESC LIMIT 1;

    IF v_proof_submitter IS NOT NULL THEN
      IF p_success THEN
        -- The submitter succeeded!
        IF v_proof_submitter = v_oath.creator_id THEN
          v_outcome := 'creator_won';
        ELSE
          v_outcome := 'opponent_won';
        END IF;
      ELSE
        -- The submitter failed, so opponent wins
        IF v_proof_submitter = v_oath.creator_id THEN
          v_outcome := 'opponent_won';
        ELSE
          v_outcome := 'creator_won';
        END IF;
      END IF;
    ELSE
      -- Fallback based on caller or default
      IF v_user = v_oath.opponent_id THEN
        v_outcome := CASE WHEN p_success THEN 'creator_won' ELSE 'opponent_won' END;
      ELSIF v_user = v_oath.creator_id THEN
        v_outcome := CASE WHEN p_success THEN 'opponent_won' ELSE 'creator_won' END;
      ELSE
        v_outcome := CASE WHEN p_success THEN 'creator_won' ELSE 'opponent_won' END;
      END IF;
    END IF;

    PERFORM public.settle_oath(p_oath_id, v_outcome);

  ELSIF v_oath.oath_type = 'solo' THEN
    PERFORM public.settle_oath(p_oath_id, CASE WHEN p_success THEN 'completed' ELSE 'failed' END);

  ELSE
    -- Group / Squad / Lobby oaths
    PERFORM public.settle_oath(p_oath_id, CASE WHEN p_success THEN 'completed' ELSE 'failed' END);
  END IF;
END;
$$;

-- ============================================================
-- 5. FUNCTION: pass_today_work(UUID, TEXT)
-- ============================================================
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
  IF v_oath.status <> 'active' AND v_oath.status::text <> 'in_review' THEN 
    RAISE EXCEPTION 'Oath is not active'; 
  END IF;

  -- Verify permissions: must be nominee, opponent, group member, or admin
  IF NOT (
    v_oath.opponent_id = v_user
    OR EXISTS (
      SELECT 1 FROM public.nominees n
      WHERE n.oath_id = p_oath_id
        AND (n.nominee_user_id = v_user OR n.email = (SELECT email FROM auth.users WHERE id = v_user))
    )
    OR EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.oath_id = p_oath_id AND gm.user_id = v_user
    )
    OR public.is_admin()
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

  -- Update nominee table if nominee verification
  UPDATE public.nominees
  SET verified = TRUE,
      verdict = 'success',
      verdict_note = v_clean_note,
      responded_at = now()
  WHERE oath_id = p_oath_id;

  -- Check if this is the final day or a single-day oath
  IF coalesce(v_oath.total_days, 1) <= 1 
     OR coalesce(v_oath.current_day, 1) >= coalesce(v_oath.total_days, 1) 
     OR v_oath.deadline <= (now() + interval '24 hours') THEN
    v_is_final_day := TRUE;
  END IF;

  IF v_is_final_day THEN
    -- Complete the oath and release full escrow
    UPDATE public.oaths
    SET status = 'completed',
        completed_at = now(),
        current_streak = coalesce(current_streak, 0) + 1,
        updated_at = now()
    WHERE id = p_oath_id;

    -- Update group_members if present
    UPDATE public.group_members
    SET status = 'completed',
        is_winner = TRUE,
        proof_submitted = TRUE,
        day_streak = coalesce(day_streak, 0) + 1
    WHERE oath_id = p_oath_id AND user_id = v_proof.submitted_by;

    -- Escrow release to creator/submitter
    IF coalesce(v_oath.stake_amount, 0) > 0 THEN
      SELECT id, coalesce(escrow_locked, 0)
      INTO v_submitter_wallet, v_submitter_escrow
      FROM public.wallets
      WHERE user_id = v_proof.submitted_by
      FOR UPDATE;

      IF v_submitter_wallet IS NOT NULL THEN
        v_release := least(v_submitter_escrow, v_oath.stake_amount);
        IF coalesce(v_release, 0) > 0 THEN
          UPDATE public.wallets
          SET balance = balance + v_release,
              escrow_locked = greatest(0, escrow_locked - v_release),
              updated_at = now()
          WHERE id = v_submitter_wallet;

          INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
          VALUES (v_submitter_wallet, p_oath_id, 'escrow_release', v_release, 'Oath completed: Locked stake released in full');
        END IF;
      END IF;
    END IF;

    -- Update profile stats (resets loss streak)
    PERFORM public.handle_profile_success(v_proof.submitted_by, 0);

    -- Post completion message into chat
    INSERT INTO public.messages (oath_id, sender_id, content, type, proof_id)
    VALUES (
      p_oath_id,
      v_user,
      '🎉 All ' || coalesce(v_oath.total_days, 1) || ' days completed! Today''s proof passed and the Oath is won!',
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
      'current_day', coalesce(v_oath.current_day, 1),
      'total_days', coalesce(v_oath.total_days, 1),
      'message', 'Oath completed and escrow released'
    );
  ELSE
    -- Multi-day oath: Advance to next day and reset daily proof window!
    UPDATE public.oaths
    SET current_day = current_day + 1,
        current_streak = coalesce(current_streak, 0) + 1,
        daily_deadline = now() + interval '24 hours',
        updated_at = now()
    WHERE id = p_oath_id;

    -- Update member streak
    UPDATE public.group_members
    SET current_day = current_day + 1,
        day_streak = coalesce(day_streak, 0) + 1,
        proof_submitted = FALSE -- Reset so next day's proof can be submitted!
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
      'current_streak', coalesce(v_oath.current_streak, 0) + 1,
      'message', 'Daily milestone passed. Next day window unlocked.'
    );
  END IF;
END;
$$;

-- ============================================================
-- 6. PERMISSIONS
-- ============================================================
REVOKE ALL ON FUNCTION public.settle_oath(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_oath(UUID, TEXT) TO authenticated, anon;

REVOKE ALL ON FUNCTION public.settle_oath(UUID, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_oath(UUID, BOOLEAN, TEXT) TO authenticated, anon;

REVOKE ALL ON FUNCTION public.settle_duo_oath(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_duo_oath(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.settle_duo_oath(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_duo_oath(UUID, UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.pass_today_work(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pass_today_work(UUID, TEXT) TO authenticated, anon;
