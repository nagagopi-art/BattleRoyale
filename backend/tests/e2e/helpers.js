// Shared helpers for e2e tests.

const path = require("path");
const { getLayout } = require(path.join(__dirname, "..", "..", "config", "mapLayout"));

// Centre of a square area (2*half wide) on this map with no
// buildings, rocks, walls or crates in it, searching outward
// from `near`. Tests place players here so cover never gets in
// the way of checks that are not about cover.
function findOpenArea(mapName, near = { x: 0, z: 0 }, half = 30) {
    const { obstacles } = getLayout(mapName);

    const clear = (cx, cz) => obstacles.every(o =>
        o.max.x < cx - half || o.min.x > cx + half ||
        o.max.z < cz - half || o.min.z > cz + half
    );

    for (let r = 0; r <= 900; r += 20) {
        const steps = Math.max(1, Math.round((2 * Math.PI * r) / 20));
        for (let k = 0; k < steps; k++) {
            const a = (k / steps) * Math.PI * 2;
            const cx = Math.max(-900, Math.min(900, near.x + Math.cos(a) * r));
            const cz = Math.max(-900, Math.min(900, near.z + Math.sin(a) * r));
            if (clear(cx, cz)) return { x: cx, z: cz };
        }
    }

    throw new Error(`No open area found on map ${mapName}`);
}

module.exports = { findOpenArea };
