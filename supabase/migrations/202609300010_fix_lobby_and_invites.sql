-- 202609300009_fix_lobby_and_invites.sql
-- Fix lobby oath creation, individual buy-in joining, lobby settlement, and refund descriptions

-- 1. Canonical create_oath_with_stake: support 'lobby' with individual buy-in
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
  p_group_mode public.group_mode DEFAULT 'survival'
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_oath_id UUID;
  v_wallet_id UUID;
  v_total_stake NUMERIC;
  v_min_players INT;
  v_max_players INT;
  v_nominee_user_id UUID;
BEGIN
  IF v_user IS NULL THEN 
    RAISE EXCEPTION 'Not authenticated'; 
  END IF;

  IF length(trim(p_oath_statement)) NOT BETWEEN 1 AND 500 THEN 
    RAISE EXCEPTION 'Statement must be 1–500 chars'; 
  END IF;

  IF p_deadline IS NULL OR p_deadline <= now() THEN 
    RAISE EXCEPTION 'Deadline must be future'; 
  END IF;

  IF p_stake_amount < 0 OR round(p_stake_amount, 2) <> p_stake_amount THEN 
    RAISE EXCEPTION 'Stake must be non-negative with at most 2 decimal places'; 
  END IF;

  IF p_oath_type = 'duo' AND p_opponent_id IS NOT NULL AND p_opponent_id = v_user THEN
    RAISE EXCEPTION 'You cannot challenge yourself';
  END IF;

  IF p_verification_method = 'nominee' AND coalesce(p_nominee_email, '') = '' THEN
    RAISE EXCEPTION 'Nominee verification requires a nominee email or username';
  END IF;

  IF p_consequence_type = 'social_ransom' AND (coalesce(p_social_phone, '') = '' OR coalesce(p_social_msg, '') = '') THEN
    RAISE EXCEPTION 'Social ransom requires both phone and message';
  END IF;

  IF p_oath_type = 'duo' THEN
    v_min_players := 2;
    v_max_players := 2;
    v_total_stake := p_stake_amount * 2;
  ELSIF p_oath_type = 'squad' THEN
    IF p_min_players IS NOT NULL AND p_max_players IS NOT NULL AND (p_min_players > p_max_players OR p_min_players < 3 OR p_max_players > 10) THEN
      RAISE EXCEPTION 'Invalid squad size: must have between 3 and 10 players, and min cannot exceed max';
    END IF;
    v_min_players := greatest(3, coalesce(p_min_players, 4));
    v_max_players := least(10, greatest(v_min_players, coalesce(p_max_players, 8)));
    v_total_stake := p_stake_amount * v_max_players;
  ELSIF p_oath_type = 'lobby' THEN
    IF p_min_players IS NOT NULL AND p_max_players IS NOT NULL AND (p_min_players > p_max_players OR p_min_players < 2 OR p_max_players > 10) THEN
      RAISE EXCEPTION 'Invalid lobby size: must have between 2 and 10 players, and min cannot exceed max';
    END IF;
    v_min_players := greatest(2, coalesce(p_min_players, 2));
    v_max_players := least(10, greatest(v_min_players, coalesce(p_max_players, 10)));
    -- In a public lobby, each player pays their individual stake buy-in
    v_total_stake := p_stake_amount;
  ELSE
    v_min_players := 1;
    v_max_players := 1;
    v_total_stake := p_stake_amount;
  END IF;

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
  
  INSERT INTO public.oaths (
    creator_id, oath_statement, deadline, oath_type, verification_method, 
    consequence_type, stake_amount, status, min_players, max_players, opponent_id, group_mode)
  VALUES (
    v_user, p_oath_statement, p_deadline, p_oath_type, p_verification_method,
    p_consequence_type, p_stake_amount, 
    CASE WHEN p_oath_type IN ('squad', 'duo', 'lobby') THEN 'pending'::public.oath_status ELSE 'active'::public.oath_status END,
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

-- 2. join_squad: support both 'squad' (free, leader covered) and 'lobby' (individual buy-in)
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
  SELECT * INTO v_oath FROM public.oaths WHERE id=p_oath_id AND oath_type IN ('squad', 'lobby') AND status IN ('pending','active') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Squad or lobby is not open'; END IF;
  IF v_oath.deadline <= now() THEN RAISE EXCEPTION 'Squad deadline has passed'; END IF;
  IF EXISTS (SELECT 1 FROM public.group_members WHERE oath_id=p_oath_id AND user_id=v_user) THEN RAISE EXCEPTION 'Already joined'; END IF;
  IF v_oath.max_players > 0 AND (SELECT count(*) FROM public.group_members WHERE oath_id=p_oath_id) >= v_oath.max_players THEN 
    RAISE EXCEPTION 'Squad is full'; 
  END IF;
  
  -- If this is a lobby oath, the joining player pays their own stake buy-in
  IF v_oath.oath_type = 'lobby' AND coalesce(v_oath.stake_amount, 0) > 0 THEN
    v_join_stake := v_oath.stake_amount;
    UPDATE public.wallets 
    SET balance = balance - v_join_stake,
        escrow_locked = escrow_locked + v_join_stake,
        updated_at = now()
    WHERE user_id = v_user AND balance >= v_join_stake
    RETURNING id INTO v_wallet_id;

    IF v_wallet_id IS NULL THEN
      RAISE EXCEPTION 'Insufficient balance to join lobby (% required)', v_join_stake;
    END IF;

    INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
    VALUES (v_wallet_id, p_oath_id, 'escrow_lock', v_join_stake, 'Lobby buy-in stake locked');

    UPDATE public.profiles SET
      total_staked = coalesce(total_staked, 0) + v_join_stake,
      updated_at = now()
    WHERE id = v_user;
  END IF;

  INSERT INTO public.group_members (oath_id, user_id, stake_amount, status, votes_needed) 
  VALUES (p_oath_id, v_user, v_oath.stake_amount, 'joined', 3) 
  RETURNING id INTO v_member;
  
  UPDATE public.oaths SET status='active', updated_at=now()
  WHERE id=p_oath_id AND status='pending'
    AND (SELECT count(*) FROM public.group_members WHERE oath_id=p_oath_id) >= greatest(1, v_oath.min_players);

  RETURN v_member;
END;
$$;

-- 3. cast_squad_vote: handle individual lobby settlements and squad settlements
CREATE OR REPLACE FUNCTION public.cast_squad_vote(p_oath_id UUID, p_member_id UUID, p_approve BOOLEAN) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE 
  v_user UUID := auth.uid(); 
  v_member public.group_members%ROWTYPE; 
  v_proof UUID; 
  v_yes INTEGER; 
  v_no INTEGER; 
  v_wallet UUID; 
  v_oath public.oaths%ROWTYPE;
  v_pending_count INTEGER;
  v_squad_total NUMERIC;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND OR v_oath.status <> 'active' THEN RAISE EXCEPTION 'Oath is not active'; END IF;
  
  SELECT * INTO v_member FROM public.group_members WHERE id=p_member_id AND oath_id=p_oath_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.group_members WHERE oath_id=p_oath_id AND user_id=v_user) THEN 
    RAISE EXCEPTION 'Not a member of this squad'; 
  END IF;
  IF v_member.user_id = v_user THEN RAISE EXCEPTION 'You cannot vote on your own proof'; END IF;
  
  SELECT id INTO v_proof FROM public.proofs WHERE oath_id=p_oath_id AND submitted_by=v_member.user_id ORDER BY created_at DESC LIMIT 1;
  IF v_proof IS NULL THEN RAISE EXCEPTION 'No proof to vote on'; END IF;

  IF EXISTS (SELECT 1 FROM public.votes WHERE proof_id=v_proof AND voter_id=v_user) THEN
    RAISE EXCEPTION 'You have already voted on this proof';
  END IF;
  IF v_member.status <> 'joined' THEN RAISE EXCEPTION 'This member has already been resolved'; END IF;
  
  INSERT INTO public.votes (proof_id, voter_id, oath_id, vote) VALUES (v_proof, v_user, p_oath_id, p_approve);
  SELECT count(*) FILTER (WHERE vote), count(*) FILTER (WHERE NOT vote) INTO v_yes, v_no FROM public.votes WHERE proof_id=v_proof;
  
  IF v_yes >= greatest(1, v_member.votes_needed) THEN
    -- SUCCESS for this member
    UPDATE public.group_members SET votes_received=v_yes, status='completed', is_winner=true WHERE id=v_member.id;
    UPDATE public.profiles SET oaths_completed=coalesce(oaths_completed,0)+1, updated_at=now() WHERE id=v_member.user_id;
    
    IF v_oath.oath_type = 'lobby' THEN
      -- Lobby: refund THIS member's escrow
      UPDATE public.wallets 
      SET balance = balance + v_oath.stake_amount, 
          escrow_locked = escrow_locked - v_oath.stake_amount, 
          updated_at = now()
      WHERE user_id = v_member.user_id AND escrow_locked >= v_oath.stake_amount 
      RETURNING id INTO v_wallet;
      
      IF v_wallet IS NOT NULL THEN
        INSERT INTO public.transactions(wallet_id, oath_id, type, amount, description) 
        VALUES(v_wallet, p_oath_id, 'escrow_release', v_oath.stake_amount, 'Lobby challenge completed, stake returned');
      END IF;
    ELSIF v_oath.group_mode = 'survival' THEN
      -- Squad survival: refund leader's escrow for this member
      UPDATE public.wallets 
      SET balance = balance + v_oath.stake_amount, 
          escrow_locked = escrow_locked - v_oath.stake_amount, 
          updated_at = now()
      WHERE user_id = v_oath.creator_id AND escrow_locked >= v_oath.stake_amount 
      RETURNING id INTO v_wallet;
      
      IF v_wallet IS NOT NULL THEN
        INSERT INTO public.transactions(wallet_id, oath_id, type, amount, description) 
        VALUES(v_wallet, p_oath_id, 'escrow_release', v_oath.stake_amount, 'Squad member succeeded (Survival refund)');
      END IF;
    END IF;

  ELSIF v_no >= greatest(1, v_member.votes_needed) THEN
    -- FAILURE for this member
    UPDATE public.group_members SET votes_received=v_yes, status='failed', is_winner=false WHERE id=v_member.id;
    UPDATE public.profiles SET oaths_failed=coalesce(oaths_failed,0)+1, updated_at=now() WHERE id=v_member.user_id;
    
    IF v_oath.oath_type = 'lobby' THEN
      -- Lobby: penalize THIS member's escrow
      UPDATE public.wallets 
      SET total_lost = total_lost + v_oath.stake_amount, 
          escrow_locked = escrow_locked - v_oath.stake_amount, 
          updated_at = now()
      WHERE user_id = v_member.user_id AND escrow_locked >= v_oath.stake_amount 
      RETURNING id INTO v_wallet;
      
      IF v_wallet IS NOT NULL THEN
        INSERT INTO public.transactions(wallet_id, oath_id, type, amount, description) 
        VALUES(v_wallet, p_oath_id, 'penalty', v_oath.stake_amount, 'Lobby challenge failed, stake forfeited');
      END IF;

    ELSIF v_oath.group_mode = 'survival' THEN
      UPDATE public.wallets 
      SET total_lost = total_lost + v_oath.stake_amount, 
          escrow_locked = escrow_locked - v_oath.stake_amount, 
          updated_at = now()
      WHERE user_id = v_oath.creator_id AND escrow_locked >= v_oath.stake_amount 
      RETURNING id INTO v_wallet;
      
      IF v_wallet IS NOT NULL THEN
        INSERT INTO public.transactions(wallet_id, oath_id, type, amount, description) 
        VALUES(v_wallet, p_oath_id, 'penalty', v_oath.stake_amount, 'Squad member failed (Survival penalty)');
      END IF;

    ELSIF v_oath.group_mode = 'weakest_link' THEN
      v_squad_total := v_oath.stake_amount * v_oath.max_players;
      UPDATE public.wallets 
      SET total_lost = total_lost + v_squad_total, 
          escrow_locked = escrow_locked - v_squad_total, 
          updated_at = now()
      WHERE user_id = v_oath.creator_id AND escrow_locked >= v_squad_total 
      RETURNING id INTO v_wallet;
      
      IF v_wallet IS NOT NULL THEN
        INSERT INTO public.transactions(wallet_id, oath_id, type, amount, description) 
        VALUES(v_wallet, p_oath_id, 'penalty', v_squad_total, 'Weakest link failed, entire squad stake forfeited');
      END IF;
      UPDATE public.oaths SET status='failed', updated_at=now() WHERE id=p_oath_id;
      RETURN;
    END IF;
    
  ELSE
    UPDATE public.group_members SET votes_received=v_yes WHERE id=v_member.id;
  END IF;

  -- Final cleanup: check if all members resolved
  SELECT count(*) INTO v_pending_count FROM public.group_members WHERE oath_id=p_oath_id AND status='joined';
  IF v_pending_count = 0 AND (SELECT status FROM public.oaths WHERE id=p_oath_id) = 'active' THEN
    IF v_oath.group_mode = 'weakest_link' THEN
      v_squad_total := v_oath.stake_amount * v_oath.max_players;
      UPDATE public.wallets 
      SET balance = balance + v_squad_total, 
          escrow_locked = escrow_locked - v_squad_total, 
          updated_at = now()
      WHERE user_id = v_oath.creator_id AND escrow_locked >= v_squad_total 
      RETURNING id INTO v_wallet;
      
      IF v_wallet IS NOT NULL THEN
        INSERT INTO public.transactions(wallet_id, oath_id, type, amount, description) 
        VALUES(v_wallet, p_oath_id, 'escrow_release', v_squad_total, 'All squad members survived (Weakest Link refund)');
      END IF;
      UPDATE public.oaths SET status='completed', updated_at=now() WHERE id=p_oath_id;
    ELSE
      IF EXISTS (SELECT 1 FROM public.group_members WHERE oath_id=p_oath_id AND status='completed') THEN
        UPDATE public.oaths SET status='completed', updated_at=now() WHERE id=p_oath_id;
      ELSE
        UPDATE public.oaths SET status='failed', updated_at=now() WHERE id=p_oath_id;
      END IF;
    END IF;
  END IF;
