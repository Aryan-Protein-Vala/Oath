-- Migration 202610110001: Fix admin RLS and withdrawal requests management
-- 1. Hardens is_admin() to recognize both real_admin, reaper_exe, admin UUID, and admin emails
-- 2. Adds status column to transactions table if not exists
-- 3. Updates withdraw_funds to set status = 'pending' on withdrawals
-- 4. Adds admin RPCs for processing and rejecting withdrawals
-- 5. Ensures Admin RLS policies allow SELECT and UPDATE on all wallets, transactions, oaths, proofs, group_members, feedbacks, notifications, and nominees

-- ============================================================
-- 1. HARDEN is_admin()
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN FALSE;
  END IF;

  -- 1. Match by known Admin UUID or Profile Username
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_uid 
      AND (
        id = '26e5d445-0a36-4c77-a8e6-025dfb55af52'::uuid
        OR lower(username) IN ('real_admin', 'reaper_exe', 'admin')
      )
  ) THEN
    RETURN TRUE;
  END IF;

  -- 2. Match by JWT email claim
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  IF v_email IN ('aryansharma24112003@gmail.com', 'admin@oath.app') THEN
    RETURN TRUE;
  END IF;

  -- 3. Match by auth.users record
  IF EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = v_uid AND lower(email) IN ('aryansharma24112003@gmail.com', 'admin@oath.app')
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon;

-- ============================================================
-- 2. ADD STATUS COLUMN TO TRANSACTIONS
-- ============================================================
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'completed';

-- ============================================================
-- 3. UPDATE withdraw_funds TO CREATE 'pending' WITHDRAWAL TRANSACTIONS
-- ============================================================
DROP FUNCTION IF EXISTS public.withdraw_funds(NUMERIC, VARCHAR);
DROP FUNCTION IF EXISTS public.withdraw_funds(NUMERIC);

