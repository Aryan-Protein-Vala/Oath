-- Migration 202610050010: Add updated_at column to group_members and nominees
-- Root cause: cancel_pending_oath, settle_oath, and cast_squad_vote execute:
-- UPDATE public.group_members SET ..., updated_at = now()
-- which failed because updated_at was missing on public.group_members table.

ALTER TABLE public.group_members
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.nominees
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.proofs
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
