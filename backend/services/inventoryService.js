
const crypto = require("crypto");

const {
    WEAPONS,
    AMMUNITION
} = require("../config/weapons");

const { addThrowable } = require("./throwableService");
const { HEALING_ITEMS } = require("./healingService");

const {
    ATTACHMENTS,
    isAttachmentCompatible,
    getEffectiveWeapon
} = require("../config/attachments");

// ==============================================
// INDIAN BATTLE FIELDS
// PLAYER INVENTORY SERVICE
// ==============================================

const inventories = new Map();

const INVENTORY_CONFIG = {
    maxWeaponSlots: 3,
    maxHelmetSlots: 3,
    maxVestSlots: 3
};

const WEAPON_AMMO = {
    assault_rifle: "rifle_ammo",
    smg: "smg_ammo",
    sniper: "sniper_ammo",
    dmr: "sniper_ammo",
    shotgun: "shotgun_ammo",
    pistol: "pistol_ammo"
};

const ARMOR_CONFIG = {
    helmet: {
        1: { durability: 100, protection: 0.20 },
        2: { durability: 150, protection: 0.30 },
        3: { durability: 200, protection: 0.40 }
    },
    vest: {
        1: { durability: 100, protection: 0.20 },
        2: { durability: 150, protection: 0.30 },
        3: { durability: 200, protection: 0.40 }
    }
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
            healing: {},
            attachments: [],
            armor: {
                helmets: [],
                vests: [],
                equipped: {
                    helmet: null,
                    vest: null
                }
            },
            createdAt: new Date().toISOString()
        });
    }

    return inventories.get(key);
}

function getInventory(matchId, playerId) {
    const inventory = inventories.get(
        getInventoryKey(matchId, playerId)
    );

    if (!inventory) {
        return null;
    }

    return JSON.parse(JSON.stringify(inventory));
}

// ==============================================
// INVENTORY SNAPSHOT / RESTORE
// ==============================================

// Save the complete inventory before combat mutations.

function snapshotInventory(matchId, playerId) {
    const key = getInventoryKey(matchId, playerId);
    const inventory = inventories.get(key);

    return {
        exists: Boolean(inventory),
        inventory: inventory
            ? JSON.parse(JSON.stringify(inventory))
            : null
    };
}

// Restore the exact previous inventory state.

function restoreInventory(matchId, playerId, snapshot) {
    if (
        !snapshot ||
        typeof snapshot !== "object" ||
        typeof snapshot.exists !== "boolean"
    ) {
        return {
            success: false,
            message: "Invalid inventory snapshot"
        };
    }

    const key = getInventoryKey(matchId, playerId);

    if (!snapshot.exists) {
        inventories.delete(key);

        return {
            success: true,
            message: "Inventory restored to previous empty state"
        };
    }

    if (
        !snapshot.inventory ||
        snapshot.inventory.matchId !== matchId ||
        String(snapshot.inventory.playerId) !== String(playerId)
    ) {
        return {
            success: false,
            message: "Inventory snapshot does not match player"
        };
    }

    inventories.set(
        key,
        JSON.parse(JSON.stringify(snapshot.inventory))
    );

    return {
        success: true,
        message: "Inventory restored successfully"
    };
}

// ==============================================
// GET EQUIPPED ARMOR
// ==============================================

function getEquippedArmor(matchId, playerId) {
    const inventory = inventories.get(
        getInventoryKey(matchId, playerId)
    );

    if (!inventory) {
        return {
            helmet: null,
            vest: null
        };
    }

    return {
        helmet: inventory.armor.equipped.helmet
            ? { ...inventory.armor.equipped.helmet }
            : null,

        vest: inventory.armor.equipped.vest
            ? { ...inventory.armor.equipped.vest }
            : null
    };
}

// ==============================================
// RESTORE EQUIPPED ARMOR FROM DATABASE
// ==============================================

