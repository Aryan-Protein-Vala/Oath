-- Migration: 202610040004_clean_postman_artifacts.sql
-- Clean up all postman test oaths and reset counters while keeping admin/users intact

DELETE FROM public.votes;
DELETE FROM public.proofs;
DELETE FROM public.nominees;
DELETE FROM public.group_members;
DELETE FROM public.messages;
DELETE FROM public.wall_entries;
DELETE FROM public.notifications;
DELETE FROM public.transactions;
DELETE FROM public.oaths;

UPDATE public.profiles
SET
  loss_streak = 0,
  penalty_box_until = NULL,
  oaths_created = 0,
  oaths_completed = 0,
  oaths_failed = 0,
  total_staked = 0,
  total_lost = 0,
  total_won = 0,
  reputation_score = 100,
  updated_at = now();

UPDATE public.wallets
SET
  escrow_locked = 0,
  updated_at = now();
