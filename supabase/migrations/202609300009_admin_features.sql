-- Admin Features Migration
-- Adds is_blocked to profiles
-- Creates a feedbacks table

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT false;

CREATE TABLE IF NOT EXISTS public.feedbacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS for feedbacks
ALTER TABLE public.feedbacks ENABLE ROW LEVEL SECURITY;

-- Anyone can insert feedback
CREATE POLICY "Users can insert their own feedback" ON public.feedbacks
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Only admins can view feedback (for simplicity, we'll allow the specific admin email via application logic, or just a policy)
CREATE POLICY "Admin can view all feedback" ON public.feedbacks
  FOR SELECT TO authenticated
  USING (
    (SELECT email FROM auth.users WHERE id = auth.uid()) = 'aryansharma24112003@gmail.com'
  );

-- Helper RPC to add funds (admin only)
CREATE OR REPLACE FUNCTION public.admin_add_funds(p_user_id UUID, p_amount NUMERIC) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_admin_email VARCHAR;
  v_wallet_id UUID;
BEGIN
  -- Verify admin
  SELECT email INTO v_admin_email FROM auth.users WHERE id = auth.uid();
  IF v_admin_email != 'aryansharma24112003@gmail.com' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  -- Get user wallet
  SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = p_user_id;
  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Wallet not found for user';
  END IF;

  UPDATE public.wallets 
  SET balance = balance + p_amount,
      total_deposited = total_deposited + p_amount
  WHERE id = v_wallet_id;

  INSERT INTO public.transactions (wallet_id, type, amount, description)
  VALUES (v_wallet_id, 'deposit', p_amount, 'Admin added funds for testing');
END;
$$;

-- Helper RPC to block/unblock user (admin only)
CREATE OR REPLACE FUNCTION public.admin_set_blocked(p_user_id UUID, p_blocked BOOLEAN) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_admin_email VARCHAR;
BEGIN
  -- Verify admin
  SELECT email INTO v_admin_email FROM auth.users WHERE id = auth.uid();
  IF v_admin_email != 'aryansharma24112003@gmail.com' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE public.profiles
  SET is_blocked = p_blocked
  WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_add_funds(UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_blocked(UUID, BOOLEAN) TO authenticated;
