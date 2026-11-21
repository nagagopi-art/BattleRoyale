-- ==========================================
-- INDIAN BATTLE FIELDS: FULL DATABASE SETUP
-- Paste this whole file into Supabase SQL Editor and click Run.
-- Safe to run more than once.
-- ==========================================


-- >>>>>>>>>> maps.sql <<<<<<<<<<


-- BHARAT BATTLEGROUNDS
-- 12 ORIGINAL INDIAN-INSPIRED MAPS

CREATE TABLE IF NOT EXISTS public.maps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    map_code VARCHAR(30) NOT NULL UNIQUE,
    map_name VARCHAR(100) NOT NULL,
    subtitle VARCHAR(150) NOT NULL,
    region VARCHAR(100) NOT NULL,
    description TEXT,
    environment VARCHAR(50) NOT NULL,
    max_players INTEGER NOT NULL DEFAULT 150
        CHECK (max_players BETWEEN 2 AND 150),
    supported_modes TEXT[] NOT NULL
        DEFAULT ARRAY['solo', 'squad']::TEXT[],
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.maps (
    map_code,
    map_name,
    subtitle,
    region,
    description,
    environment,
    max_players,
    supported_modes
)
VALUES
(
    'SAHYADRI',
    'Sahyadri',
    'The Lost Valley',
    'Western Ghats, Maharashtra',
    'Dense forests, waterfalls, villages and secret research facilities.',
    'Tropical Forest', 150, ARRAY['solo','squad']
),
(
    'MARUDHARA',
    'Marudhara',
    'Desert Storm',
    'Rajasthan',
    'Desert forts, sand dunes, underground bunkers and sandstorms.',
    'Desert', 150, ARRAY['solo','squad']
),
(
    'NEERAVAN',
    'Neeravan',
    'The Drowned Kingdom',
    'Sundarbans, West Bengal',
    'Mangrove forests, river islands, boats and abandoned settlements.',
    'Mangrove', 150, ARRAY['solo','squad']
),
(
    'HIMSHIKHAR',
    'Himshikhar',
    'Frozen Frontier',
    'Himalayan Region',
    'Snow mountains, frozen lakes, ice caves and research stations.',
    'Snow', 150, ARRAY['solo','squad']
),
(
    'ANDAMAN',
    'Andaman',
    'Kala Pani',
    'Andaman and Nicobar Islands',
    'Tropical islands, jungle interiors, beaches, ports and connected island routes.',
    'Island', 150, ARRAY['solo','squad']
),
(
    'LAKSHADWEEP',
    'Lakshadweep',
    'Coral Crown',
    'Lakshadweep Islands',
    'Coral atolls, turquoise lagoons, island villages and boat routes.',
    'Island', 150, ARRAY['solo','squad']
),
(
    'DECCAN_STRIKE',
    'Deccan Strike',
    'City of Champions',
    'Hyderabad, Telangana',
    'Fictional urban battlefield with technology districts, markets and elevated roads.',
    'Urban', 150, ARRAY['solo','squad']
),
(
    'MUMBAI_MONSOON',
    'Mumbai Monsoon',
    'City Under Rain',
    'Mumbai, Maharashtra',
    'Fictional coastal city with docks, railway yards, dense streets and monsoon weather.',
    'Urban Coastal', 150, ARRAY['solo','squad']
),
(
    'DILLI_FRONTIER',
    'Dilli Frontier',
    'Capital Clash',
    'Delhi',
    'Fictional metropolitan battlefield with markets, metro corridors and rooftops.',
    'Urban', 150, ARRAY['solo','squad']
),
(
    'CHENNAI_COAST',
    'Chennai Coastline',
    'Eastern Storm',
    'Chennai, Tamil Nadu',
    'Fictional coastal battlefield with beaches, industrial docks and urban streets.',
    'Urban Coastal', 150, ARRAY['solo','squad']
),
(
    'RANN_KUTCH',
    'Rann of Kutch',
    'White Desert',
    'Gujarat',
    'White salt flats, desert settlements and abandoned structures.',
    'Salt Desert', 150, ARRAY['solo','squad']
),
(
    'MALABAR',
    'Malabar Backwaters',
    'River of Secrets',
    'Kerala',
    'Backwaters, coconut groves, waterways, bridges and floating settlements.',
    'Backwaters', 150, ARRAY['solo','squad']
)
ON CONFLICT (map_code)
DO UPDATE SET
    map_name = EXCLUDED.map_name,
    subtitle = EXCLUDED.subtitle,
    region = EXCLUDED.region,
    description = EXCLUDED.description,
    environment = EXCLUDED.environment,
    max_players = EXCLUDED.max_players,
    supported_modes = EXCLUDED.supported_modes;