function restoreEquippedArmor(
    matchId,
    playerId,
    savedArmor
) {
    if (!savedArmor || typeof savedArmor !== "object") {
        return {
            success: false,
            message: "Saved armor data is required"
        };
    }

    const inventory = createInventory(matchId, playerId);

    function restoreOneArmor(type, level, durability) {
        if (
            !Number.isInteger(level) ||
            !Number.isInteger(durability) ||
            level < 0 ||
            level > 3 ||
            durability < 0
        ) {
            throw new Error(`Invalid saved ${type} data`);
        }

        if (level === 0) {
            if (durability !== 0) {
                throw new Error(`Invalid ${type} durability`);
            }

            return null;
        }

        const config = ARMOR_CONFIG[type][level];

        if (!config || durability > config.durability) {
            throw new Error(`Invalid saved ${type} durability`);
        }

        if (durability === 0) {
            return null;
        }

        return {
            instanceId: crypto.randomUUID(),
            itemId: `${type}_level_${level}`,
            itemType: type,
            level,
            durability,
            maxDurability: config.durability,
            protection: config.protection,
            restoredFromDatabase: true
        };
    }

    try {
        const helmet = restoreOneArmor(
            "helmet",
            savedArmor.helmet_level ?? 0,
            savedArmor.helmet_durability ?? 0
        );

        const vest = restoreOneArmor(
            "vest",
            savedArmor.vest_level ?? 0,
            savedArmor.vest_durability ?? 0
        );

        inventory.armor.equipped.helmet = helmet;
        inventory.armor.equipped.vest = vest;

        return {
            success: true,
            message: "Equipped armor restored successfully",
            helmet: helmet ? { ...helmet } : null,
            vest: vest ? { ...vest } : null
        };
    } catch (error) {
        return {
            success: false,
            message: error.message
        };
    }
}

// ==============================================
// APPLY DAMAGE TO EQUIPPED ARMOR
// ==============================================

function damageEquippedArmor(
    matchId,
    playerId,
    armorType,
    incomingDamage
) {
    if (!["helmet", "vest"].includes(armorType)) {
        return {
            success: false,
            message: "Invalid armor type"
        };
    }

    if (
        !Number.isFinite(incomingDamage) ||
        incomingDamage <= 0
    ) {
        return {
            success: false,
            message: "Invalid incoming damage"
        };
    }

    const inventory = inventories.get(
        getInventoryKey(matchId, playerId)
    );

    if (!inventory) {
        return {
            success: false,
            message: "Player inventory not found"
        };
    }

    const armor = inventory.armor.equipped[armorType];

    if (!armor || armor.durability <= 0) {
        return {
            success: true,
            message: "No usable armor equipped",
            armorType,
            absorbedDamage: 0,
            remainingDamage: incomingDamage,
            durability: 0,
            broken: false,
            armor: null
        };
    }

    const protection = armor.protection;

    const desiredAbsorption = Math.floor(
        incomingDamage * protection
    );

    const absorbedDamage = Math.min(
        desiredAbsorption,
        armor.durability
    );

    armor.durability = Math.max(
        0,
        armor.durability - absorbedDamage
    );

    const remainingDamage =
        incomingDamage - absorbedDamage;

    const broken = armor.durability <= 0;

    const armorSnapshot = { ...armor };

    if (broken) {
        inventory.armor.equipped[armorType] = null;
    }

    return {
        success: true,
        message: broken
            ? `${armorType} broken`
            : `${armorType} absorbed damage`,
        armorType,
        level: armor.level,
        absorbedDamage,
        remainingDamage,
        durability: armorSnapshot.durability,
        broken,
        armor: armorSnapshot
    };
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
        attachments: {
            sight: null,
            magazine: null,
            grip: null,
            muzzle: null
        },
        collectedAt: new Date().toISOString()
    };

    inventory.weapons.push(weaponEntry);

    return {
        status: "success",
        message: "Weapon added to inventory",
        weapon: { ...weaponEntry }
    };
}

// ==============================================
// ADD AMMUNITION
// ==============================================

// ==============================================
// MATCH STATE SNAPSHOT (CRASH RECOVERY)
// ==============================================

function exportMatchInventories(matchId) {
    const prefix = `${matchId}:`;
    const result = {};

    for (const [key, inventory] of inventories.entries()) {
        if (key.startsWith(prefix)) {
            result[key.slice(prefix.length)] = JSON.parse(JSON.stringify(inventory));
        }
    }

    return result;
}

function importMatchInventories(matchId, data) {
    for (const [playerId, inventory] of Object.entries(data || {})) {
        inventories.set(
            getInventoryKey(matchId, playerId),
            JSON.parse(JSON.stringify(inventory))
        );
    }
}

