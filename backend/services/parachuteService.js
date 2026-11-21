
const DROP_CONFIG = {
    aircraftAltitude: 1500,
    aircraftSpeed: 90,
    parachuteDeployAltitude: 500,
    autoParachuteAltitude: 100,
    landingAltitude: 5,
    maxDropDistance: 2000,
    worldBoundary: 1000,
    maxHorizontalStep: 100,
    maxVerticalStep: 200
};

const activeDrops = new Map();

// ==========================================
// GENERATE AIRCRAFT FLIGHT PATH
// ==========================================

function generateFlightPath(mapName) {
    const direction = Math.random() < 0.5 ? 1 : -1;

    const startX = direction * -900;
    const endX = direction * 900;

    const startZ = Math.random() * 800 - 400;
    const endZ = Math.random() * 800 - 400;

    return {
        mapName,
        start: {
            x: startX,
            y: DROP_CONFIG.aircraftAltitude,
            z: startZ
        },
        end: {
            x: endX,
            y: DROP_CONFIG.aircraftAltitude,
            z: endZ
        },
        speed: DROP_CONFIG.aircraftSpeed
    };
}

// ==========================================
// GET AIRCRAFT POSITION
// ==========================================

function getAircraftPosition(flightPath, progress) {
    const t = Math.max(0, Math.min(1, progress));

    return {
        x: flightPath.start.x +
            (flightPath.end.x - flightPath.start.x) * t,

        y: DROP_CONFIG.aircraftAltitude,

        z: flightPath.start.z +
            (flightPath.end.z - flightPath.start.z) * t
    };
}

// ==========================================
// PLAYER JUMP
// ==========================================

function jumpFromAircraft(matchId, playerId, aircraftPosition) {
    const key = `${matchId}:${playerId}`;

    if (activeDrops.has(key)) {
        return {
            success: false,
            message: "Player has already jumped"
        };
    }

    if (
        !aircraftPosition ||
        !Number.isFinite(aircraftPosition.x) ||
        !Number.isFinite(aircraftPosition.y) ||
        !Number.isFinite(aircraftPosition.z) ||
        Math.abs(aircraftPosition.x) > DROP_CONFIG.worldBoundary ||
        Math.abs(aircraftPosition.z) > DROP_CONFIG.worldBoundary ||
        aircraftPosition.y !== DROP_CONFIG.aircraftAltitude
    ) {
        return {
            success: false,
            message: "Invalid aircraft position"
        };
    }

    const drop = {
        success: true,
        matchId,
        playerId,
        state: "falling",
        position: {
            x: aircraftPosition.x,
            y: aircraftPosition.y,
            z: aircraftPosition.z
        },
        parachuteDeployed: false,
        startedAt: Date.now()
    };

    activeDrops.set(key, drop);

    return drop;
}

// ==========================================
// PARACHUTE DEPLOYMENT
// ==========================================

function deployParachute(matchId, playerId) {
    const key = `${matchId}:${playerId}`;
    const drop = activeDrops.get(key);

    if (!drop) {
        return {
            success: false,
            message: "Player has not jumped"
        };
    }

    if (drop.state !== "falling") {
        return {
            success: false,
            message: "Player cannot deploy parachute now"
        };
    }

    if (
        drop.position.y >
        DROP_CONFIG.parachuteDeployAltitude
    ) {
        return {
            success: false,
            message: "Player is too high to deploy parachute"
        };
    }

    drop.parachuteDeployed = true;
    drop.state = "parachuting";

    activeDrops.set(key, drop);

    return {
        success: true,
        ...drop
    };
}

// ==========================================
// UPDATE DESCENT POSITION
// ==========================================

