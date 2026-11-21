// ==========================================
// INDIAN BATTLE FIELDS
// SHARED GEOMETRY HELPERS
// ==========================================
// Yaw convention: degrees around the vertical (Y) axis.
// yaw 0 faces +Z, yaw 90 faces +X.

function isVector(v) {
    return (
        v &&
        Number.isFinite(v.x) &&
        Number.isFinite(v.y) &&
        Number.isFinite(v.z)
    );
}

function degreesToRadians(degrees) {
    return (degrees * Math.PI) / 180;
}

// Normalise any finite angle into [0, 360).
function normalizeYaw(degrees) {
    const value = degrees % 360;
    return value < 0 ? value + 360 : value;
}

// Unit "forward" (facing) and "right" axes for a yaw.
function getYawAxes(yawDegrees) {
    const yaw = degreesToRadians(yawDegrees);

    return {
        forward: { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) },
        right: { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) }
    };
}

// Express a world point in a box's local coordinates.
function toLocal(point, box) {
    const { forward, right } = getYawAxes(box.yaw);

    const dx = point.x - box.center.x;
    const dy = point.y - box.center.y;
    const dz = point.z - box.center.z;

    return {
        x: dx * right.x + dz * right.z,
        y: dy,
        z: dx * forward.x + dz * forward.z
    };
}

// Segment start→end against an oriented box
// { center, halfExtents: {x (width), y (height), z (thickness)}, yaw }.
// Returns the entry fraction t in [0, 1], or null if no hit.
function segmentIntersectsBox(start, end, box) {
    if (!isVector(start) || !isVector(end) || !box || !isVector(box.center)) {
        return null;
    }

    const p0 = toLocal(start, box);
    const p1 = toLocal(end, box);
    const d = { x: p1.x - p0.x, y: p1.y - p0.y, z: p1.z - p0.z };

    let tMin = 0;
    let tMax = 1;

    for (const axis of ["x", "y", "z"]) {
        const half = box.halfExtents[axis];

        if (Math.abs(d[axis]) < 1e-9) {
            // Parallel to this slab: must already be inside it.
            if (p0[axis] < -half || p0[axis] > half) return null;
            continue;
        }

        let t1 = (-half - p0[axis]) / d[axis];
        let t2 = (half - p0[axis]) / d[axis];

        if (t1 > t2) [t1, t2] = [t2, t1];

        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);

        if (tMin > tMax) return null;
    }

    return tMin;
}

module.exports = {
    isVector,
    normalizeYaw,
    getYawAxes,
    segmentIntersectsBox
};
