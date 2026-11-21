// ==========================================
// INDIAN BATTLE FIELDS - sockets/handlers/match.js
// ==========================================
// Joining, leaving and disconnecting from a match.
// Events: join-match, leave-match, disconnect, combat-state

const { supabaseAdmin } = require("../../config/supabase");
const { removeDrop } = require("../../services/parachuteService");
const { isBotUsername } = require("../../services/botService");
const {
    isClusterEnabled,
    getServerId,
    getServerUrl,
    claimMatch
} = require("../../services/clusterService");
const { getEquippedCosmeticsFor } = require("../../routes/cosmetics");
const {
    createInventory,
    getInventory,
    addWeapon,
    addAmmunition,
    restoreEquippedArmor,
    removePlayerInventory
} = require("../../services/inventoryService");
const { WEAPONS } = require("../../config/weapons");
const {
    createCombatPlayer,
    getCombatPlayer,
    removeCombatPlayer,
    syncCombatArmorState
} = require("../../services/combatService");
const { removeThrowablePlayer } = require("../../services/throwableService");
const { knockPlayer } = require("../../services/knockdownService");
const { getZone, getZoneState } = require("../../services/safeZoneService");

const {
    playerPositions,
    lastMovementTimes,
    getPlayerKey,
    RECONNECT_GRACE_MS,
    setMatchMapName
} = require("../game/state");
const {
    isValidPosition,
    isValidMatchId,
    emitError,
    getPosition,
    interruptHealing
} = require("../game/utils");
const { startSafeZone } = require("../game/zone");
const { scheduleDisconnectElimination, clearDisconnectTimer } = require("../game/disconnect");
const { restoreMatchIfNeeded } = require("../game/recovery");

function registerMatchHandlers(io, socket, player) {
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

            // Collision uses this map's layout.
            setMatchMapName(matchId, match.map_name);
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
                matchType: require("../game/modes").registerMatchType(matchId, match.match_code),
                matchStatus: match.status,
                members: (members || []).map(member => ({
                    ...member,
                    cosmetics: cosmetics[member.player_id] || {}
                })),
                playerPositions: playerPositionSnapshot
            });

            // Mode, round and store state (rejoins mid-match too).
            if (match.status === "in_progress") {
                const Modes = require("../game/modes");
                socket.emit("mode-state", Modes.getModeState(matchId));
                socket.emit("store-state", require("../../services/storeService").getStoreState(matchId, player.id));
            }

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
}

module.exports = registerMatchHandlers;
