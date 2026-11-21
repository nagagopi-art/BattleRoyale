-- ==========================================
-- INDIAN BATTLE FIELDS
-- Migration 002: coin awards per match
-- ==========================================
-- services/progressionService.js awards coins once per
-- player per match. This column records the award so it
-- is never paid twice (NULL = not yet awarded).
--
-- Run once in the Supabase SQL editor.

ALTER TABLE public.player_match_results
    ADD COLUMN IF NOT EXISTS coins_earned INTEGER;
