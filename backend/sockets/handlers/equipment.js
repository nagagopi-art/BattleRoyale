// ==========================================
// INDIAN BATTLE FIELDS - sockets/handlers/equipment.js
// ==========================================
// Equipping weapons and armor.
// Events: equip-weapon, equip-helmet, equip-vest, unequip-helmet, unequip-vest

const {
    getInventory,
    equipHelmet,
    equipVest,
    unequipHelmet,
    unequipVest
} = require("../../services/inventoryService");
const { WEAPONS } = require("../../config/weapons");
const { equipWeapon } = require("../../services/combatService");

const { emitError } = require("../game/utils");
const { persistEquippedArmor } = require("../game/persistence");

function registerEquipmentHandlers(io, socket, player) {
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
}

module.exports = registerEquipmentHandlers;
