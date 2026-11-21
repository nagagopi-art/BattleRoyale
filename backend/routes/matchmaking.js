// ==========================================
// INDIAN BATTLE FIELDS
// MATCHMAKING & PARTIES
// ==========================================
// POST /api/matchmaking/quick-join   { game_mode }
// POST /api/parties                  { game_mode }   create
// POST /api/parties/join             { code }
// POST /api/parties/leave
// GET  /api/parties/me
//
// Quick-match rooms use match codes starting with "QM-" so
// they are never mixed with private rooms joined by code.
// server.js starts them automatically (see QUICK_MATCH).

const express = require("express");
const crypto = require("crypto");

const { supabaseAdmin } = require("../config/supabase");
const authMiddleware = require("../middleware/authMiddleware");
const { randomMapName } = require("../config/mapCatalog");

const {
    PARTY_SIZES,
    publicParty,
    getPartyForPlayer,
    createParty,
    joinParty,
    leaveParty,
    recordMatchGroup
} = require("../services/partyService");

const {
    isClusterEnabled,
    pickHostServer,
    getMatchServerUrl
} = require("../services/clusterService");

const { MATCH_TYPES, normalizeMatchType } = require("../config/matchTypes");

const matchmakingRouter = express.Router();
const partyRouter = express.Router();

const QUICK_MATCH = {
    codePrefix: "QM-",
    // Quick matches use a random map from maps.sql.
    maxPlayers: 150,
    // Auto-start rules (used by server.js).
    minPlayersToStart: 2,
    lobbyWaitMs: 60000
};

async function getPlayer(authUserId) {
    return await supabaseAdmin
        .from("players")
        .select("id, username")
        .eq("auth_user_id", authUserId)
        .maybeSingle();
}

async function joinMatchRpc(matchId, playerId) {
    return await supabaseAdmin.rpc("join_match", {
        p_match_id: matchId,
        p_player_id: playerId
    });
}

async function leaveMatchRpc(matchId, playerId) {
    return await supabaseAdmin.rpc("leave_match", {
        p_match_id: matchId,
        p_player_id: playerId
    });
}

async function createQuickMatch(creatorId, gameMode, matchType = "br") {
    const type = MATCH_TYPES[matchType];
    const { data: match, error } = await supabaseAdmin
        .from("matches")
        .insert({
            match_code:
                type.quickPrefix +
                crypto.randomBytes(4).toString("hex").toUpperCase(),
            map_name: randomMapName(),
            game_mode: gameMode,
            max_players: type.maxPlayers?.[gameMode] || QUICK_MATCH.maxPlayers,
            current_players: 1,
            status: "waiting",
            created_by: creatorId,
            // Multi-server: the least busy server hosts it.
            ...(isClusterEnabled()
                ? { host_server: await pickHostServer() }
                : {})
        })
        .select("*")
        .single();

    if (error) throw error;

    const { error: memberError } = await supabaseAdmin
        .from("match_players")
        .insert({
            match_id: match.id,
            player_id: creatorId,
            team_number: 1
        });

    if (memberError) {
        await supabaseAdmin.from("matches").delete().eq("id", match.id);
        throw memberError;
    }

    return match;
}

// Join every player in `playerIds` to one match, or none.
async function joinAll(matchId, playerIds) {
    const joined = [];

    for (const playerId of playerIds) {
        const { data, error } = await joinMatchRpc(matchId, playerId);

        if (error || !data || data.status !== "success") {
            for (const id of joined) {
                await leaveMatchRpc(matchId, id);
            }
            return false;
        }

        joined.push(playerId);
    }

    return true;
}

