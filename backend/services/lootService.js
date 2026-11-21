
const crypto = require("crypto");

const {
    WEAPONS,
    AMMUNITION
} = require("../config/weapons");

const { THROWABLE_NAMES } = require("./throwableService");
const { HEALING_ITEMS } = require("./healingService");
const { ATTACHMENTS } = require("../config/attachments");

// ==============================================
// INDIAN BATTLE FIELDS - LOOT SERVICE
// ==============================================

const lootMatches = new Map();

const LOOT_CONFIG = {
    totalLootPerMatch: 300,
    pickupDistance: 5,
    worldBoundary: 1000,
    groundAltitude: 5,

    // Item type spawn chances (total = 100).
    itemTypeWeights: {
        weapon: 33,
        ammunition: 24,
        helmet: 9,
        vest: 9,
        throwable: 8,
        healing: 9,
        attachment: 8
    },

    // Which healing item a healing drop contains.
    healingWeights: {
        bandage: 70,
        medkit: 30
    },

    // Which throwable a throwable drop contains.
    throwableWeights: {
        frag: 35,
        smoke: 20,
        flash: 20,
        gloo: 25
    },

    // Armor level distribution.
    // Level 3 equipment is intentionally rarer.
    armorLevelWeights: {
        1: 60,
        2: 30,
        3: 10
    },

    rarity: {
        common: 50,
        uncommon: 30,
        rare: 15,
        epic: 4,
        legendary: 1
    },

    rarityMultipliers: {
        common: 1,
        uncommon: 1.1,
        rare: 1.2,
        epic: 1.3,
        legendary: 1.5
    }
};

// ==============================================
// RANDOM HELPERS
// ==============================================

function randomNumber(min, max) {
    return Math.random() * (max - min) + min;
}

function randomInteger(min, max) {
    return Math.floor(randomNumber(min, max + 1));
}

function chooseRandom(items) {
    if (!Array.isArray(items) || items.length === 0) {
        throw new Error("Cannot choose from an empty list");
    }

    return items[randomInteger(0, items.length - 1)];
}

function chooseWeighted(weights) {
    const entries = Object.entries(weights);

    const totalWeight = entries.reduce(
        (sum, [, weight]) => sum + weight,
        0
    );

    let random = Math.random() * totalWeight;

    for (const [value, weight] of entries) {
        random -= weight;

        if (random < 0) {
            return value;
        }
    }

    return entries[entries.length - 1][0];
}

// ==============================================
// RARITY GENERATION
// ==============================================

function generateRarity() {
    return chooseWeighted(LOOT_CONFIG.rarity);
}

// ==============================================
// LOOT POSITION
// ==============================================

function generateLootPosition() {
    return {
        x: Number(
            randomNumber(
                -LOOT_CONFIG.worldBoundary,
                LOOT_CONFIG.worldBoundary
            ).toFixed(2)
        ),

        y: LOOT_CONFIG.groundAltitude,

        z: Number(
            randomNumber(
                -LOOT_CONFIG.worldBoundary,
                LOOT_CONFIG.worldBoundary
            ).toFixed(2)
        )
    };
}

// ==============================================
// GENERATE WEAPON LOOT
// ==============================================

function generateWeaponLoot() {
    const weaponList = Object.values(WEAPONS);
    const weapon = chooseRandom(weaponList);

    return {
        itemType: "weapon",
        itemId: weapon.id,
        name: weapon.name,
        category: weapon.category,
        damage: weapon.damage,
        magazineSize: weapon.magazineSize
    };
}

// ==============================================
// GENERATE AMMUNITION LOOT
// ==============================================

function generateAmmunitionLoot() {
    const ammoList = Object.values(AMMUNITION);
    const ammo = chooseRandom(ammoList);

    return {
        itemType: "ammunition",
        itemId: ammo.id,
        name: ammo.name,
        quantity: randomInteger(15, 60)
    };
}

// ==============================================
// GENERATE HELMET LOOT
// ==============================================

function generateHelmetLoot() {
    const level = Number(
        chooseWeighted(LOOT_CONFIG.armorLevelWeights)
    );

    const helmetStats = {
        1: {
            durability: 100,
            protection: 0.20
        },
        2: {
            durability: 150,
            protection: 0.30
        },
        3: {
            durability: 200,
            protection: 0.40
        }
    };

    const stats = helmetStats[level];

    return {
        itemType: "helmet",
        itemId: `helmet_level_${level}`,
        name: `Level ${level} Helmet`,
        level,
        durability: stats.durability,
        protection: stats.protection
    };
}

// ==============================================
// GENERATE VEST LOOT
// ==============================================

