// ==========================================
// INDIAN BATTLE FIELDS - match coins and the store
// ==========================================
// Every player gets 1000 match coins at the start of every
// match. Coins buy weapons and gear, but only while a buy
// window is open:
//   Battle Royale   30 s after landing
//   Clash Squad     the buy phase at the start of each round
//   Team Deathmatch the start of the match and after respawning
// Kills earn extra coins. Unspent coins are added to the
// player's account when the match ends (progressionService).
// All state is in memory, per match.

const { STORE_BY_KEY, publicCatalog } = require("../config/store");
const { STARTING_MATCH_COINS } = require("../config/matchTypes");
const { addLootItem, getInventory } = require("./inventoryService");
const { getThrowableInventory } = require("./throwableService");

const wallets = new Map();      // "match:player" -> coins
const buyWindows = new Map();   // "match:player" -> endsAt (ms)

const key = (matchId, playerId) => `${matchId}:${playerId}`;

function getCoins(matchId, playerId) {
    const k = key(matchId, playerId);
    if (!wallets.has(k)) wallets.set(k, STARTING_MATCH_COINS);
    return wallets.get(k);
}

function addCoins(matchId, playerId, amount) {
    if (!Number.isFinite(amount) || amount === 0) return getCoins(matchId, playerId);
    const next = Math.max(0, getCoins(matchId, playerId) + Math.round(amount));
    wallets.set(key(matchId, playerId), next);
    return next;
}

function openBuyWindow(matchId, playerId, durationMs) {
    const endsAt = Date.now() + Math.max(0, durationMs);
    buyWindows.set(key(matchId, playerId), endsAt);
    getCoins(matchId, playerId);
    return endsAt;
}

function closeBuyWindow(matchId, playerId) {
    buyWindows.delete(key(matchId, playerId));
}

function getBuyWindowEnd(matchId, playerId) {
    const endsAt = buyWindows.get(key(matchId, playerId)) || 0;
    return endsAt > Date.now() ? endsAt : 0;
}

// What the client needs to draw the store.
function getStoreState(matchId, playerId) {
    return {
        coins: getCoins(matchId, playerId),
        buyEndsAt: getBuyWindowEnd(matchId, playerId) || null,
        serverTime: Date.now(),
        catalog: publicCatalog()
    };
}

// Buy one catalog entry. The caller checks the player is alive.
function purchase(matchId, playerId, itemKey) {
    const entry = STORE_BY_KEY.get(String(itemKey || ""));

    if (!entry) return { success: false, message: "Unknown store item" };

    if (!getBuyWindowEnd(matchId, playerId)) {
        return { success: false, message: "The store is closed (buy phase only)" };
    }

    const coins = getCoins(matchId, playerId);
    if (coins < entry.price) {
        return { success: false, message: `Not enough coins (${entry.price} needed)` };
    }

    const result = addLootItem(matchId, playerId, { ...entry.item, name: entry.name });
    if (!result.success) {
        return { success: false, message: result.message || "Inventory is full" };
    }

    // Weapons come with spare ammunition (a full inventory just skips it).
    if (entry.ammo) {
        addLootItem(matchId, playerId, { itemType: "ammunition", itemId: entry.ammo[0], quantity: entry.ammo[1] });
    }

    wallets.set(key(matchId, playerId), coins - entry.price);

    return {
        success: true,
        item: { key: entry.key, name: entry.name, itemType: entry.item.itemType, itemId: entry.item.itemId },
        coins: coins - entry.price,
        inventory: getInventory(matchId, playerId),
        throwables: getThrowableInventory(matchId, playerId)
    };
}

// playerId -> unspent coins, for the end-of-match award.
function getMatchLeftovers(matchId) {
    const prefix = `${matchId}:`;
    const out = new Map();
    for (const [k, coins] of wallets) {
        if (k.startsWith(prefix)) out.set(k.slice(prefix.length), coins);
    }
    return out;
}

function removeMatchStore(matchId) {
    const prefix = `${matchId}:`;
    for (const k of [...wallets.keys()]) if (k.startsWith(prefix)) wallets.delete(k);
    for (const k of [...buyWindows.keys()]) if (k.startsWith(prefix)) buyWindows.delete(k);
}

module.exports = {
    getCoins,
    addCoins,
    openBuyWindow,
    closeBuyWindow,
    getBuyWindowEnd,
    getStoreState,
    purchase,
    getMatchLeftovers,
    removeMatchStore
};
