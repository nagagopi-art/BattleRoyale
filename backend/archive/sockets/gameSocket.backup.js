const { supabaseAdmin } = require("../config/supabase");

const {
    generateFlightPath,
    getAircraftPosition,
    jumpFromAircraft,
    deployParachute,
    updateDropPosition,
    getDropStatus,
    removeDrop
} = require("../services/parachuteService");

const {
    generateMatchLoot,
    getAvailableLoot,
    pickupLoot,
    restoreLoot
} = require("../services/lootService");

const {
    createInventory,
    getInventory,
    addLootItem,
    getEquippedArmor,
    equipHelmet,
    equipVest,
    unequipHelmet,
    unequipVest,
    restoreEquippedArmor
} = require("../services/inventoryService");

const { WEAPONS } = require("../config/weapons");

const {
    createCombatPlayer,
    getCombatPlayer,
    equipWeapon,
    reloadWeapon,
    fireWeapon,
    removeCombatPlayer,
    syncCombatArmorState
} = require("../services/combatService");

// ==========================================
// INDIAN BATTLE FIELDS SOCKET.IO
// ==========================================

const playerPositions = new Map();
const matchFlights = new Map();
const matchDropStarted = new Set();
const lastMovementTimes = new Map();

const MOVEMENT_CONFIG = {
    MIN_INTERVAL_MS: 50,
    MAX_MOVEMENT_DISTANCE: 30,
    MAX_WORLD_BOUNDARY: 1000,
    MAX_VERTICAL_BOUNDARY: 2000,
    LOOT_SEARCH_DISTANCE: 30
};

// ==========================================
// HELPERS
// ==========================================

function getPlayerKey(matchId, playerId) {
    return `${matchId}:${playerId}`;
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

    if (error) {
        throw error;
    }

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

    if (error) {
        throw error;
    }

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

    if (error) {
        throw error;
    }

    if (!data || !data.success) {
        throw new Error("Combat database synchronization failed");
    }

    return {
        alivePlayers: data.alivePlayers,
        eliminatedPlayers: data.eliminatedPlayers
    };
}

// ==========================================
// INITIALIZE SOCKET SERVER
// ==========================================

