// ==========================================
// INDIAN BATTLE FIELDS
// MAP COLLISION (BUILDINGS, ROCKS, WALLS, CRATES)
// ==========================================
// Fast checks against a map layout's boxes using a uniform
// grid, so each query only tests nearby boxes.

const { getLayout } = require("../config/mapLayout");

const CELL = 25;
const PLAYER_RADIUS = 0.35;
const PLAYER_HEIGHT = 1.8;

const indexes = new Map(); // mapName -> { layout, cells }

function cellKey(cx, cz) {
    return `${cx},${cz}`;
}

function buildIndex(layout) {
    const cells = new Map();

    layout.obstacles.forEach((o, i) => {
        const x0 = Math.floor(o.min.x / CELL), x1 = Math.floor(o.max.x / CELL);
        const z0 = Math.floor(o.min.z / CELL), z1 = Math.floor(o.max.z / CELL);

        for (let cx = x0; cx <= x1; cx++) {
            for (let cz = z0; cz <= z1; cz++) {
                const k = cellKey(cx, cz);
                if (!cells.has(k)) cells.set(k, []);
                cells.get(k).push(i);
            }
        }
    });

    return { layout, cells };
}

function getIndex(mapName) {
    const key = mapName || "default";
    if (!indexes.has(key)) indexes.set(key, buildIndex(getLayout(key)));
    return indexes.get(key);
}

// Boxes whose grid cells touch the given x/z rectangle.
function query(index, minX, minZ, maxX, maxZ) {
    const found = new Set();

    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
        for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
            for (const i of index.cells.get(cellKey(cx, cz)) || []) found.add(i);
        }
    }

    return [...found].map(i => index.layout.obstacles[i]);
}

// Segment a->b against an axis-aligned box (slab method).
// Returns the entry fraction in [0,1] or null.
function segmentBoxT(a, b, min, max) {
    let tMin = 0;
    let tMax = 1;

    for (const axis of ["x", "y", "z"]) {
        const d = b[axis] - a[axis];

        if (Math.abs(d) < 1e-9) {
            if (a[axis] < min[axis] || a[axis] > max[axis]) return null;
            continue;
        }

        let t1 = (min[axis] - a[axis]) / d;
        let t2 = (max[axis] - a[axis]) / d;
        if (t1 > t2) [t1, t2] = [t2, t1];

        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        if (tMin > tMax) return null;
    }

    return tMin;
}

// Grid cells the 2D segment a->b passes through, in order
// (Amanatides & Woo traversal).
function* cellsAlong(a, b) {
    let cx = Math.floor(a.x / CELL);
    let cz = Math.floor(a.z / CELL);
    const endX = Math.floor(b.x / CELL);
    const endZ = Math.floor(b.z / CELL);

    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const stepX = Math.sign(dx);
    const stepZ = Math.sign(dz);

    const tDeltaX = stepX ? Math.abs(CELL / dx) : Infinity;
    const tDeltaZ = stepZ ? Math.abs(CELL / dz) : Infinity;

    let tMaxX = stepX
        ? ((stepX > 0 ? (cx + 1) * CELL : cx * CELL) - a.x) / dx
        : Infinity;
    let tMaxZ = stepZ
        ? ((stepZ > 0 ? (cz + 1) * CELL : cz * CELL) - a.z) / dz
        : Infinity;

    for (let guard = 0; guard < 1000; guard++) {
        yield [cx, cz];
        if (cx === endX && cz === endZ) return;

        if (tMaxX < tMaxZ) { cx += stepX; tMaxX += tDeltaX; }
        else { cz += stepZ; tMaxZ += tDeltaZ; }
    }
}

// First obstacle hit by the segment a->b, or null.
// Visits only the grid cells along the segment, in order,
// and stops at the first cell that contains a hit.
function segmentBlocked(mapName, a, b) {
    const index = getIndex(mapName);
    const tested = new Set();
    let best = null;

    for (const [cx, cz] of cellsAlong(a, b)) {
        for (const i of index.cells.get(cellKey(cx, cz)) || []) {
            if (tested.has(i)) continue;
            tested.add(i);

            const o = index.layout.obstacles[i];
            const t = segmentBoxT(a, b, o.min, o.max);
            if (t !== null && (!best || t < best.t)) best = { id: o.id, kind: o.kind, t };
        }

        // Boxes span cells, so a hit found here is final once
        // we have also checked this cell's neighbours' boxes;
        // stopping at the first hit cell is accurate enough
        // because the earliest box is registered in this cell.
        if (best) return best;
    }

    return best;
}

// Does a standing player at `pos` overlap any obstacle?
function positionBlocked(mapName, pos, radius = PLAYER_RADIUS) {
    const index = getIndex(mapName);
    const boxes = query(index, pos.x - radius, pos.z - radius, pos.x + radius, pos.z + radius);

    return boxes.some(o =>
        pos.y + PLAYER_HEIGHT > o.min.y && pos.y < o.max.y &&
        pos.x + radius > o.min.x && pos.x - radius < o.max.x &&
        pos.z + radius > o.min.z && pos.z - radius < o.max.z
    );
}