function generateVestLoot() {
    const level = Number(
        chooseWeighted(LOOT_CONFIG.armorLevelWeights)
    );

    const vestStats = {
        1: {
            durability: 100,
            protection: 0.20
        },
        2: {
            durability: 150,
            protection: 0.30
        },
        3: {
            durability: 200,
            protection: 0.40
        }
    };

    const stats = vestStats[level];

    return {
        itemType: "vest",
        itemId: `vest_level_${level}`,
        name: `Level ${level} Vest`,
        level,
        durability: stats.durability,
        protection: stats.protection
    };
}

// ==============================================
// GENERATE THROWABLE LOOT
// ==============================================

function generateThrowableLoot() {
    const type = chooseWeighted(LOOT_CONFIG.throwableWeights);

    return {
        itemType: "throwable",
        itemId: type,
        name: THROWABLE_NAMES[type],
        // Gloo walls drop in pairs, grenades singly.
        quantity: type === "gloo" ? 2 : 1
    };
}

// ==============================================
// GENERATE ATTACHMENT LOOT
// ==============================================

function generateAttachmentLoot() {
    const attachment = chooseRandom(Object.values(ATTACHMENTS));

    return {
        itemType: "attachment",
        itemId: attachment.id,
        name: attachment.name,
        category: attachment.slot
    };
}

// ==============================================
// GENERATE HEALING LOOT
// ==============================================

function generateHealingLoot() {
    const item = HEALING_ITEMS[
        chooseWeighted(LOOT_CONFIG.healingWeights)
    ];

    return {
        itemType: "healing",
        itemId: item.id,
        name: item.name,
        quantity: item.lootQuantity
    };
}

// ==============================================
// CREATE RANDOM LOOT ITEM
// ==============================================

function generateLootItem() {
    const rarity = generateRarity();

    const itemType = chooseWeighted(
        LOOT_CONFIG.itemTypeWeights
    );

    let item;

    switch (itemType) {
        case "weapon":
            item = generateWeaponLoot();
            break;

        case "ammunition":
            item = generateAmmunitionLoot();
            break;

        case "helmet":
            item = generateHelmetLoot();
            break;

        case "vest":
            item = generateVestLoot();
            break;

        case "throwable":
            item = generateThrowableLoot();
            break;

        case "healing":
            item = generateHealingLoot();
            break;

        case "attachment":
            item = generateAttachmentLoot();
            break;

        default:
            throw new Error("Unsupported loot item type");
    }

    return {
        lootId: crypto.randomUUID(),
        ...item,
        rarity,
        rarityMultiplier:
            LOOT_CONFIG.rarityMultipliers[rarity],
        position: generateLootPosition(),
        isAvailable: true,
        createdAt: new Date().toISOString()
    };
}

// ==============================================
// GENERATE LOOT FOR MATCH
// ==============================================

// options.pickPosition(defaultPosition, index) -> position lets
// the caller place loot (e.g. inside houses, never in walls).
function generateMatchLoot(
    matchId,
    totalLoot = LOOT_CONFIG.totalLootPerMatch,
    options = {}
) {
    if (!matchId) {
        throw new Error("Match ID is required");
    }

    if (
        !Number.isInteger(totalLoot) ||
        totalLoot < 1 ||
        totalLoot > 2000
    ) {
        throw new Error(
            "Loot count must be between 1 and 2000"
        );
    }

    if (lootMatches.has(matchId)) {
        return {
            status: "success",
            message: "Loot already generated for this match",
            totalLoot: lootMatches.get(matchId).length,
            loot: lootMatches.get(matchId)
        };
    }

    const loot = [];

    for (let i = 0; i < totalLoot; i++) {
        const item = generateLootItem();

        if (typeof options.pickPosition === "function") {
            const picked = options.pickPosition(item.position, i);
            if (picked) {
                item.position = {
                    x: Number(picked.x.toFixed(2)),
                    y: LOOT_CONFIG.groundAltitude,
                    z: Number(picked.z.toFixed(2))
                };
            }
        }

        loot.push(item);
    }

    lootMatches.set(matchId, loot);

    return {
        status: "success",
        message: "Match loot generated successfully",
        totalLoot: loot.length,
        loot
    };
}

// ==============================================
// GET AVAILABLE LOOT
// ==============================================

function getAvailableLoot(matchId) {
    if (!matchId) {
        throw new Error("Match ID is required");
    }

    const loot = lootMatches.get(matchId);

    if (!loot) {
        return [];
    }

    return loot.filter(item => item.isAvailable);
}

// ==============================================
// PICK UP LOOT
// ==============================================