// ==============================================
// DROPPING ITEMS
// ==============================================
// These remove items from the inventory and return them
// in loot-item shape so lootService can put them on the
// ground. Throwables are handled by throwableService.

function weaponToLoot(weapon) {
    return {
        itemType: "weapon",
        itemId: weapon.weaponId,
        name: weapon.name,
        category: weapon.category
    };
}

function armorToLoot(armor) {
    return {
        itemType: armor.itemType,
        itemId: armor.itemId,
        name: `Level ${armor.level} ${armor.itemType === "helmet" ? "Helmet" : "Vest"}`,
        level: armor.level,
        durability: armor.durability,
        protection: armor.protection
    };
}

// request: { itemType, itemId, quantity?, instanceId? }
function takeItemForDrop(matchId, playerId, request) {
    const inventory = inventories.get(getInventoryKey(matchId, playerId));
    if (!inventory) return { status: "error", message: "Inventory not found" };

    const { itemType, itemId, instanceId } = request || {};
    const quantity = Number.isInteger(request?.quantity) && request.quantity > 0
        ? request.quantity
        : null;

    if (itemType === "weapon") {
        const index = inventory.weapons.findIndex(w => w.weaponId === itemId);
        if (index < 0) return { status: "error", message: "Weapon not in inventory" };

        const [weapon] = inventory.weapons.splice(index, 1);
        const items = [weaponToLoot(weapon)];

        // Fitted attachments go to spare storage, or are
        // dropped with the weapon if storage is full.
        for (const attachmentId of Object.values(weapon.attachments || {})) {
            if (!attachmentId) continue;

            if ((inventory.attachments || []).length < MAX_SPARE_ATTACHMENTS) {
                inventory.attachments.push(attachmentId);
            } else {
                items.push({
                    itemType: "attachment",
                    itemId: attachmentId,
                    name: ATTACHMENTS[attachmentId]?.name || attachmentId,
                    category: ATTACHMENTS[attachmentId]?.slot || null
                });
            }
        }

        return { status: "success", items };
    }

    if (itemType === "ammunition") {
        const have = inventory.ammunition[itemId] || 0;
        if (have <= 0) return { status: "error", message: "No ammunition of that type" };

        const amount = Math.min(have, quantity || have);
        inventory.ammunition[itemId] = have - amount;

        return {
            status: "success",
            items: [{
                itemType: "ammunition",
                itemId,
                name: AMMUNITION[itemId]?.name || itemId,
                quantity: amount
            }]
        };
    }

    if (itemType === "healing") {
        const have = inventory.healing?.[itemId] || 0;
        if (have <= 0) return { status: "error", message: "No healing items of that type" };

        const amount = Math.min(have, quantity || have);
        inventory.healing[itemId] = have - amount;

        return {
            status: "success",
            items: [{
                itemType: "healing",
                itemId,
                name: HEALING_ITEMS[itemId]?.name || itemId,
                quantity: amount
            }]
        };
    }

    if (itemType === "attachment") {
        const index = (inventory.attachments || []).indexOf(itemId);
        if (index < 0) return { status: "error", message: "Attachment not in storage" };

        inventory.attachments.splice(index, 1);

        return {
            status: "success",
            items: [{
                itemType: "attachment",
                itemId,
                name: ATTACHMENTS[itemId]?.name || itemId,
                category: ATTACHMENTS[itemId]?.slot || null
            }]
        };
    }

    if (itemType === "helmet" || itemType === "vest") {
        // Only spare (unequipped) armor can be dropped.
        const list = itemType === "helmet"
            ? inventory.armor.helmets
            : inventory.armor.vests;

        const index = list.findIndex(a => a.instanceId === instanceId);
        if (index < 0) return { status: "error", message: "Armor not in inventory" };

        const [armor] = list.splice(index, 1);

        return { status: "success", items: [armorToLoot(armor)] };
    }

    return { status: "error", message: "This item cannot be dropped" };
}

