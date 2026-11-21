
const { supabaseAdmin } = require("../config/supabase");
const {
    finalizeMatch,
    getFinalMatchResults
} = require("../services/matchCompletionService");

const {
    generateFlightPath,
    getAircraftPosition,
    jumpFromAircraft,
    deployParachute,
    updateDropPosition,
    getDropStatus,
    removeDrop,
    removeMatchDrops,
    DROP_CONFIG
} = require("../services/parachuteService");

const {
    generateMatchLoot,
    getAvailableLoot,
    pickupLoot,
    restoreLoot,
    removeMatchLoot,
    dropItemsOnGround,
    hasMatchLoot
} = require("../services/lootService");

const { applyMatchProgression } = require("../services/progressionService");
const { createSocketRateLimiter } = require("../services/rateLimiter");
const { isBotUsername } = require("../services/botService");
const { reportError } = require("../services/errorReporter");

const {
    isClusterEnabled,
    getServerId,
    getServerUrl,
    claimMatch
} = require("../services/clusterService");

const {
    recordAim,
    recordViolation,
    clearMatchAntiCheat
} = require("../services/antiCheatService");
const { clearMatchGroups } = require("../services/partyService");
const { getEquippedCosmeticsFor } = require("../routes/cosmetics");

const {
    saveMatchSnapshot,
    loadMatchSnapshot,
    applySnapshot,
    deleteMatchSnapshot
} = require("../services/matchStateService");

const {
    createInventory,
    getInventory,
    addLootItem,
    addWeapon,
    addAmmunition,
    addHealingItem,
    getHealingCount,
    consumeHealingItem,
    addAttachment,
    attachToWeapon,
    detachFromWeapon,
    takeItemForDrop,
    takeAllItemsForDrop,
    addHelmet,
    addVest,
    getEquippedArmor,
    equipHelmet,
    equipVest,
    unequipHelmet,
    unequipVest,
    restoreEquippedArmor,
    snapshotInventory,
    restoreInventory,
    removePlayerInventory,
    removeMatchInventories
} = require("../services/inventoryService");

const { WEAPONS } = require("../config/weapons");

const {
    ATTACHMENT_SLOTS,
    HANDLING_CONFIG
} = require("../config/attachments");

const {
    createCombatPlayer,
    getCombatPlayer,
    equipWeapon,
    reloadWeapon,
    fireWeapon,
    removeCombatPlayer,
    syncCombatArmorState,
    snapshotCombatState,
    restoreCombatState,
    cancelPlayerReload,
    removeMatchCombat,
    applyExplosionDamage,
    clampMagazineToSize
} = require("../services/combatService");

const {
    throwGrenade,
    resolveGrenade,
    deployGlooWall,
    damageGlooWall,
    getGlooWalls,
    getThrowableInventory,
    removeThrowablePlayer,
    removeThrowableMatch,
    getExplosionDamage,
    findBlockingGlooWall,
    addSmokeCloud,
    getSmokeClouds,
    isLineOfSightBlocked,
    getFlashDuration,
    flashPlayer,
    isPlayerFlashed,
    takeThrowablesForDrop,
    getGlooWallBox,
    GLOO_CONFIG
} = require("../services/throwableService");

// Blind every living player near a flash explosion,
// unless a gloo wall shields them.
function applyFlashEffect(io, matchId, explosion) {
    const prefix = `${matchId}:`;
    const affected = [];

    for (const [key, position] of playerPositions.entries()) {
        if (!key.startsWith(prefix)) continue;

        const playerId = Number(key.slice(prefix.length));
        const combat = getCombatPlayer(matchId, playerId);

        if (!combat || !combat.isAlive) continue;

        const distance = calculateDistance(position, explosion.position);
        const durationMs = getFlashDuration(distance);

        if (durationMs <= 0) continue;

        if (findBlockingGlooWall(matchId, explosion.position, position)) {
            continue;
        }

        const blindUntil = flashPlayer(matchId, playerId, durationMs);

        io.to(`player:${playerId}`).emit("player-flashed", {
            grenadeId: explosion.grenadeId,
            durationMs,
            blindUntil,
            intensity: Number((durationMs / explosion.durationMs).toFixed(2))
        });

        affected.push({ playerId, durationMs });
    }

    return affected;
}

const {
    HEALING_ITEMS,
    calculateHealedHealth,
    canHeal,
    startHealing,
    cancelHealing,
    removeMatchHealing
} = require("../services/healingService");

const {
    KNOCK_CONFIG,
    knockPlayer,
    clearKnock,
    startRevive,
    cancelRevivesFor,
    removeMatchRevives
} = require("../services/knockdownService");

// Cancel an in-progress heal or revive involving this
// player and tell those affected why.
function interruptHealing(io, matchId, playerId, reason) {
    const cancelled = cancelHealing(matchId, playerId);

    if (cancelled && io) {
        io.to(`player:${playerId}`).emit("healing-cancelled", {
            itemId: cancelled.itemId,
            reason
        });
    }

    for (const revive of cancelRevivesFor(matchId, playerId)) {
        if (!io) continue;

        for (const id of [revive.reviverId, revive.targetId]) {
            io.to(`player:${id}`).emit("revive-cancelled", {
                reviverId: revive.reviverId,
                targetId: revive.targetId,
                reason
            });
        }
    }

    return cancelled;
}

const {
    createZone,
    updateZone,
    isOutsideZone,
    getZone,
    getZoneState,
    isMatchOvertime,
    getActiveZones,
    removeZone
} = require("../services/safeZoneService");

// Gloo walls as bullet obstacles: oriented wall panels.
function getGlooWallObstacles(matchId) {
    return getGlooWalls(matchId).map(wall => ({
        id: wall.id,
        box: getGlooWallBox(wall)
    }));
}

const playerPositions = new Map();
const matchFlights = new Map();
const matchDropStarted = new Set();
const lastMovementTimes = new Map();

const MOVEMENT_CONFIG = {
    MIN_INTERVAL_MS: 50,
    MAX_MOVEMENT_DISTANCE: 30,
    // Horizontal speed limits (units per second). Elapsed
    // time is capped at 1s so pauses cannot bank distance.
    MAX_SPEED_PER_SECOND: 12,
    KNOCKED_SPEED_PER_SECOND: 3,
    SPEED_TOLERANCE: 2,
    // Players only receive movement of others within this
    // distance (less traffic, no map-wide wallhack data).
    VISIBILITY_RANGE: 400,
    // Positions are written to the database in batches.
    POSITION_FLUSH_MS: 2000,
    MAX_WORLD_BOUNDARY: 1000,
    MAX_VERTICAL_BOUNDARY: 2000,
    LOOT_SEARCH_DISTANCE: 30
};

function getPlayerKey(matchId, playerId) {
    return `${matchId}:${playerId}`;
}

// ==========================================
// GROUND MOVEMENT RULES (AFTER LANDING)
// ==========================================
// There is no terrain height map yet, so the ground is
// flat at landing altitude, with room for buildings.

const GROUND_CONFIG = {
    GROUND_LEVEL: DROP_CONFIG.landingAltitude,
    MAX_HEIGHT_ABOVE_GROUND: 40,
    MAX_STEP_UP: 3
};

function validateGroundMovement(oldPosition, newPosition) {
    if (newPosition.y < GROUND_CONFIG.GROUND_LEVEL) {
        return { success: false, message: "Cannot move below ground" };
    }

    if (
        newPosition.y >
        GROUND_CONFIG.GROUND_LEVEL + GROUND_CONFIG.MAX_HEIGHT_ABOVE_GROUND
    ) {
        return { success: false, message: "Cannot move that high" };
    }

    if (
        oldPosition &&
        newPosition.y - oldPosition.y > GROUND_CONFIG.MAX_STEP_UP
    ) {
        return { success: false, message: "Cannot climb that fast" };
    }

    return { success: true };
}

// ==========================================
// AIRCRAFT: EJECT PLAYERS WHO NEVER JUMPED
// ==========================================

function getFlightDurationMs(flightPath) {
    const dx = flightPath.end.x - flightPath.start.x;
    const dz = flightPath.end.z - flightPath.start.z;
    const speed = flightPath.speed > 0 ? flightPath.speed : 90;

    return Math.ceil((Math.sqrt(dx * dx + dz * dz) / speed) * 1000);
}

async function ejectRemainingPlayers(io, matchId) {
    const flight = matchFlights.get(matchId);
    if (!flight) return;

    const { data: members, error } = await supabaseAdmin
        .from("match_players")
        .select("player_id")
        .eq("match_id", matchId)
        .eq("is_alive", true);

    if (error) {
        console.error("Aircraft eject lookup error:", error.message);
        return;
    }

    const exitPosition = getAircraftPosition(flight.flightPath, 1);

    for (const member of members || []) {
        if (getDropStatus(matchId, member.player_id)) continue;

        const result = jumpFromAircraft(
            matchId,
            member.player_id,
            exitPosition
        );

        if (!result.success) continue;

        try {
            await persistPlayerPosition(matchId, member.player_id, exitPosition);
        } catch (persistError) {
            console.error("Aircraft eject position error:", persistError.message);
        }

        playerPositions.set(
            getPlayerKey(matchId, member.player_id),
            exitPosition
        );

        io.to(`player:${member.player_id}`).emit("jump-started", {
            ...result,
            forced: true,
            message: "Ejected at the end of the flight path"
        });

        io.to(`match:${matchId}`).emit("player-jumped", {
            playerId: member.player_id,
            forced: true
        });
    }
}

// ==========================================
// CLEAN UP ALL IN-MEMORY STATE FOR A MATCH
// ==========================================

function cleanupCompletedMatch(matchId) {
    if (!matchId) {
        return false;
    }

    removeMatchCombat(matchId);
    removeMatchInventories(matchId);
    removeMatchLoot(matchId);
    removeMatchDrops(matchId);
    removeThrowableMatch(matchId);
    removeZone(matchId);
    removeMatchHealing(matchId);
    removeMatchRevives(matchId);
    clearMatchDisconnectTimers(matchId);
    clearMatchGroups(matchId);
    clearMatchAntiCheat(matchId);
    restoredMatches.delete(matchId);

    deleteMatchSnapshot(matchId).catch(error =>
        console.error("Snapshot delete error:", error.message)
    );

    const prefix = `${matchId}:`;

    for (const key of playerPositions.keys()) {
        if (key.startsWith(prefix)) {
            playerPositions.delete(key);
        }
    }

    for (const key of lastMovementTimes.keys()) {
        if (key.startsWith(prefix)) {
            lastMovementTimes.delete(key);
        }
    }

    const flight = matchFlights.get(matchId);
    if (flight?.ejectTimer) clearTimeout(flight.ejectTimer);

    matchFlights.delete(matchId);
    matchDropStarted.delete(matchId);

    console.log("MATCH MEMORY CLEANUP COMPLETED:", matchId);

    return true;
}

function isValidPosition(position) {
    if (!position) return false;

    const { x, y, z } = position;

    return (
        Number.isFinite(x) &&
        Number.isFinite(y) &&
        Number.isFinite(z) &&
        Math.abs(x) <= MOVEMENT_CONFIG.MAX_WORLD_BOUNDARY &&
        y >= -10 &&
        y <= MOVEMENT_CONFIG.MAX_VERTICAL_BOUNDARY &&
        Math.abs(z) <= MOVEMENT_CONFIG.MAX_WORLD_BOUNDARY
    );
}

function calculateDistance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;

    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function isValidMatchId(matchId) {
    return (
        typeof matchId === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(matchId)
    );
}

function emitError(socket, message) {
    socket.emit("game-error", {
        success: false,
        message
    });
}

// ==========================================
// SPECTATING
// ==========================================

function getSpectateRoom(matchId, playerId) {
    return `spectate:${matchId}:${playerId}`;
}

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
            batch.map(({ matchId, playerId, position }) =>
                persistPlayerPosition(matchId, playerId, position).catch(error => {
                    console.error("Position flush error:", error.message);
                    // Retry next time unless a newer one arrived.
                    const key = getPlayerKey(matchId, playerId);
                    if (!dirtyPositions.has(key)) {
                        dirtyPositions.set(key, { matchId, playerId, position });
                    }
                })
            )
        );
    } finally {
        positionFlushRunning = false;
    }
}

// ==========================================
// CRASH RECOVERY (MATCH STATE SNAPSHOTS)
// ==========================================

const SNAPSHOT_INTERVAL_MS = 10000;

// Does this server process have any player of the match
// connected? Background work (zone damage, time-limit end,
// snapshots) only runs where the match is actually being
// played, so a second server sharing the same database never
// overwrites or ends a match it is not hosting.
function hasLocalPlayers(matchId) {
    const room = gameIo?.sockets?.adapter?.rooms?.get(`match:${matchId}`);
    return Boolean(room && room.size > 0);
}
const restoredMatches = new Set();
let snapshotRunning = false;

function getSnapshotExtras(matchId) {
    const prefix = `${matchId}:`;
    const positions = {};

    for (const [key, position] of playerPositions.entries()) {
        if (key.startsWith(prefix)) {
            positions[key.slice(prefix.length)] = position;
        }
    }

    const flight = matchFlights.get(matchId);

    return {
        positions,
        flight: flight
            ? {
                flightPath: flight.flightPath,
                startedAt: flight.startedAt,
                durationMs: flight.durationMs
            }
            : null,
        dropStarted: matchDropStarted.has(matchId)
    };
}

async function saveAllMatchSnapshots() {
    if (snapshotRunning) return;
    snapshotRunning = true;

    try {
        const matchIds = new Set([
            ...getActiveZones().map(zone => zone.matchId),
            ...matchFlights.keys()
        ]);

        for (const matchId of matchIds) {
            // Only the server hosting the match saves it.
            if (!hasLocalPlayers(matchId)) continue;

            const saved = await saveMatchSnapshot(matchId, getSnapshotExtras(matchId));

            // The match was deleted from the database: drop
            // its in-memory state instead of saving it forever.
            if (saved === "match-gone") {
                cleanupCompletedMatch(matchId);
            }
        }
    } catch (error) {
        console.error("Snapshot loop error:", error.message);
    } finally {
        snapshotRunning = false;
    }
}

