// ==========================================
// INDIAN BATTLE FIELDS - sockets/handlers/aircraft.js
// ==========================================
// Aircraft, jumping, parachute descent.
// Events: start-aircraft-drop, aircraft-position, aircraft-flight-completed, jump-from-aircraft, deploy-parachute, drop-position-update, get-drop-status

const { supabaseAdmin } = require("../../config/supabase");
const {
    generateFlightPath,
    getAircraftPosition,
    jumpFromAircraft,
    deployParachute,
    updateDropPosition,
    getDropStatus
} = require("../../services/parachuteService");
const { generateMatchLoot } = require("../../services/lootService");
const {
    nearestFreePosition,
    randomPointInBuilding
} = require("../../services/mapCollision");

const {
    playerPositions,
    matchFlights,
    matchDropStarted,
    getPlayerKey,
    setMatchMapName,
    getMatchMapName
} = require("../game/state");
const {
    getFlightDurationMs,
    isValidPosition,
    emitError
} = require("../game/utils");
const { markPositionDirty, persistPlayerPosition } = require("../game/persistence");
const { ejectRemainingPlayers } = require("../game/aircraft");
const Modes = require("../game/modes");

function registerAircraftHandlers(io, socket, player) {
    // ==================================
    // AIRCRAFT DROP START
    // ==================================

    socket.on("start-aircraft-drop", async () => {
        try {
            const matchId = socket.currentMatchId;

            if (!matchId) {
                return emitError(socket, "Join a match first");
            }

            // Clash Squad / Team Deathmatch start on the ground.
            const matchType = await Modes.startModeIfNeeded(matchId).catch(error => {
                console.error("Mode start error:", error.message);
                return "br";
            });
            if (matchType !== "br") return;

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

            // Some loot inside houses; none inside walls or rocks.
            setMatchMapName(matchId, match.map_name);

            const lootResult = generateMatchLoot(matchId, undefined, {
                pickPosition: (position, index) => {
                    if (index % 5 < 2) {
                        const inside = randomPointInBuilding(match.map_name);
                        if (inside) return inside;
                    }
                    return nearestFreePosition(match.map_name, position);
                }
            });

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

            let acceptedPosition = result.position || position;

            // Landed on a roof, rock or crate: step to the
            // nearest free spot on the ground.
            const mapName = getMatchMapName(matchId);

            if (result.state === "landed" && mapName) {
                const free = nearestFreePosition(mapName, acceptedPosition);

                if (free.x !== acceptedPosition.x || free.z !== acceptedPosition.z) {
                    acceptedPosition = free;
                    const drop = getDropStatus(matchId, player.id);
                    if (drop) drop.position = { ...free };
                }
            }

            markPositionDirty(matchId, player.id, acceptedPosition);

            // Battle Royale: the store opens for 30 s after landing.
            if (result.state === "landed") Modes.onPlayerLanded(matchId, player.id);

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
}

module.exports = registerAircraftHandlers;
