const crypto = require("crypto");

const {
    normalizeYaw,
    segmentIntersectsBox
} = require("./geometry");

const throwableMatches = new Map();

const THROWABLE_CONFIG = {
    frag: {
        damage: 100,
        radius: 12,
        fuseMs: 3000,
        maxCount: 3
    },
    smoke: {
        radius: 8,
        fuseMs: 2000,
        durationMs: 15000,
        maxCount: 3
    },
    flash: {
        radius: 10,
        fuseMs: 1500,
        durationMs: 4000,
        maxCount: 3
    }
};

const GLOO_CONFIG = {
    maxWallsPerPlayer: 3,
    maxDistance: 8,
    maxHealth: 500,
    lifetimeMs: 30000,

    // Wall panel size. `facing` (degrees) is the direction
    // the wall's face points; the panel spans sideways.
    width: 4,
    height: 3,
    thickness: 0.5
};

// Oriented box for a wall placed at ground `position`.
function getGlooWallBox(wall) {
    return {
        center: {
            x: wall.position.x,
            y: wall.position.y + GLOO_CONFIG.height / 2,
            z: wall.position.z
        },
        halfExtents: {
            x: GLOO_CONFIG.width / 2,
            y: GLOO_CONFIG.height / 2,
            z: GLOO_CONFIG.thickness / 2
        },
        yaw: wall.facing
    };
}

// Maximum each player can carry (grenades use maxCount).
const THROWABLE_CARRY_LIMITS = {
    frag: THROWABLE_CONFIG.frag.maxCount,
    smoke: THROWABLE_CONFIG.smoke.maxCount,
    flash: THROWABLE_CONFIG.flash.maxCount,
    gloo: 6
};

const THROWABLE_NAMES = {
    frag: "Frag Grenade",
    smoke: "Smoke Grenade",
    flash: "Flash Grenade",
    gloo: "Gloo Wall"
};

function getMatch(matchId) {
    if (!throwableMatches.has(matchId)) {
        throwableMatches.set(matchId, {
            grenades: new Map(),
            glooWalls: new Map(),
            smokeClouds: new Map(),
            flashedUntil: new Map(),
            inventory: new Map()
        });
    }

    return throwableMatches.get(matchId);
}

// Throwables every player starts a match with. Set these
// to 0 to make throwables loot-only.
const STARTING_THROWABLES = {
    frag: 2,
    smoke: 1,
    flash: 1,
    gloo: 3
};

// Maximum distance from the thrower to the landing point.
const MAX_THROW_DISTANCE = 40;

function getInventory(matchId, playerId) {
    const match = getMatch(matchId);

    if (!match.inventory.has(String(playerId))) {
        match.inventory.set(String(playerId), { ...STARTING_THROWABLES });
    }

    return match.inventory.get(String(playerId));
}

function getDistance(a, b) {
    return Math.sqrt(
        Math.pow(a.x - b.x, 2) +
        Math.pow(a.y - b.y, 2) +
        Math.pow(a.z - b.z, 2)
    );
}

function throwGrenade(matchId, playerId, type, position, target) {
    const config = THROWABLE_CONFIG[type];

    if (!config) {
        return { success: false, message: "Invalid grenade type" };
    }

    if (
        !position ||
        !target ||
        !Number.isFinite(position.x) ||
        !Number.isFinite(position.y) ||
        !Number.isFinite(position.z) ||
        !Number.isFinite(target.x) ||
        !Number.isFinite(target.y) ||
        !Number.isFinite(target.z)
    ) {
        return { success: false, message: "Invalid throw position" };
    }

    const inventory = getInventory(matchId, playerId);

    if (inventory[type] <= 0) {
        return { success: false, message: "No grenades remaining" };
    }

    if (getDistance(position, target) > MAX_THROW_DISTANCE) {
        return { success: false, message: "Throw distance exceeded" };
    }

    inventory[type]--;

    const grenade = {
        id: crypto.randomUUID(),
        matchId,
        playerId,
        type,
        position: { ...target },
        createdAt: Date.now(),
        explodesAt: Date.now() + config.fuseMs
    };

    getMatch(matchId).grenades.set(grenade.id, grenade);

    return {
        success: true,
        grenade,
        inventory: { ...inventory }
    };
}

