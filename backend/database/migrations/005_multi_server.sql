-- ==========================================
-- INDIAN BATTLE FIELDS
-- Migration 005: running more than one game server
-- ==========================================
-- Only needed when you run 2+ backend servers. Each match
-- is hosted by exactly one server (matches.host_server);
-- servers report themselves in server_instances so new
-- matches go to the least busy one.
--
-- Run once in the Supabase SQL editor. Safe to re-run.

CREATE TABLE IF NOT EXISTS public.server_instances (
    server_id          TEXT PRIMARY KEY,
    public_url         TEXT NOT NULL,
    live_matches       INTEGER NOT NULL DEFAULT 0,
    connected_players  INTEGER NOT NULL DEFAULT 0,
    last_seen          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.server_instances ENABLE ROW LEVEL SECURITY;
-- No policies: only the backend (service role) has access.

ALTER TABLE public.matches
    ADD COLUMN IF NOT EXISTS host_server TEXT;

CREATE INDEX IF NOT EXISTS idx_matches_host_server
    ON public.matches (host_server);
