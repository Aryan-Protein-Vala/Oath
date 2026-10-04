-- Migration: 202610040002_reset_test_penalty_box.sql
-- Reset test user's penalty box timeout and purge test data from Postman/Node testing

UPDATE public.profiles
SET
  penalty_box_until = NULL,
  loss_streak = 0,
  updated_at = now();

DELETE FROM public.votes;
DELETE FROM public.proofs;
DELETE FROM public.nominees;
DELETE FROM public.group_members;
DELETE FROM public.messages;
DELETE FROM public.wall_entries;
DELETE FROM public.notifications;
DELETE FROM public.transactions;
DELETE FROM public.oaths;

UPDATE public.wallets
SET
  escrow_locked = 0,
  updated_at = now();