function resolveGrenade(matchId, grenadeId) {
    const match = getMatch(matchId);
    const grenade = match.grenades.get(grenadeId);

    if (!grenade) {
        return { success: false, message: "Grenade not found" };
    }

    if (Date.now() < grenade.explodesAt) {
        return { success: false, message: "Grenade fuse is active" };
    }

    match.grenades.delete(grenadeId);

    const config = THROWABLE_CONFIG[grenade.type];

    return {
        success: true,
        grenadeId,
        type: grenade.type,
        position: grenade.position,
        radius: config.radius,
        damage: grenade.type === "frag" ? config.damage : 0,
        durationMs: config.durationMs || 0
    };
}

function deployGlooWall(matchId, playerId, position, facing) {
    if (!position || facing === undefined || facing === null) {
        return { success: false, message: "Invalid wall position" };
    }

    const match = getMatch(matchId);
    const inventory = getInventory(matchId, playerId);

    if (inventory.gloo <= 0) {
        return { success: false, message: "No gloo walls remaining" };
    }

    if (
        !Number.isFinite(position.x) ||
        !Number.isFinite(position.y) ||
        !Number.isFinite(position.z) ||
        !Number.isFinite(facing)
    ) {
        return { success: false, message: "Invalid placement coordinates" };
    }

    const playerWalls = [...match.glooWalls.values()].filter(
        wall => String(wall.playerId) === String(playerId)
    );

    if (playerWalls.length >= GLOO_CONFIG.maxWallsPerPlayer) {
        return { success: false, message: "Maximum active gloo walls reached" };
    }

    const wall = {
        id: crypto.randomUUID(),
        matchId,
        playerId,
        position: { ...position },
        facing: normalizeYaw(facing),
        size: {
            width: GLOO_CONFIG.width,
            height: GLOO_CONFIG.height,
            thickness: GLOO_CONFIG.thickness
        },
        health: GLOO_CONFIG.maxHealth,
        createdAt: Date.now(),
        expiresAt: Date.now() + GLOO_CONFIG.lifetimeMs
    };

    match.glooWalls.set(wall.id, wall);
    inventory.gloo--;

    return {
        success: true,
        wall,
        inventory: { ...inventory }
    };
}

function damageGlooWall(matchId, wallId, damage) {
    const match = getMatch(matchId);
    const wall = match.glooWalls.get(wallId);

    if (!wall || !Number.isFinite(damage) || damage <= 0) {
        return { success: false, message: "Invalid wall or damage" };
    }

    wall.health = Math.max(0, wall.health - damage);

    if (wall.health === 0) {
        match.glooWalls.delete(wallId);
    }

    return {
        success: true,
        destroyed: wall.health === 0,
        wall
    };
}

function getGlooWalls(matchId) {
    const match = getMatch(matchId);
    const now = Date.now();

    for (const [id, wall] of match.glooWalls.entries()) {
        if (wall.expiresAt <= now) {
            match.glooWalls.delete(id);
        }
    }

    return [...match.glooWalls.values()];
}

// Linear falloff: full damage at the centre, ~0 at the edge.
function getExplosionDamage(baseDamage, radius, distance) {
    if (
        !Number.isFinite(baseDamage) ||
        !Number.isFinite(radius) ||
        !Number.isFinite(distance) ||
        radius <= 0 ||
        distance > radius
    ) {
        return 0;
    }

    return Math.max(1, Math.round(baseDamage * (1 - distance / radius)));
}

// Shortest distance from point p to the segment a-b.
function distancePointToSegment(p, a, b) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const lengthSq = abx * abx + aby * aby + abz * abz;

    let t = 0;

    if (lengthSq > 0) {
        t = ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / lengthSq;
        t = Math.max(0, Math.min(1, t));
    }

    return getDistance(p, {
        x: a.x + abx * t,
        y: a.y + aby * t,
        z: a.z + abz * t
    });
}

