-- Update Wallet Funding RPCs to accept a destination

DROP FUNCTION IF EXISTS public.withdraw_funds(NUMERIC);

CREATE OR REPLACE FUNCTION public.withdraw_funds(p_amount NUMERIC, p_destination VARCHAR DEFAULT 'Unknown') RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet_id UUID;
  v_balance NUMERIC;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  SELECT id, balance INTO v_wallet_id, v_balance FROM public.wallets WHERE user_id = auth.uid() FOR UPDATE;
  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;

  IF v_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient funds';
  END IF;

  -- Withdraw funds
  UPDATE public.wallets
  SET 
    balance = balance - p_amount,
    total_withdrawn = total_withdrawn + p_amount
  WHERE id = v_wallet_id;

  -- Log transaction
  INSERT INTO public.transactions (wallet_id, type, amount, description)
  VALUES (v_wallet_id, 'withdrawal', p_amount, 'Withdrawal to ' || p_destination);

END;
$$;

GRANT EXECUTE ON FUNCTION public.withdraw_funds(NUMERIC, VARCHAR) TO authenticated;