-- VERIFY ALL MAPS
SELECT
    map_code,
    map_name,
    region,
    environment,
    max_players,
    supported_modes
FROM public.maps
ORDER BY map_name;



-- >>>>>>>>>> map_locations.sql <<<<<<<<<<


-- ==========================================
-- BHARAT BATTLEGROUNDS
-- MAP LOCATIONS AND LANDING ZONES
-- ==========================================

CREATE TABLE IF NOT EXISTS public.map_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    map_id UUID NOT NULL
        REFERENCES public.maps(id) ON DELETE CASCADE,

    location_code VARCHAR(50) NOT NULL,
    location_name VARCHAR(100) NOT NULL,

    location_type VARCHAR(40) NOT NULL
        CHECK (location_type IN (
            'city',
            'village',
            'military_base',
            'airport',
            'port',
            'temple',
            'fort',
            'forest',
            'factory',
            'research_facility',
            'beach',
            'mountain',
            'bridge',
            'bunker',
            'landmark'
        )),

    loot_tier VARCHAR(20) NOT NULL DEFAULT 'common'
        CHECK (loot_tier IN (
            'common',
            'rare',
            'epic',
            'legendary'
        )),

    risk_level VARCHAR(20) NOT NULL DEFAULT 'medium'
        CHECK (risk_level IN ('low', 'medium', 'high')),

    -- Normalized map coordinates (0-1000).
    -- These are design coordinates, not real GPS coordinates.
    position_x NUMERIC(7,2) NOT NULL
        CHECK (position_x BETWEEN 0 AND 1000),

    position_y NUMERIC(7,2) NOT NULL
        CHECK (position_y BETWEEN 0 AND 1000),

    is_hot_drop BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    description TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (map_id, location_code)
);

-- Improve map location lookup performance
CREATE INDEX IF NOT EXISTS
idx_map_locations_map_id
ON public.map_locations(map_id);

CREATE INDEX IF NOT EXISTS
idx_map_locations_hot_drop
ON public.map_locations(map_id, is_hot_drop);

-- ==========================================
-- LOCATION SEED DATA
-- 3 LOCATIONS PER MAP
-- ==========================================