// After a restart, rebuild a live match from its snapshot
// the first time anyone rejoins it.
async function restoreMatchIfNeeded(io, match) {
    const matchId = match.id;

    if (
        match.status !== "in_progress" ||
        restoredMatches.has(matchId) ||
        hasMatchLoot(matchId) ||
        getZone(matchId)
    ) {
        return false;
    }

    restoredMatches.add(matchId);

    const state = await loadMatchSnapshot(matchId);
    if (!state) return false;

    const extras = applySnapshot(matchId, state);

    for (const [playerId, position] of Object.entries(extras.positions)) {
        const key = getPlayerKey(matchId, playerId);
        if (!playerPositions.has(key) && isValidPosition(position)) {
            playerPositions.set(key, position);
        }
    }

    if (extras.dropStarted) {
        matchDropStarted.add(matchId);
    }

    if (extras.flight && !matchFlights.has(matchId)) {
        const remaining = Math.max(
            0,
            extras.flight.startedAt + extras.flight.durationMs - Date.now()
        );

        const ejectTimer = setTimeout(() => {
            ejectRemainingPlayers(io, matchId).catch(error =>
                console.error("Aircraft eject error:", error.message)
            );
        }, remaining);

        matchFlights.set(matchId, { ...extras.flight, ejectTimer });
    }

    console.log("MATCH STATE RESTORED FROM SNAPSHOT:", matchId);

    return true;
}

// ==========================================
// DISCONNECT GRACE PERIOD
// ==========================================

// How long a disconnected player has to come back before
// being eliminated. RECONNECT_GRACE_MS overrides (tests).
const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS) > 0
    ? Number(process.env.RECONNECT_GRACE_MS)
    : 90000;
const disconnectTimers = new Map(); // "match:player" -> timeout

function clearDisconnectTimer(matchId, playerId) {
    const key = getPlayerKey(matchId, playerId);
    const timer = disconnectTimers.get(key);

    if (timer) {
        clearTimeout(timer);
        disconnectTimers.delete(key);
        return true;
    }

    return false;
}

async function scheduleDisconnectElimination(io, matchId, playerId) {
    // Still connected from another tab/device: nothing to do.
    const sockets = await io.in(`player:${playerId}`).fetchSockets();
    if (sockets.some(s => s.currentMatchId === matchId)) return;

    const combat = getCombatPlayer(matchId, playerId);
    if (combat && !combat.isAlive) return;

    clearDisconnectTimer(matchId, playerId);

    const timer = setTimeout(async () => {
        disconnectTimers.delete(getPlayerKey(matchId, playerId));

        try {
            const { data: match } = await supabaseAdmin
                .from("matches")
                .select("status")
                .eq("id", matchId)
                .maybeSingle();

            if (!match || match.status !== "in_progress") return;

            const current = getCombatPlayer(matchId, playerId);

            if (current) {
                clearKnock(current);
                current.health = 0;
                current.isAlive = false;
            }

            const saved = await persistZoneDamage(matchId, playerId, 0, true);
            if (!saved.applied) return;

            interruptHealing(io, matchId, playerId, "disconnected");
            dropDeathLoot(io, matchId, playerId);

            io.to(`match:${matchId}`).emit("player-eliminated", {
                attackerId: null,
                victimId: playerId,
                cause: "disconnected",
                weapon: "Disconnected",
                alivePlayers: saved.alivePlayers,
                eliminatedPlayers: saved.eliminatedPlayers
            });

            await handleTeamWipe(io, matchId, playerId);
            await completeMatchIfFinished(io, matchId);

        } catch (error) {
            console.error("Disconnect elimination error:", error.message);
        }
    }, RECONNECT_GRACE_MS);

    timer.unref?.();
    disconnectTimers.set(getPlayerKey(matchId, playerId), timer);
}

function clearMatchDisconnectTimers(matchId) {
    const prefix = `${matchId}:`;

    for (const [key, timer] of disconnectTimers.entries()) {
        if (key.startsWith(prefix)) {
            clearTimeout(timer);
            disconnectTimers.delete(key);
        }
    }
}

// ==========================================
// DROPPING ITEMS / DEATH LOOT
// ==========================================

// Remove one item (or stack) from a player and put it on
// the ground at their position. Returns { status, dropped }.
function dropPlayerItem(io, matchId, playerId, request) {
    const position = getPosition(matchId, playerId);

    if (!position) {
        return { status: "error", message: "Player position unavailable" };
    }

    let items;

    if (request?.itemType === "throwable") {
        items = takeThrowablesForDrop(
            matchId,
            playerId,
            request.itemId,
            request.quantity
        );

        if (items.length === 0) {
            return { status: "error", message: "No throwables of that type" };
        }
    } else {
        // Weapons: put loaded rounds back into reserve first.
        if (request?.itemType === "weapon") {
            const combat = getCombatPlayer(matchId, playerId);
            const state = combat?.weapons?.[request.itemId];

            if (combat?.isReloading && combat.activeWeapon === request.itemId) {
                return { status: "error", message: "Cannot drop a weapon while reloading it" };
            }

            const owned = getInventory(matchId, playerId)?.weapons
                ?.find(w => w.weaponId === request.itemId);

            if (owned && state && state.magazineAmmo > 0 && owned.ammoType) {
                addAmmunition(matchId, playerId, owned.ammoType, state.magazineAmmo);
            }
        }

        const taken = takeItemForDrop(matchId, playerId, request);
        if (taken.status !== "success") return taken;

        items = taken.items;

        if (request.itemType === "weapon") {
            const combat = getCombatPlayer(matchId, playerId);

            if (combat) {
                delete combat.weapons[request.itemId];
                if (combat.activeWeapon === request.itemId) {
                    combat.activeWeapon = null;
                }
            }
        }
    }

    const dropped = dropItemsOnGround(matchId, items, position);

    io.to(`match:${matchId}`).emit("loot-dropped", {
        playerId,
        reason: "dropped",
        items: dropped
    });

    return { status: "success", dropped };
}

// Everything a player carried falls where they died.
function dropDeathLoot(io, matchId, playerId) {
    try {
        const position = getPosition(matchId, playerId);
        if (!position) return [];

        const items = [
            ...takeAllItemsForDrop(matchId, playerId),
            ...takeThrowablesForDrop(matchId, playerId)
        ];

        const dropped = dropItemsOnGround(matchId, items, position);

        if (dropped.length > 0) {
            io.to(`match:${matchId}`).emit("loot-dropped", {
                playerId,
                reason: "death",
                items: dropped
            });
        }

        return dropped;
    } catch (error) {
        console.error("Death loot error:", error.message);
        return [];
    }
}

// Tell nearby players a gun was fired (and roughly where).
// Suppressed weapons are only heard from close by.
function broadcastGunshot(io, matchId, shooterId, position, weaponName, suppressed) {
    if (!position) return;

    const hearing = suppressed
        ? HANDLING_CONFIG.suppressedHearingRange
        : HANDLING_CONFIG.gunshotHearingRange;

    const prefix = `${matchId}:`;

    for (const [key, listenerPosition] of playerPositions.entries()) {
        if (!key.startsWith(prefix)) continue;

        const listenerId = Number(key.slice(prefix.length));
        if (listenerId === Number(shooterId)) continue;

        const distance = calculateDistance(position, listenerPosition);
        if (distance > hearing) continue;

        io.to(`player:${listenerId}`).emit("gunshot-heard", {
            // Rounded so the exact shooter position is not leaked.
            position: {
                x: Math.round(position.x / 5) * 5,
                y: Math.round(position.y / 5) * 5,
                z: Math.round(position.z / 5) * 5
            },
            distance: Math.round(distance),
            weapon: weaponName,
            suppressed: Boolean(suppressed)
        });
    }
}

// Knocked players can only crawl and be revived.
function rejectIfKnocked(socket, matchId, playerId) {
    const combat = getCombatPlayer(matchId, playerId);

    if (combat && combat.knocked) {
        emitError(socket, "You are knocked down");
        return true;
    }

    return false;
}

function getPosition(matchId, playerId) {
    return playerPositions.get(
        getPlayerKey(matchId, playerId)
    ) || null;
}

function isValidPlayerId(value) {
    return (
        (typeof value === "number" || typeof value === "string") &&
        String(value).trim() !== "" &&
        Number.isSafeInteger(Number(value)) &&
        Number(value) > 0
    );
}

function isValidDirection(direction) {
    return (
        direction &&
        Number.isFinite(direction.x) &&
        Number.isFinite(direction.y) &&
        Number.isFinite(direction.z)
    );
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
            p_target_is_alive: targetCombat.isAlive,
            p_shooter_kills: shooterCombat.kills,
            p_eliminated: result.eliminated,
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

    return {
        alivePlayers: data.alivePlayers,
        eliminatedPlayers: data.eliminatedPlayers
    };
}

// ==========================================
// GRENADE EXPLOSION DAMAGE
// ==========================================

async function applyGrenadeDamage(io, matchId, attackerId, explosion) {
    let teams;

    try {
        teams = await getMatchTeams(matchId);
    } catch (error) {
        console.error("Grenade team lookup error:", error.message);
        return;
    }

    if (teams.status !== "in_progress") {
        return;
    }

    // Find living players inside the blast radius.
    const prefix = `${matchId}:`;
    const targets = [];

    for (const [key, position] of playerPositions.entries()) {
        if (!key.startsWith(prefix)) continue;

        const targetId = Number(key.slice(prefix.length));

        if (!isValidPlayerId(targetId)) continue;
        if (targetId === Number(attackerId)) continue;

        // Friendly fire is off in duo and squad.
        if (areTeammates(teams, attackerId, targetId)) continue;

        const targetCombat = getCombatPlayer(matchId, targetId);
        if (!targetCombat || !targetCombat.isAlive) continue;

        const distance = calculateDistance(position, explosion.position);
        if (distance > explosion.radius) continue;

        const blockingWall = findBlockingGlooWall(
            matchId,
            explosion.position,
            position
        );

        if (blockingWall) {
            const wallHit = damageGlooWall(
                matchId,
                blockingWall.id,
                getExplosionDamage(explosion.damage, explosion.radius, distance)
            );

            if (wallHit.success) {
                io.to(`match:${matchId}`).emit("gloo-wall-damaged", {
                    wallId: blockingWall.id,
                    health: wallHit.wall.health,
                    destroyed: wallHit.destroyed
                });
            }

            continue;
        }

        targets.push({ targetId, distance });
    }

    let anyEliminated = false;

    // Apply and persist one target at a time so the
    // alive/eliminated counts from the database stay in order.
    for (const { targetId, distance } of targets) {
        const damage = getExplosionDamage(
            explosion.damage,
            explosion.radius,
            distance
        );

        if (damage <= 0) continue;

        const attackerCombatSnapshot = snapshotCombatState(matchId, attackerId);
        const targetCombatSnapshot = snapshotCombatState(matchId, targetId);
        const targetInventorySnapshot = snapshotInventory(matchId, targetId);

        const result = applyExplosionDamage(
            matchId,
            attackerId,
            targetId,
            damage,
            { allowKnock: hasStandingTeammate(teams, matchId, targetId) }
        );

        if (!result.success) continue;

        let matchCounts;

        try {
            matchCounts = await persistCombatResult(
                matchId,
                attackerId,
                targetId,
                result
            );
        } catch (databaseError) {
            console.error(
                "Grenade damage synchronization error:",
                databaseError.message
            );
            reportError("Grenade damage save failed", databaseError, { matchId });

            restoreCombatState(matchId, attackerId, attackerCombatSnapshot);
            restoreCombatState(matchId, targetId, targetCombatSnapshot);
            restoreInventory(matchId, targetId, targetInventorySnapshot);

            io.to(`player:${attackerId}`).emit("combat-sync-warning", {
                success: false,
                rolledBack: true,
                targetId,
                message: "Grenade damage could not be saved and was rolled back"
            });

            continue;
        }

        if (result.eliminated) {
            cancelPlayerReload(matchId, targetId);
        }

        interruptHealing(io, matchId, targetId, "damaged");

        io.to(`player:${targetId}`).to(getSpectateRoom(matchId, targetId)).emit("player-damaged", {
            success: true,
            attackerId,
            weapon: result.weapon,
            hitLocation: result.hitLocation,
            damage: result.damage,
            armorDamage: result.armorDamage,
            healthDamage: result.healthDamage,
            health: result.targetHealth,
            armor: result.targetArmor,
            helmetDamage: result.helmetDamage,
            vestDamage: result.vestDamage,
            helmetBroken: result.helmetBroken,
            vestBroken: result.vestBroken,
            helmetLevel: result.helmetLevel,
            helmetDurability: result.helmetDurability,
            vestLevel: result.vestLevel,
            vestDurability: result.vestDurability,
            eliminated: result.eliminated
        });

        io.to(`player:${attackerId}`).emit("damage-confirmed", {
            success: true,
            hit: true,
            weapon: result.weapon,
            targetId,
            hitLocation: result.hitLocation,
            damage: result.damage,
            armorDamage: result.armorDamage,
            healthDamage: result.healthDamage,
            targetHealth: result.targetHealth,
            targetArmor: result.targetArmor,
            eliminated: result.eliminated,
            totalKills: result.totalKills,
            alivePlayers: matchCounts.alivePlayers
        });

        if (result.knocked) {
            io.to(`match:${matchId}`).emit("player-knocked", {
                attackerId,
                victimId: targetId,
                weapon: result.weapon,
                knockHealth: result.knockHealth
            });
        }

        if (result.eliminated) {
            anyEliminated = true;

            dropDeathLoot(io, matchId, targetId);

            io.to(`match:${matchId}`).emit("player-eliminated", {
                attackerId,
                victimId: targetId,
                weapon: result.weapon,
                totalKills: result.totalKills,
                alivePlayers: matchCounts.alivePlayers,
                eliminatedPlayers: matchCounts.eliminatedPlayers
            });
        }

        if (result.knocked || result.eliminated) {
            if (await handleTeamWipe(io, matchId, targetId)) {
                anyEliminated = true;
            }
        }
    }

    if (anyEliminated) {
        await completeMatchIfFinished(io, matchId, attackerId);
    }
}

// ==========================================
// SAFE ZONE
// ==========================================

let gameIo = null;
let zoneTickRunning = false;

const ZONE_STATUS_CHECK_MS = 15000;