END;
$$;

-- 4. forfeit_squad_member: support lobby member forfeit
CREATE OR REPLACE FUNCTION public.forfeit_squad_member(p_oath_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE 
  v_user UUID := auth.uid(); 
  v_oath public.oaths%ROWTYPE; 
  v_member public.group_members%ROWTYPE; 
  v_wallet UUID;
  v_pending_count INTEGER;
  v_squad_total NUMERIC;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_oath FROM public.oaths WHERE id=p_oath_id FOR UPDATE;
  IF NOT FOUND OR v_oath.status <> 'active' THEN RAISE EXCEPTION 'Squad not active'; END IF;
  SELECT * INTO v_member FROM public.group_members WHERE oath_id=p_oath_id AND user_id=v_user FOR UPDATE;
  IF NOT FOUND OR v_member.status <> 'joined' THEN RAISE EXCEPTION 'No unresolved membership found'; END IF;
  
  UPDATE public.group_members SET status='failed', is_winner=false WHERE id=v_member.id;
  UPDATE public.profiles SET oaths_failed=coalesce(oaths_failed,0)+1, updated_at=now() WHERE id=v_user;

  IF v_oath.oath_type = 'lobby' THEN
    UPDATE public.wallets 
    SET total_lost = total_lost + v_oath.stake_amount, 
        escrow_locked = escrow_locked - v_oath.stake_amount, 
        updated_at = now()
    WHERE user_id = v_user AND escrow_locked >= v_oath.stake_amount 
    RETURNING id INTO v_wallet;
    
    IF v_wallet IS NOT NULL THEN
      INSERT INTO public.transactions(wallet_id, oath_id, type, amount, description) 
      VALUES(v_wallet, p_oath_id, 'penalty', v_oath.stake_amount, 'Lobby challenge forfeited');
    END IF;
  ELSIF v_oath.group_mode = 'survival' THEN
    UPDATE public.wallets 
    SET total_lost = total_lost + v_oath.stake_amount, 
        escrow_locked = escrow_locked - v_oath.stake_amount, 
        updated_at = now()
    WHERE user_id = v_oath.creator_id AND escrow_locked >= v_oath.stake_amount 
    RETURNING id INTO v_wallet;
    
    IF v_wallet IS NOT NULL THEN
      INSERT INTO public.transactions(wallet_id, oath_id, type, amount, description) 
      VALUES(v_wallet, p_oath_id, 'penalty', v_oath.stake_amount, 'Squad member forfeited (Survival)');
    END IF;
  ELSIF v_oath.group_mode = 'weakest_link' THEN
    v_squad_total := v_oath.stake_amount * v_oath.max_players;
    UPDATE public.wallets 
    SET total_lost = total_lost + v_squad_total, 
        escrow_locked = escrow_locked - v_squad_total, 
        updated_at = now()
    WHERE user_id = v_oath.creator_id AND escrow_locked >= v_squad_total 
    RETURNING id INTO v_wallet;
    
    IF v_wallet IS NOT NULL THEN
      INSERT INTO public.transactions(wallet_id, oath_id, type, amount, description) 
      VALUES(v_wallet, p_oath_id, 'penalty', v_squad_total, 'Weakest link member forfeited, squad forfeiture');
    END IF;
    UPDATE public.oaths SET status='failed', updated_at=now() WHERE id=p_oath_id;
    RETURN;
  END IF;

  SELECT count(*) INTO v_pending_count FROM public.group_members WHERE oath_id=p_oath_id AND status='joined';
  IF v_pending_count = 0 AND (SELECT status FROM public.oaths WHERE id=p_oath_id) = 'active' THEN
    IF EXISTS (SELECT 1 FROM public.group_members WHERE oath_id=p_oath_id AND status='completed') THEN
      UPDATE public.oaths SET status='completed', updated_at=now() WHERE id=p_oath_id;
    ELSE
      UPDATE public.oaths SET status='failed', updated_at=now() WHERE id=p_oath_id;
    END IF;
  END IF;
END;
$$;

-- 5. fail_squad_member: support lobby member deadline resolution
CREATE OR REPLACE FUNCTION public.fail_squad_member(p_oath_id UUID, p_member_id UUID DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE 
  v_user UUID := auth.uid(); 
  v_oath public.oaths%ROWTYPE; 
  v_member public.group_members%ROWTYPE; 
  v_wallet UUID;
  v_pending_count INTEGER;
  v_squad_total NUMERIC;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_oath FROM public.oaths WHERE id=p_oath_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Squad not found'; END IF;
  IF v_oath.deadline > now() THEN RAISE EXCEPTION 'Squad deadline has not passed'; END IF;

  IF p_member_id IS NOT NULL THEN
    SELECT * INTO v_member FROM public.group_members WHERE id=p_member_id AND oath_id=p_oath_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Squad member not found'; END IF;
    IF NOT (v_oath.creator_id = v_user OR EXISTS (SELECT 1 FROM public.group_members WHERE oath_id=p_oath_id AND user_id=v_user)) THEN
      RAISE EXCEPTION 'Not authorized to settle this member';
    END IF;
  ELSE
    SELECT * INTO v_member FROM public.group_members WHERE oath_id=p_oath_id AND user_id=v_user FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'No unresolved squad membership found for this user'; END IF;
  END IF;

  IF v_member.status <> 'joined' THEN RAISE EXCEPTION 'Member has already been resolved'; END IF;
  IF v_member.proof_submitted IS TRUE OR EXISTS (SELECT 1 FROM public.proofs WHERE oath_id=p_oath_id AND submitted_by=v_member.user_id) THEN
    RAISE EXCEPTION 'A member with submitted proof must be resolved by quorum vote';
  END IF;
  
  UPDATE public.group_members SET status='failed', is_winner=false WHERE id=v_member.id;
  UPDATE public.profiles SET oaths_failed=coalesce(oaths_failed,0)+1, updated_at=now() WHERE id=v_member.user_id;

  IF v_oath.oath_type = 'lobby' THEN
    UPDATE public.wallets 
    SET total_lost = total_lost + v_oath.stake_amount, 
        escrow_locked = escrow_locked - v_oath.stake_amount, 
        updated_at = now()
    WHERE user_id = v_member.user_id AND escrow_locked >= v_oath.stake_amount 
    RETURNING id INTO v_wallet;
    
    IF v_wallet IS NOT NULL THEN
      INSERT INTO public.transactions(wallet_id, oath_id, type, amount, description) 
      VALUES(v_wallet, p_oath_id, 'penalty', v_oath.stake_amount, 'Lobby deadline passed without proof');
    END IF;
  ELSIF v_oath.group_mode = 'survival' THEN
    UPDATE public.wallets 
    SET total_lost = total_lost + v_oath.stake_amount, 
        escrow_locked = escrow_locked - v_oath.stake_amount, 
        updated_at = now()
    WHERE user_id = v_oath.creator_id AND escrow_locked >= v_oath.stake_amount 
    RETURNING id INTO v_wallet;
    
    IF v_wallet IS NOT NULL THEN
      INSERT INTO public.transactions(wallet_id, oath_id, type, amount, description) 
      VALUES(v_wallet, p_oath_id, 'penalty', v_oath.stake_amount, 'Squad deadline passed without proof (Survival)');
    END IF;
  ELSIF v_oath.group_mode = 'weakest_link' THEN
    v_squad_total := v_oath.stake_amount * v_oath.max_players;
    UPDATE public.wallets 
    SET total_lost = total_lost + v_squad_total, 
        escrow_locked = escrow_locked - v_squad_total, 
        updated_at = now()
    WHERE user_id = v_oath.creator_id AND escrow_locked >= v_squad_total 
    RETURNING id INTO v_wallet;
    
    IF v_wallet IS NOT NULL THEN
      INSERT INTO public.transactions(wallet_id, oath_id, type, amount, description) 
      VALUES(v_wallet, p_oath_id, 'penalty', v_squad_total, 'Weakest link delinquent member, squad forfeiture');
    END IF;
    UPDATE public.oaths SET status='failed', updated_at=now() WHERE id=p_oath_id;
    RETURN;
  END IF;

  SELECT count(*) INTO v_pending_count FROM public.group_members WHERE oath_id=p_oath_id AND status='joined';
  IF v_pending_count = 0 AND (SELECT status FROM public.oaths WHERE id=p_oath_id) = 'active' THEN
    IF EXISTS (SELECT 1 FROM public.group_members WHERE oath_id=p_oath_id AND status='completed') THEN
      UPDATE public.oaths SET status='completed', updated_at=now() WHERE id=p_oath_id;
    ELSE
      UPDATE public.oaths SET status='failed', updated_at=now() WHERE id=p_oath_id;
    END IF;
  END IF;
END;
$$;

-- 6. add_funds: drop old single-argument signature and replace with defaulted description
DROP FUNCTION IF EXISTS public.add_funds(NUMERIC);

CREATE OR REPLACE FUNCTION public.add_funds(p_amount NUMERIC, p_description TEXT DEFAULT 'Deposited funds via Razorpay') RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet_id UUID;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = auth.uid();
  IF v_wallet_id IS NULL THEN
    INSERT INTO public.wallets (user_id, balance) VALUES (auth.uid(), 0) RETURNING id INTO v_wallet_id;
  END IF;

  UPDATE public.wallets
  SET 
    balance = balance + p_amount,
    total_deposited = CASE WHEN p_description LIKE 'Refund%' THEN total_deposited ELSE total_deposited + p_amount END
  WHERE id = v_wallet_id;

  INSERT INTO public.transactions (wallet_id, type, amount, description)
  VALUES (v_wallet_id, CASE WHEN p_description LIKE 'Refund%' THEN 'reward'::public.transaction_type ELSE 'deposit'::public.transaction_type END, p_amount, coalesce(p_description, 'Deposited funds'));
END;
$$;

-- 7. Permissions
GRANT EXECUTE ON FUNCTION public.create_oath_with_stake(TEXT, TIMESTAMPTZ, public.oath_type, public.verification_method, public.consequence_type, NUMERIC, INT, INT, UUID, TEXT, TEXT, TEXT, TEXT, public.group_mode) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_squad(UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cast_squad_vote(UUID, UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forfeit_squad_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fail_squad_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_funds(NUMERIC, TEXT) TO authenticated;
