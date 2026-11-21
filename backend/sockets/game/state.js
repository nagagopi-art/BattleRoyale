// ==========================================
// INDIAN BATTLE FIELDS - sockets/game/state.js
// ==========================================
// Shared in-memory state and settings for live matches.

const { DROP_CONFIG } = require("../../services/parachuteService");

const playerPositions = new Map();

const matchFlights = new Map();

const matchDropStarted = new Set();

const lastMovementTimes = new Map();

const MOVEMENT_CONFIG = {
    MIN_INTERVAL_MS: 50,
    MAX_MOVEMENT_DISTANCE: 30,
    // Horizontal speed limits (units per second). Elapsed
    // time is capped at 1s so pauses cannot bank distance.
    MAX_SPEED_PER_SECOND: 12,
    KNOCKED_SPEED_PER_SECOND: 3,
    SPEED_TOLERANCE: 2,
    // Players only receive movement of others within this
    // distance (less traffic, no map-wide wallhack data).
    VISIBILITY_RANGE: 400,
    // Positions are written to the database in batches.
    POSITION_FLUSH_MS: 2000,
    MAX_WORLD_BOUNDARY: 1000,
    MAX_VERTICAL_BOUNDARY: 2000,
    // How far away loot is listed to a player (get-nearby-loot).
    LOOT_SEARCH_DISTANCE: 120
};

function getPlayerKey(matchId, playerId) {
    return `${matchId}:${playerId}`;
}

// ==========================================
// GROUND MOVEMENT RULES (AFTER LANDING)
// ==========================================
// There is no terrain height map yet, so the ground is
// flat at landing altitude, with room for buildings.

const GROUND_CONFIG = {
    GROUND_LEVEL: DROP_CONFIG.landingAltitude,
    MAX_HEIGHT_ABOVE_GROUND: 40,
    MAX_STEP_UP: 3
};

// ==========================================
// CRASH RECOVERY (MATCH STATE SNAPSHOTS)
// ==========================================

const SNAPSHOT_INTERVAL_MS = 10000;

const restoredMatches = new Set();

// ==========================================
// DISCONNECT GRACE PERIOD
// ==========================================

// How long a disconnected player has to come back before
// being eliminated. RECONNECT_GRACE_MS overrides (tests).
const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS) > 0
    ? Number(process.env.RECONNECT_GRACE_MS)
    : 90000;

const disconnectTimers = new Map(); // "match:player" -> timeout

// The Socket.IO server, set once by initializeGameSocket().
let gameIo = null;

function setGameIo(io) {
    gameIo = io;
}

function getGameIo() {
    return gameIo;
}

// Which map (layout) each live match uses, for collision.
const matchMaps = new Map(); // matchId -> map name

function setMatchMapName(matchId, mapName) {
    if (matchId && mapName) matchMaps.set(matchId, mapName);
}

function getMatchMapName(matchId) {
    return matchMaps.get(matchId) || null;
}

module.exports = {
    matchMaps,
    setMatchMapName,
    getMatchMapName,
    playerPositions,
    matchFlights,
    matchDropStarted,
    lastMovementTimes,
    MOVEMENT_CONFIG,
    getPlayerKey,
    GROUND_CONFIG,
    SNAPSHOT_INTERVAL_MS,
    restoredMatches,
    RECONNECT_GRACE_MS,
    disconnectTimers,
    setGameIo,
    getGameIo
};
