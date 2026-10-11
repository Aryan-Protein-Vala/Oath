-- Migration 202610110003: Shared Duo Accountability & Private Details RLS
-- 1. Enable RLS and grant SELECT on public.oath_private_details to oath participants
-- 2. Pivot Duo challenges to shared accountability (each participant stakes their own funds,
--    completes their own proofs, and gets their own stake refunded on completion without taking the partner's stake)
-- 3. Update forfeit_oath and auto_resolve_expired_oaths for independent participant resolution

-- ============================================================
-- 1. OATH PRIVATE DETAILS RLS & GRANTS
-- ============================================================
ALTER TABLE public.oath_private_details ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.oath_private_details TO authenticated, anon;

DROP POLICY IF EXISTS "Oath private details viewable by participants" ON public.oath_private_details;
CREATE POLICY "Oath private details viewable by participants" ON public.oath_private_details
FOR SELECT TO authenticated, anon
USING (
  EXISTS (
    SELECT 1 FROM public.oaths o
    WHERE o.id = oath_private_details.oath_id
      AND (o.creator_id = auth.uid() OR o.opponent_id = auth.uid() OR public.is_admin())
  )
  OR EXISTS (
    SELECT 1 FROM public.group_members gm
    WHERE gm.oath_id = oath_private_details.oath_id
      AND gm.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.nominees n
    WHERE n.oath_id = oath_private_details.oath_id
      AND (n.nominee_user_id = auth.uid() OR n.email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  )
);

-- ============================================================
-- 2. SHARED DUO SETTLEMENT (INDEPENDENT STAKES & REFUNDS)
-- ============================================================
CREATE OR REPLACE FUNCTION public.settle_duo_oath(
  p_oath_id UUID,
  p_winner_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_oath public.oaths%ROWTYPE;
  v_user UUID := auth.uid();
  v_stake NUMERIC;
  v_winner_wallet UUID;
  v_other_id UUID;
  v_other_member public.group_members%ROWTYPE;
  v_winner_member public.group_members%ROWTYPE;
BEGIN
  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oath not found'; END IF;
  IF v_oath.oath_type <> 'duo' THEN RAISE EXCEPTION 'Only duo oaths can be settled here'; END IF;
  IF v_oath.status NOT IN ('active', 'pending') THEN RETURN; END IF;

  IF v_user IS NOT NULL AND v_user <> v_oath.creator_id AND v_user <> v_oath.opponent_id AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to settle this challenge';
  END IF;

  IF p_winner_id <> v_oath.creator_id AND p_winner_id <> v_oath.opponent_id THEN
    RAISE EXCEPTION 'Participant must be creator or opponent';
  END IF;

  v_other_id := CASE WHEN p_winner_id = v_oath.creator_id THEN v_oath.opponent_id ELSE v_oath.creator_id END;
  v_stake := coalesce(v_oath.stake_amount, 0);

  -- 1. Release participant's own 1x stake back to their wallet
  IF v_stake > 0 THEN
    UPDATE public.wallets 
    SET balance = balance + v_stake, 
        escrow_locked = greatest(0, escrow_locked - v_stake),
        updated_at = now()
    WHERE user_id = p_winner_id
    RETURNING id INTO v_winner_wallet;

    IF v_winner_wallet IS NOT NULL THEN
      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_winner_wallet, p_oath_id, 'reward', v_stake, 'Duo goal completed! Individual stake refunded');
    END IF;
  END IF;

  -- 2. Mark this participant as completed
  UPDATE public.group_members 
  SET status = 'completed', updated_at = now() 
  WHERE oath_id = p_oath_id AND user_id = p_winner_id;

  PERFORM public.handle_profile_success(p_winner_id, v_stake);

  -- 3. Check other participant's state to determine if whole oath is finished
  IF v_other_id IS NOT NULL THEN
    SELECT * INTO v_other_member FROM public.group_members WHERE oath_id = p_oath_id AND user_id = v_other_id;
    IF v_other_member.status IN ('completed', 'failed') THEN
      UPDATE public.oaths 
      SET status = 'completed', 
          settled_at = now(), 
          updated_at = now() 
      WHERE id = p_oath_id;
    END IF;
  ELSE
    -- Solo/unmatched duo fallback
    UPDATE public.oaths 
    SET status = 'completed', 
        settled_at = now(), 
        updated_at = now() 
    WHERE id = p_oath_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.settle_duo_oath(UUID, UUID) TO authenticated, anon;


-- ============================================================
-- 3. FORFEIT OATH (INDEPENDENT DUO FORFEIT)
-- ============================================================
CREATE OR REPLACE FUNCTION public.forfeit_oath(p_oath_id UUID, p_note TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_oath public.oaths%ROWTYPE;
  v_user UUID := auth.uid();
  v_stake NUMERIC;
  v_wallet_id UUID;
  v_other_id UUID;
  v_other_member public.group_members%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oath not found'; END IF;

  IF v_oath.oath_type = 'solo' THEN
    IF v_oath.creator_id <> v_user THEN RAISE EXCEPTION 'Only the oath creator can forfeit'; END IF;
    PERFORM public.settle_oath_atomically(p_oath_id, FALSE, coalesce(p_note, 'Oath forfeited by creator'), NULL, TRUE);

  ELSIF v_oath.oath_type = 'duo' THEN
    IF v_user <> v_oath.creator_id AND v_user <> v_oath.opponent_id THEN
      RAISE EXCEPTION 'Only challenge participants can forfeit';
    END IF;

    v_stake := coalesce(v_oath.stake_amount, 0);
    v_other_id := CASE WHEN v_user = v_oath.creator_id THEN v_oath.opponent_id ELSE v_oath.creator_id END;

    -- Forfeit caller's own stake
    IF v_stake > 0 THEN
      UPDATE public.wallets 
      SET escrow_locked = greatest(0, escrow_locked - v_stake), updated_at = now()
      WHERE user_id = v_user
      RETURNING id INTO v_wallet_id;

      IF v_wallet_id IS NOT NULL THEN
        INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
        VALUES (v_wallet_id, p_oath_id, 'penalty', v_stake, coalesce(p_note, 'Duo challenge forfeited'));
      END IF;
    END IF;

    -- Update caller group member status
    UPDATE public.group_members 
    SET status = 'failed', updated_at = now() 
    WHERE oath_id = p_oath_id AND user_id = v_user;

    PERFORM public.handle_profile_failure(v_user, v_stake, p_oath_id);

    -- Notify partner
    IF v_other_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, oath_id, type, title, message, status)
      VALUES (
        v_other_id,
        p_oath_id,
        'system',
        'Partner Forfeited',
        'Your duo partner conceded the challenge. Your oath remains active for your own goal!',
        'pending'
      );

      -- Check if other participant is also resolved
      SELECT * INTO v_other_member FROM public.group_members WHERE oath_id = p_oath_id AND user_id = v_other_id;
      IF v_other_member.status IN ('completed', 'failed') THEN
        UPDATE public.oaths 
        SET status = CASE WHEN v_other_member.status = 'completed' THEN 'completed' ELSE 'failed' END, 
            settled_at = now(), 
            updated_at = now() 
        WHERE id = p_oath_id;
      END IF;
    ELSE
      UPDATE public.oaths SET status = 'failed', settled_at = now(), updated_at = now() WHERE id = p_oath_id;
    END IF;

  ELSIF v_oath.oath_type IN ('squad', 'lobby') THEN
    PERFORM public.forfeit_squad_member(p_oath_id);
  ELSE
    RAISE EXCEPTION 'Unsupported oath type for forfeiture';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.forfeit_oath(UUID, TEXT) TO authenticated, anon;


-- ============================================================
-- 4. AUTO-RESOLVE EXPIRED OATHS WITH INDEPENDENT DUO RESOLUTION
-- ============================================================
DROP FUNCTION IF EXISTS public.auto_resolve_expired_oaths();

CREATE OR REPLACE FUNCTION public.auto_resolve_expired_oaths()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_oath RECORD;
  v_count INTEGER := 0;
  v_stake NUMERIC;
  v_creator_wallet UUID;
  v_opponent_wallet UUID;
  v_wallet_id UUID;
  v_tz TEXT;
  v_creator_deadline TIMESTAMPTZ;
  v_opponent_deadline TIMESTAMPTZ;
  v_creator_has_today BOOLEAN;
  v_opponent_has_today BOOLEAN;
  v_creator_member public.group_members%ROWTYPE;
  v_opponent_member public.group_members%ROWTYPE;
BEGIN
  -- 1. Daily Cadence Sweeping (Oaths active but user missed daily proof)
  FOR v_oath IN
    SELECT o.*
    FROM public.oaths o
    WHERE o.status = 'active'
      AND o.cadence = 'daily'
  LOOP
    v_tz := coalesce(v_oath.timezone, 'UTC');

    IF v_oath.oath_type = 'duo' THEN
      v_stake := coalesce(v_oath.stake_amount, 0);

      SELECT * INTO v_creator_member FROM public.group_members WHERE oath_id = v_oath.id AND user_id = v_oath.creator_id;
      SELECT * INTO v_opponent_member FROM public.group_members WHERE oath_id = v_oath.id AND user_id = v_oath.opponent_id;

      v_creator_deadline := coalesce(v_creator_member.daily_deadline, v_oath.daily_deadline);
      v_opponent_deadline := coalesce(v_opponent_member.daily_deadline, v_oath.daily_deadline);

      -- Check if creator missed daily proof
      IF v_creator_deadline IS NOT NULL AND v_creator_deadline < now() AND coalesce(v_creator_member.status, 'joined') NOT IN ('completed', 'failed') THEN
        SELECT EXISTS (
          SELECT 1 FROM public.proofs
          WHERE oath_id = v_oath.id
            AND submitted_by = v_oath.creator_id
            AND status IN ('verified', 'pending_review')
            AND created_at >= (v_creator_deadline - interval '1 day')
        ) INTO v_creator_has_today;

        IF NOT v_creator_has_today THEN
          -- Creator failed
          IF v_stake > 0 THEN
            UPDATE public.wallets SET escrow_locked = greatest(0, escrow_locked - v_stake), updated_at = now()
            WHERE user_id = v_oath.creator_id RETURNING id INTO v_creator_wallet;
            IF v_creator_wallet IS NOT NULL THEN
              INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
              VALUES (v_creator_wallet, v_oath.id, 'penalty', v_stake, 'Duo deadline expired: Daily proof missed');
            END IF;
          END IF;
          UPDATE public.group_members SET status = 'failed', updated_at = now() WHERE oath_id = v_oath.id AND user_id = v_oath.creator_id;
          PERFORM public.handle_profile_failure(v_oath.creator_id, v_stake, v_oath.id);
          v_count := v_count + 1;
        END IF;
      END IF;

      -- Check if opponent missed daily proof
      IF v_opponent_deadline IS NOT NULL AND v_opponent_deadline < now() AND coalesce(v_opponent_member.status, 'joined') NOT IN ('completed', 'failed') THEN
        SELECT EXISTS (
          SELECT 1 FROM public.proofs
          WHERE oath_id = v_oath.id
            AND submitted_by = v_oath.opponent_id
            AND status IN ('verified', 'pending_review')
            AND created_at >= (v_opponent_deadline - interval '1 day')
        ) INTO v_opponent_has_today;

        IF NOT v_opponent_has_today THEN
          -- Opponent failed
          IF v_stake > 0 THEN
            UPDATE public.wallets SET escrow_locked = greatest(0, escrow_locked - v_stake), updated_at = now()
            WHERE user_id = v_oath.opponent_id RETURNING id INTO v_opponent_wallet;
            IF v_opponent_wallet IS NOT NULL THEN
              INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
              VALUES (v_opponent_wallet, v_oath.id, 'penalty', v_stake, 'Duo deadline expired: Daily proof missed');
            END IF;
          END IF;
          UPDATE public.group_members SET status = 'failed', updated_at = now() WHERE oath_id = v_oath.id AND user_id = v_oath.opponent_id;
          PERFORM public.handle_profile_failure(v_oath.opponent_id, v_stake, v_oath.id);
          v_count := v_count + 1;
        END IF;
      END IF;

      -- Check if both are now completed/failed
      SELECT * INTO v_creator_member FROM public.group_members WHERE oath_id = v_oath.id AND user_id = v_oath.creator_id;
      SELECT * INTO v_opponent_member FROM public.group_members WHERE oath_id = v_oath.id AND user_id = v_oath.opponent_id;
      IF v_creator_member.status IN ('completed', 'failed') AND (v_oath.opponent_id IS NULL OR v_opponent_member.status IN ('completed', 'failed')) THEN
        UPDATE public.oaths
        SET status = CASE WHEN v_creator_member.status = 'completed' OR v_opponent_member.status = 'completed' THEN 'completed' ELSE 'failed' END,
            settled_at = now(),
            updated_at = now()
        WHERE id = v_oath.id;
      END IF;

    ELSIF v_oath.oath_type = 'solo' THEN
      IF v_oath.daily_deadline IS NOT NULL AND v_oath.daily_deadline < now() THEN
        SELECT EXISTS (
          SELECT 1 FROM public.proofs
          WHERE oath_id = v_oath.id
            AND submitted_by = v_oath.creator_id
            AND status IN ('verified', 'pending_review')
            AND created_at >= (v_oath.daily_deadline - interval '1 day')
        ) INTO v_creator_has_today;

        IF NOT v_creator_has_today THEN
          PERFORM public.settle_oath_atomically(
            v_oath.id,
            FALSE,
            'Daily cadence expired: Proof not submitted by local midnight',
            NULL,
            TRUE
          );
          v_count := v_count + 1;
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- 2. General Expiry for Single-Deadline Oaths
  FOR v_oath IN
    SELECT *
    FROM public.oaths
    WHERE status = 'active'
      AND deadline < now()
      AND (cadence IS NULL OR cadence = 'once')
  LOOP
    IF v_oath.oath_type = 'duo' THEN
      -- Settle any pending participant as failed
      v_stake := coalesce(v_oath.stake_amount, 0);
      SELECT * INTO v_creator_member FROM public.group_members WHERE oath_id = v_oath.id AND user_id = v_oath.creator_id;
      SELECT * INTO v_opponent_member FROM public.group_members WHERE oath_id = v_oath.id AND user_id = v_oath.opponent_id;

      IF coalesce(v_creator_member.status, 'joined') NOT IN ('completed', 'failed') THEN
        IF v_stake > 0 THEN
          UPDATE public.wallets SET escrow_locked = greatest(0, escrow_locked - v_stake), updated_at = now()
          WHERE user_id = v_oath.creator_id;
        END IF;
        UPDATE public.group_members SET status = 'failed', updated_at = now() WHERE oath_id = v_oath.id AND user_id = v_oath.creator_id;
        PERFORM public.handle_profile_failure(v_oath.creator_id, v_stake, v_oath.id);
      END IF;

      IF v_oath.opponent_id IS NOT NULL AND coalesce(v_opponent_member.status, 'joined') NOT IN ('completed', 'failed') THEN
        IF v_stake > 0 THEN
          UPDATE public.wallets SET escrow_locked = greatest(0, escrow_locked - v_stake), updated_at = now()
          WHERE user_id = v_oath.opponent_id;
        END IF;
        UPDATE public.group_members SET status = 'failed', updated_at = now() WHERE oath_id = v_oath.id AND user_id = v_oath.opponent_id;
        PERFORM public.handle_profile_failure(v_oath.opponent_id, v_stake, v_oath.id);
      END IF;

      UPDATE public.oaths SET status = 'failed', settled_at = now(), updated_at = now() WHERE id = v_oath.id;
      v_count := v_count + 1;
    ELSE
      PERFORM public.settle_oath(v_oath.id, 'failed');
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'resolved_count', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_resolve_expired_oaths() TO authenticated, anon;
