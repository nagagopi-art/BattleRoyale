
const {
    WEAPONS,
    AMMUNITION
} = require("../config/weapons");

// ==============================================
// BHARAT BATTLEGROUNDS
// PLAYER INVENTORY SERVICE
// ==============================================

const inventories = new Map();

const INVENTORY_CONFIG = {
    maxWeaponSlots: 3
};

// ==============================================
// AMMUNITION MAPPING
// ==============================================

const WEAPON_AMMO = {
    assault_rifle: "rifle_ammo",
    smg: "smg_ammo",
    sniper: "sniper_ammo",
    dmr: "sniper_ammo",
    shotgun: "shotgun_ammo",
    pistol: "pistol_ammo"
};

// ==============================================
// INVENTORY KEY
// ==============================================

function getInventoryKey(matchId, playerId) {
    if (!matchId || playerId === undefined || playerId === null) {
        throw new Error("Match ID and player ID are required");
    }

    return `${matchId}:${playerId}`;
}

// ==============================================
// CREATE OR GET INVENTORY
// ==============================================

function createInventory(matchId, playerId) {
    const key = getInventoryKey(matchId, playerId);

    if (!inventories.has(key)) {
        inventories.set(key, {
            matchId,
            playerId,
            weapons: [],
            ammunition: {},
            createdAt: new Date().toISOString()
        });
    }

    return inventories.get(key);
}

function getInventory(matchId, playerId) {
    const key = getInventoryKey(matchId, playerId);
    const inventory = inventories.get(key);

    if (!inventory) {
        return null;
    }

    return JSON.parse(JSON.stringify(inventory));
}

// ==============================================
// ADD WEAPON
// ==============================================

function addWeapon(matchId, playerId, weaponId) {
    const weapon = WEAPONS[weaponId];

    if (!weapon) {
        return {
            status: "error",
            message: "Invalid weapon"
        };
    }

    const inventory = createInventory(matchId, playerId);

    if (inventory.weapons.some(item => item.weaponId === weaponId)) {
        return {
            status: "error",
            message: "Player already owns this weapon"
        };
    }

    if (inventory.weapons.length >= INVENTORY_CONFIG.maxWeaponSlots) {
        return {
            status: "error",
            message: "Weapon inventory is full"
        };
    }

    const weaponEntry = {
        weaponId: weapon.id,
        name: weapon.name,
        category: weapon.category,
        ammoType: WEAPON_AMMO[weapon.category] || null,
        magazineSize: weapon.magazineSize,
        currentAmmo: weapon.magazineSize,
        collectedAt: new Date().toISOString()
    };

    inventory.weapons.push(weaponEntry);

    return {
        status: "success",
        message: "Weapon added to inventory",
        weapon: weaponEntry
    };
}

// ==============================================
// ADD AMMUNITION
// ==============================================

function addAmmunition(matchId, playerId, ammoId, quantity) {
    const ammo = AMMUNITION[ammoId];

    if (!ammo) {
        return {
            status: "error",
            message: "Invalid ammunition type"
        };
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
        return {
            status: "error",
            message: "Invalid ammunition quantity"
        };
    }

    const inventory = createInventory(matchId, playerId);

    const currentQuantity = inventory.ammunition[ammoId] || 0;
    const availableSpace = ammo.stackLimit - currentQuantity;

    if (availableSpace <= 0) {
        return {
            status: "error",
            message: "Ammunition stack is full"
        };
    }

    const addedQuantity = Math.min(quantity, availableSpace);

    inventory.ammunition[ammoId] =
        currentQuantity + addedQuantity;

    return {
        status: "success",
        message: "Ammunition added successfully",
        ammoId,
        addedQuantity,
        totalQuantity: inventory.ammunition[ammoId]
    };
}

// ==============================================
// ADD COLLECTED LOOT
// ==============================================

function addLootItem(matchId, playerId, item) {
    if (!item || typeof item !== "object") {
        return {
            success: false,
            message: "Invalid loot item"
        };
    }

    let result;

    if (item.itemType === "weapon") {
        result = addWeapon(matchId, playerId, item.itemId);
    } else if (item.itemType === "ammunition") {
        result = addAmmunition(
            matchId,
            playerId,
            item.itemId,
            item.quantity
        );
    } else {
        return {
            success: false,
            message: "Unsupported loot type"
        };
    }

    return {
        success: result.status === "success",
        message: result.message,
        item: result.weapon || null,
        ammo: result.ammoId || null
    };
}

// ==============================================
// REMOVE WEAPON
// ==============================================

function removeWeapon(matchId, playerId, weaponId) {
    const inventory = createInventory(matchId, playerId);

    const index = inventory.weapons.findIndex(
        item => item.weaponId === weaponId
    );

    if (index === -1) {
        return {
            status: "error",
            message: "Weapon not found"
        };
    }

    const removedWeapon = inventory.weapons.splice(index, 1)[0];

    return {
        status: "success",
        message: "Weapon removed",
        weapon: removedWeapon
    };
}

// ==============================================
// REMOVE MATCH INVENTORIES
// ==============================================

function removeMatchInventories(matchId) {
    if (!matchId) {
        return false;
    }

    let removed = false;

    for (const key of inventories.keys()) {
        if (key.startsWith(`${matchId}:`)) {
            inventories.delete(key);
            removed = true;
        }
    }

    return removed;
}

// ==============================================
// EXPORTS
// ==============================================

module.exports = {
    INVENTORY_CONFIG,
    createInventory,
    getInventory,
    addWeapon,
    addAmmunition,
    addLootItem,
    removeWeapon,
    removeMatchInventories
};
