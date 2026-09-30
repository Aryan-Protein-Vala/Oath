-- Migration 202609300015: Fix RLS policies for lobby and duo visibility, and fix duo challenge & lobby creation flows

-- 1. RLS on oaths: Allow public read of open squads and lobbies, and pending duo invitations
DROP POLICY IF EXISTS "Participants and open squads can read safe oath rows" ON public.oaths;
CREATE POLICY "Participants and open squads can read safe oath rows" ON public.oaths
  FOR SELECT TO authenticated USING (
    creator_id = auth.uid()
    OR opponent_id = auth.uid()
    OR public.is_oath_member(oaths.id)
    OR (oath_type IN ('squad', 'lobby') AND status IN ('pending', 'active'))
  );

DROP POLICY IF EXISTS "Pending duo invitations are readable" ON public.oaths;
CREATE POLICY "Pending duo invitations are readable" ON public.oaths
  FOR SELECT TO anon, authenticated USING (
    (oath_type = 'duo' AND status IN ('pending', 'active'))
    OR (oath_type IN ('squad', 'lobby') AND status IN ('pending', 'active'))
  );

-- 2. RLS on group_members: Allow reading members of open squads and lobbies
DROP POLICY IF EXISTS "Group participants can read members" ON public.group_members;
CREATE POLICY "Group participants can read members" ON public.group_members
  FOR SELECT TO anon, authenticated USING (
    public.is_oath_member(group_members.oath_id)
    OR EXISTS (
      SELECT 1 FROM public.oaths o
      WHERE o.id = group_members.oath_id
        AND o.oath_type IN ('squad', 'lobby')
        AND o.status IN ('pending', 'active')
    )
  );

