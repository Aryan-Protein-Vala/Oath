-- Migration 202610110002: Grant UPDATE on transactions and set existing withdrawals to pending
GRANT UPDATE ON TABLE public.transactions TO authenticated;

-- Mark existing withdrawal requests as pending so admin can review and process them
UPDATE public.transactions
SET status = 'pending'
WHERE type = 'withdrawal';
