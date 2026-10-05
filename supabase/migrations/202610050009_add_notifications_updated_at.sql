-- Migration 202610050009: Add updated_at column to public.notifications
-- Root cause: pass_today_work, reject_proof, and cancel_pending_oath execute:
-- UPDATE public.notifications SET status = 'accepted', updated_at = now()
-- which failed because updated_at was missing on public.notifications table.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
