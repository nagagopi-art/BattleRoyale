// ==========================================
// INDIAN BATTLE FIELDS
// MATCH STATE SNAPSHOTS (CRASH RECOVERY)
// ==========================================
// Saves each live match's in-memory state (inventories,
// loot, throwables, gloo walls, smoke, combat, zone,
// parachute drops, aircraft) to the
// `match_state_snapshots` table, and restores it after a
// server restart.
//
// Requires database/migrations/001_match_state_snapshots.sql.
// If that table does not exist, snapshots are disabled
// (logged once) and the game keeps working without them.

const { supabaseAdmin } = require("../config/supabase");

const { exportMatchInventories, importMatchInventories } = require("./inventoryService");
const { exportMatchLoot, importMatchLoot } = require("./lootService");
const { exportThrowableMatch, importThrowableMatch } = require("./throwableService");
const { exportMatchCombat, importMatchCombat } = require("./combatService");
const { exportZone, importZone } = require("./safeZoneService");
const { exportMatchDrops, importMatchDrops } = require("./parachuteService");

const SNAPSHOT_VERSION = 1;
const TABLE = "match_state_snapshots";

let disabled = false;

// Only a genuinely missing table disables snapshots. Other
// errors (for example a foreign-key error because the match
// was deleted) must not switch the feature off.
function isMissingTable(error) {
    return Boolean(
        error &&
        (error.code === "42P01" || error.code === "PGRST205")
    );
}

// The match row no longer exists (deleted): nothing to save.
function isMatchGone(error) {
    return Boolean(error && error.code === "23503");
}

function disable(error) {
    if (!disabled) {
        disabled = true;
        console.warn(
            "Match state snapshots disabled:",
            error.message,
            "- run database/migrations/001_match_state_snapshots.sql to enable crash recovery."
        );
    }
}

// extras: socket-layer state { positions, flight, dropStarted }
function buildSnapshot(matchId, extras = {}) {
    return {
        version: SNAPSHOT_VERSION,
        savedAt: new Date().toISOString(),
        inventories: exportMatchInventories(matchId),
        loot: exportMatchLoot(matchId),
        throwables: exportThrowableMatch(matchId),
        combat: exportMatchCombat(matchId),
        zone: exportZone(matchId),
        drops: exportMatchDrops(matchId),
        positions: extras.positions || {},
        flight: extras.flight || null,
        dropStarted: Boolean(extras.dropStarted)
    };
}

async function saveMatchSnapshot(matchId, extras) {
    if (disabled) return false;

    const state = buildSnapshot(matchId, extras);

    const { error } = await supabaseAdmin
        .from(TABLE)
        .upsert(
            {
                match_id: matchId,
                state,
                version: SNAPSHOT_VERSION,
                updated_at: state.savedAt
            },
            { onConflict: "match_id" }
        );

    if (error) {
        if (isMissingTable(error)) disable(error);
        else if (isMatchGone(error)) return "match-gone";
        else console.error("Snapshot save error:", matchId, error.message);
        return false;
    }

    return true;
}

async function loadMatchSnapshot(matchId) {
    if (disabled) return null;

    const { data, error } = await supabaseAdmin
        .from(TABLE)
        .select("state, version")
        .eq("match_id", matchId)
        .maybeSingle();

    if (error) {
        if (isMissingTable(error)) disable(error);
        else console.error("Snapshot load error:", matchId, error.message);
        return null;
    }

    if (!data || data.version !== SNAPSHOT_VERSION) return null;

    return data.state;
}

// Put a saved snapshot back into the services. Returns the
// socket-layer extras for the caller to restore.
function applySnapshot(matchId, state) {
    importMatchInventories(matchId, state.inventories);
    importMatchLoot(matchId, state.loot);
    importThrowableMatch(matchId, state.throwables);
    importMatchCombat(matchId, state.combat);
    importZone(matchId, state.zone);
    importMatchDrops(matchId, state.drops);

    return {
        positions: state.positions || {},
        flight: state.flight || null,
        dropStarted: Boolean(state.dropStarted)
    };
}

async function deleteMatchSnapshot(matchId) {
    if (disabled) return;

    const { error } = await supabaseAdmin
        .from(TABLE)
        .delete()
        .eq("match_id", matchId);

    if (error && !isMissingTable(error)) {
        console.error("Snapshot delete error:", matchId, error.message);
    }
}

module.exports = {
    saveMatchSnapshot,
    loadMatchSnapshot,
    applySnapshot,
    deleteMatchSnapshot
};
