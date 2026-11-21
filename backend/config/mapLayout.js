// ==============================================
// INDIAN BATTLE FIELDS
// MAP LAYOUT: BUILDINGS AND COVER
// ==============================================
// Every map gets the same layout every time (seeded by the
// map name), so the server and all clients agree on where
// every wall is. Everything is an axis-aligned box:
//   { id, kind, min: {x,y,z}, max: {x,y,z} }
// kinds: house-wall, roof, wall, rock, crate
//
// Houses are hollow (four walls with a doorway and a roof),
// so players can walk inside and loot spawns there.
//
// Roads (visual only, no collision) link the towns, and each
// town has cross streets. Houses and cover stay off the roads
// and doors face the nearest street:
//   roads: [{ id, kind: "highway"|"street", width, points: [{x,z},...] }]

const LAYOUT_VERSION = 3;

const { getMapInfo } = require("./mapCatalog");

const LAYOUT_CONFIG = {
    groundY: 5,
    worldHalf: 1000,
    towns: 10,
    housesPerTown: [5, 10],
    townRadius: [60, 110],
    house: {
        width: [8, 14],
        depth: [8, 12],
        height: 3.6,
        wallThickness: 0.5,
        doorWidth: 1.8,
        doorHeight: 2.4,
        spacing: 6
    },
    rocks: 220,
    walls: 120,
    crates: 160,
    roads: {
        highwayWidth: 9,
        streetWidth: 6,
        extraLinks: 2,        // highways beyond the spanning tree
        clearance: 2.5        // gap between road edge and houses
    },
    // Keep the area around the map centre a little open.
    clearRadiusAtCenter: 0
};

// Small deterministic PRNG (mulberry32).
function seededRandom(seedText) {
    let seed = 0;
    for (const ch of String(seedText)) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) | 0;

    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function box(id, kind, minX, minY, minZ, maxX, maxY, maxZ) {
    return {
        id,
        kind,
        min: { x: round(minX), y: round(minY), z: round(minZ) },
        max: { x: round(maxX), y: round(maxY), z: round(maxZ) }
    };
}

function round(v) {
    return Math.round(v * 100) / 100;
}

function overlaps(a, b, margin) {
    return (
        a.minX - margin < b.maxX && a.maxX + margin > b.minX &&
        a.minZ - margin < b.maxZ && a.maxZ + margin > b.minZ
    );
}

// Build one hollow house: 4 walls (doorway in one) + roof.
function buildHouse(id, cx, cz, width, depth, doorSide, cfg) {
    const g = cfg.groundY;
    const h = cfg.house.height;
    const t = cfg.house.wallThickness;
    const door = cfg.house.doorWidth;
    const doorH = cfg.house.doorHeight;

    const minX = cx - width / 2, maxX = cx + width / 2;
    const minZ = cz - depth / 2, maxZ = cz + depth / 2;

    const parts = [];
    const sides = {
        north: { axis: "x", fixed: minZ, from: minX, to: maxX },
        south: { axis: "x", fixed: maxZ - t, from: minX, to: maxX },
        west: { axis: "z", fixed: minX, from: minZ + t, to: maxZ - t },
        east: { axis: "z", fixed: maxX - t, from: minZ + t, to: maxZ - t }
    };

    for (const [side, s] of Object.entries(sides)) {
        const segments = [];

        if (side === doorSide) {
            const mid = (s.from + s.to) / 2;
            segments.push([s.from, mid - door / 2], [mid + door / 2, s.to]);
            // Lintel above the doorway.
            segments.push({ lintel: [mid - door / 2, mid + door / 2] });
        } else {
            segments.push([s.from, s.to]);
        }

        segments.forEach((seg, i) => {
            const isLintel = !Array.isArray(seg);
            const [a, b] = isLintel ? seg.lintel : seg;
            const y0 = isLintel ? g + doorH : g;

            parts.push(
                s.axis === "x"
                    ? box(`${id}-${side}-${i}`, "house-wall", a, y0, s.fixed, b, g + h, s.fixed + t)
                    : box(`${id}-${side}-${i}`, "house-wall", s.fixed, y0, a, s.fixed + t, g + h, b)
            );
        });
    }

    parts.push(box(`${id}-roof`, "roof", minX, g + h, minZ, maxX, g + h + 0.4, maxZ));

    return {
        building: {
            id,
            min: { x: round(minX), z: round(minZ) },
            max: { x: round(maxX), z: round(maxZ) },
            height: h,
            doorSide
        },
        parts
    };
}