// Start the shrinking zone for a match (no-op if running).
function startSafeZone(matchId) {
    const result = createZone(matchId);

    if (result.success && result.created && gameIo) {
        updateZone(result.zone);
        gameIo.to(`match:${matchId}`).emit(
            "zone-update",
            getZoneState(result.zone)
        );

        console.log("SAFE ZONE STARTED:", matchId);
    }

    return result;
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

// ==========================================
// TEAMS, KNOCKDOWN AND TEAM WIPE
// ==========================================

// Game mode plus every member's team and alive flag.
async function getMatchTeams(matchId) {
    const [matchResult, membersResult] = await Promise.all([
        supabaseAdmin
            .from("matches")
            .select("status, game_mode")
            .eq("id", matchId)
            .single(),
        supabaseAdmin
            .from("match_players")
            .select("player_id, team_number, is_alive")
            .eq("match_id", matchId)
    ]);

    if (matchResult.error) throw matchResult.error;
    if (membersResult.error) throw membersResult.error;

    return {
        status: matchResult.data.status,
        gameMode: matchResult.data.game_mode,
        members: membersResult.data || []
    };
}

function getTeamNumber(teams, playerId) {
    const member = teams.members.find(
        m => Number(m.player_id) === Number(playerId)
    );
    return member ? member.team_number : null;
}

function areTeammates(teams, a, b) {
    if (teams.gameMode === "solo") return false;

    const teamA = getTeamNumber(teams, a);
    return teamA !== null && teamA === getTeamNumber(teams, b);
}

// A teammate who is alive and not knocked.
function hasStandingTeammate(teams, matchId, playerId) {
    if (teams.gameMode === "solo") return false;

    const team = getTeamNumber(teams, playerId);

    return teams.members.some(m => {
        if (Number(m.player_id) === Number(playerId)) return false;
        if (m.team_number !== team || !m.is_alive) return false;

        const combat = getCombatPlayer(matchId, m.player_id);
        return !combat || (combat.isAlive && !combat.knocked);
    });
}

// Eliminate a knocked player (bleed-out or team wipe),
// crediting whoever knocked them.
async function eliminateKnockedPlayer(io, matchId, playerId, cause) {
    const combat = getCombatPlayer(matchId, playerId);
    if (!combat || !combat.knocked) return false;

    const creditId = combat.knockedBy;

    clearKnock(combat);
    combat.health = 0;
    combat.isAlive = false;

    let saved;

    try {
        saved = await persistZoneDamage(matchId, playerId, 0, true);
    } catch (error) {
        console.error("Knocked elimination sync error:", error.message);
        reportError("Knocked elimination save failed", error, { matchId });
        knockPlayer(combat, creditId);
        combat.isAlive = true;
        return false;
    }

    if (!saved.applied) return false;

    // Credit the kill to the player who knocked them.
    const killer = creditId ? getCombatPlayer(matchId, creditId) : null;

    if (killer) {
        killer.kills++;

        const { error: killError } = await supabaseAdmin
            .from("match_players")
            .update({ kills: killer.kills })
            .eq("match_id", matchId)
            .eq("player_id", creditId);

        if (killError) {
            console.error("Kill credit sync error:", killError.message);
        }
    }

    cancelPlayerReload(matchId, playerId);
    interruptHealing(io, matchId, playerId, "eliminated");

    dropDeathLoot(io, matchId, playerId);

    io.to(`match:${matchId}`).emit("player-eliminated", {
        attackerId: creditId || null,
        victimId: playerId,
        cause,
        weapon: cause === "bled out" ? "Bleed Out" : "Team Wiped",
        totalKills: killer ? killer.kills : undefined,
        alivePlayers: saved.alivePlayers,
        eliminatedPlayers: saved.eliminatedPlayers
    });

    return true;
}

// If every living member of the team is knocked, the
// whole team is out. Returns true if anyone was eliminated.
async function handleTeamWipe(io, matchId, playerId) {
    const teams = await getMatchTeams(matchId);
    if (teams.gameMode === "solo") return false;

    const team = getTeamNumber(teams, playerId);
    const aliveTeammates = teams.members.filter(
        m => m.team_number === team && m.is_alive
    );

    const anyStanding = aliveTeammates.some(m => {
        const combat = getCombatPlayer(matchId, m.player_id);
        return !combat || (combat.isAlive && !combat.knocked);
    });

    if (anyStanding) return false;

    let eliminated = false;

    for (const m of aliveTeammates) {
        if (await eliminateKnockedPlayer(io, matchId, m.player_id, "team wiped")) {
            eliminated = true;
        }
    }

    return eliminated;
}

// Bleed-out tick for every knocked player.
let knockTickRunning = false;

async function processKnockdowns(io) {
    if (knockTickRunning) return;
    knockTickRunning = true;

    try {
        const now = Date.now();
        const affectedMatches = new Set();

        for (const key of playerPositions.keys()) {
            const split = key.lastIndexOf(":");
            const matchId = key.slice(0, split);
            const playerId = Number(key.slice(split + 1));

            const combat = getCombatPlayer(matchId, playerId);
            if (!combat || !combat.isAlive || !combat.knocked) continue;

            const elapsed = combat.lastBleedAt
                ? (now - combat.lastBleedAt) / 1000
                : 1;

            combat.lastBleedAt = now;
            combat.knockHealth = Math.max(
                0,
                combat.knockHealth -
                    KNOCK_CONFIG.bleedPerSecond * Math.min(elapsed, 5)
            );

            io.to(`player:${playerId}`).emit("bleeding", {
                knockHealth: Math.round(combat.knockHealth)
            });

            if (combat.knockHealth <= 0) {
                if (await eliminateKnockedPlayer(io, matchId, playerId, "bled out")) {
                    affectedMatches.add(matchId);
                }
            }
        }

        for (const matchId of affectedMatches) {
            await completeMatchIfFinished(io, matchId);
        }
    } catch (error) {
        console.error("Knockdown tick error:", error.message);
    } finally {
        knockTickRunning = false;
    }
}

// Time limit reached: eliminate disconnected players, then
// the weakest players, until a single team remains.
async function forceEndMatch(io, matchId) {
    const teams = await getMatchTeams(matchId);
    if (teams.status !== "in_progress") return;

    const alive = teams.members.filter(m => m.is_alive);

    const eliminate = async (playerId, cause) => {
        const combat = getCombatPlayer(matchId, playerId);

        if (combat) {
            clearKnock(combat);
            combat.health = 0;
            combat.isAlive = false;
        }

        const saved = await persistZoneDamage(matchId, playerId, 0, true);
        if (!saved.applied) return;

        interruptHealing(io, matchId, playerId, "eliminated");

        dropDeathLoot(io, matchId, playerId);

        io.to(`match:${matchId}`).emit("player-eliminated", {
            attackerId: null,
            victimId: playerId,
            cause,
            weapon: "Time Limit",
            alivePlayers: saved.alivePlayers,
            eliminatedPlayers: saved.eliminatedPlayers
        });
    };

    const teamKey = m => (teams.gameMode === "solo" ? m.player_id : m.team_number);
    const aliveTeams = () => new Set(alive.map(teamKey)).size;

    // 1. Players with no live state (never connected / left).
    for (const m of [...alive]) {
        if (aliveTeams() <= 1) break;

        const combat = getCombatPlayer(matchId, m.player_id);
        const position = getPosition(matchId, m.player_id);

        if (!combat || !position) {
            await eliminate(m.player_id, "disconnected at time limit");
            alive.splice(alive.indexOf(m), 1);
        }
    }

    // 2. Lowest health first (knocked players count as 0).
    alive.sort((a, b) => {
        const ca = getCombatPlayer(matchId, a.player_id);
        const cb = getCombatPlayer(matchId, b.player_id);
        const ha = ca?.knocked ? 0 : ca?.health ?? 0;
        const hb = cb?.knocked ? 0 : cb?.health ?? 0;
        return ha - hb;
    });

    while (aliveTeams() > 1 && alive.length > 0) {
        const weakest = alive.shift();
        await eliminate(weakest.player_id, "time limit");
    }

    await completeMatchIfFinished(io, matchId);
}

async function processZone(io, zone) {
    const matchId = zone.matchId;
    const now = Date.now();

    // Periodically confirm the match is still running.
    if (
        !zone.lastStatusCheckAt ||
        now - zone.lastStatusCheckAt >= ZONE_STATUS_CHECK_MS
    ) {
        zone.lastStatusCheckAt = now;

        const { data: match } = await supabaseAdmin
            .from("matches")
            .select("status")
            .eq("id", matchId)
            .maybeSingle();

        if (!match || match.status !== "in_progress") {
            removeZone(matchId);
            return;
        }
    }

    if (updateZone(zone, now)) {
        io.to(`match:${matchId}`).emit("zone-update", getZoneState(zone));
    }

    // Not hosted here (no players connected to this server):
    // keep the circle's timing but never damage or end it.
    if (!hasLocalPlayers(matchId)) {
        zone.lastDamageAt = now;
        return;
    }

    // Time limit: force a result after the final circle.
    if (isMatchOvertime(zone, now)) {
        if (!zone.forceEnding) {
            zone.forceEnding = true;

            try {
                await forceEndMatch(io, matchId);
            } finally {
                zone.forceEnding = false;
            }
        }

        return;
    }

    const elapsedSeconds = zone.lastDamageAt
        ? (now - zone.lastDamageAt) / 1000
        : 1;

    zone.lastDamageAt = now;

    const damage = Math.max(
        1,
        Math.round(zone.damagePerSecond * Math.min(elapsedSeconds, 5))
    );

    // Living players in this match, and who is outside.
    const prefix = `${matchId}:`;
    const alive = [];

    for (const [key, position] of playerPositions.entries()) {
        if (!key.startsWith(prefix)) continue;

        const playerId = Number(key.slice(prefix.length));
        const combat = getCombatPlayer(matchId, playerId);

        // Knocked players are handled by the bleed-out tick.
        if (!combat || !combat.isAlive || combat.knocked) continue;

        alive.push({
            playerId,
            combat,
            outside: isOutsideZone(zone, position)
        });
    }

    const outside = alive.filter(p => p.outside);
    if (outside.length === 0) return;

    // The zone must never eliminate the last player alive.
    const lethal = outside.filter(p => p.combat.health <= damage);
    let spared = null;

    if (lethal.length > 0 && lethal.length >= alive.length) {
        spared = lethal.reduce((best, p) =>
            p.combat.health > best.combat.health ? p : best
        );
    }

    let anyEliminated = false;

    for (const target of outside) {
        const { playerId, combat } = target;
        const previousHealth = combat.health;

        let newHealth = Math.max(0, previousHealth - damage);

        if (target === spared && newHealth === 0) {
            newHealth = Math.min(previousHealth, 1);
        }

        if (newHealth === previousHealth) continue;

        const eliminated = newHealth === 0;

        combat.health = newHealth;
        if (eliminated) combat.isAlive = false;

        let saved;

        try {
            saved = await persistZoneDamage(
                matchId,
                playerId,
                newHealth,
                eliminated
            );
        } catch (error) {
            console.error("Zone damage sync error:", error.message);
            reportError("Zone damage save failed", error, { matchId });
            combat.health = previousHealth;
            combat.isAlive = true;
            continue;
        }

        if (!saved.applied) {
            // Database says this player is already out.
            combat.isAlive = false;
            continue;
        }

        interruptHealing(io, matchId, playerId, "zone damage");

        io.to(`player:${playerId}`).to(getSpectateRoom(matchId, playerId)).emit("zone-damage", {
            damage: previousHealth - newHealth,
            health: newHealth,
            eliminated
        });

        if (eliminated) {
            anyEliminated = true;
            cancelPlayerReload(matchId, playerId);

            dropDeathLoot(io, matchId, playerId);

            io.to(`match:${matchId}`).emit("player-eliminated", {
                attackerId: null,
                victimId: playerId,
                cause: "zone",
                weapon: "Safe Zone",
                alivePlayers: saved.alivePlayers,
                eliminatedPlayers: saved.eliminatedPlayers
            });

            // Knocked teammates left with nobody standing.
            try {
                await handleTeamWipe(io, matchId, playerId);
            } catch (error) {
                console.error("Zone team wipe error:", error.message);
            }
        }
    }

    if (anyEliminated) {
        await completeMatchIfFinished(io, matchId);
    }
}

async function processSafeZones(io) {
    if (zoneTickRunning) return;
    zoneTickRunning = true;

    try {
        for (const zone of getActiveZones()) {
            try {
                await processZone(io, zone);
            } catch (error) {
                console.error(
                    "Safe zone tick error:",
                    zone.matchId,
                    error.message
                );
            }
        }
    } finally {
        zoneTickRunning = false;
    }
}

// ==========================================
// AUTOMATIC MATCH COMPLETION (SHARED)
// ==========================================
// Called after any elimination (gun, grenade, zone).
// warnPlayerId: who to notify if completion fails (optional).

async function completeMatchIfFinished(io, matchId, warnPlayerId = null) {
    try {
        const completion = await finalizeMatch(matchId);

        if (!completion.completed) return false;

        const finalResults = await getFinalMatchResults(matchId);

        io.to(`match:${matchId}`).emit("match-completed", {
            success: true,
            matchId: matchId,
            winnerTeam: completion.winnerTeam,
            winnerPlayerId: completion.winnerPlayerId,
            resultsRecorded: completion.resultsRecorded,
            results: finalResults,
            message: "Battle completed successfully"
        });

        cleanupCompletedMatch(matchId);

        console.log(
            "MATCH COMPLETED:",
            matchId,
            "Winner:",
            completion.winnerPlayerId
        );

        // Levels and coins (runs after XP was awarded).
        applyMatchProgression(matchId)
            .then(summary => {
                for (const entry of summary) {
                    io.to(`player:${entry.playerId}`).emit(
                        "progression-updated",
                        { matchId, ...entry }
                    );
                }
            })
            .catch(error =>
                console.error("Progression error:", error.message)
            );

        return true;

    } catch (completionError) {
        console.error(
            "Match completion error:",
            completionError.message
        );
        reportError("Match completion failed", completionError, { matchId });

        if (warnPlayerId) {
            io.to(`player:${warnPlayerId}`).emit("match-completion-warning", {
                success: false,
                message: "Player elimination saved, but match completion needs attention"
            });
        }

        return false;
    }
}

// ==========================================
// INITIALIZE SOCKET SERVER
// ==========================================

function initializeGameSocket(io) {
    console.log("Initializing INDIAN BATTLE FIELDS Socket.IO...");

    gameIo = io;

    // Safe zone tick: shrink circles and apply zone damage.
    setInterval(() => processSafeZones(io), 1000).unref();

    // Knocked players bleed out.
    setInterval(() => processKnockdowns(io), 1000).unref();

    // Save live match state for crash recovery.
    setInterval(() => saveAllMatchSnapshots(), SNAPSHOT_INTERVAL_MS).unref();

    // Write changed player positions in batches.
    setInterval(
        () => flushDirtyPositions(),
        MOVEMENT_CONFIG.POSITION_FLUSH_MS
    ).unref();

    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth?.token;

            if (!token) {
                return next(new Error("Authentication token required"));
            }

            const { data, error } =
                await supabaseAdmin.auth.getUser(token);

            if (error || !data.user) {
                return next(new Error("Invalid authentication token"));
            }

            const { data: player, error: playerError } =
                await supabaseAdmin
                    .from("players")
                    .select("*")
                    .eq("auth_user_id", data.user.id)
                    .single();

            if (playerError || !player) {
                return next(new Error("Game player profile not found"));
            }

            socket.user = data.user;
            socket.player = player;

            next();
        } catch (error) {
            console.error("Socket authentication error:", error.message);
            next(new Error("Socket authentication failed"));
        }
    });

    io.on("connection", socket => {
        const player = socket.player;
        const playerRoom = `player:${player.id}`;

        socket.join(playerRoom);

        // Drop events that exceed their per-second limit.
        const allowEvent = createSocketRateLimiter();
        let lastLimitWarningAt = 0;

        socket.use(([eventName, payload], next) => {
            // Payloads, when sent, must be plain objects.
            if (
                payload !== undefined &&
                payload !== null &&
                (typeof payload !== "object" || Array.isArray(payload))
            ) {
                return emitError(socket, "Invalid request payload");
            }

            if (allowEvent(eventName)) return next();

            const now = Date.now();

            if (now - lastLimitWarningAt > 1000) {
                lastLimitWarningAt = now;
                socket.emit("rate-limited", {
                    event: eventName,
                    message: "Too many requests. Slow down."
                });
            }
            // Not calling next() drops the event.
        });

        console.log(
            `Player connected: ${player.username} (${player.id})`
        );

        socket.emit("connection-success", {
            success: true,
            message: "Connected to INDIAN BATTLE FIELDS",
            playerId: player.id,
            username: player.username
        });

        // ==================================
        // JOIN MATCH
        // ==================================

        socket.on("join-match", async (payload = {}) => {
            try {
                const { matchId } = payload;

                if (!isValidMatchId(matchId)) {
                    return emitError(socket, "Invalid match ID");
                }

                if (
                    socket.currentMatchId &&
                    socket.currentMatchId !== matchId
                ) {
                    return emitError(
                        socket,
                        "Leave your current match first"
                    );
                }

                const { data: match, error: matchError } =
                    await supabaseAdmin
                        .from("matches")
                        .select("*")
                        .eq("id", matchId)
                        .single();

                if (matchError || !match) {
                    return emitError(socket, "Match not found");
                }

                // Multi-server: matches are played on their host.
                if (isClusterEnabled()) {
                    if (match.host_server && match.host_server !== getServerId()) {
                        return socket.emit("wrong-server", {
                            matchId,
                            serverUrl: await getServerUrl(match.host_server),
                            message: "This match is hosted on another server"
                        });
                    }

                    if (!match.host_server) {
                        await claimMatch(matchId);
                    }
                }

                const { data: membership, error: membershipError } =
                    await supabaseAdmin
                        .from("match_players")
                        .select("*")
                        .eq("match_id", matchId)
                        .eq("player_id", player.id)
                        .single();

                if (membershipError || !membership) {
                    return emitError(
                        socket,
                        "You are not a member of this match"
                    );
                }

                if (["completed", "cancelled"].includes(match.status)) {
                    return emitError(socket, "This match has ended");
                }

                socket.currentMatchId = matchId;
                await socket.join(`match:${matchId}`);

                // Server restarted mid-match: restore saved state.
                await restoreMatchIfNeeded(io, match);

                // Reconnected within the grace period.
                if (clearDisconnectTimer(matchId, player.id)) {
                    socket.to(`match:${matchId}`).emit("player-reconnected", {
                        playerId: player.id
                    });
                }

                let restoredPosition = getPosition(
                    matchId,
                    player.id
                );

                if (!restoredPosition) {
                    const hasSavedPosition =
                        membership.current_x !== null &&
                        membership.current_x !== undefined &&
                        membership.current_y !== null &&
                        membership.current_y !== undefined &&
                        membership.current_z !== null &&
                        membership.current_z !== undefined;

                    restoredPosition = hasSavedPosition
                        ? {
                            x: Number(membership.current_x),
                            y: Number(membership.current_y),
                            z: Number(membership.current_z)
                        }
                        : {
                            x: Number(membership.spawn_x),
                            y: Number(membership.spawn_y),
                            z: Number(membership.spawn_z)
                        };

                    if (isValidPosition(restoredPosition)) {
                        playerPositions.set(
                            getPlayerKey(matchId, player.id),
                            restoredPosition
                        );
                    } else {
                        restoredPosition = null;
                    }
                }

                // Restore inventory and armor.
                let inventory = getInventory(matchId, player.id);

                if (!inventory) {
                    createInventory(matchId, player.id);

                    const armorRestoreResult = restoreEquippedArmor(
                        matchId,
                        player.id,
                        {
                            helmet_level: membership.helmet_level ?? 0,
                            helmet_durability: membership.helmet_durability ?? 0,
                            vest_level: membership.vest_level ?? 0,
                            vest_durability: membership.vest_durability ?? 0
                        }
                    );

                    if (!armorRestoreResult.success) {
                        throw new Error(armorRestoreResult.message);
                    }
                }

                // Bots start with a rifle or SMG and ammo, so they
                // are a real opponent without searching for loot.
                if (isBotUsername(player.username)) {
                    const botInventory = getInventory(matchId, player.id);

                    if (botInventory && botInventory.weapons.length === 0) {
                        const weaponId = ["vajra", "trishul", "garuda", "agni", "nagini"][
                            Math.floor(Math.random() * 5)
                        ];

                        addWeapon(matchId, player.id, weaponId);
                        addAmmunition(
                            matchId,
                            player.id,
                            WEAPONS[weaponId].category === "smg" ? "smg_ammo" : "rifle_ammo",
                            150
                        );
                    }
                }

                if (!getCombatPlayer(matchId, player.id)) {
                    createCombatPlayer(matchId, player.id);
                }

                const combatPlayer = getCombatPlayer(
                    matchId,
                    player.id
                );

                if (combatPlayer) {
                    combatPlayer.health = membership.health ?? 100;
                    combatPlayer.armor = membership.armor ?? 0;
                    combatPlayer.kills = membership.kills ?? 0;
                    combatPlayer.isAlive = membership.is_alive ?? true;
                    combatPlayer.teamNumber = membership.team_number ?? null;

                    // Alive with 0 health means the player was knocked
                    // down before reconnecting / a server restart.
                    if (
                        combatPlayer.isAlive &&
                        combatPlayer.health <= 0 &&
                        !combatPlayer.knocked
                    ) {
                        knockPlayer(combatPlayer, null);
                    }

                    syncCombatArmorState(matchId, player.id);
                }

                const { data: members, error: membersError } =
                    await supabaseAdmin
                        .from("match_players")
                        .select(`
                            player_id,
                            team_number,
                            is_alive,
                            spawn_x,
                            spawn_y,
                            spawn_z,
                            current_x,
                            current_y,
                            current_z,
                            helmet_level,
                            helmet_durability,
                            vest_level,
                            vest_durability
                        `)
                        .eq("match_id", matchId);

                if (membersError) throw membersError;

                const playerPositionSnapshot = [];

                for (const member of members || []) {
                    let position = getPosition(
                        matchId,
                        member.player_id
                    );

                    if (!position) {
                        const hasSavedPosition =
                            member.current_x !== null &&
                            member.current_x !== undefined &&
                            member.current_y !== null &&
                            member.current_y !== undefined &&
                            member.current_z !== null &&
                            member.current_z !== undefined;

                        const savedPosition = hasSavedPosition
                            ? {
                                x: Number(member.current_x),
                                y: Number(member.current_y),
                                z: Number(member.current_z)
                            }
                            : {
                                x: Number(member.spawn_x),
                                y: Number(member.spawn_y),
                                z: Number(member.spawn_z)
                            };

                        if (isValidPosition(savedPosition)) {
                            playerPositions.set(
                                getPlayerKey(matchId, member.player_id),
                                savedPosition
                            );

                            position = savedPosition;
                        }
                    }

                    if (position) {
                        playerPositionSnapshot.push({
                            playerId: member.player_id,
                            position
                        });
                    }
                }

                // Everyone's equipped skins, so clients can draw them.
                const cosmetics = await getEquippedCosmeticsFor(
                    (members || []).map(member => member.player_id)
                );

                socket.emit("joined-match", {
                    success: true,
                    matchId,
                    matchCode: match.match_code,
                    mapName: match.map_name,
                    gameMode: match.game_mode,
                    matchStatus: match.status,
                    members: (members || []).map(member => ({
                        ...member,
                        cosmetics: cosmetics[member.player_id] || {}
                    })),
                    playerPositions: playerPositionSnapshot
                });

                socket.to(`match:${matchId}`).emit("player-joined", {
                    playerId: player.id,
                    username: player.username,
                    cosmetics: cosmetics[player.id] || {}
                });

                socket.emit("player-spawned", {
                    playerId: player.id,
                    position: getPosition(matchId, player.id)
                });

                // Safe zone: recover it after a server restart,
                // and send the current state to this player.
                if (
                    match.status === "in_progress" &&
                    match.battlefield_status === "active"
                ) {
                    startSafeZone(matchId);
                }

                const zone = getZone(matchId);

                if (zone) {
                    socket.emit("zone-update", getZoneState(zone));
                }

            } catch (error) {
                console.error("Join match error:", error.message);
                emitError(socket, "Unable to join match");
            }
        });

        // ==================================
        // AIRCRAFT DROP START
        // ==================================

        socket.on("start-aircraft-drop", async () => {
            try {
                const matchId = socket.currentMatchId;

                if (!matchId) {
                    return emitError(socket, "Join a match first");
                }

                if (matchDropStarted.has(matchId)) {
                    return emitError(
                        socket,
                        "Aircraft drop has already started"
                    );
                }

                const { data: match } = await supabaseAdmin
                    .from("matches")
                    .select("status, map_name")
                    .eq("id", matchId)
                    .single();

                if (!match || match.status !== "in_progress") {
                    return emitError(socket, "Match is not in progress");
                }

                const { data: membership } = await supabaseAdmin
                    .from("match_players")
                    .select("player_id")
                    .eq("match_id", matchId)
                    .eq("player_id", player.id)
                    .single();

                if (!membership) {
                    return emitError(socket, "Match membership required");
                }

                const lootResult = generateMatchLoot(matchId);

                if (lootResult.status !== "success") {
                    return emitError(
                        socket,
                        lootResult.message || "Unable to generate match loot"
                    );
                }

                const flightPath = generateFlightPath(match.map_name);

                const flightDurationMs = getFlightDurationMs(flightPath);

                // Eject anyone still on board when the flight ends.
                const ejectTimer = setTimeout(() => {
                    ejectRemainingPlayers(io, matchId).catch(error =>
                        console.error("Aircraft eject error:", error.message)
                    );
                }, flightDurationMs);

                matchFlights.set(matchId, {
                    flightPath,
                    startedAt: Date.now(),
                    durationMs: flightDurationMs,
                    ejectTimer
                });

                matchDropStarted.add(matchId);

                io.to(`match:${matchId}`).emit("aircraft-started", {
                    success: true,
                    matchId,
                    flightPath,
                    flightDurationMs,
                    lootCount: lootResult.totalLoot
                });

            } catch (error) {
                console.error("Aircraft start error:", error.message);
                emitError(socket, "Unable to start aircraft");
            }
        });

        // ==================================
        // AIRCRAFT POSITION
        // ==================================

        socket.on("aircraft-position", payload => {
            const matchId = socket.currentMatchId;
            if (!matchId) return;

            const flight = matchFlights.get(matchId);
            if (!flight) return;

            const progress = Number(payload?.progress);

            if (
                !Number.isFinite(progress) ||
                progress < 0 ||
                progress > 1
            ) {
                return emitError(socket, "Invalid aircraft progress");
            }

            const position = getAircraftPosition(
                flight.flightPath,
                progress
            );

            io.to(`match:${matchId}`).emit(
                "aircraft-position-updated",
                { position, progress }
            );
        });

        // ==================================
        // AIRCRAFT FLIGHT COMPLETED
        // ==================================

        socket.on("aircraft-flight-completed", () => {
            const matchId = socket.currentMatchId;
            if (!matchId) return;

            io.to(`match:${matchId}`).emit(
                "aircraft-flight-completed",
                { success: true }
            );
        });

        // ==================================
        // JUMP FROM AIRCRAFT
        // ==================================

        socket.on("jump-from-aircraft", async payload => {
            try {
                const matchId = socket.currentMatchId;

                if (!matchId) {
                    return emitError(socket, "Join a match first");
                }

                const flight = matchFlights.get(matchId);

                if (!flight) {
                    return emitError(socket, "Aircraft has not started");
                }

                const progress = Number(payload?.progress);

                if (
                    !Number.isFinite(progress) ||
                    progress < 0 ||
                    progress > 1
                ) {
                    return emitError(socket, "Invalid jump position");
                }

                const aircraftPosition = getAircraftPosition(
                    flight.flightPath,
                    progress
                );

                const result = jumpFromAircraft(
                    matchId,
                    player.id,
                    aircraftPosition
                );

                if (!result.success) {
                    return emitError(socket, result.message);
                }

                await persistPlayerPosition(
                    matchId,
                    player.id,
                    aircraftPosition
                );

                playerPositions.set(
                    getPlayerKey(matchId, player.id),
                    aircraftPosition
                );

                socket.emit("jump-started", result);

                socket.to(`match:${matchId}`).emit("player-jumped", {
                    playerId: player.id
                });

            } catch (error) {
                console.error("Aircraft jump error:", error.message);
                emitError(socket, "Unable to process aircraft jump");
            }
        });

        // ==================================
        // DEPLOY PARACHUTE
        // ==================================

        socket.on("deploy-parachute", () => {
            const matchId = socket.currentMatchId;
            if (!matchId) return;

            const result = deployParachute(matchId, player.id);

            if (!result.success) {
                return emitError(socket, result.message);
            }

            socket.emit("parachute-deployed", result);

            socket.to(`match:${matchId}`).emit(
                "player-parachute-deployed",
                { playerId: player.id }
            );
        });

        // ==================================
        // DROP POSITION UPDATE
        // ==================================

        socket.on("drop-position-update", async payload => {
            try {
                const matchId = socket.currentMatchId;
                if (!matchId) return;

                const position = payload?.position;

                if (!isValidPosition(position)) {
                    return emitError(socket, "Invalid drop position");
                }

                const result = updateDropPosition(
                    matchId,
                    player.id,
                    position
                );

                if (!result.success) {
                    return emitError(socket, result.message);
                }

                const acceptedPosition = result.position || position;

                markPositionDirty(matchId, player.id, acceptedPosition);

                playerPositions.set(
                    getPlayerKey(matchId, player.id),
                    acceptedPosition
                );

                io.to(`match:${matchId}`).emit(
                    "player-drop-position",
                    {
                        playerId: player.id,
                        position: acceptedPosition,
                        state: result.state
                    }
                );

            } catch (error) {
                console.error("Drop position error:", error.message);
                emitError(socket, "Unable to save drop position");
            }
        });

        // ==================================
        // GET DROP STATUS
        // ==================================

        socket.on("get-drop-status", () => {
            const matchId = socket.currentMatchId;
            if (!matchId) return;

            socket.emit(
                "drop-status",
                getDropStatus(matchId, player.id)
            );
        });

        // ==================================
        // PLAYER MOVEMENT
        // ==================================

        socket.on("player-move", async payload => {
            try {
                const matchId = socket.currentMatchId;

                if (!matchId) {
                    return socket.emit("player-move-ack", {
                        success: false,
                        message: "Join a match first"
                    });
                }

                const newPosition = payload?.position;

                if (!isValidPosition(newPosition)) {
                    return socket.emit("player-move-ack", {
                        success: false,
                        message: "Invalid player position"
                    });
                }

                const key = getPlayerKey(matchId, player.id);
                const combatPlayer = getCombatPlayer(matchId, player.id);

                if (combatPlayer && !combatPlayer.isAlive) {
                    return socket.emit("player-move-ack", {
                        success: false,
                        message: "Eliminated players cannot move"
                    });
                }

                const drop = getDropStatus(matchId, player.id);

                if (drop && drop.state !== "landed") {
                    return socket.emit("player-move-ack", {
                        success: false,
                        message: "Cannot move normally while parachuting"
                    });
                }

                // Aircraft has left but this player has not jumped.
                if (!drop && matchDropStarted.has(matchId)) {
                    return socket.emit("player-move-ack", {
                        success: false,
                        message: "Still in the aircraft. Jump first"
                    });
                }

                // Ground rules after landing: no flying, no
                // sinking below ground, limited step-up height.
                if (drop && drop.state === "landed") {
                    const groundCheck = validateGroundMovement(
                        playerPositions.get(getPlayerKey(matchId, player.id)),
                        newPosition
                    );

                    if (!groundCheck.success) {
                        return socket.emit("player-move-ack", {
                            success: false,
                            message: groundCheck.message
                        });
                    }
                }

                const now = Date.now();
                const previousTime = lastMovementTimes.get(key) || 0;

                if (
                    now - previousTime <
                    MOVEMENT_CONFIG.MIN_INTERVAL_MS
                ) {
                    return socket.emit("player-move-ack", {
                        success: false,
                        message: "Movement rate limit exceeded"
                    });
                }

                const oldPosition = playerPositions.get(key);

                if (oldPosition) {
                    const distance = calculateDistance(
                        oldPosition,
                        newPosition
                    );

                    if (
                        distance >
                        MOVEMENT_CONFIG.MAX_MOVEMENT_DISTANCE
                    ) {
                        return socket.emit("player-move-ack", {
                            success: false,
                            message: "Movement speed limit exceeded",
                            distance
                        });
                    }

                    // Knocked players can only crawl.
                    if (
                        combatPlayer?.knocked &&
                        distance > KNOCK_CONFIG.crawlMaxStep
                    ) {
                        return socket.emit("player-move-ack", {
                            success: false,
                            message: "Knocked players can only crawl",
                            distance
                        });
                    }

                    // Speed over time: distance allowed since the
                    // last accepted move.
                    if (previousTime) {
                        const elapsedSeconds = Math.min(
                            1,
                            (now - previousTime) / 1000
                        );

                        const speed = combatPlayer?.knocked
                            ? MOVEMENT_CONFIG.KNOCKED_SPEED_PER_SECOND
                            : MOVEMENT_CONFIG.MAX_SPEED_PER_SECOND;

                        const horizontal = Math.hypot(
                            newPosition.x - oldPosition.x,
                            newPosition.z - oldPosition.z
                        );

                        if (
                            horizontal >
                            speed * elapsedSeconds + MOVEMENT_CONFIG.SPEED_TOLERANCE
                        ) {
                            recordViolation(
                                matchId,
                                player.id,
                                "speed",
                                `${horizontal.toFixed(1)} units in ${Math.round(elapsedSeconds * 1000)}ms`
                            );

                            return socket.emit("player-move-ack", {
                                success: false,
                                message: "Movement speed limit exceeded",
                                distance: horizontal
                            });
                        }
                    }
                }

                lastMovementTimes.set(key, now);
                playerPositions.set(key, newPosition);

                // Saved to the database in batches (see
                // flushDirtyPositions), not on every move.
                markPositionDirty(matchId, player.id, newPosition);

                // Spectators of the mover follow their camera.
                io.to(getSpectateRoom(matchId, player.id)).emit(
                    "spectated-player-moved",
                    {
                        playerId: player.id,
                        matchId,
                        position: newPosition
                    }
                );

                // Recipients come from memory: living players in
                // this match within visibility range.
                const prefix = `${matchId}:`;
                let broadcastCount = 0;

                for (const [viewerKey, viewerPosition] of playerPositions.entries()) {
                    if (!viewerKey.startsWith(prefix)) continue;

                    const viewerId = Number(viewerKey.slice(prefix.length));
                    if (viewerId === Number(player.id)) continue;

                    const viewerCombat = getCombatPlayer(matchId, viewerId);
                    if (viewerCombat && !viewerCombat.isAlive) continue;

                    if (
                        calculateDistance(viewerPosition, newPosition) >
                        MOVEMENT_CONFIG.VISIBILITY_RANGE
                    ) {
                        continue;
                    }

                    // Hidden by smoke, or the viewer is flashed.
                    const hidden =
                        isPlayerFlashed(matchId, viewerId) ||
                        isLineOfSightBlocked(
                            matchId,
                            newPosition,
                            viewerPosition
                        );

                    // Spectators of this viewer see what they see.
                    io.to(`player:${viewerId}`)
                        .to(getSpectateRoom(matchId, viewerId))
                        .emit("player-moved", {
                            playerId: player.id,
                            matchId,
                            position: hidden ? null : newPosition,
                            hidden
                        });

                    broadcastCount++;
                }

                socket.emit("player-move-ack", {
                    success: true,
                    message: "Movement accepted and broadcast",
                    playerId: player.id,
                    matchId,
                    position: newPosition,
                    recipients: broadcastCount
                });

            } catch (error) {
                console.error("Player movement error:", error);

                socket.emit("player-move-ack", {
                    success: false,
                    message: "Unable to process player movement"
                });

                emitError(socket, "Unable to process player movement");
            }
        });

        // ==================================
        // GET NEARBY LOOT
        // ==================================

        socket.on("get-nearby-loot", () => {
            const matchId = socket.currentMatchId;
            if (!matchId) return;

            const position = getPosition(matchId, player.id);

            if (!position) {
                return emitError(
                    socket,
                    "Player position unavailable"
                );
            }

            const loot = getAvailableLoot(matchId);

            const nearbyLoot = loot.filter(item =>
                calculateDistance(position, item.position) <=
                MOVEMENT_CONFIG.LOOT_SEARCH_DISTANCE
            );

            socket.emit("nearby-loot", {
                success: true,
                total: nearbyLoot.length,
                loot: nearbyLoot
            });
        });

        // ==================================
        // PICKUP LOOT
        // ==================================

        socket.on("pickup-loot", async payload => {
            try {
                const matchId = socket.currentMatchId;
                if (!matchId) return;

                const { lootId } = payload || {};

                if (typeof lootId !== "string") {
                    return emitError(socket, "Invalid loot ID");
                }

                const { data: membership } = await supabaseAdmin
                    .from("match_players")
                    .select("is_alive")
                    .eq("match_id", matchId)
                    .eq("player_id", player.id)
                    .single();

                if (!membership || !membership.is_alive) {
                    return emitError(
                        socket,
                        "Player cannot collect loot"
                    );
                }

                if (rejectIfKnocked(socket, matchId, player.id)) return;

                const position = getPosition(matchId, player.id);

                if (!position) {
                    return emitError(
                        socket,
                        "Player position unavailable"
                    );
                }

                const inventory = getInventory(matchId, player.id);

                if (!inventory) {
                    return emitError(socket, "Inventory not found");
                }

                const result = pickupLoot(matchId, lootId, position);

                if (!result.success) {
                    return emitError(socket, result.message);
                }

                let inventoryResult = addLootItem(
                    matchId,
                    player.id,
                    result.item
                );

                // Weapon slots full: swap with the weapon the player
                // chose (payload.swapWeaponId), dropping it here.
                if (
                    !inventoryResult.success &&
                    result.item.itemType === "weapon" &&
                    typeof payload?.swapWeaponId === "string"
                ) {
                    const inventoryBefore = snapshotInventory(matchId, player.id);
                    const combatBefore = snapshotCombatState(matchId, player.id);

                    const swap = dropPlayerItem(io, matchId, player.id, {
                        itemType: "weapon",
                        itemId: payload.swapWeaponId
                    });

                    if (swap.status === "success") {
                        inventoryResult = addLootItem(
                            matchId,
                            player.id,
                            result.item
                        );

                        if (!inventoryResult.success) {
                            // Undo the swap.
                            restoreInventory(matchId, player.id, inventoryBefore);
                            restoreCombatState(matchId, player.id, combatBefore);

                            for (const entry of swap.dropped) {
                                entry.isAvailable = false;
                            }

                            io.to(`match:${matchId}`).emit("loot-removed", {
                                lootIds: swap.dropped.map(e => e.lootId),
                                playerId: player.id
                            });
                        }
                    }
                }

                if (!inventoryResult.success) {
                    restoreLoot(matchId, lootId);

                    return emitError(
                        socket,
                        inventoryResult.message ||
                        "Unable to add loot to inventory"
                    );
                }

                socket.emit("loot-collected", {
                    success: true,
                    item: result.item,
                    inventory: getInventory(matchId, player.id),
                    throwables: getThrowableInventory(matchId, player.id)
                });

                if (inventoryResult.throwable) {
                    socket.emit(
                        "throwable-inventory-updated",
                        inventoryResult.throwables
                    );
                }

                socket.to(`match:${matchId}`).emit("loot-removed", {
                    lootId,
                    playerId: player.id
                });

            } catch (error) {
                console.error("Loot pickup error:", error.message);
                emitError(socket, "Unable to collect loot");
            }
        });

        // ==================================
        // DEVELOPMENT-ONLY COMBAT TEST SETUP
        // ==================================

        socket.on("dev-prepare-combat-test", payload => {
            try {
                if (
                    process.env.NODE_ENV === "production" ||
                    process.env.ENABLE_DEV_TEST_EVENTS !== "true"
                ) {
                    return emitError(
                        socket,
                        "Development test events are disabled"
                    );
                }

                const matchId = socket.currentMatchId;

                if (!matchId) {
                    return emitError(socket, "Join a match first");
                }

                const {
                    weaponId,
                    helmetLevel,
                    vestLevel,
                    ammoId,
                    ammoQuantity,
                    healingItemId,
                    healingQuantity,
                    attachmentId
                } = payload || {};

                const results = {};

                if (attachmentId) {
                    const attachmentResult = addAttachment(
                        matchId,
                        player.id,
                        attachmentId
                    );

                    if (attachmentResult.status !== "success") {
                        return emitError(socket, attachmentResult.message);
                    }

                    results.attachment = attachmentResult;
                }

                if (healingItemId) {
                    const healingResult = addHealingItem(
                        matchId,
                        player.id,
                        healingItemId,
                        Number(healingQuantity) || 1
                    );

                    if (healingResult.status !== "success") {
                        return emitError(socket, healingResult.message);
                    }

                    results.healing = {
                        itemId: healingItemId,
                        added: healingResult.addedQuantity
                    };
                }

                if (ammoId) {
                    const ammoResult = addAmmunition(
                        matchId,
                        player.id,
                        ammoId,
                        Number(ammoQuantity) || 60
                    );

                    if (ammoResult.status !== "success") {
                        return emitError(socket, ammoResult.message);
                    }

                    results.ammo = {
                        ammoId: ammoResult.ammoId,
                        added: ammoResult.addedQuantity
                    };
                }

                if (weaponId) {
                    const weaponResult = addWeapon(
                        matchId,
                        player.id,
                        weaponId
                    );

                    if (weaponResult.status !== "success") {
                        return emitError(socket, weaponResult.message);
                    }

                    results.weapon = weaponResult.weapon;
                }

                if (helmetLevel !== undefined) {
                    const helmetResult = addHelmet(
                        matchId,
                        player.id,
                        helmetLevel
                    );

                    if (helmetResult.status !== "success") {
                        return emitError(socket, helmetResult.message);
                    }

                    results.helmet = helmetResult.helmet;
                }

                if (vestLevel !== undefined) {
                    const vestResult = addVest(
                        matchId,
                        player.id,
                        vestLevel
                    );

                    if (vestResult.status !== "success") {
                        return emitError(socket, vestResult.message);
                    }

                    results.vest = vestResult.vest;
                }

                socket.emit("dev-combat-test-ready", {
                    success: true,
                    playerId: player.id,
                    results,
                    inventory: getInventory(matchId, player.id)
                });

            } catch (error) {
                console.error(
                    "Development combat test setup error:",
                    error.message
                );

                emitError(socket, "Combat test setup failed");
            }
        });


        // ==================================
        // DEV ONLY: TELEPORT (FOR TESTS)
        // ==================================
        // Lets automated tests place players without walking
        // under the speed limit. Disabled unless
        // ENABLE_DEV_TEST_EVENTS=true (never in production).

        socket.on("dev-teleport", payload => {
            if (
                process.env.NODE_ENV === "production" ||
                process.env.ENABLE_DEV_TEST_EVENTS !== "true"
            ) {
                return emitError(socket, "Development test events are disabled");
            }

            const matchId = socket.currentMatchId;
            if (!matchId) return emitError(socket, "Join a match first");

            const position = payload?.position;

            if (!isValidPosition(position)) {
                return emitError(socket, "Invalid position");
            }

            const key = getPlayerKey(matchId, player.id);

            playerPositions.set(key, { ...position });
            lastMovementTimes.delete(key);
            markPositionDirty(matchId, player.id, position);

            socket.emit("dev-teleported", { success: true, position });
        });

        // ==================================
        // GET INVENTORY
        // ==================================

        socket.on("get-inventory", () => {
            const matchId = socket.currentMatchId;
            if (!matchId) return;

            socket.emit("inventory-data", {
                success: true,
                inventory: getInventory(matchId, player.id)
            });
        });

        // ==================================
        // EQUIP WEAPON
        // ==================================

        socket.on("equip-weapon", payload => {
            const matchId = socket.currentMatchId;

            if (!matchId) {
                return emitError(socket, "Join a match first");
            }

            const { weaponId } = payload || {};

            if (
                typeof weaponId !== "string" ||
                !WEAPONS[weaponId]
            ) {
                return emitError(socket, "Invalid weapon");
            }

            const result = equipWeapon(
                matchId,
                player.id,
                weaponId
            );

            if (!result.success) {
                return emitError(socket, result.message);
            }

            socket.emit("weapon-equipped", result);
        });

        // ==================================
        // EQUIP HELMET
        // ==================================

        socket.on("equip-helmet", async payload => {
            try {
                const matchId = socket.currentMatchId;

                if (!matchId) {
                    return emitError(socket, "Join a match first");
                }

                const { itemIdentifier } = payload || {};

                const result = equipHelmet(
                    matchId,
                    player.id,
                    itemIdentifier
                );

                if (result.status !== "success") {
                    return emitError(socket, result.message);
                }

                const armorState = await persistEquippedArmor(
                    matchId,
                    player.id
                );

                const response = {
                    success: true,
                    message: result.message,
                    armorType: "helmet",
                    equipped: result.equipped,
                    replaced: result.replaced,
                    armor: armorState,
                    inventory: getInventory(matchId, player.id)
                };

                socket.emit("armor-equipped", response);

                socket.to(`match:${matchId}`).emit(
                    "player-armor-updated",
                    {
                        playerId: player.id,
                        armor: armorState
                    }
                );

            } catch (error) {
                console.error("Equip helmet error:", error.message);
                emitError(socket, "Unable to equip helmet");
            }
        });

        // ==================================
        // EQUIP VEST
        // ==================================

        socket.on("equip-vest", async payload => {
            try {
                const matchId = socket.currentMatchId;

                if (!matchId) {
                    return emitError(socket, "Join a match first");
                }

                const { itemIdentifier } = payload || {};

                const result = equipVest(
                    matchId,
                    player.id,
                    itemIdentifier
                );

                if (result.status !== "success") {
                    return emitError(socket, result.message);
                }

                const armorState = await persistEquippedArmor(
                    matchId,
                    player.id
                );

                const response = {
                    success: true,
                    message: result.message,
                    armorType: "vest",
                    equipped: result.equipped,
                    replaced: result.replaced,
                    armor: armorState,
                    inventory: getInventory(matchId, player.id)
                };

                socket.emit("armor-equipped", response);

                socket.to(`match:${matchId}`).emit(
                    "player-armor-updated",
                    {
                        playerId: player.id,
                        armor: armorState
                    }
                );

            } catch (error) {
                console.error("Equip vest error:", error.message);
                emitError(socket, "Unable to equip vest");
            }
        });

        // ==================================
        // UNEQUIP HELMET
        // ==================================

        socket.on("unequip-helmet", async () => {
            try {
                const matchId = socket.currentMatchId;

                if (!matchId) {
                    return emitError(socket, "Join a match first");
                }

                const result = unequipHelmet(matchId, player.id);

                if (result.status !== "success") {
                    return emitError(socket, result.message);
                }

                const armorState = await persistEquippedArmor(
                    matchId,
                    player.id
                );

                socket.emit("armor-unequipped", {
                    success: true,
                    message: result.message,
                    armorType: "helmet",
                    unequipped: result.unequipped,
                    armor: armorState,
                    inventory: getInventory(matchId, player.id)
                });

                socket.to(`match:${matchId}`).emit(
                    "player-armor-updated",
                    {
                        playerId: player.id,
                        armor: armorState
                    }
                );

            } catch (error) {
                console.error("Unequip helmet error:", error.message);
                emitError(socket, "Unable to unequip helmet");
            }
        });

        // ==================================
        // UNEQUIP VEST
        // ==================================

        socket.on("unequip-vest", async () => {
            try {
                const matchId = socket.currentMatchId;

                if (!matchId) {
                    return emitError(socket, "Join a match first");
                }

                const result = unequipVest(matchId, player.id);

                if (result.status !== "success") {
                    return emitError(socket, result.message);
                }

                const armorState = await persistEquippedArmor(
                    matchId,
                    player.id
                );

                socket.emit("armor-unequipped", {
                    success: true,
                    message: result.message,
                    armorType: "vest",
                    unequipped: result.unequipped,
                    armor: armorState,
                    inventory: getInventory(matchId, player.id)
                });

                socket.to(`match:${matchId}`).emit(
                    "player-armor-updated",
                    {
                        playerId: player.id,
                        armor: armorState
                    }
                );

            } catch (error) {
                console.error("Unequip vest error:", error.message);
                emitError(socket, "Unable to unequip vest");
            }
        });

        // ==========================================
        // FIRE WEAPON - SERVER HIT DETECTION
        // WITH DATABASE ROLLBACK
        // ==========================================

        socket.on("fire-weapon", async payload => {
            try {
                const matchId = socket.currentMatchId;

                if (!matchId) {
                    return emitError(socket, "Join a match first");
                }

                // Do not allow combat after match completion.
                const { data: match, error: matchError } =
                    await supabaseAdmin
                        .from("matches")
                        .select("status")
                        .eq("id", matchId)
                        .single();

                if (matchError || !match) {
                    return emitError(socket, "Unable to verify match status");
                }

                if (match.status !== "in_progress") {
                    return emitError(socket, "Match is not in progress");
                }

                const { targetId, direction } = payload || {};

                if (!isValidPlayerId(targetId)) {
                    return emitError(socket, "Invalid target player");
                }

                const numericTargetId = Number(targetId);

                if (numericTargetId === Number(player.id)) {
                    return emitError(socket, "You cannot target yourself");
                }

                if (!isValidDirection(direction)) {
                    return emitError(socket, "Invalid aim direction");
                }

                let teams;

                try {
                    teams = await getMatchTeams(matchId);
                } catch (membershipError) {
                    console.error(
                        "Combat membership lookup:",
                        membershipError.message
                    );

                    return emitError(socket, "Unable to verify match players");
                }

                const memberships = teams.members;

                // Friendly fire is off in duo and squad.
                if (areTeammates(teams, player.id, numericTargetId)) {
                    return emitError(socket, "You cannot damage teammates");
                }

                const shooterMembership = (memberships || []).find(
                    member => Number(member.player_id) === Number(player.id)
                );

                const targetMembership = (memberships || []).find(
                    member => Number(member.player_id) === numericTargetId
                );

                if (!shooterMembership || !targetMembership) {
                    return emitError(
                        socket,
                        "Both players must belong to the same match"
                    );
                }

                if (
                    !shooterMembership.is_alive ||
                    !targetMembership.is_alive
                ) {
                    return emitError(
                        socket,
                        "Shooter or target is eliminated"
                    );
                }

                const shooterCombat = getCombatPlayer(
                    matchId,
                    player.id
                );

                const targetCombat = getCombatPlayer(
                    matchId,
                    numericTargetId
                );

                if (!shooterCombat || !shooterCombat.isAlive) {
                    return emitError(
                        socket,
                        "Your combat state is unavailable or eliminated"
                    );
                }

                if (!targetCombat || !targetCombat.isAlive) {
                    return emitError(
                        socket,
                        "Target combat state is unavailable"
                    );
                }

                const shooterPosition = getPosition(
                    matchId,
                    player.id
                );

                const targetPosition = getPosition(
                    matchId,
                    numericTargetId
                );

                if (!shooterPosition || !targetPosition) {
                    return emitError(
                        socket,
                        "Shooter or target position unavailable"
                    );
                }

                const origin = {
                    x: shooterPosition.x,
                    y: shooterPosition.y + 1.5,
                    z: shooterPosition.z
                };

                // ==========================================
                // SNAPSHOT STATE FOR ROLLBACK
                // ==========================================

                const shooterCombatSnapshot = snapshotCombatState(
                    matchId,
                    player.id
                );

                const targetCombatSnapshot = snapshotCombatState(
                    matchId,
                    numericTargetId
                );

                const shooterInventorySnapshot = snapshotInventory(
                    matchId,
                    player.id
                );

                const targetInventorySnapshot = snapshotInventory(
                    matchId,
                    numericTargetId
                );

                const rollbackShot = () => {
                    const restores = [
                        restoreCombatState(
                            matchId,
                            player.id,
                            shooterCombatSnapshot
                        ),
                        restoreCombatState(
                            matchId,
                            numericTargetId,
                            targetCombatSnapshot
                        ),
                        restoreInventory(
                            matchId,
                            player.id,
                            shooterInventorySnapshot
                        ),
                        restoreInventory(
                            matchId,
                            numericTargetId,
                            targetInventorySnapshot
                        )
                    ];

                    const failed = restores.filter(
                        restore => !restore || !restore.success
                    );

                    if (failed.length > 0) {
                        console.error(
                            "Combat rollback incomplete:",
                            failed.map(restore => restore?.message)
                        );
                    }

                    return failed.length === 0;
                };

                const result = fireWeapon(
                    matchId,
                    player.id,
                    numericTargetId,
                    {
                        shooterPosition,
                        targetPosition,
                        origin,
                        direction: {
                            x: direction.x,
                            y: direction.y,
                            z: direction.z
                        },
                        obstacles: getGlooWallObstacles(matchId),
                        allowKnock: hasStandingTeammate(
                            teams,
                            matchId,
                            numericTargetId
                        )
                    }
                );

                if (!result.success) {
                    return emitError(socket, result.message);
                }

                // Flag inhuman aim snaps for review.
                recordAim(matchId, player.id, direction);

                // Firing cancels the shooter's own heal.
                interruptHealing(io, matchId, player.id, "fired weapon");

                broadcastGunshot(
                    io,
                    matchId,
                    player.id,
                    shooterPosition,
                    result.weapon,
                    result.suppressed
                );

                // ==========================================
                // SHOT BLOCKED BY GLOO WALL
                // ==========================================

                if (result.blocked) {
                    const wallHit = damageGlooWall(
                        matchId,
                        result.obstacleId,
                        result.wallDamage
                    );

                    if (wallHit.success) {
                        io.to(`match:${matchId}`).emit("gloo-wall-damaged", {
                            wallId: result.obstacleId,
                            health: wallHit.wall.health,
                            destroyed: wallHit.destroyed
                        });
                    }

                    socket.emit("shot-fired", {
                        success: true,
                        hit: false,
                        blocked: true,
                        wallId: result.obstacleId,
                        weapon: result.weapon,
                        targetId: numericTargetId,
                        remainingAmmo: result.remainingAmmo
                    });

                    socket.emit("damage-confirmed", {
                        success: true,
                        hit: false,
                        blocked: true,
                        targetId: numericTargetId,
                        damage: 0,
                        eliminated: false,
                        remainingAmmo: result.remainingAmmo
                    });

                    return;
                }

                if (!result.hit) {
                    socket.emit("shot-fired", {
                        success: true,
                        hit: false,
                        weapon: result.weapon,
                        targetId: numericTargetId,
                        remainingAmmo: result.remainingAmmo
                    });

                    socket.emit("damage-confirmed", {
                        success: true,
                        hit: false,
                        targetId: numericTargetId,
                        damage: 0,
                        eliminated: false,
                        remainingAmmo: result.remainingAmmo
                    });

                    return;
                }

                let matchCounts = null;

                // ==========================================
                // SAVE COMBAT RESULT
                // ==========================================

                try {
                    matchCounts = await persistCombatResult(
                        matchId,
                        player.id,
                        numericTargetId,
                        result
                    );
                } catch (databaseError) {
                    console.error(
                        "Combat database synchronization error:",
                        databaseError.message
                    );
                    reportError("Combat save failed", databaseError, { matchId });

                    // Undo in-memory damage, ammo, armor and kills so
                    // server memory stays consistent with the database.
                    const rolledBack = rollbackShot();

                    const restoredShooter = getCombatPlayer(
                        matchId,
                        player.id
                    );

                    socket.emit("combat-sync-warning", {
                        success: false,
                        rolledBack,
                        targetId: numericTargetId,
                        remainingAmmo:
                            restoredShooter?.weapons?.[
                                restoredShooter.activeWeapon
                            ]?.magazineAmmo,
                        message: rolledBack
                            ? "Shot could not be saved and was rolled back"
                            : "Combat database synchronization failed"
                    });

                    return;
                }

                interruptHealing(io, matchId, numericTargetId, "damaged");

                socket.emit("shot-fired", {
                    success: true,
                    hit: true,
                    weapon: result.weapon,
                    targetId: numericTargetId,
                    remainingAmmo: result.remainingAmmo
                });

                // ==========================================
                // NOTIFY DAMAGED PLAYER
                // ==========================================

                io.to(`player:${numericTargetId}`).to(getSpectateRoom(matchId, numericTargetId)).emit(
                    "player-damaged",
                    {
                        success: true,
                        attackerId: player.id,
                        weapon: result.weapon,
                        hitLocation: result.hitLocation,
                        damage: result.damage,
                        armorDamage: result.armorDamage,
                        healthDamage: result.healthDamage,
                        health: result.targetHealth,
                        armor: result.targetArmor,
                        helmetDamage: result.helmetDamage,
                        vestDamage: result.vestDamage,
                        helmetBroken: result.helmetBroken,
                        vestBroken: result.vestBroken,
                        helmetLevel: result.helmetLevel,
                        helmetDurability: result.helmetDurability,
                        vestLevel: result.vestLevel,
                        vestDurability: result.vestDurability,
                        eliminated: result.eliminated
                    }
                );

                // ==========================================
                // CONFIRM DAMAGE TO SHOOTER
                // ==========================================

                socket.emit("damage-confirmed", {
                    success: true,
                    hit: true,
                    targetId: numericTargetId,
                    hitLocation: result.hitLocation,
                    damage: result.damage,
                    armorDamage: result.armorDamage,
                    healthDamage: result.healthDamage,
                    targetHealth: result.targetHealth,
                    targetArmor: result.targetArmor,
                    helmetDamage: result.helmetDamage,
                    vestDamage: result.vestDamage,
                    helmetBroken: result.helmetBroken,
                    vestBroken: result.vestBroken,
                    helmetLevel: result.helmetLevel,
                    helmetDurability: result.helmetDurability,
                    vestLevel: result.vestLevel,
                    vestDurability: result.vestDurability,
                    eliminated: result.eliminated,
                    remainingAmmo: result.remainingAmmo,
                    totalKills: result.totalKills,
                    alivePlayers: matchCounts.alivePlayers
                });

                // ==========================================
                // PLAYER KNOCKED DOWN / ELIMINATED
                // ==========================================

                if (result.knocked) {
                    io.to(`match:${matchId}`).emit("player-knocked", {
                        attackerId: player.id,
                        victimId: numericTargetId,
                        weapon: result.weapon,
                        knockHealth: result.knockHealth
                    });
                }

                if (result.eliminated) {

                    dropDeathLoot(io, matchId, numericTargetId);

                    io.to(`match:${matchId}`).emit(
                        "player-eliminated",
                        {
                            attackerId: player.id,
                            victimId: numericTargetId,
                            weapon: result.weapon,
                            totalKills: result.totalKills,
                            alivePlayers: matchCounts.alivePlayers,
                            eliminatedPlayers: matchCounts.eliminatedPlayers
                        }
                    );
                }

                // A knock or kill may leave the team with nobody
                // standing: eliminate its knocked members.
                if (result.knocked || result.eliminated) {
                    const wiped = await handleTeamWipe(
                        io,
                        matchId,
                        numericTargetId
                    );

                    // ======================================
                    // AUTOMATIC MATCH COMPLETION
                    // ======================================

                    if (result.eliminated || wiped) {
                        await completeMatchIfFinished(io, matchId, player.id);
                    }
                }

            } catch (error) {
                console.error("Fire weapon error:", error.message);
                emitError(socket, "Unable to process weapon shot");
            }
        });

        // ==================================
        // RELOAD WEAPON - MATCH STATUS PROTECTION
        // ==================================

        socket.on("reload-weapon", async () => {
            try {
                const matchId = socket.currentMatchId;

                if (!matchId) {
                    return emitError(socket, "Join a match first");
                }

                // Verify match status.
                const { data: match, error: matchError } =
                    await supabaseAdmin
                        .from("matches")
                        .select("status")
                        .eq("id", matchId)
                        .single();

                if (matchError || !match) {
                    return emitError(socket, "Unable to verify match status");
                }

                if (match.status !== "in_progress") {
                    return emitError(socket, "Match is not in progress");
                }

                // Verify player is alive in this match.
                const { data: membership, error: membershipError } =
                    await supabaseAdmin
                        .from("match_players")
                        .select("is_alive")
                        .eq("match_id", matchId)
                        .eq("player_id", player.id)
                        .maybeSingle();

                if (membershipError || !membership) {
                    return emitError(socket, "Match membership not found");
                }

                if (!membership.is_alive) {
                    return emitError(socket, "Eliminated players cannot reload");
                }

                if (rejectIfKnocked(socket, matchId, player.id)) return;

                const combatPlayer = getCombatPlayer(
                    matchId,
                    player.id
                );

                if (!combatPlayer || !combatPlayer.isAlive) {
                    return emitError(socket, "Combat player is unavailable or eliminated");
                }

                // Start reload.
                const result = reloadWeapon(matchId, player.id);

                if (!result.success) {
                    return emitError(socket, result.message);
                }

                socket.emit("reload-started", result);

                // Notify completion only if the match and player
                // are still eligible when the timer finishes.
                setTimeout(async () => {
                    try {
                        const { data: currentMatch, error: currentMatchError } =
                            await supabaseAdmin
                                .from("matches")
                                .select("status")
                                .eq("id", matchId)
                                .single();

                        if (
                            currentMatchError ||
                            !currentMatch ||
                            currentMatch.status !== "in_progress"
                        ) {
                            return;
                        }

                        const currentCombatPlayer = getCombatPlayer(
                            matchId,
                            player.id
                        );

                        if (
                            !currentCombatPlayer ||
                            !currentCombatPlayer.isAlive
                        ) {
                            return;
                        }

                        const weaponState =
                            currentCombatPlayer.weapons[
                                currentCombatPlayer.activeWeapon
                            ];

                        socket.emit("reload-completed", {
                            success: true,
                            inventory: getInventory(matchId, player.id),
                            combat: {
                                activeWeapon: currentCombatPlayer.activeWeapon,
                                weaponState: weaponState
                            }
                        });
                    } catch (timerError) {
                        console.error(
                            "Reload completion error:",
                            timerError.message
                        );
                    }
                }, result.reloadTimeMs + 100);

            } catch (error) {
                console.error("Reload weapon error:", error.message);
                emitError(socket, "Unable to reload weapon");
            }
        });

        // ==================================
        // COMBAT STATE
        // ==================================

        socket.on("combat-state", () => {
            const matchId = socket.currentMatchId;
            if (!matchId) return;

            const combatPlayer = getCombatPlayer(
                matchId,
                player.id
            );

            if (!combatPlayer) {
                return emitError(socket, "Combat player not found");
            }

            socket.emit("combat-state-data", {
                success: true,
                combat: combatPlayer
            });
        });

        // ==================================
        // LEAVE MATCH
        // ==================================

        socket.on("leave-match", async () => {
            const matchId = socket.currentMatchId;
            if (!matchId) return;

            try {
                const { error } = await supabaseAdmin.rpc(
                    "leave_match",
                    {
                        p_match_id: matchId,
                        p_player_id: player.id
                    }
                );

                if (error) {
                    console.error("Leave match RPC:", error.message);
                    return emitError(socket, "Unable to leave match");
                }

                removeDrop(matchId, player.id);
                removeCombatPlayer(matchId, player.id);
                removePlayerInventory(matchId, player.id);
                removeThrowablePlayer(matchId, player.id);
                interruptHealing(io, matchId, player.id, "left match");

                playerPositions.delete(
                    getPlayerKey(matchId, player.id)
                );

                lastMovementTimes.delete(
                    getPlayerKey(matchId, player.id)
                );

                socket.leave(`match:${matchId}`);

                socket.to(`match:${matchId}`).emit("player-left", {
                    playerId: player.id
                });

                socket.emit("left-match", {
                    success: true,
                    message: "Successfully left match"
                });

                socket.currentMatchId = null;

            } catch (error) {
                console.error("Leave match error:", error.message);
                emitError(socket, "Unable to leave match");
            }
        });

        // ==================================
        // DISCONNECT
        // ==================================

        socket.on("disconnect", () => {
            console.log(
                `Player disconnected: ${player.username}`
            );

            const matchId = socket.currentMatchId;

            if (matchId) {
                interruptHealing(io, matchId, player.id, "disconnected");

                socket.to(`match:${matchId}`).emit(
                    "player-disconnected",
                    {
                        playerId: player.id,
                        reconnectGraceMs: RECONNECT_GRACE_MS
                    }
                );

                // Eliminated if they do not come back in time.
                scheduleDisconnectElimination(io, matchId, player.id)
                    .catch(error =>
                        console.error("Disconnect schedule error:", error.message)
                    );
            }
        });

        // ==========================================
        // THROW GRENADE
        // ==========================================

        socket.on("throw-grenade", async payload => {
            try {
                const matchId = socket.currentMatchId;
                if (!matchId) return emitError(socket, "Join a match first");

                const { data: match, error } = await supabaseAdmin
                    .from("matches")
                    .select("status")
                    .eq("id", matchId)
                    .single();

                if (error || match.status !== "in_progress") {
                    return emitError(socket, "Match is not in progress");
                }

                const player = socket.player;
                if (!player?.id) return emitError(socket, "Player not authenticated");

                const membership = await supabaseAdmin
                    .from("match_players")
                    .select("is_alive")
                    .eq("match_id", matchId)
                    .eq("player_id", player.id)
                    .maybeSingle();

                if (!membership.data?.is_alive) {
                    return emitError(socket, "Eliminated players cannot throw grenades");
                }

                if (rejectIfKnocked(socket, matchId, player.id)) return;

                const origin = playerPositions.get(getPlayerKey(matchId, player.id));
                if (!origin) return emitError(socket, "Player position unavailable");

                const result = throwGrenade(
                    matchId,
                    player.id,
                    payload?.type,
                    origin,
                    payload?.target
                );

                if (!result.success) return emitError(socket, result.message);

                io.to(`match:${matchId}`).emit("grenade-thrown", {
                    grenade: result.grenade
                });

                socket.emit("throwable-inventory-updated", result.inventory);

                const delay = Math.max(
                    0,
                    result.grenade.explodesAt - Date.now()
                );

                setTimeout(async () => {
                    try {
                        const explosion = resolveGrenade(matchId, result.grenade.id);
                        if (!explosion.success) return;

                        io.to(`match:${matchId}`).emit("grenade-exploded", explosion);

                        // Flash: blind nearby players.
                        if (explosion.type === "flash") {
                            applyFlashEffect(io, matchId, explosion);
                        }

                        // Smoke: create a cloud that hides players.
                        if (explosion.type === "smoke") {
                            const cloud = addSmokeCloud(matchId, explosion);

                            io.to(`match:${matchId}`).emit("smoke-deployed", {
                                id: cloud.id,
                                position: cloud.position,
                                radius: cloud.radius,
                                expiresAt: cloud.expiresAt
                            });

                            setTimeout(() => {
                                io.to(`match:${matchId}`).emit("smoke-cleared", {
                                    id: cloud.id
                                });
                            }, cloud.expiresAt - Date.now());
                        }

                        // Only frag grenades deal damage.
                        if (explosion.damage > 0) {
                            await applyGrenadeDamage(
                                io,
                                matchId,
                                player.id,
                                explosion
                            );
                        }
                    } catch (explosionError) {
                        console.error(
                            "Grenade explosion error:",
                            explosionError.message
                        );
                    }
                }, delay);

            } catch (error) {
                console.error("Throw grenade error:", error.message);
                emitError(socket, "Unable to throw grenade");
            }
        });

        // ==========================================
        // DEPLOY GLOO WALL
        // ==========================================

        socket.on("deploy-gloo-wall", async payload => {
            try {
                const matchId = socket.currentMatchId;
                if (!matchId) return emitError(socket, "Join a match first");

                const { data: match, error } = await supabaseAdmin
                    .from("matches")
                    .select("status")
                    .eq("id", matchId)
                    .single();

                if (error || match.status !== "in_progress") {
                    return emitError(socket, "Match is not in progress");
                }

                const player = socket.player;
                if (!player?.id) return emitError(socket, "Player not authenticated");

                const membership = await supabaseAdmin
                    .from("match_players")
                    .select("is_alive")
                    .eq("match_id", matchId)
                    .eq("player_id", player.id)
                    .maybeSingle();

                if (!membership.data?.is_alive) {
                    return emitError(socket, "Eliminated players cannot deploy walls");
                }

                if (rejectIfKnocked(socket, matchId, player.id)) return;

                const origin = playerPositions.get(getPlayerKey(matchId, player.id));
                if (!origin) return emitError(socket, "Player position unavailable");

                const requested = payload?.position;

                if (
                    !requested ||
                    !Number.isFinite(requested.x) ||
                    !Number.isFinite(requested.y) ||
                    !Number.isFinite(requested.z)
                ) {
                    return emitError(socket, "Invalid wall position");
                }

                const dx = requested.x - origin.x;
                const dy = requested.y - origin.y;
                const dz = requested.z - origin.z;

                if (Math.sqrt(dx * dx + dy * dy + dz * dz) > GLOO_CONFIG.maxDistance) {
                    return emitError(socket, "Gloo wall placement is too far away");
                }

                const result = deployGlooWall(
                    matchId,
                    player.id,
                    requested,
                    payload?.facing
                );

                if (!result.success) return emitError(socket, result.message);

                io.to(`match:${matchId}`).emit("gloo-wall-deployed", result.wall);
                socket.emit("throwable-inventory-updated", result.inventory);

            } catch (error) {
                console.error("Gloo wall error:", error.message);
                emitError(socket, "Unable to deploy gloo wall");
            }
        });

        // ==========================================
        // GET ACTIVE GLOO WALLS
        // ==========================================

        // ==========================================
        // USE HEALING ITEM
        // ==========================================

        socket.on("use-healing-item", async payload => {
            try {
                const matchId = socket.currentMatchId;
                if (!matchId) return emitError(socket, "Join a match first");

                const itemId = payload?.itemId;

                if (typeof itemId !== "string" || !HEALING_ITEMS[itemId]) {
                    return emitError(socket, "Invalid healing item");
                }

                const { data: match, error: matchError } = await supabaseAdmin
                    .from("matches")
                    .select("status")
                    .eq("id", matchId)
                    .single();

                if (matchError || !match || match.status !== "in_progress") {
                    return emitError(socket, "Match is not in progress");
                }

                const { data: membership, error: membershipError } =
                    await supabaseAdmin
                        .from("match_players")
                        .select("is_alive")
                        .eq("match_id", matchId)
                        .eq("player_id", player.id)
                        .maybeSingle();

                if (membershipError || !membership?.is_alive) {
                    return emitError(socket, "Eliminated players cannot heal");
                }

                if (rejectIfKnocked(socket, matchId, player.id)) return;

                const combat = getCombatPlayer(matchId, player.id);

                if (!combat || !combat.isAlive) {
                    return emitError(socket, "Combat player is unavailable or eliminated");
                }

                const allowed = canHeal(itemId, combat.health);
                if (!allowed.success) return emitError(socket, allowed.message);

                if (getHealingCount(matchId, player.id, itemId) <= 0) {
                    return emitError(
                        socket,
                        `No ${HEALING_ITEMS[itemId].name} remaining`
                    );
                }

                const started = startHealing(
                    matchId,
                    player.id,
                    itemId,
                    () => finishHealing(matchId, itemId)
                );

                if (!started.success) return emitError(socket, started.message);

                socket.emit("healing-started", started);

                socket.to(`match:${matchId}`).emit("player-healing", {
                    playerId: player.id,
                    itemId,
                    durationMs: started.durationMs
                });

            } catch (error) {
                console.error("Use healing item error:", error.message);
                emitError(socket, "Unable to use healing item");
            }
        });

        // Runs when the heal timer finishes without interruption.
        async function finishHealing(matchId, itemId) {
            try {
                const combat = getCombatPlayer(matchId, player.id);
                if (!combat || !combat.isAlive) return;

                const allowed = canHeal(itemId, combat.health);
                if (!allowed.success) {
                    return emitError(socket, allowed.message);
                }

                const inventorySnapshot = snapshotInventory(matchId, player.id);
                const consumed = consumeHealingItem(matchId, player.id, itemId);

                if (consumed.status !== "success") {
                    return emitError(socket, consumed.message);
                }

                const previousHealth = combat.health;
                const newHealth = calculateHealedHealth(itemId, previousHealth);

                combat.health = newHealth;

                const { data, error } = await supabaseAdmin
                    .from("match_players")
                    .update({ health: newHealth })
                    .eq("match_id", matchId)
                    .eq("player_id", player.id)
                    .eq("is_alive", true)
                    .select("player_id");

                if (error || !data || data.length === 0) {
                    if (error) {
                        console.error("Healing sync error:", error.message);
                        reportError("Healing save failed", error, { matchId });
                    }

                    // Undo: health and the used item.
                    combat.health = previousHealth;
                    restoreInventory(matchId, player.id, inventorySnapshot);

                    return socket.emit("healing-failed", {
                        itemId,
                        message: "Healing could not be saved"
                    });
                }

                socket.emit("healing-completed", {
                    success: true,
                    itemId,
                    healed: newHealth - previousHealth,
                    health: newHealth,
                    remaining: consumed.remaining,
                    inventory: getInventory(matchId, player.id)
                });

                socket.to(`match:${matchId}`).emit("player-healed", {
                    playerId: player.id,
                    itemId
                });

            } catch (error) {
                console.error("Finish healing error:", error.message);
                emitError(socket, "Unable to complete healing");
            }
        }

        socket.on("cancel-healing", () => {
            const matchId = socket.currentMatchId;
            if (!matchId) return;

            if (!interruptHealing(io, matchId, player.id, "cancelled")) {
                emitError(socket, "Not currently healing");
            }
        });

        // ==========================================
        // DROP AN ITEM ON THE GROUND
        // ==========================================
        // payload: { itemType, itemId, quantity?, instanceId? }

        socket.on("drop-item", async payload => {
            try {
                const matchId = socket.currentMatchId;
                if (!matchId) return emitError(socket, "Join a match first");

                const combat = getCombatPlayer(matchId, player.id);

                if (!combat || !combat.isAlive) {
                    return emitError(socket, "Eliminated players cannot drop items");
                }

                if (rejectIfKnocked(socket, matchId, player.id)) return;

                if (
                    typeof payload?.itemType !== "string" ||
                    typeof payload?.itemId !== "string"
                ) {
                    return emitError(socket, "Item type and id are required");
                }

                const result = dropPlayerItem(io, matchId, player.id, {
                    itemType: payload.itemType,
                    itemId: payload.itemId,
                    quantity: Number.isInteger(payload.quantity) ? payload.quantity : null,
                    instanceId: payload.instanceId
                });

                if (result.status !== "success") {
                    return emitError(socket, result.message);
                }

                socket.emit("item-dropped", {
                    success: true,
                    dropped: result.dropped,
                    inventory: getInventory(matchId, player.id),
                    throwables: getThrowableInventory(matchId, player.id)
                });

            } catch (error) {
                console.error("Drop item error:", error.message);
                emitError(socket, "Unable to drop item");
            }
        });

        // ==========================================
        // WEAPON ATTACHMENTS
        // ==========================================

        socket.on("attach-to-weapon", payload => {
            const matchId = socket.currentMatchId;
            if (!matchId) return emitError(socket, "Join a match first");
            if (rejectIfKnocked(socket, matchId, player.id)) return;

            const { weaponId, attachmentId } = payload || {};

            if (typeof weaponId !== "string" || typeof attachmentId !== "string") {
                return emitError(socket, "Weapon and attachment are required");
            }

            const combat = getCombatPlayer(matchId, player.id);

            if (combat?.isReloading && combat.activeWeapon === weaponId) {
                return emitError(socket, "Cannot change attachments while reloading");
            }

            const result = attachToWeapon(matchId, player.id, weaponId, attachmentId);

            if (result.status !== "success") {
                return emitError(socket, result.message);
            }

            clampMagazineToSize(matchId, player.id, weaponId);

            socket.emit("attachment-updated", {
                success: true,
                ...result,
                inventory: getInventory(matchId, player.id)
            });
        });

        socket.on("detach-from-weapon", payload => {
            const matchId = socket.currentMatchId;
            if (!matchId) return emitError(socket, "Join a match first");
            if (rejectIfKnocked(socket, matchId, player.id)) return;

            const { weaponId, slot } = payload || {};

            if (typeof weaponId !== "string" || !ATTACHMENT_SLOTS.includes(slot)) {
                return emitError(socket, "Valid weapon and slot are required");
            }

            const combat = getCombatPlayer(matchId, player.id);

            if (combat?.isReloading && combat.activeWeapon === weaponId) {
                return emitError(socket, "Cannot change attachments while reloading");
            }

            const result = detachFromWeapon(matchId, player.id, weaponId, slot);

            if (result.status !== "success") {
                return emitError(socket, result.message);
            }

            // Removing an extended magazine drops excess rounds
            // back into reserve ammo.
            clampMagazineToSize(matchId, player.id, weaponId);

            socket.emit("attachment-updated", {
                success: true,
                ...result,
                inventory: getInventory(matchId, player.id)
            });
        });

        // ==========================================
        // REVIVE A KNOCKED TEAMMATE
        // ==========================================

        socket.on("revive-teammate", async payload => {
            try {
                const matchId = socket.currentMatchId;
                if (!matchId) return emitError(socket, "Join a match first");

                const targetId = Number(payload?.targetId);

                if (!isValidPlayerId(targetId) || targetId === Number(player.id)) {
                    return emitError(socket, "Invalid teammate");
                }

                const teams = await getMatchTeams(matchId);

                if (teams.status !== "in_progress") {
                    return emitError(socket, "Match is not in progress");
                }

                if (!areTeammates(teams, player.id, targetId)) {
                    return emitError(socket, "You can only revive teammates");
                }

                const reviver = getCombatPlayer(matchId, player.id);
                const target = getCombatPlayer(matchId, targetId);

                if (!reviver || !reviver.isAlive || reviver.knocked) {
                    return emitError(socket, "You cannot revive right now");
                }

                if (!target || !target.isAlive || !target.knocked) {
                    return emitError(socket, "Teammate is not knocked down");
                }

                const reviverPosition = getPosition(matchId, player.id);
                const targetPosition = getPosition(matchId, targetId);

                if (
                    !reviverPosition ||
                    !targetPosition ||
                    calculateDistance(reviverPosition, targetPosition) >
                        KNOCK_CONFIG.reviveRange
                ) {
                    return emitError(socket, "Move closer to revive");
                }

                const started = startRevive(
                    matchId,
                    player.id,
                    targetId,
                    () => finishRevive(matchId, targetId)
                );

                if (!started.success) return emitError(socket, started.message);

                socket.emit("revive-started", started);

                io.to(`player:${targetId}`).emit("being-revived", {
                    reviverId: player.id,
                    durationMs: started.durationMs,
                    endsAt: started.endsAt
                });

            } catch (error) {
                console.error("Revive error:", error.message);
                emitError(socket, "Unable to revive teammate");
            }
        });

        async function finishRevive(matchId, targetId) {
            try {
                const reviver = getCombatPlayer(matchId, player.id);
                const target = getCombatPlayer(matchId, targetId);

                if (
                    !reviver || !reviver.isAlive || reviver.knocked ||
                    !target || !target.isAlive || !target.knocked
                ) {
                    return;
                }

                // Must still be close (small allowance for drift).
                const reviverPosition = getPosition(matchId, player.id);
                const targetPosition = getPosition(matchId, targetId);

                if (
                    !reviverPosition ||
                    !targetPosition ||
                    calculateDistance(reviverPosition, targetPosition) >
                        KNOCK_CONFIG.reviveRange + 1
                ) {
                    return socket.emit("revive-cancelled", {
                        reviverId: player.id,
                        targetId,
                        reason: "moved too far"
                    });
                }

                const knockedBy = target.knockedBy;

                clearKnock(target);
                target.health = KNOCK_CONFIG.reviveHealth;

                const { data, error } = await supabaseAdmin
                    .from("match_players")
                    .update({ health: target.health })
                    .eq("match_id", matchId)
                    .eq("player_id", targetId)
                    .eq("is_alive", true)
                    .select("player_id");

                if (error || !data || data.length === 0) {
                    if (error) console.error("Revive sync error:", error.message);

                    knockPlayer(target, knockedBy);

                    return socket.emit("revive-cancelled", {
                        reviverId: player.id,
                        targetId,
                        reason: "could not be saved"
                    });
                }

                io.to(`match:${matchId}`).emit("player-revived", {
                    reviverId: player.id,
                    playerId: targetId,
                    health: target.health
                });

            } catch (error) {
                console.error("Finish revive error:", error.message);
            }
        }

        socket.on("cancel-revive", () => {
            const matchId = socket.currentMatchId;
            if (!matchId) return;

            for (const revive of cancelRevivesFor(matchId, player.id)) {
                for (const id of [revive.reviverId, revive.targetId]) {
                    io.to(`player:${id}`).emit("revive-cancelled", {
                        reviverId: revive.reviverId,
                        targetId: revive.targetId,
                        reason: "cancelled"
                    });
                }
            }
        });

        // ==========================================
        // SPECTATE (ELIMINATED PLAYERS ONLY)
        // ==========================================

        socket.on("spectate-player", async payload => {
            try {
                const matchId = socket.currentMatchId;
                if (!matchId) return emitError(socket, "Join a match first");

                const targetId = Number(payload?.targetId);

                if (!isValidPlayerId(targetId) || targetId === Number(player.id)) {
                    return emitError(socket, "Invalid spectate target");
                }

                const teams = await getMatchTeams(matchId);

                const self = teams.members.find(
                    m => Number(m.player_id) === Number(player.id)
                );
                const target = teams.members.find(
                    m => Number(m.player_id) === targetId
                );

                if (!self) return emitError(socket, "You are not in this match");

                if (self.is_alive) {
                    return emitError(socket, "Only eliminated players can spectate");
                }

                if (!target || !target.is_alive) {
                    return emitError(socket, "That player is not alive");
                }

                if (socket.spectateRoom) {
                    await socket.leave(socket.spectateRoom);
                }

                socket.spectateRoom = getSpectateRoom(matchId, targetId);
                await socket.join(socket.spectateRoom);

                const combat = getCombatPlayer(matchId, targetId);

                socket.emit("spectate-started", {
                    targetId,
                    teamNumber: target.team_number,
                    position: getPosition(matchId, targetId),
                    health: combat ? combat.health : null,
                    knocked: Boolean(combat?.knocked),
                    kills: combat ? combat.kills : null,
                    activeWeapon: combat ? combat.activeWeapon : null
                });

            } catch (error) {
                console.error("Spectate error:", error.message);
                emitError(socket, "Unable to spectate");
            }
        });

        socket.on("stop-spectating", async () => {
            if (socket.spectateRoom) {
                await socket.leave(socket.spectateRoom);
                socket.spectateRoom = null;
            }

            socket.emit("spectate-stopped", { success: true });
        });

        socket.on("get-smoke-clouds", () => {
            const matchId = socket.currentMatchId;
            if (!matchId) return emitError(socket, "Join a match first");

            socket.emit(
                "smoke-clouds-state",
                getSmokeClouds(matchId).map(cloud => ({
                    id: cloud.id,
                    position: cloud.position,
                    radius: cloud.radius,
                    expiresAt: cloud.expiresAt
                }))
            );
        });

        socket.on("get-zone-state", () => {
            const matchId = socket.currentMatchId;
            if (!matchId) return emitError(socket, "Join a match first");

            const zone = getZone(matchId);

            if (!zone) {
                return emitError(socket, "Safe zone has not started");
            }

            socket.emit("zone-update", getZoneState(zone));
        });

        socket.on("get-throwable-inventory", () => {
            const matchId = socket.currentMatchId;
            if (!matchId) return emitError(socket, "Join a match first");

            socket.emit(
                "throwable-inventory-updated",
                getThrowableInventory(matchId, player.id)
            );
        });

        socket.on("get-gloo-walls", () => {
            const matchId = socket.currentMatchId;
            if (!matchId) return emitError(socket, "Join a match first");

            socket.emit("gloo-walls-state", getGlooWalls(matchId));
        });
    });

    console.log(
        "INDIAN BATTLE FIELDS Socket.IO initialized successfully"
    );
}

// Save everything that is only in memory (used on shutdown).
async function persistAllState() {
    await flushDirtyPositions();
    await saveAllMatchSnapshots();
}

module.exports = {
    initializeGameSocket,
    startSafeZone,
    persistAllState
};
