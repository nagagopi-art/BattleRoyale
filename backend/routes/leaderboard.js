
const express = require("express");
const router = express.Router();

const { supabaseAdmin } = require("../config/supabase");

// =====================================
// GLOBAL LEADERBOARD
// GET /api/leaderboard
// =====================================
router.get("/", async (req, res) => {
    try {
        const requestedLimit = Number(req.query.limit) || 50;
        const limit = Math.min(Math.max(requestedLimit, 1), 100);

        const { data: players, error } = await supabaseAdmin
            .from("players")
            .select(`
                player_uid,
                username,
                level,
                experience,
                coins
            `)
            // Bots (usernames "bot_...") are not ranked.
            .not("username", "like", "bot\\_%")
            .order("experience", { ascending: false })
            .order("level", { ascending: false })
            .limit(limit);

        if (error) {
            throw error;
        }

        const leaderboard = players.map((player, index) => ({
            rank: index + 1,
            player_uid: player.player_uid,
            username: player.username,
            level: player.level,
            experience: player.experience,
            coins: player.coins
        }));

        return res.status(200).json({
            status: "success",
            message: "Leaderboard fetched successfully",
            total: leaderboard.length,
            leaderboard
        });

    } catch (error) {
        console.error("Leaderboard error:", error.message);

        return res.status(500).json({
            status: "error",
            message: "Unable to fetch leaderboard"
        });
    }
});

module.exports = router;