WITH location_seed (
    map_code,
    location_code,
    location_name,
    location_type,
    loot_tier,
    risk_level,
    position_x,
    position_y,
    is_hot_drop,
    description
) AS (
    VALUES

    -- SAHYADRI
    ('SAHYADRI', 'TIGER_VALLEY', 'Tiger Valley', 'forest', 'rare', 'medium', 180, 220, FALSE, 'Dense forest with hidden supply camps.'),
    ('SAHYADRI', 'FORT_RUDRA', 'Fort Rudra', 'fort', 'legendary', 'high', 500, 450, TRUE, 'Ancient hill fort with valuable equipment.'),
    ('SAHYADRI', 'MIST_VILLAGE', 'Mist Village', 'village', 'common', 'low', 790, 780, FALSE, 'Quiet mountain village with basic supplies.'),

    -- MARUDHARA
    ('MARUDHARA', 'RAJ_FORT', 'Raj Fort', 'fort', 'legendary', 'high', 500, 450, TRUE, 'Large desert fortress with high-value loot.'),
    ('MARUDHARA', 'SAND_CAMP', 'Sand Camp', 'village', 'common', 'low', 200, 200, FALSE, 'Small desert settlement.'),
    ('MARUDHARA', 'UNDERDUNE', 'Underdune Bunker', 'bunker', 'epic', 'medium', 800, 760, FALSE, 'Underground bunker beneath the dunes.'),

    -- NEERAVAN
    ('NEERAVAN', 'MANGROVE_CORE', 'Mangrove Core', 'forest', 'rare', 'medium', 200, 250, FALSE, 'Dense mangrove forest and hidden paths.'),
    ('NEERAVAN', 'DROWNED_PORT', 'Drowned Port', 'port', 'legendary', 'high', 520, 480, TRUE, 'Abandoned port with high-value equipment.'),
    ('NEERAVAN', 'RIVER_HAMLET', 'River Hamlet', 'village', 'common', 'low', 800, 780, FALSE, 'Small settlement connected by waterways.'),

    -- HIMSHIKHAR
    ('HIMSHIKHAR', 'FROST_BASE', 'Frost Base', 'military_base', 'legendary', 'high', 500, 450, TRUE, 'Mountain military-style training base.'),
    ('HIMSHIKHAR', 'ICE_CAVES', 'Ice Caves', 'mountain', 'epic', 'medium', 180, 250, FALSE, 'Frozen cave system with hidden loot.'),
    ('HIMSHIKHAR', 'SNOW_VILLAGE', 'Snow Village', 'village', 'common', 'low', 800, 780, FALSE, 'Remote Himalayan settlement.'),

    -- ANDAMAN
    ('ANDAMAN', 'CORAL_HARBOR', 'Coral Harbor', 'port', 'epic', 'high', 500, 450, TRUE, 'Island harbor with valuable supplies.'),
    ('ANDAMAN', 'JUNGLE_RELIC', 'Jungle Relic', 'forest', 'rare', 'medium', 180, 220, FALSE, 'Overgrown jungle ruins.'),
    ('ANDAMAN', 'PALM_BAY', 'Palm Bay', 'beach', 'common', 'low', 800, 780, FALSE, 'Quiet tropical beach and fishing huts.'),

    -- LAKSHADWEEP
    ('LAKSHADWEEP', 'CORAL_CITADEL', 'Coral Citadel', 'landmark', 'legendary', 'high', 500, 450, TRUE, 'Central island landmark with premium loot.'),
    ('LAKSHADWEEP', 'LAGOON_VILLAGE', 'Lagoon Village', 'village', 'common', 'low', 200, 250, FALSE, 'Island village beside the lagoon.'),
    ('LAKSHADWEEP', 'REEF_STATION', 'Reef Station', 'research_facility', 'epic', 'medium', 800, 760, FALSE, 'Fictional marine research station.'),

    -- DECCAN STRIKE
    ('DECCAN_STRIKE', 'TECH_DISTRICT', 'Tech District', 'city', 'legendary', 'high', 500, 450, TRUE, 'Dense high-rise district with premium loot.'),
    ('DECCAN_STRIKE', 'OLD_MARKET', 'Old Market', 'city', 'rare', 'medium', 200, 250, FALSE, 'Busy fictional market district.'),
    ('DECCAN_STRIKE', 'OUTER_FACTORY', 'Outer Factory', 'factory', 'epic', 'medium', 800, 760, FALSE, 'Industrial complex on the edge of the city.'),

    -- MUMBAI MONSOON
    ('MUMBAI_MONSOON', 'HARBOR_TERMINAL', 'Harbor Terminal', 'port', 'legendary', 'high', 500, 450, TRUE, 'Large coastal shipping terminal.'),
    ('MUMBAI_MONSOON', 'RAIL_YARD', 'Rail Yard', 'landmark', 'epic', 'medium', 200, 250, FALSE, 'Abandoned railway maintenance yard.'),
    ('MUMBAI_MONSOON', 'COASTAL_BLOCK', 'Coastal Block', 'city', 'rare', 'low', 800, 760, FALSE, 'Residential district near the sea.'),

    -- DILLI FRONTIER
    ('DILLI_FRONTIER', 'CAPITAL_SQUARE', 'Capital Square', 'landmark', 'legendary', 'high', 500, 450, TRUE, 'Fictional central government district.'),
    ('DILLI_FRONTIER', 'METRO_JUNCTION', 'Metro Junction', 'landmark', 'epic', 'medium', 200, 250, FALSE, 'Underground metro interchange.'),
    ('DILLI_FRONTIER', 'OLD_BAZAAR', 'Old Bazaar', 'city', 'rare', 'medium', 800, 760, FALSE, 'Dense marketplace with narrow lanes.'),

    -- CHENNAI COAST
    ('CHENNAI_COAST', 'STORM_HARBOR', 'Storm Harbor', 'port', 'legendary', 'high', 500, 450, TRUE, 'Coastal port exposed to storm weather.'),
    ('CHENNAI_COAST', 'COASTAL_MARKET', 'Coastal Market', 'city', 'rare', 'medium', 200, 250, FALSE, 'Fictional seaside trading district.'),
    ('CHENNAI_COAST', 'INDUSTRIAL_ZONE', 'Industrial Zone', 'factory', 'epic', 'medium', 800, 760, FALSE, 'Industrial district with equipment stores.'),

    -- RANN OF KUTCH
    ('RANN_KUTCH', 'WHITE_FORT', 'White Fort', 'fort', 'legendary', 'high', 500, 450, TRUE, 'Fortified landmark in the salt desert.'),
    ('RANN_KUTCH', 'SALT_VILLAGE', 'Salt Village', 'village', 'common', 'low', 200, 250, FALSE, 'Village beside the white salt flats.'),
    ('RANN_KUTCH', 'DESERT_RELAY', 'Desert Relay Station', 'research_facility', 'epic', 'medium', 800, 760, FALSE, 'Remote fictional communications station.'),

    -- MALABAR BACKWATERS
    ('MALABAR', 'BACKWATER_PORT', 'Backwater Port', 'port', 'legendary', 'high', 500, 450, TRUE, 'Major waterway supply and transport point.'),
    ('MALABAR', 'COCONUT_GROVE', 'Coconut Grove', 'forest', 'common', 'low', 200, 250, FALSE, 'Green plantation with small supply huts.'),
    ('MALABAR', 'RIVER_FACTORY', 'River Factory', 'factory', 'epic', 'medium', 800, 760, FALSE, 'Abandoned industrial facility beside the river.')
)