// Empty the whole inventory (on death). Returns loot items.
function takeAllItemsForDrop(matchId, playerId) {
    const inventory = inventories.get(getInventoryKey(matchId, playerId));
    if (!inventory) return [];

    const items = [];

    for (const weapon of inventory.weapons) {
        items.push(weaponToLoot(weapon));

        for (const attachmentId of Object.values(weapon.attachments || {})) {
            if (attachmentId) {
                items.push({
                    itemType: "attachment",
                    itemId: attachmentId,
                    name: ATTACHMENTS[attachmentId]?.name || attachmentId,
                    category: ATTACHMENTS[attachmentId]?.slot || null
                });
            }
        }
    }

    for (const [ammoId, quantity] of Object.entries(inventory.ammunition || {})) {
        if (quantity > 0) {
            items.push({
                itemType: "ammunition",
                itemId: ammoId,
                name: AMMUNITION[ammoId]?.name || ammoId,
                quantity
            });
        }
    }

    for (const [itemId, quantity] of Object.entries(inventory.healing || {})) {
        if (quantity > 0) {
            items.push({
                itemType: "healing",
                itemId,
                name: HEALING_ITEMS[itemId]?.name || itemId,
                quantity
            });
        }
    }

    for (const attachmentId of inventory.attachments || []) {
        items.push({
            itemType: "attachment",
            itemId: attachmentId,
            name: ATTACHMENTS[attachmentId]?.name || attachmentId,
            category: ATTACHMENTS[attachmentId]?.slot || null
        });
    }

    const armorPieces = [
        ...inventory.armor.helmets,
        ...inventory.armor.vests,
        inventory.armor.equipped.helmet,
        inventory.armor.equipped.vest
    ].filter(a => a && a.durability > 0);

    for (const armor of armorPieces) {
        items.push(armorToLoot(armor));
    }

    // Leave an empty inventory behind.
    inventory.weapons = [];
    inventory.ammunition = {};
    inventory.healing = {};
    inventory.attachments = [];
    inventory.armor.helmets = [];
    inventory.armor.vests = [];
    inventory.armor.equipped = { helmet: null, vest: null };

    return items;
}

// ==============================================
// WEAPON ATTACHMENTS
// ==============================================
// Spare attachments live in inventory.attachments (ids).
// Fitted attachments live on each weapon entry.

const MAX_SPARE_ATTACHMENTS = 10;

function addAttachment(matchId, playerId, attachmentId) {
    if (!ATTACHMENTS[attachmentId]) {
        return { status: "error", message: "Invalid attachment" };
    }

    const inventory = createInventory(matchId, playerId);
    inventory.attachments = inventory.attachments || [];

    // Fit it straight onto a compatible weapon with a free slot.
    const slot = ATTACHMENTS[attachmentId].slot;
    const target = inventory.weapons.find(
        w =>
            isAttachmentCompatible(attachmentId, w.weaponId) &&
            !w.attachments?.[slot]
    );

    if (target) {
        target.attachments = target.attachments || {};
        target.attachments[slot] = attachmentId;
        target.magazineSize = getEffectiveWeapon(
            target.weaponId,
            target.attachments
        ).magazineSize;

        return {
            status: "success",
            message: `${ATTACHMENTS[attachmentId].name} fitted to ${target.name}`,
            attachmentId,
            fittedTo: target.weaponId
        };
    }

    if (inventory.attachments.length >= MAX_SPARE_ATTACHMENTS) {
        return { status: "error", message: "Attachment storage is full" };
    }

    inventory.attachments.push(attachmentId);

    return {
        status: "success",
        message: `${ATTACHMENTS[attachmentId].name} stored`,
        attachmentId,
        fittedTo: null
    };
}

// Fit a spare attachment; any attachment already in that
// slot goes back to spare storage.
function attachToWeapon(matchId, playerId, weaponId, attachmentId) {
    const inventory = inventories.get(getInventoryKey(matchId, playerId));
    if (!inventory) return { status: "error", message: "Inventory not found" };

    const weapon = inventory.weapons.find(w => w.weaponId === weaponId);
    if (!weapon) return { status: "error", message: "Weapon not in inventory" };

    const spareIndex = (inventory.attachments || []).indexOf(attachmentId);
    if (spareIndex < 0) {
        return { status: "error", message: "Attachment not in inventory" };
    }

    if (!isAttachmentCompatible(attachmentId, weaponId)) {
        return { status: "error", message: "Attachment does not fit this weapon" };
    }

    const slot = ATTACHMENTS[attachmentId].slot;
    weapon.attachments = weapon.attachments || {};

    const previous = weapon.attachments[slot] || null;

    inventory.attachments.splice(spareIndex, 1);
    if (previous) inventory.attachments.push(previous);

    weapon.attachments[slot] = attachmentId;
    weapon.magazineSize = getEffectiveWeapon(weaponId, weapon.attachments).magazineSize;

    return {
        status: "success",
        message: "Attachment fitted",
        weaponId,
        slot,
        attachmentId,
        replaced: previous
    };
}