// Does segment a-b pass through the box (expanded by pad)?
function segmentHitsRect(a, b, r, pad) {
    const minX = r.minX - pad, maxX = r.maxX + pad, minZ = r.minZ - pad, maxZ = r.maxZ + pad;
    let t0 = 0, t1 = 1;
    const dx = b.x - a.x, dz = b.z - a.z;
    for (const [p, d, lo, hi] of [[a.x, dx, minX, maxX], [a.z, dz, minZ, maxZ]]) {
        if (Math.abs(d) < 1e-9) {
            if (p < lo || p > hi) return false;
            continue;
        }
        let u = (lo - p) / d, v = (hi - p) / d;
        if (u > v) [u, v] = [v, u];
        t0 = Math.max(t0, u);
        t1 = Math.min(t1, v);
        if (t0 > t1) return false;
    }
    return true;
}

function closestPointOnSegment(p, a, b) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
    return { x: a.x + dx * t, z: a.z + dz * t };
}

// Building look for the client (materials, trims).
function buildingStyle(environment = "", townType, rand) {
    const env = environment.toLowerCase();
    const pick = list => list[Math.floor(rand() * list.length)];
    if (townType === "fort" || townType === "temple") return "stone";
    if (["military_base", "factory", "airport", "port"].includes(townType)) return pick(["concrete", "industrial"]);
    if (env.includes("urban")) return pick(["concrete", "concrete", "brick", "painted"]);
    if (env.includes("desert")) return pick(["sandstone", "mud", "painted"]);
    if (env.includes("snow")) return pick(["stone", "wood"]);
    if (env.includes("island") || env.includes("mangrove") || env.includes("backwaters")) return pick(["painted", "wood", "tiled"]);
    return pick(["brick", "painted", "tiled", "concrete"]);
}

// Town size by location type (hot drops get extra houses).
function townSizeFor(loc) {
    const big = ["city", "landmark", "port", "fort", "military_base", "factory", "airport"];
    const medium = ["village", "beach", "temple", "bridge"];

    let houses = big.includes(loc.type) ? [10, 15] : medium.includes(loc.type) ? [6, 9] : [3, 6];
    const radius = big.includes(loc.type) ? [90, 130] : medium.includes(loc.type) ? [60, 85] : [45, 70];

    if (loc.hotDrop) houses = [houses[0] + 4, houses[1] + 4];
    return { houses, radius };
}

// Per-environment tuning (from maps.sql "environment").
function environmentOverrides(environment = "") {
    const env = environment.toLowerCase();

    if (env.includes("urban")) return { towns: 14, housesPerTown: [8, 14], rocks: 80, walls: 200, crates: 260 };
    if (env.includes("desert")) return { towns: 8, housesPerTown: [4, 8], rocks: 320, walls: 100, crates: 120 };
    if (env.includes("snow")) return { towns: 8, housesPerTown: [4, 8], rocks: 340, walls: 80, crates: 120 };
    if (env.includes("island") || env.includes("mangrove") || env.includes("backwaters")) {
        return { towns: 10, housesPerTown: [4, 9], rocks: 180, walls: 90, crates: 160 };
    }
    return {};
}

