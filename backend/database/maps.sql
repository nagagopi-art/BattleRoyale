
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
