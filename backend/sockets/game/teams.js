// ==========================================
// INDIAN BATTLE FIELDS - sockets/game/teams.js
// ==========================================
// Teams, knockdown bleed-out and team wipes.

const { supabaseAdmin } = require("../../config/supabase");
const { reportError } = require("../../services/errorReporter");
const { getCombatPlayer, cancelPlayerReload } = require("../../services/combatService");
const {
    KNOCK_CONFIG,
    knockPlayer,
    clearKnock
} = require("../../services/knockdownService");

const { playerPositions } = require("./state");
const { interruptHealing } = require("./utils");
const { persistZoneDamage } = require("./persistence");
const { dropDeathLoot } = require("./drops");
const { completeMatchIfFinished } = require("./lifecycle");

// ==========================================
// TEAMS, KNOCKDOWN AND TEAM WIPE
// ==========================================

// Game mode plus every member's team and alive flag.
async function getMatchTeams(matchId) {
    const [matchResult, membersResult] = await Promise.all([
        supabaseAdmin
            .from("matches")
            .select("status, game_mode")
            .eq("id", matchId)
            .single(),
        supabaseAdmin
            .from("match_players")
            .select("player_id, team_number, is_alive")
            .eq("match_id", matchId)
    ]);

    if (matchResult.error) throw matchResult.error;
    if (membersResult.error) throw membersResult.error;

    return {
        status: matchResult.data.status,
        gameMode: matchResult.data.game_mode,
        members: membersResult.data || []
    };
}

function getTeamNumber(teams, playerId) {
    const member = teams.members.find(
        m => Number(m.player_id) === Number(playerId)
    );
    return member ? member.team_number : null;
}

function areTeammates(teams, a, b) {
    if (teams.gameMode === "solo") return false;

    const teamA = getTeamNumber(teams, a);
    return teamA !== null && teamA === getTeamNumber(teams, b);
}

// A teammate who is alive and not knocked.
function hasStandingTeammate(teams, matchId, playerId) {
    if (teams.gameMode === "solo") return false;

    const team = getTeamNumber(teams, playerId);

    return teams.members.some(m => {
        if (Number(m.player_id) === Number(playerId)) return false;
        if (m.team_number !== team || !m.is_alive) return false;

        const combat = getCombatPlayer(matchId, m.player_id);
        return !combat || (combat.isAlive && !combat.knocked);
    });
}

// Eliminate a knocked player (bleed-out or team wipe),
// crediting whoever knocked them.
async function eliminateKnockedPlayer(io, matchId, playerId, cause) {
    const combat = getCombatPlayer(matchId, playerId);
    if (!combat || !combat.knocked) return false;

    const creditId = combat.knockedBy;

    clearKnock(combat);
    combat.health = 0;
    combat.isAlive = false;

    let saved;

    try {
        saved = await persistZoneDamage(matchId, playerId, 0, true);
    } catch (error) {
        console.error("Knocked elimination sync error:", error.message);
        reportError("Knocked elimination save failed", error, { matchId });
        knockPlayer(combat, creditId);
        combat.isAlive = true;
        return false;
    }

    if (!saved.applied) return false;

    // Credit the kill to the player who knocked them.
    const killer = creditId ? getCombatPlayer(matchId, creditId) : null;

    if (killer) {
        killer.kills++;

        const { error: killError } = await supabaseAdmin
            .from("match_players")
            .update({ kills: killer.kills })
            .eq("match_id", matchId)
            .eq("player_id", creditId);

        if (killError) {
            console.error("Kill credit sync error:", killError.message);
        }
    }

    cancelPlayerReload(matchId, playerId);
    interruptHealing(io, matchId, playerId, "eliminated");

    dropDeathLoot(io, matchId, playerId);

    io.to(`match:${matchId}`).emit("player-eliminated", {
        attackerId: creditId || null,
        victimId: playerId,
        cause,
        weapon: cause === "bled out" ? "Bleed Out" : "Team Wiped",
        totalKills: killer ? killer.kills : undefined,
        alivePlayers: saved.alivePlayers,
        eliminatedPlayers: saved.eliminatedPlayers
    });

    return true;
}

// If every living member of the team is knocked, the
// whole team is out. Returns true if anyone was eliminated.
async function handleTeamWipe(io, matchId, playerId) {
    const teams = await getMatchTeams(matchId);
    if (teams.gameMode === "solo") return false;

    const team = getTeamNumber(teams, playerId);
    const aliveTeammates = teams.members.filter(
        m => m.team_number === team && m.is_alive
    );

    const anyStanding = aliveTeammates.some(m => {
        const combat = getCombatPlayer(matchId, m.player_id);
        return !combat || (combat.isAlive && !combat.knocked);
    });

    if (anyStanding) return false;

    let eliminated = false;

    for (const m of aliveTeammates) {
        if (await eliminateKnockedPlayer(io, matchId, m.player_id, "team wiped")) {
            eliminated = true;
        }
    }

    return eliminated;
}

// Bleed-out tick for every knocked player.
let knockTickRunning = false;

async function processKnockdowns(io) {
    if (knockTickRunning) return;
    knockTickRunning = true;

    try {
        const now = Date.now();
        const affectedMatches = new Set();

        for (const key of playerPositions.keys()) {
            const split = key.lastIndexOf(":");
            const matchId = key.slice(0, split);
            const playerId = Number(key.slice(split + 1));

            const combat = getCombatPlayer(matchId, playerId);
            if (!combat || !combat.isAlive || !combat.knocked) continue;

            const elapsed = combat.lastBleedAt
                ? (now - combat.lastBleedAt) / 1000
                : 1;

            combat.lastBleedAt = now;
            combat.knockHealth = Math.max(
                0,
                combat.knockHealth -
                    KNOCK_CONFIG.bleedPerSecond * Math.min(elapsed, 5)
            );

            io.to(`player:${playerId}`).emit("bleeding", {
                knockHealth: Math.round(combat.knockHealth)
            });

            if (combat.knockHealth <= 0) {
                if (await eliminateKnockedPlayer(io, matchId, playerId, "bled out")) {
                    affectedMatches.add(matchId);
                }
            }
        }

        for (const matchId of affectedMatches) {
            await completeMatchIfFinished(io, matchId);
        }
    } catch (error) {
        console.error("Knockdown tick error:", error.message);
    } finally {
        knockTickRunning = false;
    }
}

module.exports = {
    getMatchTeams,
    getTeamNumber,
    areTeammates,
    hasStandingTeammate,
    eliminateKnockedPlayer,
    handleTeamWipe,
    processKnockdowns
};