INSERT INTO public.map_locations (
    map_id,
    location_code,
    location_name,
    location_type,
    loot_tier,
    risk_level,
    position_x,
    position_y,
    is_hot_drop,
    description
)
SELECT
    m.id,
    s.location_code,
    s.location_name,
    s.location_type,
    s.loot_tier,
    s.risk_level,
    s.position_x,
    s.position_y,
    s.is_hot_drop,
    s.description
FROM location_seed s
JOIN public.maps m
    ON m.map_code = s.map_code
ON CONFLICT (map_id, location_code)
DO UPDATE SET
    location_name = EXCLUDED.location_name,
    location_type = EXCLUDED.location_type,
    loot_tier = EXCLUDED.loot_tier,
    risk_level = EXCLUDED.risk_level,
    position_x = EXCLUDED.position_x,
    position_y = EXCLUDED.position_y,
    is_hot_drop = EXCLUDED.is_hot_drop,
    description = EXCLUDED.description;

-- ==========================================
-- VERIFY LOCATION DATA
-- ==========================================

SELECT
    m.map_name,
    COUNT(l.id) AS total_locations,
    COUNT(l.id) FILTER (WHERE l.is_hot_drop) AS hot_drop_locations
FROM public.maps m
LEFT JOIN public.map_locations l
    ON l.map_id = m.id
GROUP BY m.id, m.map_name
ORDER BY m.map_name;



-- >>>>>>>>>> migrations/001_match_state_snapshots.sql <<<<<<<<<<

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



-- >>>>>>>>>> migrations/002_progression.sql <<<<<<<<<<

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



-- >>>>>>>>>> migrations/003_cosmetics.sql <<<<<<<<<<

-- ==========================================
-- INDIAN BATTLE FIELDS
-- Migration 003: cosmetics store
-- ==========================================
-- Catalog, ownership, equipped slots, and an atomic
-- purchase function. Used by routes/cosmetics.js.
--
-- Run once in the Supabase SQL editor.

