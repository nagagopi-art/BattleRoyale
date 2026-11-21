// ==========================================
// INDIAN BATTLE FIELDS - sockets/game/persistence.js
// ==========================================
// Database writes: positions (batched), armor, combat, zone damage.

const { supabaseAdmin } = require("../../config/supabase");
const { getEquippedArmor } = require("../../services/inventoryService");
const { getCombatPlayer, syncCombatArmorState } = require("../../services/combatService");

const { getPlayerKey } = require("./state");
const { isValidPosition } = require("./utils");

// ==========================================
// BATCHED POSITION PERSISTENCE
// ==========================================
// Movement updates only mark the position as changed; this
// loop writes the latest position of each changed player.

const dirtyPositions = new Map(); // "match:player" -> { matchId, playerId, position }

let positionFlushRunning = false;

function markPositionDirty(matchId, playerId, position) {
    dirtyPositions.set(getPlayerKey(matchId, playerId), {
        matchId,
        playerId,
        position
    });
}

async function flushDirtyPositions() {
    if (positionFlushRunning || dirtyPositions.size === 0) return;
    positionFlushRunning = true;

    const batch = [...dirtyPositions.values()];
    dirtyPositions.clear();

    try {
        await Promise.all(
            batch.map(({ matchId, playerId, position, attempts = 0 }) =>
                persistPlayerPosition(matchId, playerId, position).catch(error => {
                    // The player's row is gone (left the match, or the
                    // match was deleted): this save can never succeed.
                    const rowGone =
                        error.code === "PGRST116" ||
                        /record not found/.test(error.message || "");

                    if (rowGone) return;

                    console.error("Position flush error:", error.message);

                    // Retry a few times unless a newer position arrived.
                    const key = getPlayerKey(matchId, playerId);
                    if (attempts < 3 && !dirtyPositions.has(key)) {
                        dirtyPositions.set(key, {
                            matchId,
                            playerId,
                            position,
                            attempts: attempts + 1
                        });
                    }
                })
            )
        );
    } finally {
        positionFlushRunning = false;
    }
}

// ==========================================
// DATABASE POSITION SYNCHRONIZATION
// ==========================================

async function persistPlayerPosition(matchId, playerId, position) {
    if (!isValidPosition(position)) {
        throw new Error("Invalid position cannot be saved");
    }

    const { data, error } = await supabaseAdmin
        .from("match_players")
        .update({
            current_x: Number(position.x),
            current_y: Number(position.y),
            current_z: Number(position.z),
            position_updated_at: new Date().toISOString()
        })
        .eq("match_id", matchId)
        .eq("player_id", playerId)
        .select("player_id")
        .single();

    if (error) throw error;

    if (!data) {
        throw new Error("Player position record not found");
    }

    return true;
}

// ==========================================
// DATABASE EQUIPPED ARMOR SYNCHRONIZATION
// ==========================================

async function persistEquippedArmor(matchId, playerId) {
    const equipped = getEquippedArmor(matchId, playerId);

    const update = {
        helmet_level: equipped.helmet?.level || 0,
        helmet_durability: equipped.helmet?.durability || 0,
        vest_level: equipped.vest?.level || 0,
        vest_durability: equipped.vest?.durability || 0
    };

    const { data, error } = await supabaseAdmin
        .from("match_players")
        .update(update)
        .eq("match_id", matchId)
        .eq("player_id", playerId)
        .select("player_id, helmet_level, helmet_durability, vest_level, vest_durability")
        .single();

    if (error) throw error;

    if (!data) {
        throw new Error("Equipped armor database record not found");
    }

    syncCombatArmorState(matchId, playerId);

    return {
        helmet: equipped.helmet,
        vest: equipped.vest
    };
}

// ==========================================
// DATABASE COMBAT SYNCHRONIZATION
// ==========================================

async function persistCombatResult(
    matchId,
    shooterId,
    targetId,
    result
) {
    const targetCombat = getCombatPlayer(matchId, targetId);
    const shooterCombat = getCombatPlayer(matchId, shooterId);

    if (!targetCombat || !shooterCombat) {
        throw new Error("Combat player state unavailable");
    }

    const { data, error } = await supabaseAdmin.rpc(
        "sync_combat_result",
        {
            p_match_id: matchId,
            p_shooter_id: shooterId,
            p_target_id: targetId,
            p_target_health: targetCombat.health,
            p_target_armor: targetCombat.armor,
            // Respawn modes: a down player stays alive in the database,
            // so the normal "last team standing" check never fires.
            p_target_is_alive: targetCombat.isAlive || Boolean(targetCombat.respawnPending),
            p_shooter_kills: shooterCombat.kills,
            p_eliminated: result.eliminated && !targetCombat.respawnPending,
            p_target_helmet_level: targetCombat.helmetLevel || 0,
            p_target_helmet_durability: targetCombat.helmetDurability || 0,
            p_target_vest_level: targetCombat.vestLevel || 0,
            p_target_vest_durability: targetCombat.vestDurability || 0
        }
    );

    if (error) throw error;

    if (!data || !data.success) {
        throw new Error("Combat database synchronization failed");
    }

    // Kill rewards and respawn / round handling.
    if (result.eliminated) {
        require("./modes").onPlayerDown(matchId, targetId, shooterId);
    }

    return {
        alivePlayers: data.alivePlayers,
        eliminatedPlayers: data.eliminatedPlayers
    };
}

// Save zone damage. Zone deaths have no attacker, so this
// updates the row directly and recounts alive/eliminated.
async function persistZoneDamage(matchId, playerId, health, eliminated) {
    const update = eliminated
        ? { health: 0, is_alive: false, eliminated_at: new Date().toISOString() }
        : { health };

    const { data, error } = await supabaseAdmin
        .from("match_players")
        .update(update)
        .eq("match_id", matchId)
        .eq("player_id", playerId)
        .eq("is_alive", true)
        .select("player_id");

    if (error) throw error;

    if (!data || data.length === 0) {
        // Already eliminated in the database.
        return { applied: false };
    }

    if (!eliminated) {
        return { applied: true };
    }

    const [alive, dead] = await Promise.all([
        supabaseAdmin
            .from("match_players")
            .select("player_id", { count: "exact", head: true })
            .eq("match_id", matchId)
            .eq("is_alive", true),
        supabaseAdmin
            .from("match_players")
            .select("player_id", { count: "exact", head: true })
            .eq("match_id", matchId)
            .eq("is_alive", false)
    ]);

    if (alive.error) throw alive.error;
    if (dead.error) throw dead.error;

    const { error: countError } = await supabaseAdmin
        .from("matches")
        .update({
            alive_players: alive.count,
            eliminated_players: dead.count
        })
        .eq("id", matchId);

    if (countError) throw countError;

    return {
        applied: true,
        alivePlayers: alive.count,
        eliminatedPlayers: dead.count
    };
}

module.exports = {
    dirtyPositions,
    markPositionDirty,
    flushDirtyPositions,
    persistPlayerPosition,
    persistEquippedArmor,
    persistCombatResult,
    persistZoneDamage
};
