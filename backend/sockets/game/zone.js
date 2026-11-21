// ==========================================
// INDIAN BATTLE FIELDS - sockets/game/zone.js
// ==========================================
// Safe zone ticks, zone damage and the match time limit.

const { supabaseAdmin } = require("../../config/supabase");
const { reportError } = require("../../services/errorReporter");
const { getCombatPlayer, cancelPlayerReload } = require("../../services/combatService");
const { clearKnock } = require("../../services/knockdownService");
const {
    createZone,
    updateZone,
    isOutsideZone,
    getZoneState,
    isMatchOvertime,
    getActiveZones,
    removeZone
} = require("../../services/safeZoneService");

const { playerPositions } = require("./state");
const {
    getSpectateRoom,
    hasLocalPlayers,
    getPosition,
    interruptHealing
} = require("./utils");
const { persistZoneDamage } = require("./persistence");
const { dropDeathLoot } = require("./drops");
const { completeMatchIfFinished } = require("./lifecycle");
const { getMatchTeams, handleTeamWipe } = require("./teams");
const { getGameIo } = require("./state");

let zoneTickRunning = false;

const ZONE_STATUS_CHECK_MS = 15000;

// Start the shrinking zone for a match (no-op if running).
function startSafeZone(matchId) {
    const result = createZone(matchId);

    if (result.success && result.created && getGameIo()) {
        updateZone(result.zone);
        getGameIo().to(`match:${matchId}`).emit(
            "zone-update",
            getZoneState(result.zone)
        );

        console.log("SAFE ZONE STARTED:", matchId);
    }

    return result;
}

// Time limit reached: eliminate disconnected players, then
// the weakest players, until a single team remains.
async function forceEndMatch(io, matchId) {
    const teams = await getMatchTeams(matchId);
    if (teams.status !== "in_progress") return;

    const alive = teams.members.filter(m => m.is_alive);

    const eliminate = async (playerId, cause) => {
        const combat = getCombatPlayer(matchId, playerId);

        if (combat) {
            clearKnock(combat);
            combat.health = 0;
            combat.isAlive = false;
        }

        const saved = await persistZoneDamage(matchId, playerId, 0, true);
        if (!saved.applied) return;

        interruptHealing(io, matchId, playerId, "eliminated");

        dropDeathLoot(io, matchId, playerId);

        io.to(`match:${matchId}`).emit("player-eliminated", {
            attackerId: null,
            victimId: playerId,
            cause,
            weapon: "Time Limit",
            alivePlayers: saved.alivePlayers,
            eliminatedPlayers: saved.eliminatedPlayers
        });
    };

    const teamKey = m => (teams.gameMode === "solo" ? m.player_id : m.team_number);
    const aliveTeams = () => new Set(alive.map(teamKey)).size;

    // 1. Players with no live state (never connected / left).
    for (const m of [...alive]) {
        if (aliveTeams() <= 1) break;

        const combat = getCombatPlayer(matchId, m.player_id);
        const position = getPosition(matchId, m.player_id);

        if (!combat || !position) {
            await eliminate(m.player_id, "disconnected at time limit");
            alive.splice(alive.indexOf(m), 1);
        }
    }

    // 2. Lowest health first (knocked players count as 0).
    alive.sort((a, b) => {
        const ca = getCombatPlayer(matchId, a.player_id);
        const cb = getCombatPlayer(matchId, b.player_id);
        const ha = ca?.knocked ? 0 : ca?.health ?? 0;
        const hb = cb?.knocked ? 0 : cb?.health ?? 0;
        return ha - hb;
    });

    while (aliveTeams() > 1 && alive.length > 0) {
        const weakest = alive.shift();
        await eliminate(weakest.player_id, "time limit");
    }

    await completeMatchIfFinished(io, matchId);
}

