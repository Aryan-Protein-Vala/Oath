ALTER TABLE public.oath_private_details
ADD COLUMN IF NOT EXISTS anti_charity_cause TEXT;

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
  p_anti_charity_cause TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_user UUID := auth.uid();
  v_oath_id UUID;
  v_wallet_id UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  
  INSERT INTO public.oaths (
    creator_id, oath_statement, deadline, oath_type, verification_method, 
    consequence_type, stake_amount, status, min_players, max_players, opponent_id)
  VALUES (
    v_user, p_oath_statement, p_deadline, p_oath_type, p_verification_method,
    p_consequence_type, p_stake_amount, CASE WHEN p_oath_type = 'squad' THEN 'pending'::public.oath_status 
      WHEN p_oath_type = 'duo' THEN 'pending'::public.oath_status ELSE 'active'::public.oath_status END,
    greatest(1, coalesce(p_min_players, 1)), greatest(1, coalesce(p_max_players, 1)), p_opponent_id)
  RETURNING id INTO v_oath_id;

  IF coalesce(p_social_phone, '') <> '' OR coalesce(p_social_msg, '') <> '' OR coalesce(p_nominee_email, '') <> '' OR coalesce(p_anti_charity_cause, '') <> '' THEN
    INSERT INTO public.oath_private_details (oath_id, social_ransom_phone, social_ransom_message, nominee_email, anti_charity_cause)
    VALUES (v_oath_id, p_social_phone, p_social_msg, p_nominee_email, p_anti_charity_cause);
  END IF;

  IF p_verification_method = 'nominee' AND coalesce(p_nominee_email, '') <> '' THEN
    INSERT INTO public.nominees (oath_id, email) VALUES (v_oath_id, p_nominee_email);
  END IF;

  IF p_stake_amount > 0 THEN
    UPDATE public.wallets SET balance = balance - p_stake_amount, 
      escrow_locked = escrow_locked + p_stake_amount, updated_at = now()
    WHERE user_id = v_user AND balance >= p_stake_amount RETURNING id INTO v_wallet_id;
    IF v_wallet_id IS NULL THEN RAISE EXCEPTION 'Insufficient available balance'; END IF;
    
    INSERT INTO public.transactions (wallet_id, oath_id, type, amount, description)
    VALUES (v_wallet_id, v_oath_id, 'escrow_lock', p_stake_amount, 'Stake locked for oath');
  END IF;

  UPDATE public.profiles SET 
    oaths_created = coalesce(oaths_created, 0) + 1,
    total_staked = coalesce(total_staked, 0) + p_stake_amount,
    updated_at = now()
  WHERE id = v_user;

  IF p_oath_type = 'squad' THEN
    INSERT INTO public.group_members (oath_id, user_id, stake_amount, status)
    VALUES (v_oath_id, v_user, p_stake_amount, 'joined');
  END IF;

  RETURN v_oath_id;
END;
$$;
