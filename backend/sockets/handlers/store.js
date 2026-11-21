// ==========================================
// INDIAN BATTLE FIELDS - sockets/handlers/store.js
// ==========================================
// In-match store. Events:
//   store-get            -> store-state { coins, buyEndsAt, catalog }
//   store-buy { key }    -> store-purchased { item, coins, inventory, throwables }
// The server checks the buy window, the price and the
// player's coins; items go into the normal inventory.

const { getCombatPlayer } = require("../../services/combatService");
const Store = require("../../services/storeService");
const { emitError } = require("../game/utils");

module.exports = function registerStoreHandlers(io, socket, player) {
    socket.on("store-get", () => {
        const matchId = socket.currentMatchId;
        if (!matchId) return emitError(socket, "Join a match first");
        socket.emit("store-state", Store.getStoreState(matchId, player.id));
    });

    socket.on("store-buy", payload => {
        const matchId = socket.currentMatchId;
        if (!matchId) return emitError(socket, "Join a match first");

        const combat = getCombatPlayer(matchId, player.id);
        if (!combat || !combat.isAlive) return emitError(socket, "You cannot buy while down");
        if (combat.knocked) return emitError(socket, "You cannot buy while knocked");

        const result = Store.purchase(matchId, player.id, payload?.key);
        if (!result.success) {
            return socket.emit("store-error", { message: result.message });
        }

        socket.emit("store-purchased", result);
        socket.emit("inventory-data", { success: true, inventory: result.inventory });
        socket.emit("throwable-inventory-updated", result.throwables);
    });
};
