-- Migration 202609300016: Enhance nominee verification lookup, universal pending oath cancellation, and add_funds description

-- 1. Update add_funds to support description parameter
CREATE OR REPLACE FUNCTION public.add_funds(p_amount NUMERIC, p_description TEXT DEFAULT 'Deposited funds via payment gateway') RETURNS VOID
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
  VALUES (
    v_wallet_id,
    CASE WHEN p_description LIKE 'Refund%' THEN 'reward'::public.transaction_type ELSE 'deposit'::public.transaction_type END,
    p_amount,
    coalesce(p_description, 'Deposited funds')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_funds(NUMERIC, TEXT) TO authenticated;

-- 2. Enhance get_nominee_challenge to support verification token OR oath id
CREATE OR REPLACE FUNCTION public.get_nominee_challenge(p_token TEXT)
RETURNS TABLE (
  oath_id UUID,
  oath_statement TEXT,
  deadline TIMESTAMPTZ,
  stake_amount NUMERIC,
  oath_type public.oath_type,
  challenge_status public.oath_status,
  creator_username TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT o.id, o.oath_statement, o.deadline, o.stake_amount, o.oath_type, o.status, p.username
  FROM public.nominees n
  JOIN public.oaths o ON o.id = n.oath_id
  JOIN public.profiles p ON p.id = o.creator_id
  WHERE (n.verification_token::text = p_token OR o.id::text = p_token)
    AND n.verified = false
    AND o.status = 'active'
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_nominee_challenge(TEXT) TO anon, authenticated;

-- 3. Enhance verify_nominee to support verification token OR oath id
CREATE OR REPLACE FUNCTION public.verify_nominee(p_token TEXT, p_success BOOLEAN, p_note TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE 
  v_oath_id UUID;
  v_actual_token TEXT;
BEGIN
  SELECT oath_id, verification_token::text INTO v_oath_id, v_actual_token
  FROM public.nominees
  WHERE (verification_token::text = p_token OR oath_id::text = p_token) AND verified = false
  LIMIT 1
  FOR UPDATE;

  IF v_oath_id IS NULL THEN 
    RAISE EXCEPTION 'Invalid or already used verification token'; 
  END IF;

  PERFORM public.settle_oath_atomically(v_oath_id, p_success, p_note, coalesce(v_actual_token, p_token), FALSE);
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_nominee(TEXT, BOOLEAN, TEXT) TO anon, authenticated;

-- 4. Universal pending oath cancellation for Duo, Squad, and Lobby
CREATE OR REPLACE FUNCTION public.cancel_pending_oath(p_oath_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_user UUID := auth.uid();
  v_oath public.oaths%ROWTYPE;
  v_wallet_id UUID;
  v_creator_refund NUMERIC := 0;
  v_member RECORD;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO v_oath FROM public.oaths WHERE id = p_oath_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Oath not found'; END IF;
  IF v_oath.creator_id <> v_user THEN RAISE EXCEPTION 'Only the creator can cancel this oath'; END IF;
  IF v_oath.status <> 'pending' THEN RAISE EXCEPTION 'Only pending oaths can be cancelled'; END IF;

  -- Calculate creator refund
  IF v_oath.oath_type = 'duo' THEN
    v_creator_refund := v_oath.stake_amount * 2;
  ELSIF v_oath.oath_type = 'squad' THEN
    v_creator_refund := v_oath.stake_amount * v_oath.max_players;
  ELSE
    v_creator_refund := v_oath.stake_amount;
  END IF;

  IF v_creator_refund > 0 THEN
    UPDATE public.wallets 
    SET balance = balance + v_creator_refund,
        escrow_locked = escrow_locked - v_creator_refund,
        updated_at = now()
    WHERE user_id = v_user AND escrow_locked >= v_creator_refund
    RETURNING id INTO v_wallet_id;

    IF v_wallet_id IS NOT NULL THEN
      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_wallet_id, p_oath_id, 'escrow_release', v_creator_refund, 'Pending ' || v_oath.oath_type::text || ' oath cancelled; escrow refunded');
    END IF;
  END IF;

  -- Refund any other members who paid individual buy-in (in lobby)
  FOR v_member IN (SELECT * FROM public.group_members WHERE oath_id = p_oath_id AND user_id <> v_user AND stake_amount > 0) LOOP
    UPDATE public.wallets
    SET balance = balance + v_member.stake_amount,
        escrow_locked = escrow_locked - v_member.stake_amount,
        updated_at = now()
    WHERE user_id = v_member.user_id AND escrow_locked >= v_member.stake_amount
    RETURNING id INTO v_wallet_id;

    IF v_wallet_id IS NOT NULL THEN
      INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
      VALUES (v_wallet_id, p_oath_id, 'escrow_release', v_member.stake_amount, 'Pending lobby cancelled by creator; buy-in refunded');
    END IF;
  END LOOP;

  UPDATE public.oaths SET status = 'cancelled', updated_at = now() WHERE id = p_oath_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_pending_oath(UUID) TO authenticated;
