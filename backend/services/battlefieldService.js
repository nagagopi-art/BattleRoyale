
const { supabaseAdmin } = require("../config/supabase");
const { getMatchGroups } = require("./partyService");

// ==========================================
// INDIAN BATTLE FIELDS
// BATTLEFIELD CONFIGURATION
// ==========================================

const MAX_PLAYERS = 150;

const BATTLEFIELD = {
    minX: -1000,
    maxX: 1000,
    minZ: -1000,
    maxZ: 1000,
    spawnY: 100,
    minSpawnRadius: 350,
    maxSpawnRadius: 600,
    teamSpawnRadius: 12
};

const TEAM_SIZES = {
    solo: 1,
    duo: 2,
    squad: 4
};

// ==========================================
// VALIDATE GAME MODE
// ==========================================

function validateGameMode(gameMode) {

    if (!Object.prototype.hasOwnProperty.call(
        TEAM_SIZES,
        gameMode
    )) {
        throw new Error(
            `Invalid game mode: ${gameMode}`
        );
    }

    return TEAM_SIZES[gameMode];
}

// ==========================================
// GENERATE TEAM SPAWN POSITION
// ==========================================

function generateTeamSpawnPosition(index, totalTeams) {

    const angle =
        (2 * Math.PI * index) /
        Math.max(totalTeams, 1);

    const radius =
        BATTLEFIELD.minSpawnRadius +
        Math.random() *
        (
            BATTLEFIELD.maxSpawnRadius -
            BATTLEFIELD.minSpawnRadius
        );

    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;

    return {
        x: Number(x.toFixed(2)),
        y: BATTLEFIELD.spawnY,
        z: Number(z.toFixed(2))
    };
}

// ==========================================
// GENERATE PLAYER SPAWN POSITION
// ==========================================

function generateSpawnPosition(index, totalPlayers) {

    const angle =
        (2 * Math.PI * index) /
        Math.max(totalPlayers, 1);

    const radius =
        BATTLEFIELD.minSpawnRadius +
        Math.random() *
        (
            BATTLEFIELD.maxSpawnRadius -
            BATTLEFIELD.minSpawnRadius
        );

    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;

    return {
        x: Number(x.toFixed(2)),
        y: BATTLEFIELD.spawnY,
        z: Number(z.toFixed(2))
    };
}

// ==========================================
// ASSIGN TEAMS AND SPAWN POSITIONS
// ==========================================

// groups: optional [[playerId, ...], ...] of players who
// queued together (parties). Each party gets its own team;
// everyone else fills the remaining slots in join order.
function orderPlayersIntoTeams(players, teamSize, groups = []) {
    const byId = new Map(players.map(p => [String(p.player_id), p]));
    const placed = new Set();
    const teams = [];

    for (const group of groups) {
        const members = group
            .map(String)
            .filter(id => byId.has(id) && !placed.has(id))
            .slice(0, teamSize);

        if (members.length === 0) continue;

        members.forEach(id => placed.add(id));
        teams.push(members.map(id => byId.get(id)));
    }

    for (const player of players) {
        const id = String(player.player_id);
        if (placed.has(id)) continue;

        // Fill partial teams (including partial parties) first.
        let team = teams.find(t => t.length < teamSize);

        if (!team) {
            team = [];
            teams.push(team);
        }

        team.push(player);
        placed.add(id);
    }

    return teams;
}

function assignTeams(players, gameMode, groups = []) {

    if (!Array.isArray(players) || players.length === 0) {
        throw new Error("Players list is empty");
    }

    if (players.length > MAX_PLAYERS) {
        throw new Error("Maximum 150 players allowed");
    }

    const teamSize = validateGameMode(gameMode);

    const teams = orderPlayersIntoTeams(players, teamSize, groups);

    // Flatten so that index / teamSize still identifies the
    // team below: pad every team to teamSize with null.
    players = teams.flatMap(team => [
        ...team,
        ...Array(teamSize - team.length).fill(null)
    ]);

    const totalTeams = teams.length;

    const teamPositions = [];

    for (let i = 0; i < totalTeams; i++) {

        teamPositions.push(
            generateTeamSpawnPosition(i, totalTeams)
        );
    }

    const assignments = [];

    players.forEach((player, index) => {

        // Empty padding slot in a partial team.
        if (player === null) return;

        if (player.player_id === undefined ||
            player.player_id === null) {
            throw new Error(
                `Invalid player ID at position ${index}`
            );
        }

        const teamNumber =
            Math.floor(index / teamSize) + 1;

        const teamPosition =
            teamPositions[teamNumber - 1];

        // Keep team members close to each other.
        const positionInTeam = index % teamSize;

        const offsetAngle =
            (2 * Math.PI * positionInTeam) /
            Math.max(teamSize, 1);

        const offsetRadius =
            positionInTeam === 0
                ? 0
                : BATTLEFIELD.teamSpawnRadius;

        const x =
            teamPosition.x +
            Math.cos(offsetAngle) * offsetRadius;

        const z =
            teamPosition.z +
            Math.sin(offsetAngle) * offsetRadius;

        const spawn = {
            x: Number(x.toFixed(2)),
            y: BATTLEFIELD.spawnY,
            z: Number(z.toFixed(2))
        };

        if (
            spawn.x < BATTLEFIELD.minX ||
            spawn.x > BATTLEFIELD.maxX ||
            spawn.z < BATTLEFIELD.minZ ||
            spawn.z > BATTLEFIELD.maxZ
        ) {
            throw new Error(
                "Generated spawn position is outside battlefield"
            );
        }

        assignments.push({
            player_id: player.player_id,
            team_number: teamNumber,
            spawn_x: spawn.x,
            spawn_y: spawn.y,
            spawn_z: spawn.z
        });
    });

    return assignments;
}

