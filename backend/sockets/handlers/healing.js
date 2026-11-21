// ==========================================
// INDIAN BATTLE FIELDS - sockets/handlers/healing.js
// ==========================================
// Healing items and reviving teammates.
// Events: use-healing-item, cancel-healing, revive-teammate, cancel-revive

const { supabaseAdmin } = require("../../config/supabase");
const { reportError } = require("../../services/errorReporter");
const {
    getInventory,
    getHealingCount,
    consumeHealingItem,
    snapshotInventory,
    restoreInventory
} = require("../../services/inventoryService");
const { getCombatPlayer } = require("../../services/combatService");
const {
    HEALING_ITEMS,
    calculateHealedHealth,
    canHeal,
    startHealing
} = require("../../services/healingService");
const {
    KNOCK_CONFIG,
    knockPlayer,
    clearKnock,
    startRevive,
    cancelRevivesFor
} = require("../../services/knockdownService");

const {
    calculateDistance,
    emitError,
    rejectIfKnocked,
    getPosition,
    isValidPlayerId,
    interruptHealing
} = require("../game/utils");
const { getMatchTeams, areTeammates } = require("../game/teams");

function registerHealingHandlers(io, socket, player) {
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
}

module.exports = registerHealingHandlers;
