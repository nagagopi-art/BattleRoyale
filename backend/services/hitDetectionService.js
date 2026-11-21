
const { WEAPONS } = require("../config/weapons");
const { segmentIntersectsBox } = require("./geometry");

// ==========================================
// BHARAT BATTLEGROUNDS HIT DETECTION
// ==========================================

const HIT_CONFIG = {
    MAX_WORLD_BOUNDARY: 1000,
    MAX_SHOOTING_DISTANCE: 500,
    MAX_VERTICAL_DISTANCE: 200,
    MIN_HITBOX_HEIGHT: 1.7,
    PLAYER_RADIUS: 0.35,
    HITBOXES: {
        head: {
            minY: 1.45,
            maxY: 1.85,
            radius: 0.22,
            damageMultiplier: 2.0
        },
        body: {
            minY: 0.65,
            maxY: 1.45,
            radius: 0.35,
            damageMultiplier: 1.0
        },
        legs: {
            minY: 0.0,
            maxY: 0.65,
            radius: 0.30,
            damageMultiplier: 0.75
        }
    }
};

// ==========================================
// VECTOR HELPERS
// ==========================================

function isValidVector(vector) {
    return (
        vector &&
        Number.isFinite(vector.x) &&
        Number.isFinite(vector.y) &&
        Number.isFinite(vector.z)
    );
}

function subtractVectors(a, b) {
    return {
        x: a.x - b.x,
        y: a.y - b.y,
        z: a.z - b.z
    };
}

function dotProduct(a, b) {
    return (
        a.x * b.x +
        a.y * b.y +
        a.z * b.z
    );
}

function vectorLength(vector) {
    return Math.sqrt(dotProduct(vector, vector));
}

function normalizeVector(vector) {
    const length = vectorLength(vector);

    if (length === 0) return null;

    return {
        x: vector.x / length,
        y: vector.y / length,
        z: vector.z / length
    };
}

// ==========================================
// DISTANCE
// ==========================================

function calculateDistance(a, b) {
    if (!isValidVector(a) || !isValidVector(b)) {
        return Infinity;
    }

    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;

    return Math.sqrt(
        dx * dx +
        dy * dy +
        dz * dz
    );
}

// ==========================================
// WORLD VALIDATION
// ==========================================

function isInsideWorld(position) {
    if (!isValidVector(position)) return false;

    return (
        Math.abs(position.x) <= HIT_CONFIG.MAX_WORLD_BOUNDARY &&
        Math.abs(position.z) <= HIT_CONFIG.MAX_WORLD_BOUNDARY &&
        position.y >= 0 &&
        position.y <= HIT_CONFIG.MAX_VERTICAL_DISTANCE
    );
}

// ==========================================
// PLAYER HITBOX
// ==========================================

function getPlayerHitboxes(playerPosition) {
    if (!isInsideWorld(playerPosition)) {
        return null;
    }

    const hitboxes = {};

    for (const [location, config] of Object.entries(
        HIT_CONFIG.HITBOXES
    )) {
        hitboxes[location] = {
            center: {
                x: playerPosition.x,
                y: playerPosition.y +
                    (config.minY + config.maxY) / 2,
                z: playerPosition.z
            },
            radius: config.radius,
            minY: playerPosition.y + config.minY,
            maxY: playerPosition.y + config.maxY,
            damageMultiplier: config.damageMultiplier
        };
    }

    return hitboxes;
}

// ==========================================
// POINT TO RAY DISTANCE
// ==========================================

function pointToRayDistance(origin, direction, point) {
    const toPoint = subtractVectors(point, origin);

    const projection = dotProduct(toPoint, direction);

    if (projection < 0) {
        return {
            distance: Infinity,
            projection
        };
    }

    const closestPoint = {
        x: origin.x + direction.x * projection,
        y: origin.y + direction.y * projection,
        z: origin.z + direction.z * projection
    };

    return {
        distance: calculateDistance(closestPoint, point),
        projection
    };
}

// ==========================================
// RAY HIT DETECTION
// ==========================================

function detectHit(origin, direction, targetPosition, maxDistance) {
    if (
        !isInsideWorld(origin) ||
        !isInsideWorld(targetPosition) ||
        !isValidVector(direction)
    ) {
        return {
            hit: false,
            message: "Invalid shooting coordinates"
        };
    }

    const normalizedDirection = normalizeVector(direction);

    if (!normalizedDirection) {
        return {
            hit: false,
            message: "Invalid shooting direction"
        };
    }

    const range = Number.isFinite(maxDistance)
        ? Math.min(maxDistance, HIT_CONFIG.MAX_SHOOTING_DISTANCE)
        : HIT_CONFIG.MAX_SHOOTING_DISTANCE;

    if (range <= 0) {
        return {
            hit: false,
            message: "Invalid weapon range"
        };
    }

    const distanceToTarget = calculateDistance(
        origin,
        targetPosition
    );

    if (distanceToTarget > range) {
        return {
            hit: false,
            message: "Target outside weapon range"
        };
    }

    const hitboxes = getPlayerHitboxes(targetPosition);

    if (!hitboxes) {
        return {
            hit: false,
            message: "Invalid target hitboxes"
        };
    }

    let closestHit = null;

    for (const [location, hitbox] of Object.entries(hitboxes)) {

        const result = pointToRayDistance(
            origin,
            normalizedDirection,
            hitbox.center
        );

        if (
            result.distance <= hitbox.radius &&
            result.projection <= range
        ) {
            if (
                !closestHit ||
                result.projection < closestHit.distance
            ) {
                closestHit = {
                    hit: true,
                    hitLocation: location,
                    distance: result.projection,
                    damageMultiplier: hitbox.damageMultiplier
                };
            }
        }
    }

    if (!closestHit) {
        return {
            hit: false,
            message: "Shot missed"
        };
    }

    return {
        success: true,
        ...closestHit,
        targetDistance: distanceToTarget
    };
}