function detachFromWeapon(matchId, playerId, weaponId, slot) {
    const inventory = inventories.get(getInventoryKey(matchId, playerId));
    if (!inventory) return { status: "error", message: "Inventory not found" };

    const weapon = inventory.weapons.find(w => w.weaponId === weaponId);
    if (!weapon) return { status: "error", message: "Weapon not in inventory" };

    const attachmentId = weapon.attachments?.[slot];
    if (!attachmentId) return { status: "error", message: "Slot is empty" };

    inventory.attachments = inventory.attachments || [];

    if (inventory.attachments.length >= MAX_SPARE_ATTACHMENTS) {
        return { status: "error", message: "Attachment storage is full" };
    }

    weapon.attachments[slot] = null;
    inventory.attachments.push(attachmentId);
    weapon.magazineSize = getEffectiveWeapon(weaponId, weapon.attachments).magazineSize;

    return {
        status: "success",
        message: "Attachment removed",
        weaponId,
        slot,
        attachmentId
    };
}

function getWeaponAttachments(matchId, playerId, weaponId) {
    const inventory = inventories.get(getInventoryKey(matchId, playerId));
    const weapon = inventory?.weapons.find(w => w.weaponId === weaponId);
    return weapon?.attachments ? { ...weapon.attachments } : {};
}

// ==============================================
// HEALING ITEMS
// ==============================================

function addHealingItem(matchId, playerId, itemId, quantity) {
    const item = HEALING_ITEMS[itemId];

    if (!item) {
        return { status: "error", message: "Invalid healing item" };
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
        return {
            status: "error",
            message: "Healing quantity must be a positive integer"
        };
    }

    const inventory = createInventory(matchId, playerId);
    inventory.healing = inventory.healing || {};

    const current = inventory.healing[itemId] || 0;
    const space = item.carryLimit - current;

    if (space <= 0) {
        return { status: "error", message: `${item.name} limit reached` };
    }

    const addedQuantity = Math.min(quantity, space);
    inventory.healing[itemId] = current + addedQuantity;

    return {
        status: "success",
        message: `${item.name} added successfully`,
        healingId: itemId,
        addedQuantity,
        totalQuantity: inventory.healing[itemId]
    };
}

function getHealingCount(matchId, playerId, itemId) {
    const inventory = inventories.get(getInventoryKey(matchId, playerId));
    return inventory?.healing?.[itemId] || 0;
}

function consumeHealingItem(matchId, playerId, itemId) {
    const inventory = inventories.get(getInventoryKey(matchId, playerId));
    const current = inventory?.healing?.[itemId] || 0;

    if (current <= 0) {
        return { status: "error", message: "No healing items remaining" };
    }

    inventory.healing[itemId] = current - 1;

    return {
        status: "success",
        remaining: inventory.healing[itemId]
    };
}

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
            message: "Ammunition quantity must be a positive integer"
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
// CONSUME AMMUNITION
// ==============================================

function consumeAmmunition(matchId, playerId, ammoId, quantity) {
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
            message: "Consumption quantity must be a positive integer"
        };
    }

    const inventory = inventories.get(
        getInventoryKey(matchId, playerId)
    );

    if (!inventory) {
        return {
            status: "error",
            message: "Player inventory not found"
        };
    }

    const currentQuantity = inventory.ammunition[ammoId] || 0;

    if (currentQuantity < quantity) {
        return {
            status: "error",
            message: "Insufficient ammunition"
        };
    }

    const remainingQuantity = currentQuantity - quantity;

    if (remainingQuantity === 0) {
        delete inventory.ammunition[ammoId];
    } else {
        inventory.ammunition[ammoId] = remainingQuantity;
    }

    return {
        status: "success",
        message: "Ammunition consumed successfully",
        ammoId,
        consumedQuantity: quantity,
        remainingQuantity
    };
}

// ==============================================
// ADD HELMET
// ==============================================