// ==========================================
// LOAD EXISTING BATTLEFIELD ASSIGNMENTS
// ==========================================

async function getExistingBattlefield(matchId, gameMode) {

    const { data: participants, error } =
        await supabaseAdmin
            .from("match_players")
            .select(
                "player_id, team_number, spawn_x, spawn_y, spawn_z, health, armor, kills, is_alive"
            )
            .eq("match_id", matchId)
            .order("joined_at", { ascending: true });

    if (error) {
        throw error;
    }

    if (!participants || participants.length === 0) {
        throw new Error(
            "No battlefield assignments found"
        );
    }

    return {
        success: true,
        matchId,
        gameMode,
        totalPlayers: participants.length,
        teamSize: TEAM_SIZES[gameMode],
        assignments: participants.map(player => ({
            player_id: player.player_id,
            team_number: player.team_number,
            spawn_x: player.spawn_x,
            spawn_y: player.spawn_y,
            spawn_z: player.spawn_z
        }))
    };
}

// ==========================================
// INITIALIZE BATTLEFIELD
// ==========================================

async function initializeBattlefield(matchId) {

    try {

        if (!matchId || typeof matchId !== "string") {
            throw new Error("Valid Match ID is required");
        }

        // ----------------------------------
        // GET MATCH DETAILS
        // ----------------------------------

        const { data: match, error: matchError } =
            await supabaseAdmin
                .from("matches")
                .select(
                    "id, game_mode, status, max_players, battlefield_status"
                )
                .eq("id", matchId)
                .single();

        if (matchError || !match) {
            throw new Error("Match not found");
        }

        if (match.status !== "in_progress") {
            throw new Error(
                "Match is not in progress"
            );
        }

        const teamSize = validateGameMode(
            match.game_mode
        );

        // ----------------------------------
        // PREVENT DUPLICATE INITIALIZATION
        // ----------------------------------

        if (match.battlefield_status === "active") {

            console.log(
                "Battlefield already active:",
                matchId
            );

            return await getExistingBattlefield(
                matchId,
                match.game_mode
            );
        }

        // ----------------------------------
        // GET MATCH PARTICIPANTS
        // ----------------------------------

        const { data: participants, error: playersError } =
            await supabaseAdmin
                .from("match_players")
                .select("player_id")
                .eq("match_id", matchId)
                .order("joined_at", { ascending: true });

        if (playersError) {
            throw playersError;
        }

        if (!participants || participants.length === 0) {
            throw new Error(
                "No players found in this match"
            );
        }

        const maxAllowed = Math.min(
            Number(match.max_players) || MAX_PLAYERS,
            MAX_PLAYERS
        );

        if (participants.length > maxAllowed) {
            throw new Error(
                `Player limit exceeded. Maximum allowed: ${maxAllowed}`
            );
        }

        // ----------------------------------
        // GENERATE TEAM ASSIGNMENTS
        // ----------------------------------

        const playerAssignments = assignTeams(
            participants,
            match.game_mode,
            getMatchGroups(matchId)
        );

        // ----------------------------------
        // SAVE PLAYER SPAWN DATA
        // ----------------------------------

        for (const assignment of playerAssignments) {

            const { data: updatedPlayer, error } =
                await supabaseAdmin
                    .from("match_players")
                    .update({
                        team_number: assignment.team_number,
                        spawn_x: assignment.spawn_x,
                        spawn_y: assignment.spawn_y,
                        spawn_z: assignment.spawn_z,
                        health: 100,
                        armor: 0,
                        kills: 0,
                        is_alive: true,
                        eliminated_at: null
                    })
                    .eq("match_id", matchId)
                    .eq("player_id", assignment.player_id)
                    .select("player_id");

            if (error) {
                throw error;
            }

            if (!updatedPlayer || updatedPlayer.length === 0) {
                throw new Error(
                    `Failed to save spawn for player ${assignment.player_id}`
                );
            }
        }

        // ----------------------------------
        // UPDATE MATCH BATTLEFIELD STATUS
        // ----------------------------------

        const { error: updateError } =
            await supabaseAdmin
                .from("matches")
                .update({
                    battlefield_status: "active",
                    alive_players: participants.length,
                    eliminated_players: 0
                })
                .eq("id", matchId);

        if (updateError) {
            throw updateError;
        }

        // ----------------------------------
        // SUCCESS RESPONSE
        // ----------------------------------

        console.log("----------------------------------");
        console.log("BATTLEFIELD INITIALIZED");
        console.log("Game: INDIAN BATTLE FIELDS");
        console.log("Match:", matchId);
        console.log("Mode:", match.game_mode);
        console.log("Players:", participants.length);
        console.log("Teams:", Math.ceil(
            participants.length / teamSize
        ));
        console.log("----------------------------------");

        return {
            success: true,
            matchId,
            gameMode: match.game_mode,
            totalPlayers: participants.length,
            teamSize,
            assignments: playerAssignments
        };

    } catch (error) {

        console.error(
            "Battlefield initialization error:",
            error.message
        );

        throw error;
    }
}

// ==========================================
// EXPORT SERVICE
// ==========================================

module.exports = {
    initializeBattlefield,
    assignTeams,
    generateSpawnPosition,
    BATTLEFIELD,
    TEAM_SIZES
};
