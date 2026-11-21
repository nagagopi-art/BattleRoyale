
const { WEAPONS } = require("../config/weapons");

const {
    getInventory,
    addAmmunition
} = require("./inventoryService");

const {
    calculateDistance,
    validateShot
} = require("./hitDetectionService");

// ==========================================
// BHARAT BATTLEGROUNDS COMBAT ENGINE
// ==========================================

const COMBAT_CONFIG = {
    MAX_HEALTH: 100,
    MAX_ARMOR: 100,
    RELOAD_TIME_MS: 2000,
    DEFAULT_MAGAZINE_SIZE: 30,
    DEFAULT_HEADSHOT_MULTIPLIER: 2,
    MAX_WEAPON_DAMAGE: 200
};

const combatPlayers = new Map();
const lastShotTimes = new Map();
const reloadTimers = new Map();

// ==========================================
// HELPERS
// ==========================================

function getPlayerKey(matchId, playerId) {
    return `${matchId}:${playerId}`;
}

function getAmmoType(weapon) {
    const mapping = {
        assault_rifle: "rifle_ammo",
        smg: "smg_ammo",
        sniper: "sniper_ammo",
        dmr: "sniper_ammo",
        shotgun: "shotgun_ammo",
        pistol: "pistol_ammo"
    };

    return mapping[weapon.category] || null;
}

function getAvailableAmmo(inventory, ammoType) {
    if (!inventory || !Array.isArray(inventory.ammunition)) {
        return 0;
    }

    const ammo = inventory.ammunition.find(
        item => item.ammoType === ammoType
    );

    return ammo ? ammo.quantity : 0;
}

function getMagazineSize(weapon) {
    const size = weapon.magazineSize ||
        COMBAT_CONFIG.DEFAULT_MAGAZINE_SIZE;

    return Number.isInteger(size) && size > 0
        ? size
        : COMBAT_CONFIG.DEFAULT_MAGAZINE_SIZE;
}

// ==========================================
// PLAYER COMBAT STATE
// ==========================================

function createCombatPlayer(matchId, playerId) {
    if (!matchId || !playerId) {
        return {
            success: false,
            message: "Match ID and player ID required"
        };
    }

    const key = getPlayerKey(matchId, playerId);

    if (combatPlayers.has(key)) {
        return {
            success: true,
            message: "Combat player already initialized",
            player: combatPlayers.get(key)
        };
    }

    const player = {
        matchId,
        playerId,
        health: COMBAT_CONFIG.MAX_HEALTH,
        armor: 0,
        kills: 0,
        isAlive: true,
        isReloading: false,
        activeWeapon: null,
        weapons: {}
    };

    combatPlayers.set(key, player);

    return {
        success: true,
        message: "Combat player initialized",
        player
    };
}

function getCombatPlayer(matchId, playerId) {
    return combatPlayers.get(getPlayerKey(matchId, playerId)) || null;
}

// ==========================================
// WEAPON EQUIPPING
// ==========================================

function equipWeapon(matchId, playerId, weaponId) {
    const player = getCombatPlayer(matchId, playerId);

    if (!player || !player.isAlive) {
        return {
            success: false,
            message: "Player unavailable"
        };
    }

    const weapon = WEAPONS[weaponId];

    if (!weapon) {
        return {
            success: false,
            message: "Invalid weapon"
        };
    }

    const inventory = getInventory(matchId, playerId);

    if (!inventory || !Array.isArray(inventory.weapons)) {
        return {
            success: false,
            message: "Inventory not found"
        };
    }

    const ownedWeapon = inventory.weapons.find(
        item => item.weaponId === weaponId
    );

    if (!ownedWeapon) {
        return {
            success: false,
            message: "Weapon not present in inventory"
        };
    }

    if (!player.weapons[weaponId]) {
        player.weapons[weaponId] = {
            magazineAmmo: getMagazineSize(weapon),
            totalAmmo: 0
        };
    }

    player.activeWeapon = weaponId;

    return {
        success: true,
        message: "Weapon equipped",
        weapon: {
            id: weaponId,
            name: weapon.name,
            ...player.weapons[weaponId]
        }
    };
}

// ==========================================
// DAMAGE CALCULATION
// ==========================================

