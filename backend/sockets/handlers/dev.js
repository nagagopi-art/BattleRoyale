// ==========================================
// INDIAN BATTLE FIELDS - sockets/handlers/dev.js
// ==========================================
// Development-only test events (disabled in production).
// Events: dev-prepare-combat-test, dev-teleport

const {
    getInventory,
    addWeapon,
    addAmmunition,
    addHealingItem,
    addAttachment,
    addHelmet,
    addVest
} = require("../../services/inventoryService");

const {
    playerPositions,
    lastMovementTimes,
    getPlayerKey
} = require("../game/state");
const { isValidPosition, emitError } = require("../game/utils");
const { markPositionDirty } = require("../game/persistence");

function registerDevHandlers(io, socket, player) {
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
}

module.exports = registerDevHandlers;
