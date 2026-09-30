-- Fix Duo/Squad deductions to automatically deduct from peers' wallets instead of the leader

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
  v_nominee_user_id UUID;
  v_peer_id UUID;
  v_peer_wallet_id UUID;
  v_peer_username TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF length(trim(p_oath_statement)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Statement must be 1–500 chars'; END IF;
  IF p_deadline IS NULL OR p_deadline <= now() THEN RAISE EXCEPTION 'Deadline must be future'; END IF;
  IF p_stake_amount < 0 THEN
    RAISE EXCEPTION 'Stake must be non-negative';
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
  ELSIF p_oath_type = 'squad' THEN
    v_min_players := greatest(3, coalesce(p_min_players, 4));
    v_max_players := least(10, greatest(v_min_players, coalesce(p_max_players, 8)));
  ELSIF p_oath_type = 'lobby' THEN
    v_min_players := greatest(2, coalesce(p_min_players, 2));
    v_max_players := least(10, greatest(v_min_players, coalesce(p_max_players, 10)));
  ELSE
    v_min_players := 1;
    v_max_players := 1;
  END IF;

  -- 1. Deduct from Leader
  IF p_stake_amount > 0 THEN
    UPDATE public.wallets 
    SET balance = balance - p_stake_amount,
        escrow_locked = escrow_locked + p_stake_amount, 
        updated_at = now()
    WHERE user_id = v_user AND balance >= p_stake_amount
    RETURNING id INTO v_wallet_id;
    
    IF v_wallet_id IS NULL THEN 
      RAISE EXCEPTION 'Insufficient balance to cover your stake'; 
    END IF;
  END IF;
  
  -- Create Oath
  INSERT INTO public.oaths (
    creator_id, oath_statement, deadline, oath_type, verification_method, 
    consequence_type, stake_amount, status, min_players, max_players, opponent_id, group_mode)
  VALUES (
    v_user, p_oath_statement, p_deadline, p_oath_type, p_verification_method,
    p_consequence_type, p_stake_amount, 
    'active'::public.oath_status, -- They are active instantly now because peers are auto-joined
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
    total_staked = coalesce(total_staked, 0) + p_stake_amount,
    updated_at = now()
  WHERE id = v_user;

  -- Add leader to group_members
  IF p_oath_type IN ('squad', 'duo', 'lobby') THEN
    INSERT INTO public.group_members (oath_id, user_id, stake_amount, status, votes_needed)
    VALUES (v_oath_id, v_user, p_stake_amount, 'joined', CASE WHEN p_oath_type = 'duo' THEN 1 ELSE 3 END);
  END IF;

  IF p_stake_amount > 0 THEN
    INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
    VALUES (v_wallet_id, v_oath_id, 'escrow_lock', p_stake_amount, 'Escrow locked for ' || p_oath_type::text || ' oath: ' || p_oath_statement);
  END IF;

  -- 2. Deduct from Peers (Duo)
  IF p_oath_type = 'duo' AND p_opponent_id IS NOT NULL THEN
    SELECT username INTO v_peer_username FROM public.profiles WHERE id = p_opponent_id;
    IF p_stake_amount > 0 THEN
      UPDATE public.wallets 
      SET balance = balance - p_stake_amount, escrow_locked = escrow_locked + p_stake_amount, updated_at = now()
      WHERE user_id = p_opponent_id AND balance >= p_stake_amount
      RETURNING id INTO v_peer_wallet_id;
      IF v_peer_wallet_id IS NULL THEN RAISE EXCEPTION 'Opponent @% does not have enough balance', v_peer_username; END IF;
      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_peer_wallet_id, v_oath_id, 'escrow_lock', p_stake_amount, 'Escrow locked for duo oath from @' || (SELECT username FROM public.profiles WHERE id = v_user));
    END IF;
    INSERT INTO public.group_members (oath_id, user_id, stake_amount, status, votes_needed) VALUES (v_oath_id, p_opponent_id, p_stake_amount, 'joined', 1);
  END IF;

  -- 3. Deduct from Peers (Squad)
  IF p_oath_type = 'squad' AND p_opponent_ids IS NOT NULL AND array_length(p_opponent_ids, 1) > 0 THEN
    FOREACH v_peer_id IN ARRAY p_opponent_ids LOOP
      SELECT username INTO v_peer_username FROM public.profiles WHERE id = v_peer_id;
      IF p_stake_amount > 0 THEN
        UPDATE public.wallets 
        SET balance = balance - p_stake_amount, escrow_locked = escrow_locked + p_stake_amount, updated_at = now()
        WHERE user_id = v_peer_id AND balance >= p_stake_amount
        RETURNING id INTO v_peer_wallet_id;
        IF v_peer_wallet_id IS NULL THEN RAISE EXCEPTION 'Squad member @% does not have enough balance', v_peer_username; END IF;
        INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
        VALUES (v_peer_wallet_id, v_oath_id, 'escrow_lock', p_stake_amount, 'Escrow locked for squad oath from @' || (SELECT username FROM public.profiles WHERE id = v_user));
      END IF;
      INSERT INTO public.group_members (oath_id, user_id, stake_amount, status, votes_needed) VALUES (v_oath_id, v_peer_id, p_stake_amount, 'joined', 3);
    END LOOP;
  END IF;

  RETURN v_oath_id;
END;
$$;
