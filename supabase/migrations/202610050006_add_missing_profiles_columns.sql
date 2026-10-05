-- Migration 202610050006: Add all missing columns to public.profiles
-- Several migrations reference columns that were never added via ADD COLUMN.
-- This migration safely adds them all with IF NOT EXISTS.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS oaths_joined   INTEGER          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS oaths_failed   INTEGER          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duffer_debt    INTEGER          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loss_streak    INTEGER          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS penalty_box_until TIMESTAMPTZ   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS net_earnings   NUMERIC(12,2)    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_blocked     BOOLEAN          NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reputation_score INTEGER        NOT NULL DEFAULT 100;
