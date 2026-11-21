// ==========================================
// INDIAN BATTLE FIELDS - sockets/game/drops.js
// ==========================================
// Dropping items, death loot and gunshot sounds.

const { dropItemsOnGround } = require("../../services/lootService");
const {
    getInventory,
    addAmmunition,
    takeItemForDrop,
    takeAllItemsForDrop
} = require("../../services/inventoryService");
const { HANDLING_CONFIG } = require("../../config/attachments");
const { getCombatPlayer } = require("../../services/combatService");
const { takeThrowablesForDrop } = require("../../services/throwableService");

const { playerPositions } = require("./state");
const { calculateDistance, getPosition } = require("./utils");

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
    // Clash Squad / Team Deathmatch: players keep their gear.
    if (require("./modes").isRespawnMatch(matchId)) return [];

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

module.exports = {
    dropPlayerItem,
    dropDeathLoot,
    broadcastGunshot
};
