-- Migration: 202610040002_reset_test_penalty_box.sql
-- Historical one-off test cleanup migration neutralized so replaying migrations never wipes data or mutates balances.
DO $$ BEGIN PERFORM 1; END $$;
