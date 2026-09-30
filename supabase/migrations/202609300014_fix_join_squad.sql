-- Fix join_squad so that joining a squad also deducts individual buy-in, just like lobby.

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
  
  IF coalesce(v_oath.stake_amount, 0) > 0 THEN
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
    VALUES (v_wallet_id, p_oath_id, 'escrow_lock', v_join_stake, 'Stake locked for joining oath');

    UPDATE public.profiles SET
      total_staked = coalesce(total_staked, 0) + v_join_stake,
      updated_at = now()
    WHERE id = v_user;
  END IF;

  INSERT INTO public.group_members (oath_id, user_id, stake_amount, status, votes_needed)
  VALUES (p_oath_id, v_user, v_oath.stake_amount, 'joined', CASE WHEN v_oath.oath_type = 'duo' THEN 1 ELSE 3 END)
  RETURNING id INTO v_member;

  -- If squad is full now, maybe set to active, but they are already active in the new flow
  IF (SELECT count(*) FROM public.group_members WHERE oath_id=p_oath_id) >= v_oath.min_players THEN
    UPDATE public.oaths SET status = 'active' WHERE id = p_oath_id AND status = 'pending';
  END IF;

  RETURN v_member;
END;
$$;
