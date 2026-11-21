
const express = require("express");
const crypto = require("crypto");

const router = express.Router();

const { supabaseAdmin } = require("../config/supabase");
const authMiddleware = require("../middleware/authMiddleware");

const {
    isClusterEnabled,
    pickHostServer,
    getServerUrl,
    getMatchServerUrl
} = require("../services/clusterService");

const { getLayout } = require("../config/mapLayout");

const MAX_PLAYERS = 150;
const ALLOWED_MODES = ["solo", "duo", "squad"];
const { MATCH_TYPES, ROOM_CODE_PATTERN, normalizeMatchType } = require("../config/matchTypes");
const ALLOWED_STATUSES = [
    "waiting",
    "starting",
    "in_progress",
    "completed",
    "cancelled"
];

// ==========================================
// HELPERS
// ==========================================

async function getAuthenticatedPlayer(authUserId) {
    return await supabaseAdmin
        .from("players")
        .select("id, player_uid, username, level, coins")
        .eq("auth_user_id", authUserId)
        .maybeSingle();
}

function isValidUUID(value) {
    return typeof value === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

async function joinMatch(matchId, playerId) {
    return await supabaseAdmin.rpc("join_match", {
        p_match_id: matchId,
        p_player_id: playerId
    });
}

function sendServerError(res, message) {
    return res.status(500).json({
        status: "error",
        message
    });
}

// ==========================================
// CREATE MATCH
// POST /api/matches/create
// ==========================================

router.post("/create", authMiddleware, async (req, res) => {
    try {
        const { map_name, game_mode } = req.body;
        const matchType = normalizeMatchType(String(req.body.match_type || "br"));

        if (
            typeof map_name !== "string" ||
            map_name.trim().length < 3 ||
            map_name.trim().length > 100
        ) {
            return res.status(400).json({
                status: "error",
                message: "Valid map name is required"
            });
        }

        if (!ALLOWED_MODES.includes(game_mode)) {
            return res.status(400).json({
                status: "error",
                message: "Game mode must be solo, duo or squad"
            });
        }

        const { data: player, error: playerError } =
            await getAuthenticatedPlayer(req.user.id);

        if (playerError || !player) {
            return res.status(404).json({
                status: "error",
                message: "Player profile not found"
            });
        }

        const matchCode =
            MATCH_TYPES[matchType].roomPrefix + crypto.randomBytes(4).toString("hex").toUpperCase();

        const { data: match, error } = await supabaseAdmin
            .from("matches")
            .insert({
                match_code: matchCode,
                map_name: map_name.trim(),
                game_mode,
                max_players: MATCH_TYPES[matchType].maxPlayers?.[game_mode] || MAX_PLAYERS,
                current_players: 1,
                status: "waiting",
                created_by: player.id,
                // Multi-server: the least busy server hosts it.
                ...(isClusterEnabled()
                    ? { host_server: await pickHostServer() }
                    : {})
            })
            .select("*")
            .single();

        if (error) {
            console.error("Create match error:", error.message);
            return sendServerError(res, "Unable to create match");
        }

        // Register creator as the first match member.
        const { error: memberError } = await supabaseAdmin
            .from("match_players")
            .insert({
                match_id: match.id,
                player_id: player.id,
                team_number: 1
            });

        if (memberError) {
            console.error("Creator registration error:", memberError.message);

            await supabaseAdmin
                .from("matches")
                .delete()
                .eq("id", match.id);

            return sendServerError(
                res,
                "Unable to register match creator"
            );
        }

        return res.status(201).json({
            status: "success",
            message: "Battle room created successfully",
            match,
            // Where to connect the game socket (null = this server).
            serverUrl: await getServerUrl(match.host_server)
        });

    } catch (error) {
        console.error("Create match error:", error);
        return sendServerError(res, "Internal server error");
    }
});


// ==========================================
// GET AVAILABLE MATCHES
// GET /api/matches?status=waiting
// ==========================================

router.get("/", async (req, res) => {
    try {
        const matchStatus = req.query.status || "waiting";

        if (!ALLOWED_STATUSES.includes(matchStatus)) {
            return res.status(400).json({
                status: "error",
                message: "Invalid match status"
            });
        }

        const { data: matches, error } = await supabaseAdmin
            .from("matches")
            .select(`
                id,
                match_code,
                map_name,
                game_mode,
                max_players,
                current_players,
                status,
                start_at,
                started_at,
                created_at
            `)
            .eq("status", matchStatus)
            .order("created_at", { ascending: false });

        if (error) {
            console.error("Fetch matches error:", error.message);
            return sendServerError(res, "Unable to fetch matches");
        }

        return res.status(200).json({
            status: "success",
            message: "Matches fetched successfully",
            total: matches.length,
            matches
        });

    } catch (error) {
        console.error("Fetch matches error:", error);
        return sendServerError(res, "Internal server error");
    }
});


// ==========================================
// JOIN MATCH USING MATCH CODE
// POST /api/matches/join/code/:matchCode
// ==========================================

router.post("/join/code/:matchCode", authMiddleware, async (req, res) => {
    try {
        const matchCode = req.params.matchCode.trim().toUpperCase();

        if (!ROOM_CODE_PATTERN.test(matchCode)) {
            return res.status(400).json({
                status: "error",
                message: "Invalid match code format"
            });
        }

        const { data: match, error } = await supabaseAdmin
            .from("matches")
            .select("id")
            .eq("match_code", matchCode)
            .maybeSingle();

        if (error || !match) {
            return res.status(404).json({
                status: "error",
                message: "Match code not found"
            });
        }

        const { data: player, error: playerError } =
            await getAuthenticatedPlayer(req.user.id);

        if (playerError || !player) {
            return res.status(404).json({
                status: "error",
                message: "Player profile not found"
            });
        }

        const { data: result, error: joinError } =
            await joinMatch(match.id, player.id);

        if (joinError) {
            console.error("Join match RPC error:", joinError.message);
            return sendServerError(res, "Unable to join match");
        }

        if (!result || result.status !== "success") {
            return res.status(409).json(
                result || {
                    status: "error",
                    message: "Unable to join match"
                }
            );
        }

        return res.status(200).json({
            ...result,
            matchId: match.id,
            serverUrl: await getMatchServerUrl(match.id)
        });

    } catch (error) {
        console.error("Join by code error:", error);
        return sendServerError(res, "Internal server error");
    }
});


// ==========================================
// JOIN MATCH USING UUID
// POST /api/matches/join/:matchId
// ==========================================

router.post("/join/:matchId", authMiddleware, async (req, res) => {
    try {
        const { matchId } = req.params;

        if (!isValidUUID(matchId)) {
            return res.status(400).json({
                status: "error",
                message: "Invalid match ID"
            });
        }

        const { data: player, error: playerError } =
            await getAuthenticatedPlayer(req.user.id);

        if (playerError || !player) {
            return res.status(404).json({
                status: "error",
                message: "Player profile not found"
            });
        }

        const { data: result, error } =
            await joinMatch(matchId, player.id);

        if (error) {
            console.error("Join match error:", error.message);
            return sendServerError(res, "Unable to join match");
        }

        if (!result || result.status !== "success") {
            return res.status(409).json(
                result || {
                    status: "error",
                    message: "Unable to join match"
                }
            );
        }

        return res.status(200).json({
            ...result,
            matchId,
            serverUrl: await getMatchServerUrl(matchId)
        });

    } catch (error) {
        console.error("Join match error:", error);
        return sendServerError(res, "Internal server error");
    }
});


// ==========================================
// GET MATCH PLAYERS
// GET /api/matches/:matchId/players
// ==========================================

router.get("/:matchId/players", async (req, res) => {
    try {
        const { matchId } = req.params;

        if (!isValidUUID(matchId)) {
            return res.status(400).json({
                status: "error",
                message: "Invalid match ID"
            });
        }

        const { data: players, error } = await supabaseAdmin
            .from("match_players")
            .select(`
                player_id,
                joined_at,
                players (
                    player_uid,
                    username,
                    level,
                    avatar_url
                )
            `)
            .eq("match_id", matchId)
            .order("joined_at", { ascending: true });

        if (error) {
            console.error("Match players error:", error.message);
            return sendServerError(res, "Unable to fetch match players");
        }

        return res.status(200).json({
            status: "success",
            message: "Match players fetched successfully",
            total: players.length,
            players
        });

    } catch (error) {
        console.error("Match players error:", error);
        return sendServerError(res, "Internal server error");
    }
});


// ==========================================
// LEAVE MATCH
// POST /api/matches/:matchId/leave
// ==========================================

router.post("/:matchId/leave", authMiddleware, async (req, res) => {
    try {
        const { matchId } = req.params;

        if (!isValidUUID(matchId)) {
            return res.status(400).json({
                status: "error",
                message: "Invalid match ID"
            });
        }

        const { data: player, error: playerError } =
            await getAuthenticatedPlayer(req.user.id);

        if (playerError || !player) {
            return res.status(404).json({
                status: "error",
                message: "Player profile not found"
            });
        }

        const { data: result, error } = await supabaseAdmin.rpc(
            "leave_match",
            {
                p_match_id: matchId,
                p_player_id: player.id
            }
        );

        if (error) {
            console.error("Leave match error:", error.message);
            return sendServerError(res, "Unable to leave match");
        }

        if (!result || result.status !== "success") {
            return res.status(409).json(
                result || {
                    status: "error",
                    message: "Unable to leave match"
                }
            );
        }

        return res.status(200).json(result);

    } catch (error) {
        console.error("Leave match error:", error);
        return sendServerError(res, "Internal server error");
    }
});


// ==========================================
// START MATCH
// POST /api/matches/:matchId/start
// ==========================================

router.post("/:matchId/start", authMiddleware, async (req, res) => {
    try {
        const { matchId } = req.params;

        if (!isValidUUID(matchId)) {
            return res.status(400).json({
                status: "error",
                message: "Invalid match ID"
            });
        }

        const { data: player, error: playerError } =
            await getAuthenticatedPlayer(req.user.id);

        if (playerError || !player) {
            return res.status(404).json({
                status: "error",
                message: "Player profile not found"
            });
        }

        const { data: result, error } = await supabaseAdmin.rpc(
            "prepare_match_start",
            {
                p_match_id: matchId,
                p_player_id: player.id
            }
        );

        if (error) {
            console.error("Start match RPC error:", error.message);
            return sendServerError(res, "Unable to start match");
        }

        if (!result || result.status !== "success") {
            return res.status(409).json(
                result || {
                    status: "error",
                    message: "Unable to start match"
                }
            );
        }

        return res.status(200).json(result);

    } catch (error) {
        console.error("Start match error:", error);
        return sendServerError(res, "Internal server error");
    }
});


// ==========================================
// GET MAP LAYOUT FOR A MATCH
// GET /api/matches/:matchId/layout
// ==========================================
// Buildings and cover (axis-aligned boxes) the server uses
// for collision, so clients build the identical scene.
// The layout never changes for a map + version, so clients
// can cache it by layout.version + layout.mapName.

router.get("/:matchId/layout", async (req, res) => {
    try {
        const { matchId } = req.params;

        if (!isValidUUID(matchId)) {
            return res.status(400).json({ status: "error", message: "Invalid match ID" });
        }

        const { data: match, error } = await supabaseAdmin
            .from("matches")
            .select("map_name")
            .eq("id", matchId)
            .maybeSingle();

        if (error) {
            console.error("Layout lookup error:", error.message);
            return sendServerError(res, "Unable to fetch match");
        }

        if (!match) {
            return res.status(404).json({ status: "error", message: "Match not found" });
        }

        res.set("Cache-Control", "public, max-age=3600");

        return res.status(200).json({
            status: "success",
            layout: getLayout(match.map_name)
        });

    } catch (error) {
        console.error("Layout error:", error);
        return sendServerError(res, "Internal server error");
    }
});

// ==========================================
// GET COMPLETED MATCH RESULTS
// GET /api/matches/:matchId/results
// ==========================================

router.get("/:matchId/results", authMiddleware, async (req, res) => {
    try {
        const { matchId } = req.params;

        if (!isValidUUID(matchId)) {
            return res.status(400).json({
                status: "error",
                message: "Invalid match ID"
            });
        }

        const { data: player, error: playerError } =
            await getAuthenticatedPlayer(req.user.id);

        if (playerError || !player) {
            return res.status(404).json({
                status: "error",
                message: "Player profile not found"
            });
        }

        // Verify that this player participated in the match.
        const { data: membership, error: membershipError } =
            await supabaseAdmin
                .from("match_players")
                .select("player_id")
                .eq("match_id", matchId)
                .eq("player_id", player.id)
                .maybeSingle();

        if (membershipError) {
            console.error("Match membership error:", membershipError.message);
            return sendServerError(res, "Unable to verify match participation");
        }

        if (!membership) {
            return res.status(403).json({
                status: "error",
                message: "You did not participate in this match"
            });
        }

        // Match must be completed.
        const { data: match, error: matchError } =
            await supabaseAdmin
                .from("matches")
                .select("id, match_code, game_mode, map_name, status, winner_team, winner_player_id, completed_at")
                .eq("id", matchId)
                .maybeSingle();

        if (matchError) {
            console.error("Match results lookup error:", matchError.message);
            return sendServerError(res, "Unable to fetch match");
        }

        if (!match) {
            return res.status(404).json({
                status: "error",
                message: "Match not found"
            });
        }

        if (match.status !== "completed") {
            return res.status(409).json({
                status: "error",
                message: "Match has not completed yet"
            });
        }

        // Fetch permanent match results.
        const { data: results, error: resultsError } =
            await supabaseAdmin
                .from("player_match_results")
                .select(`
                    player_id,
                    kills,
                    deaths,
                    placement,
                    is_winner,
                    xp_earned,
                    rank_points_earned,
                    completed_at
                `)
                .eq("match_id", matchId)
                .order("placement", { ascending: true });

        if (resultsError) {
            console.error("Results fetch error:", resultsError.message);
            return sendServerError(res, "Unable to fetch match results");
        }

        const playerIds = (results || []).map(row => row.player_id);

        const { data: profiles, error: profilesError } =
            await supabaseAdmin
                .from("players")
                .select("id, username, avatar_url, level")
                .in("id", playerIds);

        if (profilesError) {
            console.error("Player profiles error:", profilesError.message);
            return sendServerError(res, "Unable to fetch player profiles");
        }

        const profileMap = new Map(
            (profiles || []).map(profile => [
                String(profile.id),
                profile
            ])
        );

        const finalResults = (results || []).map(row => ({
            playerId: row.player_id,
            username: profileMap.get(String(row.player_id))?.username || "Player",
            avatarUrl: profileMap.get(String(row.player_id))?.avatar_url || null,
            level: profileMap.get(String(row.player_id))?.level ?? 1,
            kills: row.kills,
            deaths: row.deaths,
            placement: row.placement,
            isWinner: row.is_winner,
            xpEarned: row.xp_earned,
            rankPointsEarned: row.rank_points_earned,
            completedAt: row.completed_at
        }));

        return res.status(200).json({
            status: "success",
            message: "Match results fetched successfully",
            match,
            totalPlayers: finalResults.length,
            results: finalResults
        });

    } catch (error) {
        console.error("Match results error:", error);
        return sendServerError(res, "Internal server error");
    }
});

// ==========================================
// GET MATCH DETAILS
// GET /api/matches/:matchId
// ==========================================

router.get("/:matchId", async (req, res) => {
    try {
        const { matchId } = req.params;

        if (!isValidUUID(matchId)) {
            return res.status(400).json({
                status: "error",
                message: "Invalid match ID"
            });
        }

        const { data: match, error } = await supabaseAdmin
            .from("matches")
            .select("*")
            .eq("id", matchId)
            .maybeSingle();

        if (error) {
            console.error("Match details error:", error.message);
            return sendServerError(res, "Unable to fetch match details");
        }

        if (!match) {
            return res.status(404).json({
                status: "error",
                message: "Match not found"
            });
        }

        return res.status(200).json({
            status: "success",
            message: "Match details fetched successfully",
            match
        });

    } catch (error) {
        console.error("Match details error:", error);
        return sendServerError(res, "Internal server error");
    }
});

module.exports = router;