-- ---------- Catalog ----------
CREATE TABLE IF NOT EXISTS public.cosmetics (
    id           TEXT PRIMARY KEY,
    name         VARCHAR(100) NOT NULL,
    description  TEXT,
    slot         VARCHAR(20) NOT NULL
                 CHECK (slot IN ('character', 'parachute', 'weapon', 'emote')),
    rarity       VARCHAR(20) NOT NULL DEFAULT 'common'
                 CHECK (rarity IN ('common', 'uncommon', 'rare', 'epic', 'legendary')),
    price_coins  INTEGER NOT NULL CHECK (price_coins >= 0),
    min_level    INTEGER NOT NULL DEFAULT 1,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- Ownership ----------
CREATE TABLE IF NOT EXISTS public.player_cosmetics (
    player_id    BIGINT NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
    cosmetic_id  TEXT NOT NULL REFERENCES public.cosmetics(id),
    acquired_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (player_id, cosmetic_id)
);

-- ---------- Equipped (one per slot) ----------
CREATE TABLE IF NOT EXISTS public.player_equipped_cosmetics (
    player_id    BIGINT NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
    slot         VARCHAR(20) NOT NULL,
    cosmetic_id  TEXT NOT NULL REFERENCES public.cosmetics(id),
    PRIMARY KEY (player_id, slot)
);

ALTER TABLE public.cosmetics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_cosmetics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_equipped_cosmetics ENABLE ROW LEVEL SECURITY;
-- No policies: only the backend (service role) has access.

-- ---------- Atomic purchase ----------
-- Deducts coins and grants ownership in one transaction.
CREATE OR REPLACE FUNCTION public.buy_cosmetic(
    p_player_id   BIGINT,
    p_cosmetic_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_item    public.cosmetics%ROWTYPE;
    v_coins   INTEGER;
    v_level   INTEGER;
BEGIN
    SELECT * INTO v_item
    FROM public.cosmetics
    WHERE id = p_cosmetic_id AND is_active;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Cosmetic not found');
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.player_cosmetics
        WHERE player_id = p_player_id AND cosmetic_id = p_cosmetic_id
    ) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Already owned');
    END IF;

    -- Lock the player row so two purchases cannot overspend.
    SELECT coins, level INTO v_coins, v_level
    FROM public.players
    WHERE id = p_player_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Player not found');
    END IF;

    IF v_level < v_item.min_level THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', format('Requires level %s', v_item.min_level)
        );
    END IF;

    IF v_coins < v_item.price_coins THEN
        RETURN jsonb_build_object('success', false, 'message', 'Not enough coins');
    END IF;

    UPDATE public.players
    SET coins = coins - v_item.price_coins
    WHERE id = p_player_id;

    INSERT INTO public.player_cosmetics (player_id, cosmetic_id)
    VALUES (p_player_id, p_cosmetic_id);

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Purchased',
        'cosmetic_id', p_cosmetic_id,
        'coins', v_coins - v_item.price_coins
    );
END;
$$;

REVOKE ALL ON FUNCTION public.buy_cosmetic(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;

-- ---------- Starter catalog (original designs) ----------
INSERT INTO public.cosmetics (id, name, description, slot, rarity, price_coins, min_level) VALUES
    ('char_monsoon_ranger', 'Monsoon Ranger', 'Rain-cloak scout outfit in deep teal.', 'character', 'common', 300, 1),
    ('char_desert_falcon', 'Desert Falcon', 'Sand-and-saffron desert gear.', 'character', 'rare', 900, 5),
    ('char_himalayan_sentinel', 'Himalayan Sentinel', 'Snow-white high-altitude armor.', 'character', 'epic', 2000, 15),
    ('chute_peacock', 'Peacock Canopy', 'Parachute with a blue-green feather pattern.', 'parachute', 'uncommon', 500, 3),
    ('chute_lotus', 'Lotus Bloom', 'Pink lotus-petal parachute.', 'parachute', 'rare', 1000, 8),
    ('weapon_brass_inlay', 'Brass Inlay', 'Engraved brass finish for any weapon.', 'weapon', 'uncommon', 600, 4),
    ('weapon_midnight_indigo', 'Midnight Indigo', 'Indigo-dyed weapon wrap.', 'weapon', 'rare', 1200, 10),
    ('weapon_sunfire', 'Sunfire', 'Glowing orange-gold weapon finish.', 'weapon', 'legendary', 3500, 25),
    ('emote_victory_drum', 'Victory Drum', 'Celebrate with a drum roll.', 'emote', 'common', 250, 1),
    ('emote_salute', 'Squad Salute', 'A sharp salute to your squad.', 'emote', 'uncommon', 400, 2)
ON CONFLICT (id) DO NOTHING;



-- >>>>>>>>>> migrations/004_lock_down_access.sql <<<<<<<<<<

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



-- >>>>>>>>>> migrations/005_multi_server.sql <<<<<<<<<<

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

