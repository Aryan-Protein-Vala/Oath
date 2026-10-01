-- Migration 202610010003: Secure deposits by removing public add_funds and creating internal server-only RPC

-- 1. Drop the old heavily vulnerable public add_funds
DROP FUNCTION IF EXISTS public.add_funds(NUMERIC, TEXT);

-- 2. Create a secure, server-only version
CREATE OR REPLACE FUNCTION public.add_funds_server(p_user_id UUID, p_amount NUMERIC, p_description TEXT DEFAULT 'Deposited funds via payment gateway') RETURNS VOID
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

  SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = p_user_id;
  IF v_wallet_id IS NULL THEN
    INSERT INTO public.wallets (user_id, balance) VALUES (p_user_id, 0) RETURNING id INTO v_wallet_id;
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
    p_description
  );
END;
$$;

-- 3. Lock it down completely (only the server with service_role can execute this)
REVOKE ALL ON FUNCTION public.add_funds_server(UUID, NUMERIC, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_funds_server(UUID, NUMERIC, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.add_funds_server(UUID, NUMERIC, TEXT) TO service_role;