// Returns the gloo wall shielding the target from the blast, if any.
// Explosions are traced from just above the blast point to
// the target's chest, through the wall panel's box.
function findBlockingGlooWall(matchId, explosionPosition, targetPosition) {
    const from = {
        x: explosionPosition.x,
        y: explosionPosition.y + 0.5,
        z: explosionPosition.z
    };

    const to = {
        x: targetPosition.x,
        y: targetPosition.y + 1.0,
        z: targetPosition.z
    };

    let nearest = null;
    let nearestT = Infinity;

    for (const wall of getGlooWalls(matchId)) {
        const t = segmentIntersectsBox(from, to, getGlooWallBox(wall));

        if (t !== null && t < nearestT) {
            nearest = wall;
            nearestT = t;
        }
    }

    return nearest;
}

// Add picked-up throwables, capped at the carry limit.
function addThrowable(matchId, playerId, type, quantity = 1) {
    const limit = THROWABLE_CARRY_LIMITS[type];

    if (limit === undefined) {
        return { success: false, message: "Invalid throwable type" };
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
        return { success: false, message: "Invalid throwable quantity" };
    }

    const inventory = getInventory(matchId, playerId);
    const space = limit - inventory[type];

    if (space <= 0) {
        return {
            success: false,
            message: `${THROWABLE_NAMES[type]} limit reached`
        };
    }

    const addedQuantity = Math.min(quantity, space);
    inventory[type] += addedQuantity;

    return {
        success: true,
        type,
        addedQuantity,
        inventory: { ...inventory }
    };
}

// ==========================================
// SMOKE CLOUDS
// ==========================================
// A cloud is a sphere centred 2m above where the
// smoke grenade landed. It blocks line of sight.

const SMOKE_CENTER_HEIGHT = 2;
const EYE_HEIGHT = 1.5;

function addSmokeCloud(matchId, explosion) {
    const config = THROWABLE_CONFIG.smoke;
    const now = Date.now();

    const cloud = {
        id: explosion.grenadeId || crypto.randomUUID(),
        matchId,
        position: { ...explosion.position },
        center: {
            x: explosion.position.x,
            y: explosion.position.y + SMOKE_CENTER_HEIGHT,
            z: explosion.position.z
        },
        radius: config.radius,
        createdAt: now,
        expiresAt: now + config.durationMs
    };

    getMatch(matchId).smokeClouds.set(cloud.id, cloud);

    return cloud;
}

function getSmokeClouds(matchId) {
    const match = throwableMatches.get(matchId);
    if (!match) return [];

    const now = Date.now();

    for (const [id, cloud] of match.smokeClouds.entries()) {
        if (cloud.expiresAt <= now) {
            match.smokeClouds.delete(id);
        }
    }

    return [...match.smokeClouds.values()];
}

// True when smoke blocks the view between two players
// (eye to eye), including when either is inside a cloud.
function isLineOfSightBlocked(matchId, fromPosition, toPosition) {
    const clouds = getSmokeClouds(matchId);
    if (clouds.length === 0) return false;

    const isVector = p =>
        p &&
        Number.isFinite(p.x) &&
        Number.isFinite(p.y) &&
        Number.isFinite(p.z);

    if (!isVector(fromPosition) || !isVector(toPosition)) return false;

    const fromEye = { ...fromPosition, y: fromPosition.y + EYE_HEIGHT };
    const toEye = { ...toPosition, y: toPosition.y + EYE_HEIGHT };

    return clouds.some(cloud =>
        distancePointToSegment(cloud.center, fromEye, toEye) <= cloud.radius
    );
}

// ==========================================
// FLASH BLINDNESS
// ==========================================
// Facing direction is not known to the server, so blind
// time depends on distance: full duration at the centre,
// 25% of it at the edge of the radius.

const FLASH_MIN_FRACTION = 0.25;

function getFlashDuration(distance) {
    const config = THROWABLE_CONFIG.flash;

    if (!Number.isFinite(distance) || distance > config.radius) {
        return 0;
    }

    const fraction = 1 - (1 - FLASH_MIN_FRACTION) * (distance / config.radius);

    return Math.round(config.durationMs * fraction);
}

