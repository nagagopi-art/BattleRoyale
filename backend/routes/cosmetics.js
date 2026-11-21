// ==========================================
// INDIAN BATTLE FIELDS
// COSMETICS STORE
// ==========================================
// GET  /api/cosmetics                 catalog (+ owned/equipped if logged in)
// GET  /api/cosmetics/mine            owned + equipped
// POST /api/cosmetics/:id/buy         buy with coins
// POST /api/cosmetics/:id/equip       equip into its slot
// POST /api/cosmetics/unequip/:slot   clear a slot
//
// Requires database/migrations/003_cosmetics.sql.

const express = require("express");
const router = express.Router();

const { supabaseAdmin } = require("../config/supabase");
const authMiddleware = require("../middleware/authMiddleware");

const SLOTS = ["character", "parachute", "weapon", "emote"];

function isMissingTable(error) {
    return error && (error.code === "PGRST205" || error.code === "42P01" || error.code === "PGRST202");
}

function sendError(res, error, fallback) {
    if (isMissingTable(error)) {
        return res.status(503).json({
            status: "error",
            message: "Cosmetics are not set up yet. Run database/migrations/003_cosmetics.sql in Supabase."
        });
    }

    console.error(fallback + ":", error?.message || error);

    return res.status(500).json({ status: "error", message: fallback });
}

async function getPlayerForUser(authUserId) {
    return await supabaseAdmin
        .from("players")
        .select("id, level, coins")
        .eq("auth_user_id", authUserId)
        .maybeSingle();
}

async function getOwnedAndEquipped(playerId) {
    const [owned, equipped] = await Promise.all([
        supabaseAdmin
            .from("player_cosmetics")
            .select("cosmetic_id, acquired_at")
            .eq("player_id", playerId),
        supabaseAdmin
            .from("player_equipped_cosmetics")
            .select("slot, cosmetic_id")
            .eq("player_id", playerId)
    ]);

    if (owned.error) throw owned.error;
    if (equipped.error) throw equipped.error;

    return {
        owned: owned.data || [],
        equipped: Object.fromEntries(
            (equipped.data || []).map(e => [e.slot, e.cosmetic_id])
        )
    };
}

// ---------- Catalog ----------
router.get("/", async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from("cosmetics")
            .select("id, name, description, slot, rarity, price_coins, min_level")
            .eq("is_active", true)
            .order("slot")
            .order("price_coins");

        if (error) return sendError(res, error, "Unable to fetch cosmetics");

        return res.status(200).json({
            status: "success",
            total: data.length,
            cosmetics: data
        });

    } catch (error) {
        return sendError(res, error, "Unable to fetch cosmetics");
    }
});

// ---------- My cosmetics ----------
router.get("/mine", authMiddleware, async (req, res) => {
    try {
        const { data: player, error } = await getPlayerForUser(req.user.id);

        if (error) return sendError(res, error, "Unable to fetch player");
        if (!player) {
            return res.status(404).json({ status: "error", message: "Player profile not found" });
        }

        const mine = await getOwnedAndEquipped(player.id);

        return res.status(200).json({
            status: "success",
            coins: player.coins,
            ...mine
        });

    } catch (error) {
        return sendError(res, error, "Unable to fetch your cosmetics");
    }
});

// ---------- Buy ----------
router.post("/:cosmeticId/buy", authMiddleware, async (req, res) => {
    try {
        const cosmeticId = String(req.params.cosmeticId || "");

        if (!/^[a-z0-9_]{1,64}$/.test(cosmeticId)) {
            return res.status(400).json({ status: "error", message: "Invalid cosmetic ID" });
        }

        const { data: player, error } = await getPlayerForUser(req.user.id);

        if (error) return sendError(res, error, "Unable to fetch player");
        if (!player) {
            return res.status(404).json({ status: "error", message: "Player profile not found" });
        }

        const { data: result, error: buyError } = await supabaseAdmin.rpc(
            "buy_cosmetic",
            { p_player_id: player.id, p_cosmetic_id: cosmeticId }
        );

        if (buyError) return sendError(res, buyError, "Unable to buy cosmetic");

        if (!result?.success) {
            return res.status(409).json({
                status: "error",
                message: result?.message || "Purchase failed"
            });
        }

        return res.status(200).json({
            status: "success",
            message: "Cosmetic purchased",
            cosmeticId,
            coins: result.coins
        });

    } catch (error) {
        return sendError(res, error, "Unable to buy cosmetic");
    }
});

