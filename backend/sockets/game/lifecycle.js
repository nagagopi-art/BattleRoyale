// ==========================================
// INDIAN BATTLE FIELDS - sockets/game/lifecycle.js
// ==========================================
// Match completion and freeing a finished match's memory.

const { finalizeMatch, getFinalMatchResults } = require("../../services/matchCompletionService");
const { removeMatchDrops } = require("../../services/parachuteService");
const { removeMatchLoot } = require("../../services/lootService");
const { applyMatchProgression } = require("../../services/progressionService");
const { reportError } = require("../../services/errorReporter");
const { clearMatchAntiCheat } = require("../../services/antiCheatService");
const { clearMatchGroups } = require("../../services/partyService");
const { deleteMatchSnapshot } = require("../../services/matchStateService");
const { removeMatchInventories } = require("../../services/inventoryService");
const { removeMatchCombat } = require("../../services/combatService");
const { removeThrowableMatch } = require("../../services/throwableService");
const { removeMatchHealing } = require("../../services/healingService");
const { removeMatchRevives } = require("../../services/knockdownService");
const { removeZone } = require("../../services/safeZoneService");
const { dirtyPositions } = require("./persistence");
const { removeMatchMode } = require("./modes");
const { getMatchLeftovers } = require("../../services/storeService");

const {
    playerPositions,
    matchFlights,
    matchDropStarted,
    lastMovementTimes,
    restoredMatches,
    disconnectTimers,
    matchMaps
} = require("./state");

// ==========================================
// CLEAN UP ALL IN-MEMORY STATE FOR A MATCH
// ==========================================

function cleanupCompletedMatch(matchId) {
    if (!matchId) {
        return false;
    }

    removeMatchCombat(matchId);
    removeMatchInventories(matchId);
    removeMatchLoot(matchId);
    removeMatchDrops(matchId);
    removeThrowableMatch(matchId);
    removeZone(matchId);
    removeMatchHealing(matchId);
    removeMatchRevives(matchId);
    clearMatchDisconnectTimers(matchId);
    clearMatchGroups(matchId);
    clearMatchAntiCheat(matchId);
    removeMatchMode(matchId);
    restoredMatches.delete(matchId);
    matchMaps.delete(matchId);

    deleteMatchSnapshot(matchId).catch(error =>
        console.error("Snapshot delete error:", error.message)
    );

    const prefix = `${matchId}:`;

    for (const key of playerPositions.keys()) {
        if (key.startsWith(prefix)) {
            playerPositions.delete(key);
        }
    }

    for (const key of lastMovementTimes.keys()) {
        if (key.startsWith(prefix)) {
            lastMovementTimes.delete(key);
        }
    }

    // Pending position saves are no longer needed.
    for (const key of dirtyPositions.keys()) {
        if (key.startsWith(prefix)) {
            dirtyPositions.delete(key);
        }
    }

    const flight = matchFlights.get(matchId);
    if (flight?.ejectTimer) clearTimeout(flight.ejectTimer);

    matchFlights.delete(matchId);
    matchDropStarted.delete(matchId);

    console.log("MATCH MEMORY CLEANUP COMPLETED:", matchId);

    return true;
}

function clearMatchDisconnectTimers(matchId) {
    const prefix = `${matchId}:`;

    for (const [key, timer] of disconnectTimers.entries()) {
        if (key.startsWith(prefix)) {
            clearTimeout(timer);
            disconnectTimers.delete(key);
        }
    }
}

// ==========================================
// AUTOMATIC MATCH COMPLETION (SHARED)
// ==========================================
// Called after any elimination (gun, grenade, zone).
// warnPlayerId: who to notify if completion fails (optional).

async function completeMatchIfFinished(io, matchId, warnPlayerId = null) {
    try {
        const completion = await finalizeMatch(matchId);

        if (!completion.completed) return false;

        const finalResults = await getFinalMatchResults(matchId);

        // Unspent match coins go to each player's account.
        const leftoverCoins = getMatchLeftovers(matchId);

        io.to(`match:${matchId}`).emit("match-completed", {
            success: true,
            matchId: matchId,
            winnerTeam: completion.winnerTeam,
            winnerPlayerId: completion.winnerPlayerId,
            resultsRecorded: completion.resultsRecorded,
            results: finalResults,
            message: "Battle completed successfully"
        });

        cleanupCompletedMatch(matchId);

        console.log(
            "MATCH COMPLETED:",
            matchId,
            "Winner:",
            completion.winnerPlayerId
        );

        // Levels and coins (runs after XP was awarded).
        applyMatchProgression(matchId, { leftoverCoins })
            .then(summary => {
                for (const entry of summary) {
                    io.to(`player:${entry.playerId}`).emit(
                        "progression-updated",
                        { matchId, ...entry }
                    );
                }
            })
            .catch(error =>
                console.error("Progression error:", error.message)
            );

        return true;

    } catch (completionError) {
        console.error(
            "Match completion error:",
            completionError.message
        );
        reportError("Match completion failed", completionError, { matchId });

        if (warnPlayerId) {
            io.to(`player:${warnPlayerId}`).emit("match-completion-warning", {
                success: false,
                message: "Player elimination saved, but match completion needs attention"
            });
        }

        return false;
    }
}

module.exports = {
    cleanupCompletedMatch,
    clearMatchDisconnectTimers,
    completeMatchIfFinished
};