-- 3. Fix create_oath_with_stake
DROP FUNCTION IF EXISTS public.create_oath_with_stake(TEXT, TIMESTAMPTZ, public.oath_type, public.verification_method, public.consequence_type, NUMERIC, TEXT, TEXT, TEXT, INTEGER, INTEGER, UUID);
DROP FUNCTION IF EXISTS public.create_oath_with_stake(TEXT, TIMESTAMPTZ, public.oath_type, public.verification_method, public.consequence_type, NUMERIC, INT, INT, UUID, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.create_oath_with_stake(TEXT, TIMESTAMPTZ, public.oath_type, public.verification_method, public.consequence_type, NUMERIC, INT, INT, UUID, TEXT, TEXT, TEXT, TEXT, public.group_mode);
DROP FUNCTION IF EXISTS public.create_oath_with_stake(TEXT, TIMESTAMPTZ, public.oath_type, public.verification_method, public.consequence_type, NUMERIC, INT, INT, UUID, TEXT, TEXT, TEXT, TEXT, public.group_mode, UUID[]);

CREATE OR REPLACE FUNCTION public.create_oath_with_stake(
  p_oath_statement TEXT,
  p_deadline TIMESTAMPTZ,
  p_oath_type public.oath_type,
  p_verification_method public.verification_method,
  p_consequence_type public.consequence_type,
  p_stake_amount NUMERIC,
  p_min_players INT DEFAULT NULL,
  p_max_players INT DEFAULT NULL,
  p_opponent_id UUID DEFAULT NULL,
  p_social_phone TEXT DEFAULT NULL,
  p_social_msg TEXT DEFAULT NULL,
  p_nominee_email TEXT DEFAULT NULL,
  p_anti_charity_cause TEXT DEFAULT NULL,
  p_group_mode public.group_mode DEFAULT NULL,
  p_opponent_ids UUID[] DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_user UUID := auth.uid();
  v_oath_id UUID;
  v_wallet_id UUID;
  v_min_players INT;
  v_max_players INT;
  v_total_stake NUMERIC := 0;
  v_nominee_user_id UUID;
  v_initial_status public.oath_status;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF length(trim(p_oath_statement)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Statement must be 1–500 chars'; END IF;
  IF p_deadline IS NULL OR p_deadline <= now() THEN RAISE EXCEPTION 'Deadline must be future'; END IF;
  IF p_stake_amount < 0 THEN RAISE EXCEPTION 'Stake must be non-negative'; END IF;

  IF p_oath_type = 'duo' AND p_opponent_id IS NOT NULL AND p_opponent_id = v_user THEN
    RAISE EXCEPTION 'You cannot challenge yourself';
  END IF;

  IF p_verification_method = 'nominee' AND coalesce(p_nominee_email, '') = '' THEN
    RAISE EXCEPTION 'Nominee verification requires a nominee email or username';
  END IF;

  IF p_consequence_type = 'social_ransom' AND (coalesce(p_social_phone, '') = '' OR coalesce(p_social_msg, '') = '') THEN
    RAISE EXCEPTION 'Social ransom requires both phone and message';
  END IF;

  IF p_oath_type IN ('duo', 'squad') AND p_group_mode IS NULL THEN
    p_group_mode := 'survival';
  END IF;

  IF p_oath_type = 'duo' THEN
    v_min_players := 2;
    v_max_players := 2;
    v_total_stake := p_stake_amount * 2; -- Leader pays 2x pot upfront so opponent can join free
    v_initial_status := 'pending';
  ELSIF p_oath_type = 'squad' THEN
    IF p_min_players IS NOT NULL AND p_max_players IS NOT NULL AND (p_min_players > p_max_players OR p_min_players < 3 OR p_max_players > 10) THEN
      RAISE EXCEPTION 'Invalid squad size: must have between 3 and 10 players, and min cannot exceed max';
    END IF;
    v_min_players := greatest(3, coalesce(p_min_players, 4));
    v_max_players := least(10, greatest(v_min_players, coalesce(p_max_players, 8)));
    v_total_stake := p_stake_amount * v_max_players;
    v_initial_status := 'pending';
  ELSIF p_oath_type = 'lobby' THEN
    v_min_players := greatest(2, coalesce(p_min_players, 2));
    v_max_players := least(10, greatest(v_min_players, coalesce(p_max_players, 10)));
    v_total_stake := p_stake_amount; -- In public lobby, creator pays 1x buy-in
    v_initial_status := 'pending';
  ELSE
    v_min_players := 1;
    v_max_players := 1;
    v_total_stake := p_stake_amount;
    v_initial_status := 'active';
  END IF;

  -- Deduct creator stake / total pot
  IF v_total_stake > 0 THEN
    UPDATE public.wallets 
    SET balance = balance - v_total_stake,
        escrow_locked = escrow_locked + v_total_stake, 
        updated_at = now()
    WHERE user_id = v_user AND balance >= v_total_stake
    RETURNING id INTO v_wallet_id;
    
    IF v_wallet_id IS NULL THEN 
      RAISE EXCEPTION 'Insufficient balance to cover total stake (% required)', v_total_stake; 
    END IF;
  END IF;
  
  -- Create Oath with proper pending status
  INSERT INTO public.oaths (
    creator_id, oath_statement, deadline, oath_type, verification_method, 
    consequence_type, stake_amount, status, min_players, max_players, opponent_id, group_mode)
  VALUES (
    v_user, p_oath_statement, p_deadline, p_oath_type, p_verification_method,
    p_consequence_type, p_stake_amount, 
    v_initial_status,
    v_min_players, v_max_players, p_opponent_id, p_group_mode)
  RETURNING id INTO v_oath_id;

  IF coalesce(p_social_phone, '') <> '' OR coalesce(p_social_msg, '') <> '' OR coalesce(p_nominee_email, '') <> '' OR coalesce(p_anti_charity_cause, '') <> '' THEN
    INSERT INTO public.oath_private_details (oath_id, social_ransom_phone, social_ransom_message, nominee_email, anti_charity_cause)
    VALUES (v_oath_id, p_social_phone, p_social_msg, p_nominee_email, p_anti_charity_cause);
  END IF;

  IF p_verification_method = 'nominee' AND coalesce(p_nominee_email, '') <> '' THEN
    SELECT id INTO v_nominee_user_id FROM public.profiles WHERE username = replace(p_nominee_email, '@', '') LIMIT 1;
    INSERT INTO public.nominees (oath_id, email, nominee_user_id) 
    VALUES (v_oath_id, p_nominee_email, v_nominee_user_id);
  END IF;

  UPDATE public.profiles SET
    oaths_created = coalesce(oaths_created, 0) + 1,
    total_staked = coalesce(total_staked, 0) + v_total_stake,
    updated_at = now()
  WHERE id = v_user;

  -- Add leader to group_members
  IF p_oath_type IN ('squad', 'duo', 'lobby') THEN
    INSERT INTO public.group_members (oath_id, user_id, stake_amount, status, votes_needed)
    VALUES (v_oath_id, v_user, p_stake_amount, 'joined', CASE WHEN p_oath_type = 'duo' THEN 1 ELSE 3 END);
  END IF;

  IF v_total_stake > 0 THEN
    INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
    VALUES (v_wallet_id, v_oath_id, 'escrow_lock', v_total_stake, 'Escrow locked for ' || p_oath_type::text || ' oath: ' || p_oath_statement);
  END IF;

  RETURN v_oath_id;
END;
$$;

-- 4. accept_duo_challenge: Opponent joins free (Leader covered pot) and status becomes active
CREATE OR REPLACE FUNCTION public.accept_duo_challenge(p_oath_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_user UUID := auth.uid(); 
  v_oath public.oaths%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND OR v_oath.oath_type <> 'duo' OR v_oath.status <> 'pending' THEN RAISE EXCEPTION 'Challenge is unavailable'; END IF;
  IF v_oath.creator_id = v_user THEN RAISE EXCEPTION 'You cannot accept your own challenge'; END IF;
  IF v_oath.opponent_id IS NOT NULL AND v_oath.opponent_id <> v_user THEN RAISE EXCEPTION 'Challenge is addressed to another user'; END IF;
  IF v_oath.deadline <= now() THEN RAISE EXCEPTION 'This challenge has expired'; END IF;
  
  UPDATE public.oaths SET opponent_id = v_user, status = 'active', updated_at = now() WHERE id = p_oath_id;
  
  INSERT INTO public.group_members (oath_id, user_id, stake_amount, status, votes_needed)
  VALUES (p_oath_id, v_user, v_oath.stake_amount, 'joined', 1) 
  ON CONFLICT (oath_id, user_id) DO UPDATE SET status = 'joined';
END;
$$;

-- 5. cancel_duo_challenge: Refund 2x stake to creator
CREATE OR REPLACE FUNCTION public.cancel_duo_challenge(p_oath_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_user UUID := auth.uid();
  v_oath public.oaths%ROWTYPE;
  v_wallet_id UUID;
  v_refund NUMERIC;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND OR v_oath.oath_type <> 'duo' OR v_oath.creator_id <> v_user THEN 
    RAISE EXCEPTION 'Challenge not found or unauthorized'; 
  END IF;
  IF v_oath.status <> 'pending' THEN RAISE EXCEPTION 'Only pending challenges can be cancelled'; END IF;

  v_refund := v_oath.stake_amount * 2;
  IF v_refund > 0 THEN
    UPDATE public.wallets 
    SET balance = balance + v_refund, escrow_locked = escrow_locked - v_refund, updated_at = now()
    WHERE user_id = v_user AND escrow_locked >= v_refund
    RETURNING id INTO v_wallet_id;
    
    IF v_wallet_id IS NULL THEN RAISE EXCEPTION 'Escrow inconsistent'; END IF;
    
    INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
    VALUES (v_wallet_id, p_oath_id, 'escrow_release', v_refund, 'Duo challenge cancelled by creator; stake refunded');
  END IF;

  UPDATE public.oaths SET status = 'cancelled', updated_at = now() WHERE id = p_oath_id;
END;
$$;

-- 6. join_squad: Supports squad, lobby, and duo joining with correct individual buy-in for lobbies
CREATE OR REPLACE FUNCTION public.join_squad(p_oath_id UUID, p_stake_amount NUMERIC) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE 
  v_user UUID := auth.uid(); 
  v_member UUID; 
  v_oath public.oaths%ROWTYPE;
  v_wallet_id UUID;
  v_join_stake NUMERIC := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_oath FROM public.oaths WHERE id=p_oath_id AND oath_type IN ('squad', 'lobby', 'duo') AND status IN ('pending','active') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oath is not open for joining'; END IF;
  IF v_oath.deadline <= now() THEN RAISE EXCEPTION 'Deadline has passed'; END IF;
  IF EXISTS (SELECT 1 FROM public.group_members WHERE oath_id=p_oath_id AND user_id=v_user) THEN RAISE EXCEPTION 'Already joined'; END IF;
  IF v_oath.max_players > 0 AND (SELECT count(*) FROM public.group_members WHERE oath_id=p_oath_id) >= v_oath.max_players THEN 
    RAISE EXCEPTION 'This oath is full'; 
  END IF;
  
  -- In a lobby, each joining user pays their individual buy-in
  IF v_oath.oath_type = 'lobby' AND coalesce(v_oath.stake_amount, 0) > 0 THEN
    v_join_stake := v_oath.stake_amount;
    UPDATE public.wallets 
    SET balance = balance - v_join_stake,
        escrow_locked = escrow_locked + v_join_stake,
        updated_at = now()
    WHERE user_id = v_user AND balance >= v_join_stake
    RETURNING id INTO v_wallet_id;

    IF v_wallet_id IS NULL THEN
      RAISE EXCEPTION 'You do not have enough money in your wallet (% required)', v_join_stake;
    END IF;

    INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
    VALUES (v_wallet_id, p_oath_id, 'escrow_lock', v_join_stake, 'Stake locked for joining lobby');

    UPDATE public.profiles SET
      total_staked = coalesce(total_staked, 0) + v_join_stake,
      updated_at = now()
    WHERE id = v_user;
  END IF;

  INSERT INTO public.group_members (oath_id, user_id, stake_amount, status, votes_needed)
  VALUES (p_oath_id, v_user, v_oath.stake_amount, 'joined', CASE WHEN v_oath.oath_type = 'duo' THEN 1 ELSE 3 END)
  RETURNING id INTO v_member;

  -- If min_players reached, activate the lobby or squad
  IF (SELECT count(*) FROM public.group_members WHERE oath_id=p_oath_id) >= v_oath.min_players THEN
    UPDATE public.oaths SET status = 'active' WHERE id = p_oath_id AND status = 'pending';
  END IF;

  RETURN v_member;
END;
$$;

-- Grant permissions to authenticated
GRANT EXECUTE ON FUNCTION public.create_oath_with_stake(TEXT, TIMESTAMPTZ, public.oath_type, public.verification_method, public.consequence_type, NUMERIC, INT, INT, UUID, TEXT, TEXT, TEXT, TEXT, public.group_mode, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_duo_challenge(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_duo_challenge(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_squad(UUID, NUMERIC) TO authenticated;