function calculateDamage(weapon, hitLocation) {
    if (!weapon || !Number.isFinite(weapon.damage)) {
        return 0;
    }

    let multiplier = 1;

    if (hitLocation === "head") {
        multiplier = weapon.headshotMultiplier ||
            COMBAT_CONFIG.DEFAULT_HEADSHOT_MULTIPLIER;
    } else if (hitLocation === "legs") {
        multiplier = 0.75;
    } else if (hitLocation !== "body") {
        return 0;
    }

    const damage = Math.round(weapon.damage * multiplier);

    return Math.min(
        COMBAT_CONFIG.MAX_WEAPON_DAMAGE,
        Math.max(1, damage)
    );
}

// ==========================================
// SHOOTING COOLDOWN
// ==========================================

function getWeaponCooldown(weapon) {
    if (
        Number.isFinite(weapon.fireRateMs) &&
        weapon.fireRateMs > 0
    ) {
        return weapon.fireRateMs;
    }

    if (
        Number.isFinite(weapon.fireRate) &&
        weapon.fireRate > 0
    ) {
        // Supports fireRate specified as rounds per minute.
        return Math.ceil(60000 / weapon.fireRate);
    }

    return 150;
}

// ==========================================
// RELOAD
// ==========================================

function reloadWeapon(matchId, playerId) {
    const player = getCombatPlayer(matchId, playerId);

    if (!player || !player.isAlive) {
        return {
            success: false,
            message: "Player unavailable"
        };
    }

    if (player.isReloading) {
        return {
            success: false,
            message: "Already reloading"
        };
    }

    const weaponId = player.activeWeapon;

    if (!weaponId) {
        return {
            success: false,
            message: "No weapon equipped"
        };
    }

    const weapon = WEAPONS[weaponId];
    const weaponState = player.weapons[weaponId];

    if (!weapon || !weaponState) {
        return {
            success: false,
            message: "Weapon state unavailable"
        };
    }

    const magazineSize = getMagazineSize(weapon);

    const requiredAmmo =
        magazineSize - weaponState.magazineAmmo;

    if (requiredAmmo <= 0) {
        return {
            success: false,
            message: "Magazine is already full"
        };
    }

    const inventory = getInventory(matchId, playerId);
    const ammoType = getAmmoType(weapon);

    if (!ammoType) {
        return {
            success: false,
            message: "Weapon ammunition type unavailable"
        };
    }

    const availableAmmo = getAvailableAmmo(
        inventory,
        ammoType
    );

    if (availableAmmo <= 0) {
        return {
            success: false,
            message: "No ammunition available"
        };
    }

    const reloadAmount = Math.min(
        requiredAmmo,
        availableAmmo
    );

    const key = getPlayerKey(matchId, playerId);

    player.isReloading = true;

    const timer = setTimeout(() => {
        try {
            if (!player.isAlive) return;

            const currentInventory = getInventory(
                matchId,
                playerId
            );

            const currentAmmo = getAvailableAmmo(
                currentInventory,
                ammoType
            );

            const actualAmount = Math.min(
                reloadAmount,
                currentAmmo,
                magazineSize - weaponState.magazineAmmo
            );

            if (actualAmount > 0) {
                const consumed = addAmmunition(
                    matchId,
                    playerId,
                    ammoType,
                    -actualAmount
                );

                if (consumed && consumed.success) {
                    weaponState.magazineAmmo += actualAmount;
                }
            }
        } finally {
            player.isReloading = false;
            reloadTimers.delete(key);
        }
    }, COMBAT_CONFIG.RELOAD_TIME_MS);

    reloadTimers.set(key, timer);

    return {
        success: true,
        message: "Reload started",
        reloadTimeMs: COMBAT_CONFIG.RELOAD_TIME_MS,
        ammoToReload: reloadAmount
    };
}

// ==========================================
// AUTHORITATIVE SHOT VALIDATION
// ==========================================

