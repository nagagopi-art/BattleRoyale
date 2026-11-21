// ==========================================
// INDIAN BATTLE FIELDS
// KNOCKDOWN & REVIVE (DUO / SQUAD)
// ==========================================
// Knock state lives on the combat player object:
//   combat.knocked, combat.knockHealth, combat.knockedBy
// Revive timers live here. Persistence and events are
// handled in the socket layer.

const KNOCK_CONFIG = {
    knockHealth: 100,
    bleedPerSecond: 3,
    reviveMs: 8000,
    reviveHealth: 25,
    reviveRange: 2.5,
    // Knocked players crawl: max distance per movement update.
    crawlMaxStep: 7.5
};

const activeRevives = new Map(); // key: match:reviver

function getKey(matchId, playerId) {
    return `${matchId}:${playerId}`;
}

function knockPlayer(combat, attackerId) {
    combat.health = 0;
    combat.knocked = true;
    combat.knockHealth = KNOCK_CONFIG.knockHealth;
    combat.knockedBy = attackerId ?? null;
    combat.knockedAt = Date.now();
}

function clearKnock(combat) {
    combat.knocked = false;
    combat.knockHealth = 0;
    combat.knockedBy = null;
    combat.knockedAt = null;
}

function isKnocked(combat) {
    return Boolean(combat && combat.knocked);
}

// Start reviving `targetId`. onComplete runs after reviveMs
// unless cancelled.
function startRevive(matchId, reviverId, targetId, onComplete) {
    const key = getKey(matchId, reviverId);

    if (activeRevives.has(key)) {
        return { success: false, message: "Already reviving" };
    }

    for (const revive of activeRevives.values()) {
        if (
            revive.matchId === matchId &&
            String(revive.targetId) === String(targetId)
        ) {
            return { success: false, message: "Teammate is already being revived" };
        }
    }

    const startedAt = Date.now();

    const timer = setTimeout(() => {
        activeRevives.delete(key);
        onComplete();
    }, KNOCK_CONFIG.reviveMs);

    activeRevives.set(key, {
        matchId,
        reviverId,
        targetId,
        startedAt,
        endsAt: startedAt + KNOCK_CONFIG.reviveMs,
        timer
    });

    return {
        success: true,
        targetId,
        durationMs: KNOCK_CONFIG.reviveMs,
        endsAt: startedAt + KNOCK_CONFIG.reviveMs
    };
}

// Cancel every revive this player is part of (as reviver
// or as the knocked target). Returns the cancelled revives.
function cancelRevivesFor(matchId, playerId) {
    const cancelled = [];

    for (const [key, revive] of activeRevives.entries()) {
        if (
            revive.matchId === matchId &&
            (String(revive.reviverId) === String(playerId) ||
                String(revive.targetId) === String(playerId))
        ) {
            clearTimeout(revive.timer);
            activeRevives.delete(key);
            cancelled.push({
                reviverId: revive.reviverId,
                targetId: revive.targetId
            });
        }
    }

    return cancelled;
}

function removeMatchRevives(matchId) {
    for (const [key, revive] of activeRevives.entries()) {
        if (revive.matchId === matchId) {
            clearTimeout(revive.timer);
            activeRevives.delete(key);
        }
    }
}

module.exports = {
    KNOCK_CONFIG,
    knockPlayer,
    clearKnock,
    isKnocked,
    startRevive,
    cancelRevivesFor,
    removeMatchRevives
};