function updateDropPosition(matchId, playerId, position) {
    const key = `${matchId}:${playerId}`;
    const drop = activeDrops.get(key);

    if (!drop) {
        return {
            success: false,
            message: "Active drop not found"
        };
    }

    if (!["falling", "parachuting"].includes(drop.state)) {
        return {
            success: false,
            message: "Player has already landed"
        };
    }

    if (
        !position ||
        !Number.isFinite(position.x) ||
        !Number.isFinite(position.y) ||
        !Number.isFinite(position.z)
    ) {
        return {
            success: false,
            message: "Invalid position"
        };
    }

    if (
        Math.abs(position.x) > DROP_CONFIG.worldBoundary ||
        Math.abs(position.z) > DROP_CONFIG.worldBoundary ||
        position.y < 0 ||
        position.y > DROP_CONFIG.aircraftAltitude
    ) {
        return {
            success: false,
            message: "Position outside battlefield boundaries"
        };
    }

    // Prevent upward movement during descent.
    if (position.y > drop.position.y) {
        return {
            success: false,
            message: "Player cannot move upward during descent"
        };
    }

    // Check horizontal movement.
    const horizontalDistance = Math.hypot(
        position.x - drop.position.x,
        position.z - drop.position.z
    );

    if (horizontalDistance > DROP_CONFIG.maxHorizontalStep) {
        return {
            success: false,
            message: "Drop movement is too fast"
        };
    }

    // Check vertical movement.
    const verticalDistance = drop.position.y - position.y;

    if (verticalDistance > DROP_CONFIG.maxVerticalStep) {
        return {
            success: false,
            message: "Descent movement is too fast"
        };
    }

    // Save accepted position.
    drop.position = {
        x: position.x,
        y: position.y,
        z: position.z
    };

    // Automatic emergency parachute deployment.
    if (
        drop.position.y <= DROP_CONFIG.autoParachuteAltitude &&
        !drop.parachuteDeployed
    ) {
        drop.parachuteDeployed = true;
        drop.state = "parachuting";
    }

    // Detect landing.
    if (drop.position.y <= DROP_CONFIG.landingAltitude) {
        drop.position.y = DROP_CONFIG.landingAltitude;
        drop.state = "landed";
    }

    activeDrops.set(key, drop);

    return {
        success: true,
        ...drop
    };
}

// ==========================================
// GET PLAYER DROP STATUS
// ==========================================

function getDropStatus(matchId, playerId) {
    const key = `${matchId}:${playerId}`;

    return activeDrops.get(key) || null;
}

// ==========================================
// PLACE A PLAYER ON THE GROUND (no drop)
// ==========================================
// Clash Squad and Team Deathmatch start on the ground: a
// "landed" record turns on the normal ground movement rules.

function markLanded(matchId, playerId, position) {
    const drop = {
        success: true,
        matchId,
        playerId,
        state: "landed",
        position: { x: position.x, y: DROP_CONFIG.landingAltitude, z: position.z },
        parachuteDeployed: false,
        startedAt: Date.now()
    };
    activeDrops.set(`${matchId}:${playerId}`, drop);
    return drop;
}

// ==========================================
// REMOVE PLAYER DROP
// ==========================================

function removeDrop(matchId, playerId) {
    const key = `${matchId}:${playerId}`;

    activeDrops.delete(key);
}

// ==========================================
// REMOVE ALL DROPS FOR A MATCH
// ==========================================

function removeMatchDrops(matchId) {
    if (!matchId) {
        return false;
    }

    const prefix = `${matchId}:`;
    let removed = false;

    for (const key of activeDrops.keys()) {
        if (key.startsWith(prefix)) {
            activeDrops.delete(key);
            removed = true;
        }
    }

    return removed;
}

// ==========================================
// MATCH STATE SNAPSHOT (CRASH RECOVERY)
// ==========================================

function exportMatchDrops(matchId) {
    const prefix = `${matchId}:`;
    const result = {};

    for (const [key, drop] of activeDrops.entries()) {
        if (key.startsWith(prefix)) {
            result[key.slice(prefix.length)] = { ...drop, position: { ...drop.position } };
        }
    }

    return result;
}

function importMatchDrops(matchId, data) {
    for (const [playerId, drop] of Object.entries(data || {})) {
        activeDrops.set(`${matchId}:${playerId}`, {
            ...drop,
            position: { ...drop.position }
        });
    }
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
    generateFlightPath,
    getAircraftPosition,
    jumpFromAircraft,
    deployParachute,
    updateDropPosition,
    getDropStatus,
    markLanded,
    removeDrop,
    removeMatchDrops,
    exportMatchDrops,
    importMatchDrops,
    DROP_CONFIG
};
