-- Migration: 202610030004_clean_test_materials_and_reset_stats.sql
-- Historical one-off test cleanup migration neutralized so replaying migrations never wipes data or mutates balances.
DO $$ BEGIN PERFORM 1; END $$;
