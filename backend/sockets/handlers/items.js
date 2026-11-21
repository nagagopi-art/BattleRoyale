// ==========================================
// INDIAN BATTLE FIELDS - sockets/handlers/items.js
// ==========================================
// Loot pickup, inventory, dropping items, attachments.
// Events: get-nearby-loot, pickup-loot, get-inventory, drop-item, attach-to-weapon, detach-from-weapon

const { supabaseAdmin } = require("../../config/supabase");
const {
    getAvailableLoot,
    pickupLoot,
    restoreLoot
} = require("../../services/lootService");
const {
    getInventory,
    addLootItem,
    attachToWeapon,
    detachFromWeapon,
    snapshotInventory,
    restoreInventory
} = require("../../services/inventoryService");
const { ATTACHMENT_SLOTS } = require("../../config/attachments");
const {
    getCombatPlayer,
    snapshotCombatState,
    restoreCombatState,
    clampMagazineToSize
} = require("../../services/combatService");
const { getThrowableInventory } = require("../../services/throwableService");

const { MOVEMENT_CONFIG } = require("../game/state");
const {
    calculateDistance,
    emitError,
    rejectIfKnocked,
    getPosition
} = require("../game/utils");
const { dropPlayerItem } = require("../game/drops");

function registerItemsHandlers(io, socket, player) {
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
}

module.exports = registerItemsHandlers;