// Blind a player; a longer flash replaces a shorter one.
function flashPlayer(matchId, playerId, durationMs) {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return null;

    const match = getMatch(matchId);
    const key = String(playerId);
    const until = Date.now() + durationMs;

    if ((match.flashedUntil.get(key) || 0) < until) {
        match.flashedUntil.set(key, until);
    }

    return match.flashedUntil.get(key);
}

function isPlayerFlashed(matchId, playerId) {
    const match = throwableMatches.get(matchId);
    if (!match) return false;

    const key = String(playerId);
    const until = match.flashedUntil.get(key);

    if (!until) return false;

    if (until <= Date.now()) {
        match.flashedUntil.delete(key);
        return false;
    }

    return true;
}

// Remove throwables to drop them on the ground.
// Returns loot items (empty array if none).
function takeThrowablesForDrop(matchId, playerId, type = null, quantity = null) {
    const match = throwableMatches.get(matchId);
    const inventory = match?.inventory.get(String(playerId));
    if (!inventory) return [];

    const types = type ? [type] : Object.keys(THROWABLE_CARRY_LIMITS);
    const items = [];

    for (const t of types) {
        const have = inventory[t] || 0;
        if (have <= 0) continue;

        const amount = Number.isInteger(quantity) && quantity > 0
            ? Math.min(have, quantity)
            : have;

        inventory[t] = have - amount;

        items.push({
            itemType: "throwable",
            itemId: t,
            name: THROWABLE_NAMES[t],
            quantity: amount
        });
    }

    return items;
}

function getThrowableInventory(matchId, playerId) {
    return { ...getInventory(matchId, playerId) };
}

function removeThrowablePlayer(matchId, playerId) {
    const match = throwableMatches.get(matchId);

    if (!match) return false;

    match.inventory.delete(String(playerId));

    for (const [id, item] of match.grenades.entries()) {
        if (String(item.playerId) === String(playerId)) {
            match.grenades.delete(id);
        }
    }

    for (const [id, wall] of match.glooWalls.entries()) {
        if (String(wall.playerId) === String(playerId)) {
            match.glooWalls.delete(id);
        }
    }

    return true;
}

// Snapshot: inventories, gloo walls and smoke clouds.
// Grenades in flight are not saved (their timers are lost
// on restart anyway).
function exportThrowableMatch(matchId) {
    const match = throwableMatches.get(matchId);
    if (!match) return null;

    return {
        inventory: Object.fromEntries(match.inventory),
        glooWalls: [...match.glooWalls.values()],
        smokeClouds: [...match.smokeClouds.values()]
    };
}

function importThrowableMatch(matchId, data) {
    if (!data) return;

    const match = getMatch(matchId);

    for (const [playerId, counts] of Object.entries(data.inventory || {})) {
        match.inventory.set(String(playerId), { ...counts });
    }

    for (const wall of data.glooWalls || []) {
        match.glooWalls.set(wall.id, { ...wall });
    }

    for (const cloud of data.smokeClouds || []) {
        match.smokeClouds.set(cloud.id, { ...cloud });
    }
}

function removeThrowableMatch(matchId) {
    return throwableMatches.delete(matchId);
}

module.exports = {
    THROWABLE_CONFIG,
    GLOO_CONFIG,
    THROWABLE_CARRY_LIMITS,
    THROWABLE_NAMES,
    STARTING_THROWABLES,
    MAX_THROW_DISTANCE,
    getGlooWallBox,
    addThrowable,
    throwGrenade,
    resolveGrenade,
    deployGlooWall,
    damageGlooWall,
    getGlooWalls,
    getExplosionDamage,
    findBlockingGlooWall,
    addSmokeCloud,
    getSmokeClouds,
    isLineOfSightBlocked,
    getFlashDuration,
    flashPlayer,
    isPlayerFlashed,
    takeThrowablesForDrop,
    getThrowableInventory,
    removeThrowablePlayer,
    removeThrowableMatch,
    exportThrowableMatch,
    importThrowableMatch
};