// ==========================================
// WEAPON RANGE VALIDATION
// ==========================================

function validateWeaponRange(weaponId, distance) {
    const weapon = WEAPONS[weaponId];

    if (!weapon) {
        return {
            success: false,
            message: "Weapon not found"
        };
    }

    if (!Number.isFinite(distance) || distance < 0) {
        return {
            success: false,
            message: "Invalid shooting distance"
        };
    }

    const maxRange =
        weapon.range || HIT_CONFIG.MAX_SHOOTING_DISTANCE;

    if (distance > maxRange) {
        return {
            success: false,
            message: "Target outside weapon range",
            maxRange,
            distance
        };
    }

    return {
        success: true,
        maxRange,
        distance
    };
}

// ==========================================
// OBSTACLE (GLOO WALL) BLOCKING
// ==========================================
// Obstacles are oriented boxes: { id, box } where box is
// { center, halfExtents, yaw } (see services/geometry.js).
// Returns the nearest obstacle the ray enters before
// maxDistance, or null.

function findBlockingObstacle(origin, direction, obstacles, maxDistance) {
    if (!Array.isArray(obstacles) || obstacles.length === 0) {
        return null;
    }

    const normalizedDirection = normalizeVector(direction);

    if (!normalizedDirection || !Number.isFinite(maxDistance) || maxDistance <= 0) {
        return null;
    }

    const end = {
        x: origin.x + normalizedDirection.x * maxDistance,
        y: origin.y + normalizedDirection.y * maxDistance,
        z: origin.z + normalizedDirection.z * maxDistance
    };

    let nearest = null;

    for (const obstacle of obstacles) {
        if (!obstacle || !obstacle.box) continue;

        const t = segmentIntersectsBox(origin, end, obstacle.box);

        if (t === null) continue;

        const distance = t * maxDistance;

        if (!nearest || distance < nearest.distance) {
            nearest = { id: obstacle.id, distance };
        }
    }

    return nearest;
}

// ==========================================
// FULL HIT VALIDATION
// ==========================================

function validateShot({
    shooterPosition,
    targetPosition,
    origin,
    direction,
    weaponId,
    maxRange,
    obstacles
}) {
    if (!isInsideWorld(shooterPosition)) {
        return {
            success: false,
            message: "Invalid shooter position"
        };
    }

    if (!isInsideWorld(targetPosition)) {
        return {
            success: false,
            message: "Invalid target position"
        };
    }

    if (!isValidVector(origin) || !isValidVector(direction)) {
        return {
            success: false,
            message: "Invalid shot origin or direction"
        };
    }

    const shooterToTarget = calculateDistance(
        shooterPosition,
        targetPosition
    );

    // maxRange: attachment-adjusted range (scopes) when given.
    const weaponValidation = Number.isFinite(maxRange) && maxRange > 0
        ? (shooterToTarget > maxRange
            ? {
                success: false,
                message: "Target outside weapon range",
                maxRange,
                distance: shooterToTarget
            }
            : { success: true, maxRange, distance: shooterToTarget })
        : validateWeaponRange(weaponId, shooterToTarget);

    if (!weaponValidation.success) {
        return weaponValidation;
    }

    // Prevent clients from firing from a location
    // unrelated to their server-maintained position.
    const originDistance = calculateDistance(
        shooterPosition,
        origin
    );

    if (originDistance > 3) {
        return {
            success: false,
            message: "Shot origin does not match player position"
        };
    }

    const hit = detectHit(
        origin,
        direction,
        targetPosition,
        weaponValidation.maxRange
    );

    // A gloo wall in front of the target (or in front of
    // a missed shot, within weapon range) stops the bullet.
    const blockingObstacle = findBlockingObstacle(
        origin,
        direction,
        obstacles,
        hit.hit ? hit.distance : weaponValidation.maxRange
    );

    if (blockingObstacle) {
        return {
            success: true,
            hit: false,
            blocked: true,
            obstacleId: blockingObstacle.id,
            message: "Shot blocked by gloo wall",
            distance: shooterToTarget
        };
    }

    if (!hit.hit) {
        return {
            success: true,
            hit: false,
            message: hit.message,
            distance: shooterToTarget
        };
    }

    return {
        success: true,
        hit: true,
        hitLocation: hit.hitLocation,
        damageMultiplier: hit.damageMultiplier,
        distance: shooterToTarget,
        weaponId
    };
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
    HIT_CONFIG,
    calculateDistance,
    isInsideWorld,
    getPlayerHitboxes,
    detectHit,
    findBlockingObstacle,
    validateWeaponRange,
    validateShot
};
