-- ==========================================
-- INDIAN BATTLE FIELDS
-- Migration 004: lock down direct database access
-- ==========================================
-- The backend talks to Supabase only with the secret
-- (service role) key, which bypasses Row Level Security.
-- The public/publishable key is used only for Supabase Auth
-- (sign-in, refresh, emails).
--
-- Without this migration, anyone holding the public key
-- (it ships inside every game client) could read other
-- players' emails or call game functions such as
-- sync_combat_result directly to award themselves kills.
--
-- IMPORTANT: if a game client reads these tables directly
-- with the public key (not through this backend), it will
-- stop working after this migration. Route those reads
-- through the backend API instead.
--
-- Run once in the Supabase SQL editor. Safe to re-run.

-- ---------- Row Level Security on every game table ----------
-- RLS enabled + no policies = no access for anon/authenticated.
ALTER TABLE IF EXISTS public.players               ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.matches               ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.match_players         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.player_match_results  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.maps                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.map_locations         ENABLE ROW LEVEL SECURITY;

-- ---------- Game functions: backend only ----------
DO $$
DECLARE
    fn RECORD;
BEGIN
    FOR fn IN
        SELECT p.oid::regprocedure AS signature
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
              'join_match',
              'leave_match',
              'prepare_match_start',
              'complete_match_start',
              'sync_combat_result',
              'finalize_match_if_ready',
              'buy_cosmetic'
          )
    LOOP
        EXECUTE format(
            'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated',
            fn.signature
        );
    END LOOP;
END;
$$;

-- ---------- Check afterwards ----------
-- Tables without RLS (should return no game tables):
--   SELECT tablename FROM pg_tables
--   WHERE schemaname = 'public' AND NOT rowsecurity;
