-- Migration: 202610030004_clean_test_materials_and_reset_stats.sql
-- Clean all test oaths, test proofs, test messages, test wall entries, and reset test stats while preserving users and admin privileges.

-- 1. Clear child records
DELETE FROM public.votes;
DELETE FROM public.proofs;
DELETE FROM public.nominees;
DELETE FROM public.group_members;
DELETE FROM public.messages;
DELETE FROM public.wall_entries;
DELETE FROM public.notifications;
DELETE FROM public.transactions;
DELETE FROM public.feedbacks;

-- Delete private details if table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'oath_private_details') THEN
    DELETE FROM public.oath_private_details;
  END IF;
END $$;

-- 2. Clear all test oaths
DELETE FROM public.oaths;

-- 3. Reset profile test counters and duffer debt, preserving users and admin status
UPDATE public.profiles
SET
  duffer_debt = 0,
  oaths_created = 0,
  oaths_completed = 0,
  oaths_failed = 0,
  total_staked = 0,
  total_lost = 0,
  total_won = 0,
  reputation_score = 100,
  updated_at = now();

-- 4. Release any locked escrow on wallets since no active oaths exist
UPDATE public.wallets
SET
  escrow_locked = 0,
  total_won = 0,
  total_lost = 0,
  updated_at = now();
