// ==========================================
// INDIAN BATTLE FIELDS - sockets/handlers/throwables.js
// ==========================================
// Grenades, gloo walls, smoke clouds.
// Events: throw-grenade, deploy-gloo-wall, get-gloo-walls, get-smoke-clouds, get-throwable-inventory

const { supabaseAdmin } = require("../../config/supabase");
const {
    throwGrenade,
    resolveGrenade,
    deployGlooWall,
    getGlooWalls,
    getThrowableInventory,
    addSmokeCloud,
    getSmokeClouds,
    GLOO_CONFIG
} = require("../../services/throwableService");

const { playerPositions, getPlayerKey } = require("../game/state");
const { emitError, rejectIfKnocked } = require("../game/utils");
const { applyGrenadeDamage, applyFlashEffect } = require("../game/explosions");

function registerThrowablesHandlers(io, socket, player) {
    // ==========================================
    // THROW GRENADE
    // ==========================================

    socket.on("throw-grenade", async payload => {
        try {
            const matchId = socket.currentMatchId;
            if (!matchId) return emitError(socket, "Join a match first");

            if (require("../game/modes").isCombatFrozen(matchId)) {
                return emitError(socket, "Buy phase: wait for the round to start");
            }

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
}

module.exports = registerThrowablesHandlers;
