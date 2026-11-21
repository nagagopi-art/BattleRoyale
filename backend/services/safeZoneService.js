// ==========================================
// INDIAN BATTLE FIELDS
// SAFE ZONE (SHRINKING CIRCLE)
// ==========================================
// Pure zone logic: no database or socket code.
// All times are milliseconds. Distances use the
// horizontal plane (x, z) only.

const zones = new Map();

// Speed up all zone timings for testing, e.g. 0.05.
const TIME_SCALE = (() => {
    const value = Number(process.env.SAFE_ZONE_TIME_SCALE);
    return Number.isFinite(value) && value > 0 ? value : 1;
})();

const ZONE_CONFIG = {
    // After the final circle closes, the match is forced
    // to end once this much extra time has passed.
    finalGraceMs: 120000,

    // The first circle covers the whole battlefield
    // (corners of a 2000 x 2000 map are ~1414 from centre).
    startCenter: { x: 0, z: 0 },
    startRadius: 1500,

    // Each phase: wait, then shrink to `radius`.
    // damagePerSecond applies to anyone outside the
    // circle during that phase.
    phases: [
        { waitMs: 90000, shrinkMs: 60000, radius: 800, damagePerSecond: 1 },
        { waitMs: 60000, shrinkMs: 50000, radius: 450, damagePerSecond: 2 },
        { waitMs: 50000, shrinkMs: 40000, radius: 250, damagePerSecond: 4 },
        { waitMs: 40000, shrinkMs: 30000, radius: 120, damagePerSecond: 6 },
        { waitMs: 30000, shrinkMs: 25000, radius: 50, damagePerSecond: 9 },
        { waitMs: 25000, shrinkMs: 20000, radius: 15, damagePerSecond: 12 },
        { waitMs: 20000, shrinkMs: 20000, radius: 0, damagePerSecond: 20 }
    ]
};

function scaled(ms) {
    return Math.max(1000, Math.round(ms * TIME_SCALE));
}

// Pick a centre for the next circle so that it lies
// completely inside the current circle.
function pickNextCenter(center, currentRadius, nextRadius) {
    const maxOffset = Math.max(0, currentRadius - nextRadius);
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.sqrt(Math.random()) * maxOffset;

    return {
        x: Number((center.x + Math.cos(angle) * distance).toFixed(2)),
        z: Number((center.z + Math.sin(angle) * distance).toFixed(2))
    };
}

function beginPhase(zone, phaseIndex, now) {
    const phase = ZONE_CONFIG.phases[phaseIndex];

    zone.phaseIndex = phaseIndex;
    zone.fromCenter = { ...zone.currentCenter };
    zone.fromRadius = zone.currentRadius;
    zone.nextRadius = phase.radius;
    zone.nextCenter = pickNextCenter(
        zone.currentCenter,
        zone.currentRadius,
        phase.radius
    );
    zone.damagePerSecond = phase.damagePerSecond;
    zone.waitEndsAt = now + scaled(phase.waitMs);
    zone.shrinkEndsAt = zone.waitEndsAt + scaled(phase.shrinkMs);
}

function createZone(matchId, now = Date.now()) {
    if (!matchId) {
        return { success: false, message: "Match ID required" };
    }

    if (zones.has(matchId)) {
        return { success: true, created: false, zone: zones.get(matchId) };
    }

    const zone = {
        matchId,
        startedAt: now,
        finished: false,
        currentCenter: { ...ZONE_CONFIG.startCenter },
        currentRadius: ZONE_CONFIG.startRadius
    };

    beginPhase(zone, 0, now);
    zones.set(matchId, zone);

    return { success: true, created: true, zone };
}

function getZone(matchId) {
    return zones.get(matchId) || null;
}

// Advance the zone to `now`. Returns true when a new
// phase started (so callers can announce it).
function updateZone(zone, now = Date.now()) {
    let phaseChanged = false;

    while (!zone.finished) {
        if (now < zone.waitEndsAt) {
            zone.state = "waiting";
            zone.currentCenter = { ...zone.fromCenter };
            zone.currentRadius = zone.fromRadius;
            break;
        }

        if (now < zone.shrinkEndsAt) {
            const t = (now - zone.waitEndsAt) /
                (zone.shrinkEndsAt - zone.waitEndsAt);

            zone.state = "shrinking";
            zone.currentCenter = {
                x: zone.fromCenter.x + (zone.nextCenter.x - zone.fromCenter.x) * t,
                z: zone.fromCenter.z + (zone.nextCenter.z - zone.fromCenter.z) * t
            };
            zone.currentRadius =
                zone.fromRadius + (zone.nextRadius - zone.fromRadius) * t;
            break;
        }

        // Shrink finished.
        zone.currentCenter = { ...zone.nextCenter };
        zone.currentRadius = zone.nextRadius;

        const nextIndex = zone.phaseIndex + 1;

        if (nextIndex >= ZONE_CONFIG.phases.length) {
            zone.finished = true;
            zone.finishedAt = zone.shrinkEndsAt;
            zone.state = "final";
            phaseChanged = true;
            break;
        }

        beginPhase(zone, nextIndex, zone.shrinkEndsAt);
        phaseChanged = true;
    }

    return phaseChanged;
}

function isOutsideZone(zone, position) {
    if (
        !position ||
        !Number.isFinite(position.x) ||
        !Number.isFinite(position.z)
    ) {
        return false;
    }

    const dx = position.x - zone.currentCenter.x;
    const dz = position.z - zone.currentCenter.z;

    return Math.sqrt(dx * dx + dz * dz) > zone.currentRadius;
}

// Snapshot sent to clients.
function getZoneState(zone) {
    return {
        matchId: zone.matchId,
        phase: zone.phaseIndex + 1,
        totalPhases: ZONE_CONFIG.phases.length,
        state: zone.state || "waiting",
        current: {
            center: {
                x: Number(zone.currentCenter.x.toFixed(2)),
                z: Number(zone.currentCenter.z.toFixed(2))
            },
            radius: Number(zone.currentRadius.toFixed(2))
        },
        next: zone.finished
            ? null
            : {
                center: { ...zone.nextCenter },
                radius: zone.nextRadius
            },
        shrinkStartsAt: zone.finished ? null : zone.waitEndsAt,
        shrinkEndsAt: zone.finished ? null : zone.shrinkEndsAt,
        damagePerSecond: zone.damagePerSecond,
        serverTime: Date.now()
    };
}

// True once the final circle has closed and the grace
// period has passed: the match must be ended.
function isMatchOvertime(zone, now = Date.now()) {
    return Boolean(
        zone.finished &&
        zone.finishedAt &&
        now >= zone.finishedAt + scaled(ZONE_CONFIG.finalGraceMs)
    );
}

function getActiveZones() {
    return [...zones.values()];
}

function exportZone(matchId) {
    const zone = zones.get(matchId);
    return zone ? JSON.parse(JSON.stringify(zone)) : null;
}

// Restores a zone exactly where it was (same phase and
// timings), so the circle continues after a restart.
function importZone(matchId, data) {
    if (!data || zones.has(matchId)) return;

    const zone = JSON.parse(JSON.stringify(data));
    delete zone.lastDamageAt;
    delete zone.lastStatusCheckAt;
    delete zone.forceEnding;

    zones.set(matchId, zone);
}

function removeZone(matchId) {
    return zones.delete(matchId);
}

module.exports = {
    ZONE_CONFIG,
    createZone,
    getZone,
    updateZone,
    isOutsideZone,
    getZoneState,
    isMatchOvertime,
    getActiveZones,
    exportZone,
    importZone,
    removeZone
};
