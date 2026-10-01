-- Migration 202610010004: Restore add_funds with default description for deposits and refunds
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
    total_deposited = CASE WHEN coalesce(p_description, '') LIKE 'Refund%' THEN total_deposited ELSE total_deposited + p_amount END
  WHERE id = v_wallet_id;

  INSERT INTO public.transactions (wallet_id, type, amount, description)
  VALUES (
    v_wallet_id,
    CASE WHEN coalesce(p_description, '') LIKE 'Refund%' THEN 'reward'::public.transaction_type ELSE 'deposit'::public.transaction_type END,
    p_amount,
    coalesce(p_description, 'Deposited funds via Razorpay')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_funds(NUMERIC, TEXT) TO authenticated;