async function processZone(io, zone) {
    const matchId = zone.matchId;
    const now = Date.now();

    // Periodically confirm the match is still running.
    if (
        !zone.lastStatusCheckAt ||
        now - zone.lastStatusCheckAt >= ZONE_STATUS_CHECK_MS
    ) {
        zone.lastStatusCheckAt = now;

        const { data: match } = await supabaseAdmin
            .from("matches")
            .select("status")
            .eq("id", matchId)
            .maybeSingle();

        if (!match || match.status !== "in_progress") {
            removeZone(matchId);
            return;
        }
    }

    if (updateZone(zone, now)) {
        io.to(`match:${matchId}`).emit("zone-update", getZoneState(zone));
    }

    // Not hosted here (no players connected to this server):
    // keep the circle's timing but never damage or end it.
    if (!hasLocalPlayers(matchId)) {
        zone.lastDamageAt = now;
        return;
    }

    // Time limit: force a result after the final circle.
    if (isMatchOvertime(zone, now)) {
        if (!zone.forceEnding) {
            zone.forceEnding = true;

            try {
                await forceEndMatch(io, matchId);
            } finally {
                zone.forceEnding = false;
            }
        }

        return;
    }

    const elapsedSeconds = zone.lastDamageAt
        ? (now - zone.lastDamageAt) / 1000
        : 1;

    zone.lastDamageAt = now;

    const damage = Math.max(
        1,
        Math.round(zone.damagePerSecond * Math.min(elapsedSeconds, 5))
    );

    // Living players in this match, and who is outside.
    const prefix = `${matchId}:`;
    const alive = [];

    for (const [key, position] of playerPositions.entries()) {
        if (!key.startsWith(prefix)) continue;

        const playerId = Number(key.slice(prefix.length));
        const combat = getCombatPlayer(matchId, playerId);

        // Knocked players are handled by the bleed-out tick.
        if (!combat || !combat.isAlive || combat.knocked) continue;

        alive.push({
            playerId,
            combat,
            outside: isOutsideZone(zone, position)
        });
    }

    const outside = alive.filter(p => p.outside);
    if (outside.length === 0) return;

    // The zone must never eliminate the last player alive.
    const lethal = outside.filter(p => p.combat.health <= damage);
    let spared = null;

    if (lethal.length > 0 && lethal.length >= alive.length) {
        spared = lethal.reduce((best, p) =>
            p.combat.health > best.combat.health ? p : best
        );
    }

    let anyEliminated = false;

    for (const target of outside) {
        const { playerId, combat } = target;
        const previousHealth = combat.health;

        let newHealth = Math.max(0, previousHealth - damage);

        if (target === spared && newHealth === 0) {
            newHealth = Math.min(previousHealth, 1);
        }

        if (newHealth === previousHealth) continue;

        const eliminated = newHealth === 0;

        combat.health = newHealth;
        if (eliminated) combat.isAlive = false;

        let saved;

        try {
            saved = await persistZoneDamage(
                matchId,
                playerId,
                newHealth,
                eliminated
            );
        } catch (error) {
            console.error("Zone damage sync error:", error.message);
            reportError("Zone damage save failed", error, { matchId });
            combat.health = previousHealth;
            combat.isAlive = true;
            continue;
        }

        if (!saved.applied) {
            // Database says this player is already out.
            combat.isAlive = false;
            continue;
        }

        interruptHealing(io, matchId, playerId, "zone damage");

        io.to(`player:${playerId}`).to(getSpectateRoom(matchId, playerId)).emit("zone-damage", {
            damage: previousHealth - newHealth,
            health: newHealth,
            eliminated
        });

        if (eliminated) {
            anyEliminated = true;
            cancelPlayerReload(matchId, playerId);

            dropDeathLoot(io, matchId, playerId);

            io.to(`match:${matchId}`).emit("player-eliminated", {
                attackerId: null,
                victimId: playerId,
                cause: "zone",
                weapon: "Safe Zone",
                alivePlayers: saved.alivePlayers,
                eliminatedPlayers: saved.eliminatedPlayers
            });

            // Knocked teammates left with nobody standing.
            try {
                await handleTeamWipe(io, matchId, playerId);
            } catch (error) {
                console.error("Zone team wipe error:", error.message);
            }
        }
    }

    if (anyEliminated) {
        await completeMatchIfFinished(io, matchId);
    }
}

async function processSafeZones(io) {
    if (zoneTickRunning) return;
    zoneTickRunning = true;

    try {
        for (const zone of getActiveZones()) {
            try {
                await processZone(io, zone);
            } catch (error) {
                console.error(
                    "Safe zone tick error:",
                    zone.matchId,
                    error.message
                );
            }
        }
    } finally {
        zoneTickRunning = false;
    }
}

module.exports = {
    ZONE_STATUS_CHECK_MS,
    startSafeZone,
    forceEndMatch,
    processZone,
    processSafeZones
};