// ---------- Quick join ----------
matchmakingRouter.post("/quick-join", authMiddleware, async (req, res) => {
    try {
        const gameMode = String(req.body.game_mode || "");
        // br (Battle Royale), cs (Clash Squad) or tdm (Team Deathmatch).
        const matchType = normalizeMatchType(String(req.body.match_type || "br"));

        if (!PARTY_SIZES[gameMode]) {
            return res.status(400).json({
                status: "error",
                message: "Game mode must be solo, duo or squad"
            });
        }

        const { data: player, error } = await getPlayer(req.user.id);

        if (error || !player) {
            return res.status(404).json({ status: "error", message: "Player profile not found" });
        }

        // Whole party queues together (leader only).
        const party = getPartyForPlayer(player.id);
        let group = [player.id];

        if (party) {
            if (party.leaderId !== String(player.id)) {
                return res.status(403).json({
                    status: "error",
                    message: "Only the party leader can start matchmaking"
                });
            }

            if (party.gameMode !== gameMode) {
                return res.status(400).json({
                    status: "error",
                    message: `Your party is set up for ${party.gameMode}`
                });
            }

            group = party.members.map(Number);
        }

        // 1. Try open quick-match rooms with room for the group.
        const { data: openMatches, error: openError } = await supabaseAdmin
            .from("matches")
            .select("id, match_code, current_players, max_players")
            .eq("status", "waiting")
            .eq("game_mode", gameMode)
            .like("match_code", `${MATCH_TYPES[matchType].quickPrefix}%`)
            .order("created_at", { ascending: true })
            .limit(10);

        if (openError) throw openError;

        let match = null;

        for (const candidate of openMatches || []) {
            if (candidate.max_players - candidate.current_players < group.length) {
                continue;
            }

            if (await joinAll(candidate.id, group)) {
                match = candidate;
                break;
            }
        }

        // 2. None found: open a new room.
        if (!match) {
            match = await createQuickMatch(group[0], gameMode, matchType);

            if (group.length > 1 && !(await joinAll(match.id, group.slice(1)))) {
                await leaveMatchRpc(match.id, group[0]);

                return res.status(409).json({
                    status: "error",
                    message: "Could not place your whole party in a match"
                });
            }
        }

        if (group.length > 1) {
            recordMatchGroup(match.id, group);
            party.currentMatchId = match.id;
        }

        return res.status(200).json({
            status: "success",
            message: "Match found",
            matchId: match.id,
            matchCode: match.match_code,
            gameMode,
            matchType,
            partyMembers: group,
            // Where to connect the game socket (null = this server).
            serverUrl: await getMatchServerUrl(match.id)
        });

    } catch (error) {
        console.error("Quick join error:", error.message);

        return res.status(500).json({
            status: "error",
            message: "Unable to find a match"
        });
    }
});

// ---------- Parties ----------
partyRouter.get("/me", authMiddleware, async (req, res) => {
    const { data: player } = await getPlayer(req.user.id);

    if (!player) {
        return res.status(404).json({ status: "error", message: "Player profile not found" });
    }

    const party = getPartyForPlayer(player.id);

    return res.status(200).json({
        status: "success",
        party: party ? { ...publicParty(party), currentMatchId: party.currentMatchId || null } : null
    });
});

partyRouter.post("/", authMiddleware, async (req, res) => {
    const { data: player } = await getPlayer(req.user.id);

    if (!player) {
        return res.status(404).json({ status: "error", message: "Player profile not found" });
    }

    const result = createParty(player.id, String(req.body.game_mode || ""));

    return res.status(result.success ? 201 : 409).json({
        status: result.success ? "success" : "error",
        message: result.message || "Party created",
        party: result.party || null
    });
});

partyRouter.post("/join", authMiddleware, async (req, res) => {
    const { data: player } = await getPlayer(req.user.id);

    if (!player) {
        return res.status(404).json({ status: "error", message: "Player profile not found" });
    }

    const result = joinParty(player.id, req.body.code);

    return res.status(result.success ? 200 : 409).json({
        status: result.success ? "success" : "error",
        message: result.message || "Joined party",
        party: result.party || null
    });
});

partyRouter.post("/leave", authMiddleware, async (req, res) => {
    const { data: player } = await getPlayer(req.user.id);

    if (!player) {
        return res.status(404).json({ status: "error", message: "Player profile not found" });
    }

    const result = leaveParty(player.id);

    return res.status(result.success ? 200 : 409).json({
        status: result.success ? "success" : "error",
        message: result.message || "Left party",
        party: result.party || null
    });
});

module.exports = {
    matchmakingRouter,
    partyRouter,
    QUICK_MATCH
};