// ---------- Equip ----------
router.post("/:cosmeticId/equip", authMiddleware, async (req, res) => {
    try {
        const cosmeticId = String(req.params.cosmeticId || "");

        if (!/^[a-z0-9_]{1,64}$/.test(cosmeticId)) {
            return res.status(400).json({ status: "error", message: "Invalid cosmetic ID" });
        }

        const { data: player, error } = await getPlayerForUser(req.user.id);

        if (error) return sendError(res, error, "Unable to fetch player");
        if (!player) {
            return res.status(404).json({ status: "error", message: "Player profile not found" });
        }

        const [{ data: owned, error: ownedError }, { data: cosmetic, error: cosmeticError }] =
            await Promise.all([
                supabaseAdmin
                    .from("player_cosmetics")
                    .select("cosmetic_id")
                    .eq("player_id", player.id)
                    .eq("cosmetic_id", cosmeticId)
                    .maybeSingle(),
                supabaseAdmin
                    .from("cosmetics")
                    .select("id, slot")
                    .eq("id", cosmeticId)
                    .maybeSingle()
            ]);

        if (ownedError) return sendError(res, ownedError, "Unable to equip cosmetic");
        if (cosmeticError) return sendError(res, cosmeticError, "Unable to equip cosmetic");

        if (!cosmetic) {
            return res.status(404).json({ status: "error", message: "Cosmetic not found" });
        }

        if (!owned) {
            return res.status(403).json({ status: "error", message: "You do not own this cosmetic" });
        }

        const { error: equipError } = await supabaseAdmin
            .from("player_equipped_cosmetics")
            .upsert(
                { player_id: player.id, slot: cosmetic.slot, cosmetic_id: cosmeticId },
                { onConflict: "player_id,slot" }
            );

        if (equipError) return sendError(res, equipError, "Unable to equip cosmetic");

        return res.status(200).json({
            status: "success",
            message: "Cosmetic equipped",
            slot: cosmetic.slot,
            cosmeticId
        });

    } catch (error) {
        return sendError(res, error, "Unable to equip cosmetic");
    }
});

// ---------- Unequip ----------
router.post("/unequip/:slot", authMiddleware, async (req, res) => {
    try {
        const slot = String(req.params.slot || "");

        if (!SLOTS.includes(slot)) {
            return res.status(400).json({ status: "error", message: "Invalid slot" });
        }

        const { data: player, error } = await getPlayerForUser(req.user.id);

        if (error) return sendError(res, error, "Unable to fetch player");
        if (!player) {
            return res.status(404).json({ status: "error", message: "Player profile not found" });
        }

        const { error: deleteError } = await supabaseAdmin
            .from("player_equipped_cosmetics")
            .delete()
            .eq("player_id", player.id)
            .eq("slot", slot);

        if (deleteError) return sendError(res, deleteError, "Unable to unequip cosmetic");

        return res.status(200).json({ status: "success", message: "Slot cleared", slot });

    } catch (error) {
        return sendError(res, error, "Unable to unequip cosmetic");
    }
});

// Equipped cosmetics for many players (used by the game
// socket to show everyone's skins). Returns {} if the
// cosmetics tables do not exist yet.
async function getEquippedCosmeticsFor(playerIds) {
    if (!Array.isArray(playerIds) || playerIds.length === 0) return {};

    const { data, error } = await supabaseAdmin
        .from("player_equipped_cosmetics")
        .select("player_id, slot, cosmetic_id")
        .in("player_id", playerIds);

    if (error) return {};

    const result = {};

    for (const row of data || []) {
        result[row.player_id] = result[row.player_id] || {};
        result[row.player_id][row.slot] = row.cosmetic_id;
    }

    return result;
}

module.exports = router;
module.exports.getEquippedCosmeticsFor = getEquippedCosmeticsFor;
