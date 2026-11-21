// ==========================================
// INDIAN BATTLE FIELDS - sockets/game/recovery.js
// ==========================================
// Crash recovery: saving and restoring match snapshots.

const { hasMatchLoot } = require("../../services/lootService");
const {
    saveMatchSnapshot,
    loadMatchSnapshot,
    applySnapshot
} = require("../../services/matchStateService");
const { getZone, getActiveZones } = require("../../services/safeZoneService");

const {
    playerPositions,
    matchFlights,
    matchDropStarted,
    getPlayerKey,
    restoredMatches
} = require("./state");
const { isValidPosition, hasLocalPlayers } = require("./utils");
const { cleanupCompletedMatch } = require("./lifecycle");
const { ejectRemainingPlayers } = require("./aircraft");

let snapshotRunning = false;

function getSnapshotExtras(matchId) {
    const prefix = `${matchId}:`;
    const positions = {};

    for (const [key, position] of playerPositions.entries()) {
        if (key.startsWith(prefix)) {
            positions[key.slice(prefix.length)] = position;
        }
    }

    const flight = matchFlights.get(matchId);

    return {
        positions,
        flight: flight
            ? {
                flightPath: flight.flightPath,
                startedAt: flight.startedAt,
                durationMs: flight.durationMs
            }
            : null,
        dropStarted: matchDropStarted.has(matchId)
    };
}

async function saveAllMatchSnapshots() {
    if (snapshotRunning) return;
    snapshotRunning = true;

    try {
        const matchIds = new Set([
            ...getActiveZones().map(zone => zone.matchId),
            ...matchFlights.keys()
        ]);

        for (const matchId of matchIds) {
            // Only the server hosting the match saves it.
            if (!hasLocalPlayers(matchId)) continue;

            const saved = await saveMatchSnapshot(matchId, getSnapshotExtras(matchId));

            // The match was deleted from the database: drop
            // its in-memory state instead of saving it forever.
            if (saved === "match-gone") {
                cleanupCompletedMatch(matchId);
            }
        }
    } catch (error) {
        console.error("Snapshot loop error:", error.message);
    } finally {
        snapshotRunning = false;
    }
}

// After a restart, rebuild a live match from its snapshot
// the first time anyone rejoins it.
async function restoreMatchIfNeeded(io, match) {
    const matchId = match.id;

    if (
        match.status !== "in_progress" ||
        restoredMatches.has(matchId) ||
        hasMatchLoot(matchId) ||
        getZone(matchId)
    ) {
        return false;
    }

    restoredMatches.add(matchId);

    const state = await loadMatchSnapshot(matchId);
    if (!state) return false;

    const extras = applySnapshot(matchId, state);

    for (const [playerId, position] of Object.entries(extras.positions)) {
        const key = getPlayerKey(matchId, playerId);
        if (!playerPositions.has(key) && isValidPosition(position)) {
            playerPositions.set(key, position);
        }
    }

    if (extras.dropStarted) {
        matchDropStarted.add(matchId);
    }

    if (extras.flight && !matchFlights.has(matchId)) {
        const remaining = Math.max(
            0,
            extras.flight.startedAt + extras.flight.durationMs - Date.now()
        );

        const ejectTimer = setTimeout(() => {
            ejectRemainingPlayers(io, matchId).catch(error =>
                console.error("Aircraft eject error:", error.message)
            );
        }, remaining);

        matchFlights.set(matchId, { ...extras.flight, ejectTimer });
    }

    console.log("MATCH STATE RESTORED FROM SNAPSHOT:", matchId);

    return true;
}

module.exports = {
    getSnapshotExtras,
    saveAllMatchSnapshots,
    restoreMatchIfNeeded
};
