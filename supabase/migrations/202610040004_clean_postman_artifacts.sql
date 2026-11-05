-- Migration: 202610040004_clean_postman_artifacts.sql
-- Historical one-off test cleanup migration neutralized so replaying migrations never wipes data or mutates balances.
DO $$ BEGIN PERFORM 1; END $$;