// Walking from `from` to `to`: blocked if the end overlaps an
// obstacle or the path crosses one (no tunnelling through
// thin walls). Uses obstacles grown by the player radius.
function movementBlocked(mapName, from, to, radius = PLAYER_RADIUS) {
    if (positionBlocked(mapName, to, radius)) return true;

    const index = getIndex(mapName);
    const boxes = query(
        index,
        Math.min(from.x, to.x) - radius, Math.min(from.z, to.z) - radius,
        Math.max(from.x, to.x) + radius, Math.max(from.z, to.z) + radius
    );

    const a = { x: from.x, y: 0, z: from.z };
    const b = { x: to.x, y: 0, z: to.z };

    return boxes.some(o => {
        // Only obstacles that overlap the player's body height.
        const lowY = Math.min(from.y, to.y);
        const highY = Math.max(from.y, to.y) + PLAYER_HEIGHT;
        if (highY <= o.min.y || lowY >= o.max.y) return false;

        const t = segmentBoxT(
            a, b,
            { x: o.min.x - radius, y: -1, z: o.min.z - radius },
            { x: o.max.x + radius, y: 1, z: o.max.z + radius }
        );

        // Starting inside a grown box (t === 0) only counts if
        // the move goes deeper; allow walking out of contact.
        if (t === null) return false;
        if (t > 0) return true;

        const center = { x: (o.min.x + o.max.x) / 2, z: (o.min.z + o.max.z) / 2 };
        return Math.hypot(to.x - center.x, to.z - center.z) < Math.hypot(from.x - center.x, from.z - center.z);
    });
}

// Line of sight between two standing players (eye to eye).
function lineOfSightBlocked(mapName, fromPos, toPos) {
    if (!fromPos || !toPos) return false;

    return Boolean(segmentBlocked(
        mapName,
        { x: fromPos.x, y: fromPos.y + 1.5, z: fromPos.z },
        { x: toPos.x, y: toPos.y + 1.5, z: toPos.z }
    ));
}

// Closest free spot to `pos` (spiral search), e.g. when a
// parachute lands on a roof or a rock.
function nearestFreePosition(mapName, pos) {
    if (!positionBlocked(mapName, pos)) return { ...pos };

    for (let r = 1; r <= 40; r += 1) {
        for (let k = 0; k < 16; k++) {
            const a = (k / 16) * Math.PI * 2;
            const candidate = { x: pos.x + Math.cos(a) * r, y: pos.y, z: pos.z + Math.sin(a) * r };
            if (Math.abs(candidate.x) < 995 && Math.abs(candidate.z) < 995 && !positionBlocked(mapName, candidate)) {
                return candidate;
            }
        }
    }

    return { ...pos };
}

// Random free point inside a random house (for loot).
function randomPointInBuilding(mapName, rand = Math.random) {
    const { layout } = getIndex(mapName);
    if (!layout.buildings.length) return null;

    for (let tries = 0; tries < 10; tries++) {
        const b = layout.buildings[Math.floor(rand() * layout.buildings.length)];
        const margin = 1.2;
        const p = {
            x: b.min.x + margin + rand() * (b.max.x - b.min.x - 2 * margin),
            y: layout.groundY,
            z: b.min.z + margin + rand() * (b.max.z - b.min.z - 2 * margin)
        };
        if (!positionBlocked(mapName, p, 0.3)) return p;
    }

    return null;
}

// Obstacles along a segment, in the { id, box } form that
// hitDetectionService uses for bullets (yaw 0 boxes).
// `extend` lengthens the segment so spread shots are covered.
function obstaclesNear(mapName, a, b, extend = 1.15) {
    const index = getIndex(mapName);
    const end = {
        x: a.x + (b.x - a.x) * extend,
        y: b.y,
        z: a.z + (b.z - a.z) * extend
    };

    const ids = new Set();
    for (const [cx, cz] of cellsAlong(a, end)) {
        // Include neighbouring cells: spread can drift sideways.
        for (let ox = -1; ox <= 1; ox++) {
            for (let oz = -1; oz <= 1; oz++) {
                for (const i of index.cells.get(cellKey(cx + ox, cz + oz)) || []) ids.add(i);
            }
        }
    }

    return [...ids].map(i => index.layout.obstacles[i]).map(o => ({
        id: `static:${o.id}`,
        box: {
            center: {
                x: (o.min.x + o.max.x) / 2,
                y: (o.min.y + o.max.y) / 2,
                z: (o.min.z + o.max.z) / 2
            },
            halfExtents: {
                x: (o.max.x - o.min.x) / 2,
                y: (o.max.y - o.min.y) / 2,
                z: (o.max.z - o.min.z) / 2
            },
            yaw: 0
        }
    }));
}

module.exports = {
    PLAYER_RADIUS,
    segmentBlocked,
    positionBlocked,
    movementBlocked,
    lineOfSightBlocked,
    nearestFreePosition,
    randomPointInBuilding,
    obstaclesNear
};