CREATE OR REPLACE FUNCTION public.withdraw_funds(
  p_amount NUMERIC, 
  p_destination VARCHAR DEFAULT 'Unknown'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_wallet_id UUID;
  v_balance NUMERIC;
  v_clean_amount NUMERIC(12,2);
  v_tx_id UUID := gen_random_uuid();
  v_dest TEXT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  v_clean_amount := round(p_amount::numeric, 2);
  v_dest := coalesce(nullif(trim(p_destination), ''), 'Unknown');

  SELECT id, balance INTO v_wallet_id, v_balance 
  FROM public.wallets 
  WHERE user_id = v_user 
  FOR UPDATE;

  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;

  IF v_balance < v_clean_amount THEN
    RAISE EXCEPTION 'Insufficient funds in wallet';
  END IF;

  -- Deduct from wallet balance & record withdrawal
  UPDATE public.wallets
  SET 
    balance = balance - v_clean_amount,
    total_withdrawn = coalesce(total_withdrawn, 0) + v_clean_amount,
    updated_at = now()
  WHERE id = v_wallet_id;

  -- Log transaction with 'pending' status for admin payout tracking
  INSERT INTO public.transactions (id, wallet_id, type, amount, description, status)
  VALUES (v_tx_id, v_wallet_id, 'withdrawal', v_clean_amount, 'Withdrawal to ' || v_dest, 'pending');

  RETURN jsonb_build_object('success', true, 'transaction_id', v_tx_id, 'amount', v_clean_amount);
END;
$$;

GRANT EXECUTE ON FUNCTION public.withdraw_funds(NUMERIC, VARCHAR) TO authenticated, anon;

-- ============================================================
-- 4. ADMIN WITHDRAWAL MANAGEMENT RPCS
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_process_withdrawal(
  p_transaction_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_tx RECORD;
  v_wallet RECORD;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  SELECT * INTO v_tx FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;

  IF v_tx.type <> 'withdrawal' THEN
    RAISE EXCEPTION 'Transaction is not a withdrawal';
  END IF;

  IF v_tx.status = 'completed' THEN
    RETURN jsonb_build_object('success', true, 'message', 'Already completed');
  END IF;

  UPDATE public.transactions
  SET status = 'completed'
  WHERE id = p_transaction_id;

  SELECT * INTO v_wallet FROM public.wallets WHERE id = v_tx.wallet_id;
  IF FOUND AND v_wallet.user_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, status)
    VALUES (
      v_wallet.user_id,
      'system',
      'Withdrawal Processed',
      'Your withdrawal of $' || v_tx.amount || ' (' || coalesce(v_tx.description, 'Payout') || ') has been sent!',
      'pending'
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'transaction_id', p_transaction_id, 'status', 'completed');
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reject_withdrawal(
  p_transaction_id UUID,
  p_reason TEXT DEFAULT 'Withdrawal rejected by admin'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_tx RECORD;
  v_wallet RECORD;
  v_refund_note TEXT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  SELECT * INTO v_tx FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;

  IF v_tx.type <> 'withdrawal' THEN
    RAISE EXCEPTION 'Transaction is not a withdrawal';
  END IF;

  IF v_tx.status = 'rejected' THEN
    RETURN jsonb_build_object('success', true, 'message', 'Already rejected');
  END IF;

  -- Refund wallet
  SELECT * INTO v_wallet FROM public.wallets WHERE id = v_tx.wallet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Associated wallet not found';
  END IF;

  UPDATE public.wallets
  SET 
    balance = balance + v_tx.amount,
    total_withdrawn = greatest(0, coalesce(total_withdrawn, 0) - v_tx.amount),
    updated_at = now()
  WHERE id = v_wallet.id;

  UPDATE public.transactions
  SET status = 'rejected'
  WHERE id = p_transaction_id;

  v_refund_note := 'Refund for rejected withdrawal: ' || coalesce(nullif(trim(p_reason), ''), 'Admin rejection');

  -- Record refund transaction
  INSERT INTO public.transactions (wallet_id, type, amount, description, status)
  VALUES (v_wallet.id, 'escrow_release', v_tx.amount, v_refund_note, 'completed');

  IF v_wallet.user_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, status)
    VALUES (
      v_wallet.user_id,
      'system',
      'Withdrawal Refunded',
      'Your withdrawal of $' || v_tx.amount || ' was rejected: ' || coalesce(p_reason, 'Information mismatch') || '. Funds have been restored to your balance.',
      'pending'
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'transaction_id', p_transaction_id, 'status', 'rejected', 'refunded_amount', v_tx.amount);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_process_withdrawal(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.admin_reject_withdrawal(UUID, TEXT) TO authenticated, anon;

-- ============================================================
-- 5. ENSURE AIRTIGHT ADMIN RLS POLICIES ACROSS ALL TABLES
-- ============================================================
DROP POLICY IF EXISTS "Admin can view all wallets" ON public.wallets;
CREATE POLICY "Admin can view all wallets" ON public.wallets FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "Admin can update all wallets" ON public.wallets;
CREATE POLICY "Admin can update all wallets" ON public.wallets FOR UPDATE USING (public.is_admin());

DROP POLICY IF EXISTS "Admin can view all oaths" ON public.oaths;
CREATE POLICY "Admin can view all oaths" ON public.oaths FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "Admin can view all transactions" ON public.transactions;
CREATE POLICY "Admin can view all transactions" ON public.transactions FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "Admin can update all transactions" ON public.transactions;
CREATE POLICY "Admin can update all transactions" ON public.transactions FOR UPDATE USING (public.is_admin());

DROP POLICY IF EXISTS "Admin can view all feedbacks" ON public.feedbacks;
CREATE POLICY "Admin can view all feedbacks" ON public.feedbacks FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "Admin can view all group_members" ON public.group_members;
CREATE POLICY "Admin can view all group_members" ON public.group_members FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "Admin can view all proofs" ON public.proofs;
CREATE POLICY "Admin can view all proofs" ON public.proofs FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "Admin can view all nominees" ON public.nominees;
CREATE POLICY "Admin can view all nominees" ON public.nominees FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "Admin can update all profiles" ON public.profiles;
CREATE POLICY "Admin can update all profiles" ON public.profiles FOR UPDATE USING (public.is_admin());