function fireWeapon(matchId, shooterId, targetId, shotData = {}) {
    const shooter = getCombatPlayer(matchId, shooterId);
    const target = getCombatPlayer(matchId, targetId);

    if (!shooter || !target) {
        return {
            success: false,
            message: "Shooter or target not found"
        };
    }

    if (!shooter.isAlive || !target.isAlive) {
        return {
            success: false,
            message: "Player is eliminated"
        };
    }

    if (
        shooterId === targetId ||
        String(shooterId) === String(targetId)
    ) {
        return {
            success: false,
            message: "Cannot shoot yourself"
        };
    }

    if (shooter.matchId !== target.matchId) {
        return {
            success: false,
            message: "Players are not in the same match"
        };
    }

    const weaponId = shooter.activeWeapon;
    const weapon = WEAPONS[weaponId];

    if (!weapon) {
        return {
            success: false,
            message: "No valid weapon equipped"
        };
    }

    const weaponState = shooter.weapons[weaponId];

    if (!weaponState) {
        return {
            success: false,
            message: "Weapon state unavailable"
        };
    }

    if (shooter.isReloading) {
        return {
            success: false,
            message: "Weapon is reloading"
        };
    }

    if (weaponState.magazineAmmo <= 0) {
        return {
            success: false,
            message: "Magazine empty"
        };
    }

    const shooterPosition = shotData.shooterPosition;
    const targetPosition = shotData.targetPosition;
    const origin = shotData.origin;
    const direction = shotData.direction;

    const hitValidation = validateShot({
        shooterPosition,
        targetPosition,
        origin,
        direction,
        weaponId
    });

    if (!hitValidation.success) {
        return {
            success: false,
            message: hitValidation.message
        };
    }

    const key = getPlayerKey(matchId, shooterId);
    const now = Date.now();
    const previousShot = lastShotTimes.get(key) || 0;
    const cooldown = getWeaponCooldown(weapon);

    if (now - previousShot < cooldown) {
        return {
            success: false,
            message: "Weapon firing cooldown active"
        };
    }

    lastShotTimes.set(key, now);
    weaponState.magazineAmmo--;

    if (!hitValidation.hit) {
        return {
            success: true,
            message: "Shot missed",
            shooterId,
            targetId,
            remainingAmmo: weaponState.magazineAmmo,
            hit: false
        };
    }

    const damage = calculateDamage(
        weapon,
        hitValidation.hitLocation
    );

    const armorDamage = Math.min(
        target.armor,
        damage
    );

    target.armor -= armorDamage;

    const healthDamage = damage - armorDamage;

    target.health = Math.max(
        0,
        target.health - healthDamage
    );

    let eliminated = false;

    if (target.health <= 0) {
        target.health = 0;
        target.isAlive = false;
        shooter.kills++;
        eliminated = true;

        const reloadTimer = reloadTimers.get(
            getPlayerKey(matchId, targetId)
        );

        if (reloadTimer) {
            clearTimeout(reloadTimer);
            reloadTimers.delete(getPlayerKey(matchId, targetId));
        }

        target.isReloading = false;
    }

    return {
        success: true,
        message: eliminated ? "Target eliminated" : "Target hit",
        shooterId,
        targetId,
        weapon: weapon.name,
        hit: true,
        hitLocation: hitValidation.hitLocation,
        damage,
        armorDamage,
        healthDamage,
        targetHealth: target.health,
        targetArmor: target.armor,
        remainingAmmo: weaponState.magazineAmmo,
        eliminated,
        totalKills: shooter.kills
    };
}

// ==========================================
// CLEANUP
// ==========================================

function removeCombatPlayer(matchId, playerId) {
    const key = getPlayerKey(matchId, playerId);

    const timer = reloadTimers.get(key);

    if (timer) {
        clearTimeout(timer);
        reloadTimers.delete(key);
    }

    combatPlayers.delete(key);
    lastShotTimes.delete(key);

    return {
        success: true,
        message: "Combat player removed"
    };
}

function removeMatchCombat(matchId) {
    for (const [key, player] of combatPlayers.entries()) {
        if (player.matchId === matchId) {
            removeCombatPlayer(matchId, player.playerId);
        }
    }

    return {
        success: true,
        message: "Match combat state cleared"
    };
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
    COMBAT_CONFIG,
    createCombatPlayer,
    getCombatPlayer,
    equipWeapon,
    reloadWeapon,
    fireWeapon,
    calculateDamage,
    calculateDistance,
    removeCombatPlayer,
    removeMatchCombat
};
