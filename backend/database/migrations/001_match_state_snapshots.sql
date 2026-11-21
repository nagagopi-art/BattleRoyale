-- ==========================================
-- INDIAN BATTLE FIELDS
-- Migration 001: match state snapshots
-- ==========================================
-- Stores each live match's in-memory game state
-- (inventories, loot, throwables, gloo walls, combat,
-- safe zone, parachute drops) so a server restart can
-- resume the match. Written by services/matchStateService.js.
--
-- Run once in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS public.match_state_snapshots (
    match_id    UUID PRIMARY KEY
                REFERENCES public.matches(id) ON DELETE CASCADE,
    state       JSONB NOT NULL,
    version     INTEGER NOT NULL DEFAULT 1,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only the backend (service role) may read or write.
ALTER TABLE public.match_state_snapshots ENABLE ROW LEVEL SECURITY;

-- No policies are created on purpose: with RLS enabled and
-- no policies, the public/anon key has no access at all.
