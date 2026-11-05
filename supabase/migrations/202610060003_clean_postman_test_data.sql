-- Migration 202610060003: Clean all postman and test artifacts from database
-- Historical one-off test cleanup migration neutralized so replaying migrations never wipes data or mutates balances.
DO $$ BEGIN PERFORM 1; END $$;
