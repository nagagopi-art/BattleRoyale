// ==============================================
// INDIAN BATTLE FIELDS
// MAP CATALOG: the 12 maps and their named locations
// ==============================================
// Read straight from database/maps.sql and
// database/map_locations.sql, so the seed files stay the
// single source of truth. Used for map layouts, the layout
// API and quick-match map selection.

const fs = require("fs");
const path = require("path");

const DB_DIR = path.join(__dirname, "..", "database");

// Design coordinates (0-1000) -> world (-950..950).
const toWorld = v => Math.round((Number(v) * 1.9 - 950) * 100) / 100;

function readSeed(file) {
    try {
        return fs.readFileSync(path.join(DB_DIR, file), "utf8");
    } catch {
        return "";
    }
}

function parseMaps(sql) {
    const re = /\(\s*'([A-Z_]+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'((?:[^']|'')*)',\s*'([^']+)',\s*(\d+)/g;

    return [...sql.matchAll(re)].map(m => ({
        code: m[1],
        name: m[2],
        subtitle: m[3],
        region: m[4],
        description: m[5].replace(/''/g, "'"),
        environment: m[6],
        maxPlayers: Number(m[7]),
        locations: []
    }));
}

function parseLocations(sql) {
    const re = /\('([A-Z_]+)',\s*'([A-Z_]+)',\s*'([^']+)',\s*'([a-z_]+)',\s*'([a-z]+)',\s*'([a-z]+)',\s*(\d+),\s*(\d+),\s*(TRUE|FALSE),\s*'((?:[^']|'')*)'\)/g;

    return [...sql.matchAll(re)].map(m => ({
        mapCode: m[1],
        code: m[2],
        name: m[3],
        type: m[4],
        lootTier: m[5],
        risk: m[6],
        x: toWorld(m[7]),
        z: toWorld(m[8]),
        hotDrop: m[9] === "TRUE",
        description: m[10].replace(/''/g, "'")
    }));
}

const MAPS = parseMaps(readSeed("maps.sql"));

for (const location of parseLocations(readSeed("map_locations.sql"))) {
    const map = MAPS.find(m => m.code === location.mapCode);
    if (map) map.locations.push(location);
}

const byName = new Map(MAPS.map(m => [m.name.toLowerCase(), m]));
const byCode = new Map(MAPS.map(m => [m.code, m]));

// Catalog entry for a map name or code (null for unknown,
// e.g. test maps).
function getMapInfo(nameOrCode) {
    if (!nameOrCode) return null;
    return byName.get(String(nameOrCode).toLowerCase()) || byCode.get(String(nameOrCode).toUpperCase()) || null;
}

function listMaps() {
    return MAPS;
}

function randomMapName() {
    return MAPS.length
        ? MAPS[Math.floor(Math.random() * MAPS.length)].name
        : "Sahyadri";
}

module.exports = {
    getMapInfo,
    listMaps,
    randomMapName
};
