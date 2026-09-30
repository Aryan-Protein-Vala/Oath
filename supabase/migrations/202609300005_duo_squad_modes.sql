-- 202609300005_duo_squad_modes.sql
-- Introduce "Weakest Link" and "Survival" modes for Duos and Squads.
-- Leader pays all upfront, members join without escrow locks.

BEGIN;

DO $$ BEGIN
  CREATE TYPE public.group_mode AS ENUM ('weakest_link', 'survival');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

ALTER TABLE public.oaths ADD COLUMN IF NOT EXISTS group_mode public.group_mode;

-- Update create_oath_with_stake to support group_mode and Leader Pays All
CREATE OR REPLACE FUNCTION public.create_oath_with_stake(
  p_oath_statement TEXT,
  p_deadline TIMESTAMPTZ,
  p_oath_type public.oath_type,
  p_verification_method public.verification_method,
  p_consequence_type public.consequence_type,
  p_stake_amount NUMERIC,
  p_min_players INT DEFAULT 1,
  p_max_players INT DEFAULT 1,
  p_opponent_id UUID DEFAULT NULL,
  p_social_phone TEXT DEFAULT NULL,
  p_social_msg TEXT DEFAULT NULL,
  p_nominee_email TEXT DEFAULT NULL,
  p_anti_charity_cause TEXT DEFAULT NULL,
  p_group_mode public.group_mode DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_user UUID := auth.uid();
  v_oath_id UUID;
  v_wallet_id UUID;
  v_total_stake NUMERIC;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF length(trim(p_oath_statement)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Statement must be 1–500 chars'; END IF;
  IF p_deadline IS NULL OR p_deadline <= now() THEN RAISE EXCEPTION 'Deadline must be future'; END IF;
  IF p_stake_amount < 0 THEN RAISE EXCEPTION 'Stake must be non-negative'; END IF;
  
  IF p_oath_type IN ('duo', 'squad') AND p_group_mode IS NULL THEN
    RAISE EXCEPTION 'Duo and Squad require a group mode (weakest_link or survival)';
  END IF;

  v_total_stake := CASE 
    WHEN p_oath_type IN ('duo', 'squad') THEN p_stake_amount * greatest(1, coalesce(p_max_players, 1))
    ELSE p_stake_amount 
  END;

  IF v_total_stake > 0 THEN
    UPDATE public.wallets SET balance = balance - v_total_stake,
      escrow_locked = escrow_locked + v_total_stake, updated_at = now()
    WHERE user_id = v_user AND balance >= v_total_stake
    RETURNING id INTO v_wallet_id;
    IF v_wallet_id IS NULL THEN RAISE EXCEPTION 'Insufficient balance to cover all players'; END IF;
  END IF;
  
  INSERT INTO public.oaths (
    creator_id, oath_statement, deadline, oath_type, verification_method, 
    consequence_type, stake_amount, status, min_players, max_players, opponent_id, group_mode)
  VALUES (
    v_user, p_oath_statement, p_deadline, p_oath_type, p_verification_method,
    p_consequence_type, p_stake_amount, CASE WHEN p_oath_type = 'squad' THEN 'pending'::public.oath_status 
      WHEN p_oath_type = 'duo' THEN 'pending'::public.oath_status ELSE 'active'::public.oath_status END,
    greatest(1, coalesce(p_min_players, 1)), greatest(1, coalesce(p_max_players, 1)), p_opponent_id, p_group_mode)
  RETURNING id INTO v_oath_id;

  IF coalesce(p_social_phone, '') <> '' OR coalesce(p_social_msg, '') <> '' OR coalesce(p_nominee_email, '') <> '' OR coalesce(p_anti_charity_cause, '') <> '' THEN
    INSERT INTO public.oath_private_details (oath_id, social_ransom_phone, social_ransom_message, nominee_email, anti_charity_cause)
    VALUES (v_oath_id, p_social_phone, p_social_msg, p_nominee_email, p_anti_charity_cause);
  END IF;

  IF p_verification_method = 'nominee' AND coalesce(p_nominee_email, '') <> '' THEN
    INSERT INTO public.nominees (oath_id, email) VALUES (v_oath_id, p_nominee_email);
  END IF;

  UPDATE public.profiles SET
    oaths_created = coalesce(oaths_created, 0) + 1,
    total_staked = coalesce(total_staked, 0) + v_total_stake,
    updated_at = now()
  WHERE id = v_user;

  IF p_oath_type IN ('squad', 'duo') THEN
    INSERT INTO public.group_members (oath_id, user_id, stake_amount, status, votes_needed)
    VALUES (v_oath_id, v_user, p_stake_amount, 'joined', 3);
  END IF;

  IF v_wallet_id IS NOT NULL THEN
    INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
    VALUES (v_wallet_id, v_oath_id, 'escrow_lock', v_total_stake, 'Stake locked for oath');
  END IF;

  RETURN v_oath_id;
END;
$$;

-- Update accept_duo_challenge so it DOES NOT take money from the opponent
CREATE OR REPLACE FUNCTION public.accept_duo_challenge(p_oath_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_user UUID := auth.uid(); v_oath public.oaths%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND OR v_oath.oath_type <> 'duo' OR v_oath.status <> 'pending' THEN RAISE EXCEPTION 'Challenge is unavailable'; END IF;
  IF v_oath.creator_id = v_user OR (v_oath.opponent_id IS NOT NULL AND v_oath.opponent_id <> v_user) THEN RAISE EXCEPTION 'Challenge is not addressed to this account'; END IF;
  IF v_oath.deadline <= now() THEN RAISE EXCEPTION 'This challenge has expired'; END IF;
  
  -- Simply set opponent and status, NO wallet deduction since Leader pays.
  UPDATE public.oaths SET opponent_id = v_user, status = 'active', updated_at = now() WHERE id = p_oath_id;
  
  -- Insert into group members for quorum verification in Duo (if we treat duo like a 2-person squad)
  INSERT INTO public.group_members (oath_id, user_id, stake_amount, status, votes_needed)
  VALUES (p_oath_id, v_user, v_oath.stake_amount, 'joined', 1) ON CONFLICT DO NOTHING;
END;
$$;

-- Update join_squad so it DOES NOT take money from the member
CREATE OR REPLACE FUNCTION public.join_squad(p_oath_id UUID, p_stake_amount NUMERIC) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_user UUID := auth.uid(); v_member UUID; v_oath public.oaths%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_oath FROM public.oaths WHERE id=p_oath_id AND oath_type='squad' AND status IN ('pending','active') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Squad is not open'; END IF;
  IF v_oath.deadline <= now() THEN RAISE EXCEPTION 'Squad deadline has passed'; END IF;
  IF EXISTS (SELECT 1 FROM public.group_members WHERE oath_id=p_oath_id AND user_id=v_user) THEN RAISE EXCEPTION 'Already joined'; END IF;
  IF v_oath.max_players > 0 AND (SELECT count(*) FROM public.group_members WHERE oath_id=p_oath_id) >= v_oath.max_players THEN RAISE EXCEPTION 'Squad is full'; END IF;
  
  -- Insert without charging wallet
  INSERT INTO public.group_members (oath_id,user_id,stake_amount,status,votes_needed) VALUES (p_oath_id,v_user,v_oath.stake_amount,'joined',3) RETURNING id INTO v_member;
  
  UPDATE public.oaths SET status='active',updated_at=now()
    WHERE id=p_oath_id AND status='pending'
      AND (SELECT count(*) FROM public.group_members WHERE oath_id=p_oath_id) >= greatest(1,v_oath.min_players);
  RETURN v_member;
END;
$$;

COMMIT;