function initializeGameSocket(io) {
    console.log("Initializing INDIAN BATTLE FIELDS Socket.IO...");

    // ======================================
    // SOCKET AUTHENTICATION
    // ======================================

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

    // ======================================
    // CONNECTION
    // ======================================

    io.on("connection", socket => {
        const player = socket.player;
        const playerRoom = `player:${player.id}`;

        socket.join(playerRoom);

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

                // Restore position:
                // memory -> saved database position -> spawn position.

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

                // Restore inventory and equipped armor from the membership row.
                // A newly created in-memory inventory indicates a server restart
                // or a first join in this process.
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

                    // Keep combat armor fields aligned with inventory.
                    syncCombatArmorState(matchId, player.id);
                }

                // Get all match members with saved positions.
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

                if (membersError) {
                    throw membersError;
                }

                // Restore positions for all members after server restart.
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

                socket.emit("joined-match", {
                    success: true,
                    matchId,
                    matchCode: match.match_code,
                    mapName: match.map_name,
                    gameMode: match.game_mode,
                    matchStatus: match.status,
                    members: members || [],
                    playerPositions: playerPositionSnapshot
                });

                socket.to(`match:${matchId}`).emit("player-joined", {
                    playerId: player.id,
                    username: player.username
                });

                socket.emit("player-spawned", {
                    playerId: player.id,
                    position: getPosition(matchId, player.id)
                });

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

                matchFlights.set(matchId, {
                    flightPath,
                    startedAt: Date.now()
                });

                matchDropStarted.add(matchId);

                io.to(`match:${matchId}`).emit("aircraft-started", {
                    success: true,
                    matchId,
                    flightPath,
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

                await persistPlayerPosition(
                    matchId,
                    player.id,
                    acceptedPosition
                );

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
            console.log("\n========== MOVEMENT EVENT RECEIVED ==========");
            console.log("Player:", player.username, player.id);
            console.log("Socket ID:", socket.id);
            console.log("Payload:", payload);

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
                }

                // Save accepted position to Supabase first.
                await persistPlayerPosition(
                    matchId,
                    player.id,
                    newPosition
                );

                // Update memory only after successful database save.
                lastMovementTimes.set(key, now);
                playerPositions.set(key, newPosition);

                // Find all alive players registered in this match.
                const { data: matchMembers, error: membersError } =
                    await supabaseAdmin
                        .from("match_players")
                        .select("player_id")
                        .eq("match_id", matchId)
                        .eq("is_alive", true);

                if (membersError) {
                    throw membersError;
                }

                console.log("\n========== MOVEMENT BROADCAST DEBUG ==========");
                console.log("Sender:", player.username, player.id);
                console.log("Match:", matchId);
                console.log("Match members:", matchMembers);

                let broadcastCount = 0;

                // Send movement to every other connected player.
                for (const member of matchMembers || []) {
                    if (
                        Number(member.player_id) === Number(player.id)
                    ) {
                        continue;
                    }

                    const targetRoom = `player:${member.player_id}`;

                    const targetSockets = await io
                        .in(targetRoom)
                        .fetchSockets();

                    console.log(
                        "Target player:",
                        member.player_id,
                        "Connected sockets:",
                        targetSockets.length
                    );

                    if (targetSockets.length > 0) {
                        io.to(targetRoom).emit("player-moved", {
                            playerId: player.id,
                            matchId,
                            position: newPosition
                        });

                        broadcastCount++;
                    }
                }

                // Confirm movement to sender.
                socket.emit("player-move-ack", {
                    success: true,
                    message: "Movement accepted and broadcast",
                    playerId: player.id,
                    matchId,
                    position: newPosition,
                    recipients: broadcastCount
                });

                console.log(
                    "Movement broadcast recipients:",
                    broadcastCount
                );

                console.log("=============================================\n");

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

                const inventoryResult = addLootItem(
                    matchId,
                    player.id,
                    result.item
                );

                if (!inventoryResult.success) {
                    restoreLoot(matchId, lootId);

                    return emitError(
                        socket,
                        inventoryResult.message || "Unable to add loot to inventory"
                    );
                }

                socket.emit("loot-collected", {
                    success: true,
                    item: result.item,
                    inventory: getInventory(matchId, player.id)
                });

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

        // ==================================
        // FIRE WEAPON - SERVER HIT DETECTION
        // ==================================

        socket.on("fire-weapon", async payload => {
            try {
                const matchId = socket.currentMatchId;

                if (!matchId) {
                    return emitError(socket, "Join a match first");
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

                const { data: memberships, error: membershipError } =
                    await supabaseAdmin
                        .from("match_players")
                        .select("player_id, is_alive")
                        .eq("match_id", matchId)
                        .in("player_id", [player.id, numericTargetId]);

                if (membershipError) {
                    console.error(
                        "Combat membership lookup:",
                        membershipError.message
                    );

                    return emitError(socket, "Unable to verify match players");
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
                        }
                    }
                );

                if (!result.success) {
                    return emitError(socket, result.message);
                }

                socket.emit("shot-fired", {
                    success: true,
                    hit: Boolean(result.hit),
                    weapon: result.weapon,
                    targetId: numericTargetId,
                    remainingAmmo: result.remainingAmmo
                });

                if (!result.hit) {
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

                    socket.emit("combat-sync-warning", {
                        success: false,
                        message:
                            "Combat was processed, but database synchronization needs attention"
                    });
                }

                io.to(`player:${numericTargetId}`).emit(
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
                    alivePlayers: matchCounts?.alivePlayers
                });

                if (result.eliminated) {
                    io.to(`match:${matchId}`).emit(
                        "player-eliminated",
                        {
                            attackerId: player.id,
                            victimId: numericTargetId,
                            weapon: result.weapon,
                            totalKills: result.totalKills,
                            alivePlayers: matchCounts?.alivePlayers,
                            eliminatedPlayers: matchCounts?.eliminatedPlayers
                        }
                    );
                }

            } catch (error) {
                console.error("Fire weapon error:", error.message);
                emitError(socket, "Unable to process weapon shot");
            }
        });

        // ==================================
        // RELOAD WEAPON
        // ==================================

        socket.on("reload-weapon", () => {
            const matchId = socket.currentMatchId;
            if (!matchId) return;

            const result = reloadWeapon(matchId, player.id);

            if (!result.success) {
                return emitError(socket, result.message);
            }

            socket.emit("reload-started", result);

            setTimeout(() => {
                const combatPlayer = getCombatPlayer(
                    matchId,
                    player.id
                );

                if (!combatPlayer) return;

                socket.emit("reload-completed", {
                    success: true,
                    inventory: getInventory(matchId, player.id),
                    combat: {
                        activeWeapon: combatPlayer.activeWeapon,
                        weaponState: combatPlayer.weapons[
                            combatPlayer.activeWeapon
                        ]
                    }
                });
            }, result.reloadTimeMs + 100);
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
                socket.to(`match:${matchId}`).emit(
                    "player-disconnected",
                    { playerId: player.id }
                );
            }
        });
    });

    console.log(
        "INDIAN BATTLE FIELDS Socket.IO initialized successfully"
    );
}

module.exports = {
    initializeGameSocket
};