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
