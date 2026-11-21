// ==========================================
// INDIAN BATTLE FIELDS - sockets/handlers/movement.js
// ==========================================
// Player movement and visibility-filtered broadcast.
// Events: player-move

const { getDropStatus } = require("../../services/parachuteService");
const { recordViolation } = require("../../services/antiCheatService");
const { getCombatPlayer } = require("../../services/combatService");
const { isLineOfSightBlocked, isPlayerFlashed } = require("../../services/throwableService");
const { KNOCK_CONFIG } = require("../../services/knockdownService");
const {
    movementBlocked,
    lineOfSightBlocked: coverBlocksSight
} = require("../../services/mapCollision");

const {
    playerPositions,
    matchDropStarted,
    lastMovementTimes,
    MOVEMENT_CONFIG,
    getPlayerKey,
    getMatchMapName
} = require("../game/state");
const {
    validateGroundMovement,
    isValidPosition,
    calculateDistance,
    emitError,
    getSpectateRoom
} = require("../game/utils");
const { markPositionDirty } = require("../game/persistence");

function registerMovementHandlers(io, socket, player) {
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

            // Clash Squad / Team Deathmatch: stay inside the arena.
            if (require("../game/modes").outsideArena(matchId, newPosition)) {
                return socket.emit("player-move-ack", {
                    success: false,
                    message: "Arena boundary"
                });
            }

            const key = getPlayerKey(matchId, player.id);
            const combatPlayer = getCombatPlayer(matchId, player.id);
            const mapName = getMatchMapName(matchId);

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

                // Buildings, rocks, walls and crates are solid.
                if (mapName && movementBlocked(mapName, oldPosition, newPosition)) {
                    return socket.emit("player-move-ack", {
                        success: false,
                        message: "Blocked by an obstacle"
                    });
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

                // Hidden by smoke, a building or other cover, or
                // the viewer is flashed. Hidden positions are
                // never sent, so wallhacks have nothing to show.
                const hidden =
                    isPlayerFlashed(matchId, viewerId) ||
                    isLineOfSightBlocked(
                        matchId,
                        newPosition,
                        viewerPosition
                    ) ||
                    Boolean(mapName && coverBlocksSight(mapName, newPosition, viewerPosition));

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
}

module.exports = registerMovementHandlers;