function addHelmet(matchId, playerId, level) {
    const config = ARMOR_CONFIG.helmet[level];

    if (!config) {
        return {
            status: "error",
            message: "Invalid helmet level"
        };
    }

    const inventory = createInventory(matchId, playerId);

    if (inventory.armor.helmets.length >= INVENTORY_CONFIG.maxHelmetSlots) {
        return {
            status: "error",
            message: "Helmet inventory is full"
        };
    }

    const helmet = {
        instanceId: crypto.randomUUID(),
        itemId: `helmet_level_${level}`,
        itemType: "helmet",
        level,
        durability: config.durability,
        maxDurability: config.durability,
        protection: config.protection,
        collectedAt: new Date().toISOString()
    };

    inventory.armor.helmets.push(helmet);

    return {
        status: "success",
        message: "Helmet added to inventory",
        helmet: { ...helmet }
    };
}

// ==============================================
// ADD VEST
// ==============================================

function addVest(matchId, playerId, level) {
    const config = ARMOR_CONFIG.vest[level];

    if (!config) {
        return {
            status: "error",
            message: "Invalid vest level"
        };
    }

    const inventory = createInventory(matchId, playerId);

    if (inventory.armor.vests.length >= INVENTORY_CONFIG.maxVestSlots) {
        return {
            status: "error",
            message: "Vest inventory is full"
        };
    }

    const vest = {
        instanceId: crypto.randomUUID(),
        itemId: `vest_level_${level}`,
        itemType: "vest",
        level,
        durability: config.durability,
        maxDurability: config.durability,
        protection: config.protection,
        collectedAt: new Date().toISOString()
    };

    inventory.armor.vests.push(vest);

    return {
        status: "success",
        message: "Vest added to inventory",
        vest: { ...vest }
    };
}

// ==============================================
// EQUIP ARMOR HELPER
// ==============================================

function equipArmor(matchId, playerId, armorType, itemIdentifier) {
    if (!["helmet", "vest"].includes(armorType)) {
        return {
            status: "error",
            message: "Invalid armor type"
        };
    }

    if (
        typeof itemIdentifier !== "string" ||
        !itemIdentifier.trim()
    ) {
        return {
            status: "error",
            message: "Armor item identifier is required"
        };
    }

    const inventory = inventories.get(
        getInventoryKey(matchId, playerId)
    );

    if (!inventory) {
        return {
            status: "error",
            message: "Player inventory not found"
        };
    }

    const listName = armorType === "helmet"
        ? "helmets"
        : "vests";

    const carriedItems = inventory.armor[listName];

    const itemIndex = carriedItems.findIndex(item =>
        item.instanceId === itemIdentifier ||
        item.itemId === itemIdentifier
    );

    if (itemIndex === -1) {
        return {
            status: "error",
            message: `Player does not own this ${armorType}`
        };
    }

    const selectedArmor = carriedItems[itemIndex];

    if (selectedArmor.durability <= 0) {
        return {
            status: "error",
            message: "Broken armor cannot be equipped"
        };
    }

    const previousArmor = inventory.armor.equipped[armorType];

    if (
        previousArmor &&
        previousArmor.instanceId === selectedArmor.instanceId
    ) {
        return {
            status: "error",
            message: `${armorType} is already equipped`
        };
    }

    carriedItems.splice(itemIndex, 1);

    if (previousArmor) {
        carriedItems.push(previousArmor);
    }

    inventory.armor.equipped[armorType] = selectedArmor;

    return {
        status: "success",
        message: `${armorType} equipped successfully`,
        armorType,
        equipped: { ...selectedArmor },
        replaced: previousArmor
            ? { ...previousArmor }
            : null
    };
}

// ==============================================
// EQUIP HELMET / VEST
// ==============================================

function equipHelmet(matchId, playerId, itemIdentifier) {
    return equipArmor(matchId, playerId, "helmet", itemIdentifier);
}

function equipVest(matchId, playerId, itemIdentifier) {
    return equipArmor(matchId, playerId, "vest", itemIdentifier);
}

// ==============================================
// UNEQUIP ARMOR HELPER
// ==============================================

