// ==========================================
// INDIAN BATTLE FIELDS
// SOCKET EVENT RATE LIMITING
// ==========================================
// Token bucket per socket and event name. Each event has a
// sustained rate (per second) and a small burst allowance.

const EVENT_LIMITS = {
    "player-move": { perSecond: 25, burst: 10 },
    "fire-weapon": { perSecond: 25, burst: 10 },
    "drop-position-update": { perSecond: 15, burst: 5 },
    "aircraft-position": { perSecond: 15, burst: 5 },
    "pickup-loot": { perSecond: 8, burst: 4 },
    "get-nearby-loot": { perSecond: 4, burst: 2 },
    "use-healing-item": { perSecond: 4, burst: 2 },
    "revive-teammate": { perSecond: 4, burst: 2 },
    "throw-grenade": { perSecond: 4, burst: 2 },
    "deploy-gloo-wall": { perSecond: 4, burst: 2 },
    "join-match": { perSecond: 2, burst: 3 },
    default: { perSecond: 10, burst: 5 }
};

function createSocketRateLimiter() {
    const buckets = new Map();

    return function allow(eventName) {
        const limit = EVENT_LIMITS[eventName] || EVENT_LIMITS.default;
        const now = Date.now();

        let bucket = buckets.get(eventName);

        if (!bucket) {
            bucket = { tokens: limit.perSecond + limit.burst, updatedAt: now };
            buckets.set(eventName, bucket);
        }

        const elapsed = (now - bucket.updatedAt) / 1000;

        bucket.tokens = Math.min(
            limit.perSecond + limit.burst,
            bucket.tokens + elapsed * limit.perSecond
        );
        bucket.updatedAt = now;

        if (bucket.tokens < 1) return false;

        bucket.tokens -= 1;
        return true;
    };
}

module.exports = {
    EVENT_LIMITS,
    createSocketRateLimiter
};
