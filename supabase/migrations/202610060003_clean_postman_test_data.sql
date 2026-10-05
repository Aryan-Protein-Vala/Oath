-- Migration 202610060003: Clean all postman and test artifacts from database
-- Preserves all user accounts, auth records, and profiles while wiping test oaths, proofs, and transactions.

-- 1. Wipe child operational records
DELETE FROM public.votes;
DELETE FROM public.proofs;
DELETE FROM public.nominees;
DELETE FROM public.group_members;
DELETE FROM public.messages;
DELETE FROM public.wall_entries;
DELETE FROM public.notifications;
DELETE FROM public.transactions;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'feedbacks') THEN
    DELETE FROM public.feedbacks;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'oath_private_details') THEN
    DELETE FROM public.oath_private_details;
  END IF;
END $$;

-- 2. Wipe oaths
DELETE FROM public.oaths;

-- 3. Reset profile counters for all accounts while keeping users intact
UPDATE public.profiles
SET
  oaths_created = 0,
  oaths_completed = 0,
  oaths_failed = 0,
  oaths_joined = 0,
  total_staked = 0,
  total_lost = 0,
  total_won = 0,
  net_earnings = 0,
  loss_streak = 0,
  penalty_box_until = NULL,
  duffer_debt = 0,
  reputation_score = 100,
  updated_at = now();

-- 4. Reset wallets:
UPDATE public.wallets
SET
  balance = balance + escrow_locked,
  escrow_locked = 0,
  total_won = 0,
  total_lost = 0,
  updated_at = now()
WHERE user_id <> '26e5d445-0a36-4c77-a8e6-025dfb55af52'::uuid;

UPDATE public.wallets
SET
  balance = 1000000000.00,
  escrow_locked = 0,
  total_deposited = 1000000000.00,
  total_withdrawn = 0,
  total_won = 0,
  total_lost = 0,
  updated_at = now()
WHERE user_id = '26e5d445-0a36-4c77-a8e6-025dfb55af52'::uuid;