function unequipArmor(matchId, playerId, armorType) {
    if (!["helmet", "vest"].includes(armorType)) {
        return {
            status: "error",
            message: "Invalid armor type"
        };
    }

    const inventory = inventories.get(
        getInventoryKey(matchId, playerId)
    );

    if (!inventory) {
        return {
            status: "error",
            message: "Player inventory not found"
        };
    }

    const listName = armorType === "helmet"
        ? "helmets"
        : "vests";

    const carriedItems = inventory.armor[listName];
    const equippedArmor = inventory.armor.equipped[armorType];

    if (!equippedArmor) {
        return {
            status: "error",
            message: `No ${armorType} is currently equipped`
        };
    }

    const maxSlots = armorType === "helmet"
        ? INVENTORY_CONFIG.maxHelmetSlots
        : INVENTORY_CONFIG.maxVestSlots;

    if (carriedItems.length >= maxSlots) {
        return {
            status: "error",
            message: `${armorType} inventory is full`
        };
    }

    carriedItems.push(equippedArmor);
    inventory.armor.equipped[armorType] = null;

    return {
        status: "success",
        message: `${armorType} unequipped successfully`,
        unequipped: { ...equippedArmor }
    };
}

// ==============================================
// UNEQUIP HELMET / VEST
// ==============================================

function unequipHelmet(matchId, playerId) {
    return unequipArmor(matchId, playerId, "helmet");
}

function unequipVest(matchId, playerId) {
    return unequipArmor(matchId, playerId, "vest");
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
    } else if (item.itemType === "helmet" || item.itemType === "vest") {
        result = item.itemType === "helmet"
            ? addHelmet(matchId, playerId, item.level)
            : addVest(matchId, playerId, item.level);

        // Dropped armor keeps its worn-down durability.
        const added = result.helmet || result.vest;

        if (
            result.status === "success" &&
            added &&
            Number.isFinite(item.durability) &&
            item.durability < added.durability
        ) {
            const inventory = inventories.get(getInventoryKey(matchId, playerId));
            const list = item.itemType === "helmet"
                ? inventory.armor.helmets
                : inventory.armor.vests;
            const stored = list.find(a => a.instanceId === added.instanceId);

            if (stored) {
                stored.durability = Math.max(1, Math.floor(item.durability));
                added.durability = stored.durability;
            }
        }
    } else if (item.itemType === "attachment") {
        result = addAttachment(matchId, playerId, item.itemId);
    } else if (item.itemType === "healing") {
        result = addHealingItem(
            matchId,
            playerId,
            item.itemId,
            item.quantity || 1
        );
    } else if (item.itemType === "throwable") {
        // Throwables are tracked by throwableService.
        const throwableResult = addThrowable(
            matchId,
            playerId,
            item.itemId,
            item.quantity || 1
        );

        return {
            success: throwableResult.success,
            message: throwableResult.success
                ? `${item.name || item.itemId} collected`
                : throwableResult.message,
            item: null,
            ammo: null,
            helmet: null,
            vest: null,
            throwable: throwableResult.success
                ? throwableResult.type
                : null,
            throwables: throwableResult.inventory || null,
            addedQuantity: throwableResult.addedQuantity || 0
        };
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
        ammo: result.ammoId || null,
        helmet: result.helmet || null,
        vest: result.vest || null,
        addedQuantity: result.addedQuantity || 0
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

// ==========================================
// REMOVE ONE PLAYER INVENTORY
// ==========================================

function removePlayerInventory(matchId, playerId) {
    if (!matchId || !playerId) {
        return false;
    }

    const key = getInventoryKey(matchId, playerId);

    return inventories.delete(key);
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
    ARMOR_CONFIG,

    createInventory,
    getInventory,

    snapshotInventory,
    restoreInventory,

    addHealingItem,
    getHealingCount,
    consumeHealingItem,

    addAttachment,
    attachToWeapon,
    detachFromWeapon,
    getWeaponAttachments,

    takeItemForDrop,
    takeAllItemsForDrop,

    exportMatchInventories,
    importMatchInventories,

    getEquippedArmor,
    damageEquippedArmor,
    restoreEquippedArmor,

    addWeapon,
    addAmmunition,
    consumeAmmunition,

    addHelmet,
    addVest,

    equipHelmet,
    equipVest,

    unequipHelmet,
    unequipVest,

    addLootItem,
    removeWeapon,

    removePlayerInventory,
    removeMatchInventories
};
