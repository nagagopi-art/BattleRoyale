
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
