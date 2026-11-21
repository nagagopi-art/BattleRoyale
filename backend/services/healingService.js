// ==========================================
// INDIAN BATTLE FIELDS
// HEALING ITEMS
// ==========================================
// Item definitions and in-progress heal timers.
// Inventory counts live in inventoryService;
// database persistence lives in the socket layer.

const HEALING_ITEMS = {
    bandage: {
        id: "bandage",
        name: "Bandage",
        healAmount: 15,
        // Bandages cannot heal above this.
        maxHealth: 75,
        useMs: 3000,
        carryLimit: 10,
        lootQuantity: 5
    },
    medkit: {
        id: "medkit",
        name: "Medkit",
        healAmount: 100,
        maxHealth: 100,
        useMs: 6000,
        carryLimit: 3,
        lootQuantity: 1
    }
};

const activeHeals = new Map();

function getKey(matchId, playerId) {
    return `${matchId}:${playerId}`;
}

// Health after using the item (never lowers health).
function calculateHealedHealth(itemId, currentHealth) {
    const item = HEALING_ITEMS[itemId];

    if (!item || !Number.isFinite(currentHealth)) {
        return currentHealth;
    }

    if (currentHealth >= item.maxHealth) {
        return currentHealth;
    }

    return Math.min(item.maxHealth, currentHealth + item.healAmount);
}

function canHeal(itemId, currentHealth) {
    const item = HEALING_ITEMS[itemId];

    if (!item) {
        return { success: false, message: "Invalid healing item" };
    }

    if (currentHealth >= item.maxHealth) {
        return {
            success: false,
            message: item.maxHealth < 100
                ? `${item.name} cannot heal above ${item.maxHealth} health`
                : "Health is already full"
        };
    }

    return { success: true };
}

// Starts the use timer. onComplete runs when it finishes
// (it does not run if the heal is cancelled).
function startHealing(matchId, playerId, itemId, onComplete) {
    const item = HEALING_ITEMS[itemId];

    if (!item) {
        return { success: false, message: "Invalid healing item" };
    }

    const key = getKey(matchId, playerId);

    if (activeHeals.has(key)) {
        return { success: false, message: "Already healing" };
    }

    const startedAt = Date.now();

    const timer = setTimeout(() => {
        activeHeals.delete(key);
        onComplete();
    }, item.useMs);

    activeHeals.set(key, {
        itemId,
        startedAt,
        endsAt: startedAt + item.useMs,
        timer
    });

    return {
        success: true,
        itemId,
        name: item.name,
        durationMs: item.useMs,
        endsAt: startedAt + item.useMs
    };
}

// Returns the cancelled heal, or null if none was active.
function cancelHealing(matchId, playerId) {
    const key = getKey(matchId, playerId);
    const heal = activeHeals.get(key);

    if (!heal) return null;

    clearTimeout(heal.timer);
    activeHeals.delete(key);

    return { itemId: heal.itemId };
}

function isHealing(matchId, playerId) {
    return activeHeals.has(getKey(matchId, playerId));
}

function removeMatchHealing(matchId) {
    const prefix = `${matchId}:`;

    for (const [key, heal] of activeHeals.entries()) {
        if (key.startsWith(prefix)) {
            clearTimeout(heal.timer);
            activeHeals.delete(key);
        }
    }
}

module.exports = {
    HEALING_ITEMS,
    calculateHealedHealth,
    canHeal,
    startHealing,
    cancelHealing,
    isHealing,
    removeMatchHealing
};