function pickupLoot(matchId, lootId, playerPosition) {
    if (!matchId || !lootId || !playerPosition) {
        return {
            success: false,
            status: "error",
            message:
                "Match ID, loot ID and player position are required"
        };
    }

    const { x, y = 0, z } = playerPosition;

    if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        !Number.isFinite(z) ||
        Math.abs(x) > 100000 ||
        Math.abs(y) > 10000 ||
        Math.abs(z) > 100000
    ) {
        return {
            success: false,
            status: "error",
            message: "Invalid player position"
        };
    }

    const loot = lootMatches.get(matchId);

    if (!loot) {
        return {
            success: false,
            status: "error",
            message:
                "Loot has not been generated for this match"
        };
    }

    const item = loot.find(
        entry => entry.lootId === lootId
    );

    if (!item || !item.isAvailable) {
        return {
            success: false,
            status: "error",
            message:
                "Loot is unavailable or already collected"
        };
    }

    const dx = x - item.position.x;
    const dy = y - item.position.y;
    const dz = z - item.position.z;

    const distance = Math.sqrt(
        dx * dx + dy * dy + dz * dz
    );

    if (distance > LOOT_CONFIG.pickupDistance) {
        return {
            success: false,
            status: "error",
            message: "Move closer to collect this item",
            distance: Number(distance.toFixed(2))
        };
    }

    // Mark as collected.
    item.isAvailable = false;
    item.collectedAt = new Date().toISOString();

    return {
        success: true,
        status: "success",
        message: "Loot collected successfully",
        item: {
            lootId: item.lootId,
            itemType: item.itemType,
            itemId: item.itemId,
            name: item.name,
            category: item.category || null,
            quantity: item.quantity || null,
            level: item.level || null,
            durability: item.durability || null,
            protection: item.protection || null,
            rarity: item.rarity
        }
    };
}

// ==============================================
// RESTORE LOOT AFTER FAILED INVENTORY UPDATE
// ==============================================

function restoreLoot(matchId, lootId) {
    if (!matchId || !lootId) {
        return false;
    }

    const loot = lootMatches.get(matchId);

    if (!loot) {
        return false;
    }

    const item = loot.find(
        entry => entry.lootId === lootId
    );

    if (!item || item.isAvailable) {
        return false;
    }

    item.isAvailable = true;
    delete item.collectedAt;

    return true;
}

// ==============================================
// REMOVE MATCH LOOT
// ==============================================

function removeMatchLoot(matchId) {
    if (!matchId) {
        return false;
    }

    return lootMatches.delete(matchId);
}

// ==============================================
// EXPORTS
// ==============================================

// ==============================================
// DROP ITEMS ON THE GROUND
// ==============================================
// Used for player drops and death loot. Items are spread
// in a small circle around `position` so they can each be
// picked up individually.

function dropItemsOnGround(matchId, items, position) {
    if (
        !matchId ||
        !Array.isArray(items) ||
        items.length === 0 ||
        !position ||
        !Number.isFinite(position.x) ||
        !Number.isFinite(position.y) ||
        !Number.isFinite(position.z)
    ) {
        return [];
    }

    if (!lootMatches.has(matchId)) {
        lootMatches.set(matchId, []);
    }

    const loot = lootMatches.get(matchId);
    const dropped = [];

    items.forEach((item, index) => {
        const angle = (index / items.length) * Math.PI * 2;
        const radius = items.length > 1 ? 1.2 : 0;

        const entry = {
            lootId: crypto.randomUUID(),
            ...item,
            rarity: item.rarity || "common",
            rarityMultiplier: 1,
            position: {
                x: Number((position.x + Math.cos(angle) * radius).toFixed(2)),
                y: position.y,
                z: Number((position.z + Math.sin(angle) * radius).toFixed(2))
            },
            isAvailable: true,
            dropped: true,
            createdAt: new Date().toISOString()
        };

        loot.push(entry);
        dropped.push(entry);
    });

    return dropped;
}

// ==============================================
// MATCH STATE SNAPSHOT (CRASH RECOVERY)
// ==============================================

function exportMatchLoot(matchId) {
    const loot = lootMatches.get(matchId);
    return loot ? JSON.parse(JSON.stringify(loot)) : null;
}

function importMatchLoot(matchId, loot) {
    if (Array.isArray(loot)) {
        lootMatches.set(matchId, JSON.parse(JSON.stringify(loot)));
    }
}

function hasMatchLoot(matchId) {
    return lootMatches.has(matchId);
}

module.exports = {
    LOOT_CONFIG,
    exportMatchLoot,
    importMatchLoot,
    hasMatchLoot,
    dropItemsOnGround,
    generateMatchLoot,
    getAvailableLoot,
    pickupLoot,
    restoreLoot,
    removeMatchLoot
};
