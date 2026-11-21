// ==========================================
// INDIAN BATTLE FIELDS - sockets/game/utils.js
// ==========================================
// Small helpers: validation, positions, errors, knock/heal interrupts.

const { getCombatPlayer } = require("../../services/combatService");
const { getGlooWalls, getGlooWallBox } = require("../../services/throwableService");
const { cancelHealing } = require("../../services/healingService");
const { cancelRevivesFor } = require("../../services/knockdownService");

const {
    playerPositions,
    MOVEMENT_CONFIG,
    getPlayerKey,
    GROUND_CONFIG
} = require("./state");
const { getGameIo } = require("./state");

// Cancel an in-progress heal or revive involving this
// player and tell those affected why.
function interruptHealing(io, matchId, playerId, reason) {
    const cancelled = cancelHealing(matchId, playerId);

    if (cancelled && io) {
        io.to(`player:${playerId}`).emit("healing-cancelled", {
            itemId: cancelled.itemId,
            reason
        });
    }

    for (const revive of cancelRevivesFor(matchId, playerId)) {
        if (!io) continue;

        for (const id of [revive.reviverId, revive.targetId]) {
            io.to(`player:${id}`).emit("revive-cancelled", {
                reviverId: revive.reviverId,
                targetId: revive.targetId,
                reason
            });
        }
    }

    return cancelled;
}

// Gloo walls as bullet obstacles: oriented wall panels.
function getGlooWallObstacles(matchId) {
    return getGlooWalls(matchId).map(wall => ({
        id: wall.id,
        box: getGlooWallBox(wall)
    }));
}

function validateGroundMovement(oldPosition, newPosition) {
    if (newPosition.y < GROUND_CONFIG.GROUND_LEVEL) {
        return { success: false, message: "Cannot move below ground" };
    }

    if (
        newPosition.y >
        GROUND_CONFIG.GROUND_LEVEL + GROUND_CONFIG.MAX_HEIGHT_ABOVE_GROUND
    ) {
        return { success: false, message: "Cannot move that high" };
    }

    if (
        oldPosition &&
        newPosition.y - oldPosition.y > GROUND_CONFIG.MAX_STEP_UP
    ) {
        return { success: false, message: "Cannot climb that fast" };
    }

    return { success: true };
}

// ==========================================
// AIRCRAFT: EJECT PLAYERS WHO NEVER JUMPED
// ==========================================

function getFlightDurationMs(flightPath) {
    const dx = flightPath.end.x - flightPath.start.x;
    const dz = flightPath.end.z - flightPath.start.z;
    const speed = flightPath.speed > 0 ? flightPath.speed : 90;

    return Math.ceil((Math.sqrt(dx * dx + dz * dz) / speed) * 1000);
}

function isValidPosition(position) {
    if (!position) return false;

    const { x, y, z } = position;

    return (
        Number.isFinite(x) &&
        Number.isFinite(y) &&
        Number.isFinite(z) &&
        Math.abs(x) <= MOVEMENT_CONFIG.MAX_WORLD_BOUNDARY &&
        y >= -10 &&
        y <= MOVEMENT_CONFIG.MAX_VERTICAL_BOUNDARY &&
        Math.abs(z) <= MOVEMENT_CONFIG.MAX_WORLD_BOUNDARY
    );
}

function calculateDistance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;

    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function isValidMatchId(matchId) {
    return (
        typeof matchId === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(matchId)
    );
}

function emitError(socket, message) {
    socket.emit("game-error", {
        success: false,
        message
    });
}

// ==========================================
// SPECTATING
// ==========================================

function getSpectateRoom(matchId, playerId) {
    return `spectate:${matchId}:${playerId}`;
}

// Does this server process have any player of the match
// connected? Background work (zone damage, time-limit end,
// snapshots) only runs where the match is actually being
// played, so a second server sharing the same database never
// overwrites or ends a match it is not hosting.
function hasLocalPlayers(matchId) {
    const room = getGameIo()?.sockets?.adapter?.rooms?.get(`match:${matchId}`);
    return Boolean(room && room.size > 0);
}

// Knocked players can only crawl and be revived.
function rejectIfKnocked(socket, matchId, playerId) {
    const combat = getCombatPlayer(matchId, playerId);

    if (combat && combat.knocked) {
        emitError(socket, "You are knocked down");
        return true;
    }

    return false;
}

function getPosition(matchId, playerId) {
    return playerPositions.get(
        getPlayerKey(matchId, playerId)
    ) || null;
}

function isValidPlayerId(value) {
    return (
        (typeof value === "number" || typeof value === "string") &&
        String(value).trim() !== "" &&
        Number.isSafeInteger(Number(value)) &&
        Number(value) > 0
    );
}

function isValidDirection(direction) {
    return (
        direction &&
        Number.isFinite(direction.x) &&
        Number.isFinite(direction.y) &&
        Number.isFinite(direction.z)
    );
}

module.exports = {
    validateGroundMovement,
    getFlightDurationMs,
    isValidPosition,
    calculateDistance,
    isValidMatchId,
    emitError,
    getSpectateRoom,
    hasLocalPlayers,
    rejectIfKnocked,
    getPosition,
    isValidPlayerId,
    isValidDirection,
    interruptHealing,
    getGlooWallObstacles
};
