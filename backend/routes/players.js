
const express = require("express");
const router = express.Router();

const { supabaseAdmin } = require("../config/supabase");
const authMiddleware = require("../middleware/authMiddleware");

const {
    getPlayerProfile,
    getPlayerMatchHistory,
    getPlayerRank
} = require("../services/playerStatsService");

const { getLevelProgress } = require("../services/progressionService");

// ==========================================
// FETCH AUTHENTICATED PLAYER
// ==========================================

async function getPlayer(authUserId) {
    return await supabaseAdmin
        .from("players")
        .select(`
            id,
            player_uid,
            auth_user_id,
            username,
            email,
            avatar_url,
            level,
            experience,
            coins,
            rank_points,
            created_at
        `)
        .eq("auth_user_id", authUserId)
        .maybeSingle();
}

// ==========================================
// VALIDATE PLAYER ID
// ==========================================

function validPlayerId(playerId) {
    return /^\d+$/.test(String(playerId)) &&
        Number(playerId) > 0;
}

// ==========================================
// GET MY BASIC PROFILE
// GET /api/players/me
// ==========================================

router.get("/me", authMiddleware, async (req, res) => {
    try {
        const { data: player, error } =
            await getPlayer(req.user.id);

        if (error) {
            console.error("Player query error:", error.message);
            return res.status(500).json({
                status: "error",
                message: "Database error while fetching player"
            });
        }

        if (!player) {
            return res.status(404).json({
                status: "error",
                message: "Player profile not found"
            });
        }

        return res.status(200).json({
            status: "success",
            message: "Player profile fetched successfully",
            player,
            progression: getLevelProgress(player.experience)
        });

    } catch (error) {
        console.error("Profile error:", error);

        return res.status(500).json({
            status: "error",
            message: "Internal server error"
        });
    }
});

// ==========================================
// GET MY FULL CAREER PROFILE
// GET /api/players/profile
// ==========================================

router.get("/profile", authMiddleware, async (req, res) => {
    try {
        const { data: player, error } =
            await getPlayer(req.user.id);

        if (error) {
            throw new Error(error.message);
        }

        if (!player) {
            return res.status(404).json({
                status: "error",
                message: "Player profile not found"
            });
        }

        const profile = await getPlayerProfile(player.id);

        return res.status(200).json({
            status: "success",
            message: "Career profile fetched successfully",
            ...profile
        });

    } catch (error) {
        console.error("Career profile error:", error.message);

        return res.status(500).json({
            status: "error",
            message: "Unable to fetch career profile"
        });
    }
});

// ==========================================
// UPDATE MY PLAYER PROFILE
// PATCH /api/players/me
// ==========================================

router.patch("/me", authMiddleware, async (req, res) => {
    try {
        const { username, avatar_url } = req.body;
        const updates = {};

        if (username !== undefined) {
            if (
                typeof username !== "string" ||
                username.trim().length < 3 ||
                username.trim().length > 20
            ) {
                return res.status(400).json({
                    status: "error",
                    message: "Username must contain 3-20 characters"
                });
            }

            updates.username = username.trim();
        }

        if (avatar_url !== undefined) {
            if (
                avatar_url !== null &&
                (
                    typeof avatar_url !== "string" ||
                    avatar_url.length > 2048 ||
                    !/^https?:\/\/\S+$/i.test(avatar_url)
                )
            ) {
                return res.status(400).json({
                    status: "error",
                    message: "Invalid avatar URL"
                });
            }

            updates.avatar_url = avatar_url;
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({
                status: "error",
                message: "No profile changes provided"
            });
        }

        const { data: player, error } = await supabaseAdmin
            .from("players")
            .update(updates)
            .eq("auth_user_id", req.user.id)
            .select(`
                id,
                player_uid,
                username,
                avatar_url,
                level,
                experience,
                coins,
                rank_points
            `)
            .maybeSingle();

        if (error) {
            console.error("Profile update error:", error.message);

            return res.status(500).json({
                status: "error",
                message: "Unable to update player profile"
            });
        }

        if (!player) {
            return res.status(404).json({
                status: "error",
                message: "Player profile not found"
            });
        }

        return res.status(200).json({
            status: "success",
            message: "Player profile updated successfully",
            player
        });

    } catch (error) {
        console.error("Update profile error:", error);

        return res.status(500).json({
            status: "error",
            message: "Internal server error"
        });
    }
});

// ==========================================
// GET MY PLAYER STATISTICS
// GET /api/players/stats
// ==========================================

router.get("/stats", authMiddleware, async (req, res) => {
    try {
        const { data: player, error } =
            await getPlayer(req.user.id);

        if (error) {
            throw new Error(error.message);
        }

        if (!player) {
            return res.status(404).json({
                status: "error",
                message: "Player profile not found"
            });
        }

        const profile = await getPlayerProfile(player.id);

        return res.status(200).json({
            status: "success",
            message: "Player statistics fetched successfully",
            stats: {
                player_uid: player.player_uid,
                username: player.username,
                level: player.level,
                experience: player.experience,
                coins: player.coins,
                rank_points: player.rank_points,
                ...profile.career
            }
        });

    } catch (error) {
        console.error("Statistics error:", error.message);

        return res.status(500).json({
            status: "error",
            message: "Unable to fetch player statistics"
        });
    }
});

// ==========================================
// GET ANOTHER PLAYER'S PROFILE
// GET /api/players/:playerId/profile
// ==========================================

router.get("/:playerId/profile", authMiddleware, async (req, res) => {
    try {
        const { playerId } = req.params;

        if (!validPlayerId(playerId)) {
            return res.status(400).json({
                status: "error",
                message: "Invalid player ID"
            });
        }

        const profile = await getPlayerProfile(Number(playerId));

        return res.status(200).json({
            status: "success",
            message: "Player profile fetched successfully",
            ...profile
        });

    } catch (error) {
        console.error("Public profile error:", error.message);

        if (error.message.includes("0 rows")) {
            return res.status(404).json({
                status: "error",
                message: "Player not found"
            });
        }

        return res.status(500).json({
            status: "error",
            message: "Unable to fetch player profile"
        });
    }
});

// ==========================================
// GET PLAYER RANK
// GET /api/players/:playerId/rank
// ==========================================

router.get("/:playerId/rank", authMiddleware, async (req, res) => {
    try {
        const { playerId } = req.params;

        if (!validPlayerId(playerId)) {
            return res.status(400).json({
                status: "error",
                message: "Invalid player ID"
            });
        }

        const rank = await getPlayerRank(Number(playerId));

        return res.status(200).json({
            status: "success",
            message: "Player rank fetched successfully",
            rank
        });

    } catch (error) {
        console.error("Player rank error:", error.message);

        return res.status(500).json({
            status: "error",
            message: "Unable to fetch player rank"
        });
    }
});

// ==========================================
// GET PLAYER MATCH HISTORY
// GET /api/players/:playerId/match-history
// ==========================================

router.get(
    "/:playerId/match-history",
    authMiddleware,
    async (req, res) => {
        try {
            const { playerId } = req.params;

            if (!validPlayerId(playerId)) {
                return res.status(400).json({
                    status: "error",
                    message: "Invalid player ID"
                });
            }

            const history = await getPlayerMatchHistory(
                Number(playerId),
                req.query.limit,
                req.query.offset
            );

            return res.status(200).json({
                status: "success",
                message: "Player match history fetched successfully",
                ...history
            });

        } catch (error) {
            console.error("Match history error:", error.message);

            return res.status(500).json({
                status: "error",
                message: "Unable to fetch match history"
            });
        }
    }
);

module.exports = router;
