-- Migration: 202610030002_airtight_auto_resolve_expired_oaths.sql
-- Fixes critical logic flaws in auto_resolve_expired_oaths:
-- 1. Sweeps Solo oaths where creator never submitted proof (Solo oaths do NOT exist in group_members).
-- 2. Sweeps Duo oaths properly under Leader-Pays-All (seizes 2x escrow from creator if both ghost, awards 2x to submitter if one ghosts).
-- 3. Sweeps Weakest Link squads properly (seizes leader's full squad escrow if any member ghosts).
-- 4. Correctly marks failed status for squads where all members ghosted instead of incorrectly marking as completed.
-- 5. Properly handles individual buy-in public lobbies.

CREATE OR REPLACE FUNCTION public.auto_resolve_expired_oaths()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_count INTEGER := 0;
  v_oath RECORD;
  v_member RECORD;
  v_creator_wallet UUID;
  v_creator_escrow NUMERIC;
  v_member_wallet UUID;
  v_member_escrow NUMERIC;
  v_release NUMERIC;
  v_creator_has_proof BOOLEAN;
  v_opponent_has_proof BOOLEAN;
  v_any_ghosted BOOLEAN;
  v_squad_total NUMERIC;
  v_house_cut NUMERIC;
  v_winner_reward NUMERIC;
BEGIN
  -- =========================================================================
  -- 1. SOLO OATHS: Creator never submitted proof before deadline
  -- =========================================================================
  FOR v_oath IN
    SELECT o.*
    FROM public.oaths o
    WHERE o.status = 'active'
      AND o.oath_type = 'solo'
      AND o.deadline < now()
      AND NOT EXISTS (
        SELECT 1 FROM public.proofs p
        WHERE p.oath_id = o.id
          AND p.submitted_by = o.creator_id
      )
    FOR UPDATE SKIP LOCKED
  LOOP
    IF v_oath.stake_amount > 0 THEN
      SELECT id, coalesce(escrow_locked, 0)
      INTO v_creator_wallet, v_creator_escrow
      FROM public.wallets
      WHERE user_id = v_oath.creator_id
      FOR UPDATE;

      IF v_creator_wallet IS NOT NULL THEN
        v_release := least(v_creator_escrow, v_oath.stake_amount);
        IF v_release > 0 THEN
          UPDATE public.wallets
          SET escrow_locked = escrow_locked - v_release,
              total_lost = coalesce(total_lost, 0) + v_release,
              updated_at = now()
          WHERE id = v_creator_wallet;

          INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
          VALUES (v_creator_wallet, v_oath.id, 'penalty', v_release, 'Solo Oath Failed: Missed deadline without submitting proof');
        END IF;
      END IF;
    END IF;

    UPDATE public.profiles
    SET oaths_failed = coalesce(oaths_failed, 0) + 1,
        total_lost = coalesce(total_lost, 0) + coalesce(v_release, 0),
        updated_at = now()
    WHERE id = v_oath.creator_id;

    INSERT INTO public.notifications (user_id, oath_id, type, title, message, status)
    VALUES (
      v_oath.creator_id,
      v_oath.id,
      'system',
      'You Failed the Oath',
      'You failed to submit proof before the deadline. Your stake has been seized.',
      'pending'
    );

    UPDATE public.oaths
    SET status = 'failed', updated_at = now()
    WHERE id = v_oath.id;

    v_count := v_count + 1;
  END LOOP;

  -- =========================================================================
  -- 2. DUO OATHS: Leader pays 2x upfront, check creator and opponent submissions
  -- =========================================================================
  FOR v_oath IN
    SELECT o.*
    FROM public.oaths o
    WHERE o.status = 'active'
      AND o.oath_type = 'duo'
      AND o.deadline < now()
    FOR UPDATE SKIP LOCKED
  LOOP
    v_creator_has_proof := EXISTS (
      SELECT 1 FROM public.proofs p WHERE p.oath_id = v_oath.id AND p.submitted_by = v_oath.creator_id
    );
    v_opponent_has_proof := EXISTS (
      SELECT 1 FROM public.proofs p WHERE p.oath_id = v_oath.id AND p.submitted_by = v_oath.opponent_id
    );

    IF NOT v_creator_has_proof OR NOT v_opponent_has_proof THEN
      v_squad_total := v_oath.stake_amount * 2;

      -- Case A: BOTH ghosted
      IF NOT v_creator_has_proof AND NOT v_opponent_has_proof THEN
        SELECT id, coalesce(escrow_locked, 0) INTO v_creator_wallet, v_creator_escrow
        FROM public.wallets WHERE user_id = v_oath.creator_id FOR UPDATE;

        IF v_creator_wallet IS NOT NULL THEN
          v_release := least(v_creator_escrow, v_squad_total);
          IF v_release > 0 THEN
            UPDATE public.wallets
            SET escrow_locked = escrow_locked - v_release,
                total_lost = coalesce(total_lost, 0) + v_release,
                updated_at = now()
            WHERE id = v_creator_wallet;

            INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
            VALUES (v_creator_wallet, v_oath.id, 'penalty', v_release, 'Duo Duel Failed: Neither player submitted proof');
          END IF;
        END IF;

        UPDATE public.group_members SET status = 'failed', is_winner = false WHERE oath_id = v_oath.id;

        UPDATE public.profiles SET oaths_failed = coalesce(oaths_failed, 0) + 1, updated_at = now()
        WHERE id IN (v_oath.creator_id, v_oath.opponent_id);

        UPDATE public.profiles SET total_lost = coalesce(total_lost, 0) + coalesce(v_release, 0)
        WHERE id = v_oath.creator_id;

        INSERT INTO public.notifications (user_id, oath_id, type, title, message, status)
        VALUES
          (v_oath.creator_id, v_oath.id, 'system', 'Duel Expired', 'Neither player submitted proof in time. Total duel stake seized.', 'pending'),
          (v_oath.opponent_id, v_oath.id, 'system', 'Duel Expired', 'Neither player submitted proof in time for the duel.', 'pending');

        UPDATE public.oaths SET status = 'failed', updated_at = now() WHERE id = v_oath.id;
        v_count := v_count + 1;

      -- Case B: Creator submitted proof, Opponent ghosted -> Creator wins!
      ELSIF v_creator_has_proof AND NOT v_opponent_has_proof THEN
        UPDATE public.group_members SET status = 'failed', is_winner = false
        WHERE oath_id = v_oath.id AND user_id = v_oath.opponent_id;

        UPDATE public.group_members SET status = 'completed', is_winner = true
        WHERE oath_id = v_oath.id AND user_id = v_oath.creator_id;

        UPDATE public.profiles SET oaths_failed = coalesce(oaths_failed, 0) + 1, updated_at = now()
        WHERE id = v_oath.opponent_id;

        UPDATE public.profiles SET oaths_completed = coalesce(oaths_completed, 0) + 1, updated_at = now()
        WHERE id = v_oath.creator_id;

        SELECT id, coalesce(escrow_locked, 0) INTO v_creator_wallet, v_creator_escrow
        FROM public.wallets WHERE user_id = v_oath.creator_id FOR UPDATE;

        IF v_creator_wallet IS NOT NULL THEN
          v_release := least(v_creator_escrow, v_squad_total);
          IF v_release > 0 THEN
            UPDATE public.wallets
            SET balance = balance + v_release,
                escrow_locked = escrow_locked - v_release,
                total_won = coalesce(total_won, 0) + v_oath.stake_amount,
                updated_at = now()
            WHERE id = v_creator_wallet;

            INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
            VALUES (v_creator_wallet, v_oath.id, 'reward', v_release, 'Opponent ghosted: Won duo challenge');
          END IF;
        END IF;

        INSERT INTO public.notifications (user_id, oath_id, type, title, message, status)
        VALUES
          (v_oath.creator_id, v_oath.id, 'system', 'You Won the Duel!', 'Your opponent failed to submit proof before the deadline. Pot unlocked!', 'pending'),
          (v_oath.opponent_id, v_oath.id, 'system', 'Duel Lost', 'You failed to submit proof in time for the duel.', 'pending');

        UPDATE public.oaths SET status = 'completed', updated_at = now() WHERE id = v_oath.id;
        v_count := v_count + 1;

      -- Case C: Opponent submitted proof, Creator ghosted -> Opponent wins!
      ELSIF NOT v_creator_has_proof AND v_opponent_has_proof THEN
        UPDATE public.group_members SET status = 'failed', is_winner = false
        WHERE oath_id = v_oath.id AND user_id = v_oath.creator_id;

        UPDATE public.group_members SET status = 'completed', is_winner = true
        WHERE oath_id = v_oath.id AND user_id = v_oath.opponent_id;

        UPDATE public.profiles SET oaths_failed = coalesce(oaths_failed, 0) + 1, updated_at = now()
        WHERE id = v_oath.creator_id;

        UPDATE public.profiles SET oaths_completed = coalesce(oaths_completed, 0) + 1, updated_at = now()
        WHERE id = v_oath.opponent_id;

        SELECT id, coalesce(escrow_locked, 0) INTO v_creator_wallet, v_creator_escrow
        FROM public.wallets WHERE user_id = v_oath.creator_id FOR UPDATE;

        IF v_creator_wallet IS NOT NULL THEN
          v_release := least(v_creator_escrow, v_squad_total);
          IF v_release > 0 THEN
            UPDATE public.wallets
            SET escrow_locked = escrow_locked - v_release,
                total_lost = coalesce(total_lost, 0) + v_release,
                updated_at = now()
            WHERE id = v_creator_wallet;

            INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
            VALUES (v_creator_wallet, v_oath.id, 'penalty', v_release, 'Missed deadline: Duel forfeited to opponent');

            v_house_cut := round(v_release * 0.10, 2);
            v_winner_reward := v_release - v_house_cut;

            SELECT id INTO v_member_wallet FROM public.wallets WHERE user_id = v_oath.opponent_id FOR UPDATE;
            IF v_member_wallet IS NOT NULL THEN
              UPDATE public.wallets
              SET balance = balance + v_winner_reward,
                  total_won = coalesce(total_won, 0) + v_winner_reward,
                  updated_at = now()
              WHERE id = v_member_wallet;

              INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
              VALUES (v_member_wallet, v_oath.id, 'reward', v_winner_reward, 'Creator ghosted: Won duo challenge');
            END IF;

            UPDATE public.profiles SET total_won = coalesce(total_won, 0) + v_winner_reward WHERE id = v_oath.opponent_id;
            UPDATE public.profiles SET total_lost = coalesce(total_lost, 0) + v_release WHERE id = v_oath.creator_id;
          END IF;
        END IF;

        INSERT INTO public.notifications (user_id, oath_id, type, title, message, status)
        VALUES
          (v_oath.opponent_id, v_oath.id, 'system', 'You Won the Duel!', 'Creator failed to submit proof before the deadline. Pot awarded!', 'pending'),
          (v_oath.creator_id, v_oath.id, 'system', 'Duel Lost', 'You failed to submit proof in time. Duel stake seized.', 'pending');

        UPDATE public.oaths SET status = 'completed', updated_at = now() WHERE id = v_oath.id;
        v_count := v_count + 1;
      END IF;
    END IF;
  END LOOP;

  -- =========================================================================
  -- 3. SQUAD OATHS: Weakest Link (any ghost = full squad fails) & Survival
  -- =========================================================================
  FOR v_oath IN
    SELECT o.*
    FROM public.oaths o
    WHERE o.status = 'active'
      AND o.oath_type = 'squad'
      AND o.deadline < now()
    FOR UPDATE SKIP LOCKED
  LOOP
    IF v_oath.group_mode = 'weakest_link' THEN
      v_any_ghosted := EXISTS (
        SELECT 1 FROM public.group_members gm
        WHERE gm.oath_id = v_oath.id
          AND gm.status = 'joined'
          AND NOT EXISTS (
            SELECT 1 FROM public.proofs p WHERE p.oath_id = v_oath.id AND p.submitted_by = gm.user_id
          )
      );

      IF v_any_ghosted THEN
        v_squad_total := v_oath.stake_amount * v_oath.max_players;
        SELECT id, coalesce(escrow_locked, 0) INTO v_creator_wallet, v_creator_escrow
        FROM public.wallets WHERE user_id = v_oath.creator_id FOR UPDATE;

        IF v_creator_wallet IS NOT NULL THEN
          v_release := least(v_creator_escrow, v_squad_total);
          IF v_release > 0 THEN
            UPDATE public.wallets
            SET escrow_locked = escrow_locked - v_release,
                total_lost = coalesce(total_lost, 0) + v_release,
                updated_at = now()
            WHERE id = v_creator_wallet;

            INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
            VALUES (v_creator_wallet, v_oath.id, 'penalty', v_release, 'Weakest Link squad failed: Member(s) missed deadline without submitting proof');
          END IF;
        END IF;

        UPDATE public.group_members
        SET status = 'failed', is_winner = false
        WHERE oath_id = v_oath.id AND status = 'joined';

        UPDATE public.profiles SET oaths_failed = coalesce(oaths_failed, 0) + 1, updated_at = now()
        WHERE id = v_oath.creator_id;

        UPDATE public.oaths SET status = 'failed', updated_at = now() WHERE id = v_oath.id;

        INSERT INTO public.notifications (user_id, oath_id, type, title, message, status)
        SELECT gm.user_id, v_oath.id, 'system', 'Squad Failed', 'Weakest Link broken: A member failed to submit proof before the deadline.', 'pending'
        FROM public.group_members gm WHERE gm.oath_id = v_oath.id;

        v_count := v_count + 1;
      END IF;

    ELSE
      -- Survival squad: fail each member who did not submit proof
      FOR v_member IN
        SELECT gm.id, gm.user_id
        FROM public.group_members gm
        WHERE gm.oath_id = v_oath.id
          AND gm.status = 'joined'
          AND NOT EXISTS (
            SELECT 1 FROM public.proofs p WHERE p.oath_id = v_oath.id AND p.submitted_by = gm.user_id
          )
      LOOP
        UPDATE public.group_members SET status = 'failed', is_winner = false WHERE id = v_member.id;
        UPDATE public.profiles SET oaths_failed = coalesce(oaths_failed, 0) + 1, updated_at = now() WHERE id = v_member.user_id;

        IF v_oath.stake_amount > 0 THEN
          SELECT id, coalesce(escrow_locked, 0) INTO v_creator_wallet, v_creator_escrow
          FROM public.wallets WHERE user_id = v_oath.creator_id FOR UPDATE;

          IF v_creator_wallet IS NOT NULL THEN
            v_release := least(v_creator_escrow, v_oath.stake_amount);
            IF v_release > 0 THEN
              UPDATE public.wallets
              SET escrow_locked = escrow_locked - v_release,
                  total_lost = coalesce(total_lost, 0) + v_release,
                  updated_at = now()
              WHERE id = v_creator_wallet;

              INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
              VALUES (v_creator_wallet, v_oath.id, 'penalty', v_release, 'Squad member missed deadline without submitting proof');
            END IF;
          END IF;
        END IF;

        INSERT INTO public.notifications (user_id, oath_id, type, title, message, status)
        VALUES (v_member.user_id, v_oath.id, 'system', 'Squad Member Failed', 'You missed the deadline without submitting proof.', 'pending');

        v_count := v_count + 1;
      END LOOP;

      -- Check if all members resolved
      IF NOT EXISTS (SELECT 1 FROM public.group_members WHERE oath_id = v_oath.id AND status = 'joined') THEN
        IF EXISTS (SELECT 1 FROM public.group_members WHERE oath_id = v_oath.id AND status = 'completed') THEN
          UPDATE public.oaths SET status = 'completed', updated_at = now() WHERE id = v_oath.id;
        ELSE
          UPDATE public.oaths SET status = 'failed', updated_at = now() WHERE id = v_oath.id;
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- =========================================================================
  -- 4. PUBLIC LOBBY OATHS: Individual buy-in, each player stakes own money
  -- =========================================================================
  FOR v_member IN
    SELECT gm.id, gm.oath_id, gm.user_id, o.stake_amount
    FROM public.group_members gm
    JOIN public.oaths o ON o.id = gm.oath_id
    WHERE o.status = 'active'
      AND o.oath_type = 'lobby'
      AND o.deadline < now()
      AND gm.status = 'joined'
      AND NOT EXISTS (
        SELECT 1 FROM public.proofs p WHERE p.oath_id = gm.oath_id AND p.submitted_by = gm.user_id
      )
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.group_members SET status = 'failed', is_winner = false WHERE id = v_member.id;

    IF v_member.stake_amount > 0 THEN
      SELECT id, coalesce(escrow_locked, 0) INTO v_member_wallet, v_member_escrow
      FROM public.wallets WHERE user_id = v_member.user_id FOR UPDATE;

      IF v_member_wallet IS NOT NULL THEN
        v_release := least(v_member_escrow, v_member.stake_amount);
        IF v_release > 0 THEN
          UPDATE public.wallets
          SET escrow_locked = escrow_locked - v_release,
              total_lost = coalesce(total_lost, 0) + v_release,
              updated_at = now()
          WHERE id = v_member_wallet;

          INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
          VALUES (v_member_wallet, v_member.oath_id, 'penalty', v_release, 'Lobby Member Failed: Missed deadline without submitting proof');
        END IF;
      END IF;
    END IF;

    UPDATE public.profiles
    SET oaths_failed = coalesce(oaths_failed, 0) + 1,
        total_lost = coalesce(total_lost, 0) + coalesce(v_release, 0),
        updated_at = now()
    WHERE id = v_member.user_id;

    INSERT INTO public.notifications (user_id, oath_id, type, title, message, status)
    VALUES (v_member.user_id, v_member.oath_id, 'system', 'Lobby Failed', 'You missed the deadline without submitting proof. Stake seized.', 'pending');

    v_count := v_count + 1;
  END LOOP;

  -- Final cleanup for lobby oaths where all members resolved
  FOR v_oath IN
    SELECT o.id
    FROM public.oaths o
    WHERE o.status = 'active'
      AND o.oath_type = 'lobby'
      AND o.deadline < now()
      AND NOT EXISTS (
        SELECT 1 FROM public.group_members gm WHERE gm.oath_id = o.id AND gm.status = 'joined'
      )
    FOR UPDATE SKIP LOCKED
  LOOP
    IF EXISTS (SELECT 1 FROM public.group_members WHERE oath_id = v_oath.id AND status = 'completed') THEN
      UPDATE public.oaths SET status = 'completed', updated_at = now() WHERE id = v_oath.id;
    ELSE
      UPDATE public.oaths SET status = 'failed', updated_at = now() WHERE id = v_oath.id;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_resolve_expired_oaths() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_resolve_expired_oaths() TO authenticated, anon;
