// ==========================================
// INDIAN BATTLE FIELDS
// ANTI-CHEAT SUSPICION TRACKING
// ==========================================
// Records suspicious behaviour per player per match and
// logs a warning when it crosses a threshold. It does not
// punish anyone by itself; it gives evidence for review.

const ANTI_CHEAT_CONFIG = {
    // Aim snap: direction change larger than this between two
    // shots fired within snapWindowMs.
    snapAngleDegrees: 90,
    snapWindowMs: 150,
    // Log when a player reaches these counts (and every
    // multiple of them afterwards).
    warnThreshold: 5
};

const lastAim = new Map();     // key -> { direction, at }
const violations = new Map();  // key -> { type -> count }

function key(matchId, playerId) {
    return `${matchId}:${playerId}`;
}

function recordViolation(matchId, playerId, type, detail = "") {
    const k = key(matchId, playerId);
    const counts = violations.get(k) || {};

    counts[type] = (counts[type] || 0) + 1;
    violations.set(k, counts);

    if (counts[type] % ANTI_CHEAT_CONFIG.warnThreshold === 0) {
        console.warn(
            "ANTI-CHEAT:",
            `player ${playerId} in match ${matchId}`,
            `${type} x${counts[type]}`,
            detail
        );
    }

    return counts[type];
}

function angleBetween(a, b) {
    const la = Math.hypot(a.x, a.y, a.z);
    const lb = Math.hypot(b.x, b.y, b.z);
    if (!la || !lb) return 0;

    const cos = (a.x * b.x + a.y * b.y + a.z * b.z) / (la * lb);
    return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

// Call for every shot with the client's aim direction.
function recordAim(matchId, playerId, direction, now = Date.now()) {
    const k = key(matchId, playerId);
    const previous = lastAim.get(k);

    lastAim.set(k, { direction: { ...direction }, at: now });

    if (!previous || now - previous.at > ANTI_CHEAT_CONFIG.snapWindowMs) {
        return false;
    }

    const angle = angleBetween(previous.direction, direction);

    if (angle > ANTI_CHEAT_CONFIG.snapAngleDegrees) {
        recordViolation(
            matchId,
            playerId,
            "aim-snap",
            `${Math.round(angle)} deg in ${now - previous.at}ms`
        );
        return true;
    }

    return false;
}

function getViolations(matchId, playerId) {
    return { ...(violations.get(key(matchId, playerId)) || {}) };
}

function clearMatchAntiCheat(matchId) {
    const prefix = `${matchId}:`;

    for (const k of [...lastAim.keys()]) {
        if (k.startsWith(prefix)) lastAim.delete(k);
    }

    for (const k of [...violations.keys()]) {
        if (k.startsWith(prefix)) violations.delete(k);
    }
}

module.exports = {
    ANTI_CHEAT_CONFIG,
    recordAim,
    recordViolation,
    getViolations,
    clearMatchAntiCheat
};