function generateLayout(mapName, overrides = {}) {
    const mapInfo = getMapInfo(mapName);
    const envOverrides = environmentOverrides(mapInfo?.environment);
    const cfg = {
        ...LAYOUT_CONFIG,
        ...envOverrides,
        ...overrides,
        house: { ...LAYOUT_CONFIG.house, ...(overrides.house || {}) }
    };
    const rand = seededRandom(`bbf-layout-v${LAYOUT_VERSION}:${mapName || "default"}`);
    const range = (a, b) => a + rand() * (b - a);
    const g = cfg.groundY;
    const edge = cfg.worldHalf - 40;

    const obstacles = [];
    const buildings = [];
    const towns = [];
    const footprints = [];

    const free = fp => !footprints.some(other => overlaps(fp, other, cfg.house.spacing));

    // ---------- towns ----------
    // The map's named locations (Fort Rudra, Raj Fort, ...)
    // come first; the rest are unnamed settlements.
    const named = (mapInfo?.locations || []).map(loc => ({ ...loc, ...townSizeFor(loc) }));
    const townCount = Math.max(cfg.towns, named.length);

    for (let t = 0; t < townCount; t++) {
        const loc = named[t];

        const town = loc
            ? {
                id: `town-${t}`,
                name: loc.name,
                code: loc.code,
                type: loc.type,
                lootTier: loc.lootTier,
                risk: loc.risk,
                hotDrop: loc.hotDrop,
                center: { x: round(loc.x), z: round(loc.z) },
                radius: round(range(...loc.radius))
            }
            : {
                id: `town-${t}`,
                name: null,
                center: { x: round(range(-edge + 120, edge - 120)), z: round(range(-edge + 120, edge - 120)) },
                radius: round(range(...cfg.townRadius))
            };
        towns.push(town);
    }

    // ---------- roads ----------
    const roadCfg = { ...LAYOUT_CONFIG.roads, ...(cfg.roads || {}) };
    const roads = [];
    const clampEdge = v => Math.max(-edge, Math.min(edge, v));

    // Highways: minimum spanning tree over town centres (Prim),
    // plus a few extra short links so it isn't a pure tree.
    const dist = (a, b) => Math.hypot(a.center.x - b.center.x, a.center.z - b.center.z);
    const inTree = new Set([0]);
    const links = [];
    while (inTree.size < towns.length) {
        let best = null;
        for (const i of inTree) {
            for (let j = 0; j < towns.length; j++) {
                if (inTree.has(j)) continue;
                const d = dist(towns[i], towns[j]);
                if (!best || d < best.d) best = { i, j, d };
            }
        }
        inTree.add(best.j);
        links.push([best.i, best.j]);
    }
    const linked = new Set(links.map(([i, j]) => `${Math.min(i, j)}-${Math.max(i, j)}`));
    const extras = [];
    for (let i = 0; i < towns.length; i++) {
        for (let j = i + 1; j < towns.length; j++) {
            if (!linked.has(`${i}-${j}`)) extras.push({ i, j, d: dist(towns[i], towns[j]) });
        }
    }
    extras.sort((a, b) => a.d - b.d).slice(0, roadCfg.extraLinks).forEach(e => links.push([e.i, e.j]));

    links.forEach(([i, j], k) => {
        const a = towns[i].center, b = towns[j].center;
        // A gentle bend half way so roads don't look ruler-straight.
        const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
        const nx = -(b.z - a.z), nz = b.x - a.x;
        const nl = Math.hypot(nx, nz) || 1;
        const bend = range(-0.12, 0.12) * dist(towns[i], towns[j]);
        roads.push({
            id: `highway-${k}`,
            kind: "highway",
            width: roadCfg.highwayWidth,
            from: towns[i].id,
            to: towns[j].id,
            points: [
                { x: round(a.x), z: round(a.z) },
                { x: round(clampEdge(mx + (nx / nl) * bend)), z: round(clampEdge(mz + (nz / nl) * bend)) },
                { x: round(b.x), z: round(b.z) }
            ]
        });
    });

    // Streets: two crossing streets through every town.
    towns.forEach((town, t) => {
        const angle = rand() * Math.PI;
        for (let s = 0; s < 2; s++) {
            const a = angle + s * Math.PI / 2;
            const len = town.radius * range(0.9, 1.15);
            const dx = Math.cos(a) * len, dz = Math.sin(a) * len;
            roads.push({
                id: `street-${t}-${s}`,
                kind: "street",
                width: roadCfg.streetWidth,
                town: town.id,
                points: [
                    { x: round(clampEdge(town.center.x - dx)), z: round(clampEdge(town.center.z - dz)) },
                    { x: round(clampEdge(town.center.x + dx)), z: round(clampEdge(town.center.z + dz)) }
                ]
            });
        }
    });

    const roadSegments = [];
    for (const road of roads) {
        for (let i = 0; i < road.points.length - 1; i++) {
            roadSegments.push({ a: road.points[i], b: road.points[i + 1], half: road.width / 2 });
        }
    }
    const onRoad = (fp, clearance) => roadSegments.some(s => segmentHitsRect(s.a, s.b, fp, s.half + clearance));

    // Door faces the nearest road.
    const doorTowardRoad = (cx, cz) => {
        let best = null;
        for (const s of roadSegments) {
            const p = closestPointOnSegment({ x: cx, z: cz }, s.a, s.b);
            const d = Math.hypot(p.x - cx, p.z - cz);
            if (!best || d < best.d) best = { d, p };
        }
        if (!best || best.d > 60) return null;
        const dx = best.p.x - cx, dz = best.p.z - cz;
        // north = -Z side, south = +Z side, west = -X, east = +X.
        return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? "east" : "west") : (dz > 0 ? "south" : "north");
    };

    // ---------- houses ----------
    for (let t = 0; t < townCount; t++) {
        const loc = named[t];
        const town = towns[t];
        const houses = loc ? loc.houses : cfg.housesPerTown;
        const count = Math.floor(range(houses[0], houses[1] + 1));

        for (let i = 0, placed = 0; i < count * 6 && placed < count; i++) {
            const width = range(...cfg.house.width);
            const depth = range(...cfg.house.depth);
            const angle = rand() * Math.PI * 2;
            const dist = Math.sqrt(rand()) * town.radius;
            const cx = town.center.x + Math.cos(angle) * dist;
            const cz = town.center.z + Math.sin(angle) * dist;

            const fp = { minX: cx - width / 2, maxX: cx + width / 2, minZ: cz - depth / 2, maxZ: cz + depth / 2 };
            if (Math.abs(cx) > edge || Math.abs(cz) > edge || !free(fp)) continue;
            if (onRoad(fp, roadCfg.clearance)) continue;

            const randomSide = ["north", "south", "east", "west"][Math.floor(rand() * 4)];
            const doorSide = doorTowardRoad(cx, cz) || randomSide;
            const house = buildHouse(`house-${t}-${placed}`, cx, cz, width, depth, doorSide, cfg);
            house.building.town = town.id;
            house.building.style = buildingStyle(mapInfo?.environment, town.type, rand);
            house.building.variant = Math.floor(rand() * 4);

            footprints.push(fp);
            buildings.push(house.building);
            obstacles.push(...house.parts);
            placed++;
        }
    }

    // ---------- scattered cover ----------
    const scatter = (count, kind, sizeFn, spacing) => {
        for (let i = 0, placed = 0; i < count * 4 && placed < count; i++) {
            const { sx, sy, sz } = sizeFn();
            const cx = range(-edge, edge);
            const cz = range(-edge, edge);
            const fp = { minX: cx - sx / 2, maxX: cx + sx / 2, minZ: cz - sz / 2, maxZ: cz + sz / 2 };
            if (!footprints.every(other => !overlaps(fp, other, spacing))) continue;
            if (onRoad(fp, 1)) continue;

            footprints.push(fp);
            obstacles.push(box(`${kind}-${placed}`, kind, fp.minX, g, fp.minZ, fp.maxX, g + sy, fp.maxZ));
            placed++;
        }
    };

    scatter(cfg.rocks, "rock", () => {
        const s = range(1.4, 4.5);
        return { sx: s * range(0.8, 1.4), sy: s * range(0.6, 1.0), sz: s * range(0.8, 1.4) };
    }, 3);

    scatter(cfg.walls, "wall", () => {
        const long = range(5, 14);
        const along = rand() < 0.5;
        return { sx: along ? long : 0.6, sy: range(1.2, 2.2), sz: along ? 0.6 : long };
    }, 3);

    scatter(cfg.crates, "crate", () => {
        const s = range(1.1, 2.2);
        return { sx: s, sy: s, sz: s };
    }, 2);

    return {
        version: LAYOUT_VERSION,
        mapName: mapName || "default",
        map: mapInfo
            ? {
                code: mapInfo.code,
                name: mapInfo.name,
                subtitle: mapInfo.subtitle,
                region: mapInfo.region,
                environment: mapInfo.environment,
                description: mapInfo.description
            }
            : null,
        groundY: g,
        worldHalf: cfg.worldHalf,
        towns,
        roads,
        buildings,
        obstacles
    };
}

// Layouts are cached per map name.
const cache = new Map();

function getLayout(mapName) {
    const key = mapName || "default";
    if (!cache.has(key)) cache.set(key, generateLayout(key));
    return cache.get(key);
}

module.exports = {
    LAYOUT_VERSION,
    LAYOUT_CONFIG,
    generateLayout,
    getLayout
};
