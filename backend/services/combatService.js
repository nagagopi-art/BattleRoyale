
const { WEAPONS } = require("../config/weapons");

const {
    getInventory,
    consumeAmmunition,
    getEquippedArmor,
    damageEquippedArmor,
    getWeaponAttachments,
    addAmmunition
} = require("./inventoryService");

const {
    getEffectiveWeapon,
    HANDLING_CONFIG
} = require("../config/attachments");

const {
    calculateDistance,
    validateShot
} = require("./hitDetectionService");

const {
    knockPlayer,
    clearKnock
} = require("./knockdownService");

// ==========================================
// INDIAN BATTLE FIELDS
// COMBAT ENGINE
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

// Weapon stats including the player's fitted attachments.
function getPlayerWeapon(matchId, playerId, weaponId) {
    if (!WEAPONS[weaponId]) return null;

    return getEffectiveWeapon(
        weaponId,
        getWeaponAttachments(matchId, playerId, weaponId)
    );
}

// After an attachment change, make sure the loaded magazine
// fits the (possibly smaller) magazine size. Extra rounds
// go back into reserve ammunition.
function clampMagazineToSize(matchId, playerId, weaponId) {
    const player = getCombatPlayer(matchId, playerId);
    const weapon = getPlayerWeapon(matchId, playerId, weaponId);
    const state = player?.weapons?.[weaponId];

    if (!player || !weapon || !state) {
        return { success: true, returned: 0 };
    }

    const excess = state.magazineAmmo - weapon.magazineSize;

    if (excess <= 0) {
        return { success: true, returned: 0 };
    }

    state.magazineAmmo = weapon.magazineSize;

    const ammoType = getAmmoType(weapon);

    if (ammoType) {
        addAmmunition(matchId, playerId, ammoType, excess);
    }

    return { success: true, returned: excess };
}

// ==========================================
// SPREAD, RECOIL AND DAMAGE FALLOFF
// ==========================================

const recoilStates = new Map(); // key -> { recoil, lastShotAt }

// Current recoil (degrees) after firing one more shot now.
function updateRecoil(key, weapon, now) {
    const state = recoilStates.get(key) || { recoil: 0, lastShotAt: 0 };

    if (now - state.lastShotAt > HANDLING_CONFIG.recoilResetMs) {
        state.recoil = 0;
    }

    const current = state.recoil;

    state.recoil = Math.min(
        weapon.maxRecoil,
        state.recoil + weapon.recoilPerShot
    );
    state.lastShotAt = now;
    recoilStates.set(key, state);

    return current;
}

// Rotate `direction` by a random angle inside a cone of
// `maxDegrees` (uniform over the cone's disc).
function applySpread(direction, maxDegrees) {
    const length = Math.hypot(direction.x, direction.y, direction.z);
    if (!length || !(maxDegrees > 0)) return { ...direction };

    const d = {
        x: direction.x / length,
        y: direction.y / length,
        z: direction.z / length
    };

    // Two axes perpendicular to d.
    const helper = Math.abs(d.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    let u = {
        x: d.y * helper.z - d.z * helper.y,
        y: d.z * helper.x - d.x * helper.z,
        z: d.x * helper.y - d.y * helper.x
    };
    const uLen = Math.hypot(u.x, u.y, u.z);
    u = { x: u.x / uLen, y: u.y / uLen, z: u.z / uLen };
    const v = {
        x: d.y * u.z - d.z * u.y,
        y: d.z * u.x - d.x * u.z,
        z: d.x * u.y - d.y * u.x
    };

    const angle = (maxDegrees * Math.PI / 180) * Math.sqrt(Math.random());
    const around = Math.random() * Math.PI * 2;
    const offset = Math.tan(angle);

    return {
        x: d.x + (u.x * Math.cos(around) + v.x * Math.sin(around)) * offset,
        y: d.y + (u.y * Math.cos(around) + v.y * Math.sin(around)) * offset,
        z: d.z + (u.z * Math.cos(around) + v.z * Math.sin(around)) * offset
    };
}

// 1.0 up to falloffStart of range, then down to minDamageFraction.
function getFalloffMultiplier(weapon, distance) {
    const range = weapon.range || 1;
    const start = range * HANDLING_CONFIG.falloffStartFraction;

    if (!Number.isFinite(distance) || distance <= start) return 1;

    const t = Math.min(1, (distance - start) / (range - start));

    return 1 - (1 - HANDLING_CONFIG.minDamageFraction) * t;
}

function cloneData(data) {
    return data === undefined || data === null
        ? data
        : JSON.parse(JSON.stringify(data));
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
    if (
        !inventory ||
        !inventory.ammunition ||
        typeof inventory.ammunition !== "object"
    ) {
        return 0;
    }

    const quantity = inventory.ammunition[ammoType] || 0;

    return Number.isInteger(quantity) && quantity > 0
        ? quantity
        : 0;
}

function getMagazineSize(weapon) {
    const size = weapon.magazineSize ||
        COMBAT_CONFIG.DEFAULT_MAGAZINE_SIZE;

    return Number.isInteger(size) && size > 0
        ? size
        : COMBAT_CONFIG.DEFAULT_MAGAZINE_SIZE;
}

function getReloadTime(weapon) {
    if (
        Number.isFinite(weapon.reloadTime) &&
        weapon.reloadTime > 0
    ) {
        return Math.round(weapon.reloadTime * 1000);
    }

    return COMBAT_CONFIG.RELOAD_TIME_MS;
}

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
        return Math.ceil(60000 / weapon.fireRate);
    }

    return 150;
}

// ==========================================
// COMBAT STATE SNAPSHOT
// ==========================================

function snapshotCombatState(matchId, playerId) {
    const key = getPlayerKey(matchId, playerId);
    const player = combatPlayers.get(key);

    return {
        exists: Boolean(player),
        player: player ? cloneData(player) : null,

        hadLastShotTime: lastShotTimes.has(key),
        lastShotTime: lastShotTimes.has(key)
            ? lastShotTimes.get(key)
            : null,

        hadReloadTimer: reloadTimers.has(key)
    };
}

// ==========================================
// RESTORE COMBAT STATE
// ==========================================

function restoreCombatState(matchId, playerId, snapshot) {
    if (
        !snapshot ||
        typeof snapshot !== "object" ||
        typeof snapshot.exists !== "boolean"
    ) {
        return {
            success: false,
            message: "Invalid combat snapshot"
        };
    }

    const key = getPlayerKey(matchId, playerId);

    if (!snapshot.exists) {
        const timer = reloadTimers.get(key);

        if (timer) {
            clearTimeout(timer);
            reloadTimers.delete(key);
        }

        combatPlayers.delete(key);
        lastShotTimes.delete(key);

        return {
            success: true,
            message: "Combat state restored to previous empty state"
        };
    }

    if (!snapshot.player) {
        return {
            success: false,
            message: "Combat snapshot player data is missing"
        };
    }

    if (
        String(snapshot.player.matchId) !== String(matchId) ||
        String(snapshot.player.playerId) !== String(playerId)
    ) {
        return {
            success: false,
            message: "Combat snapshot does not match player"
        };
    }

    const restoredPlayer = cloneData(snapshot.player);
    const existingPlayer = combatPlayers.get(key);

    if (existingPlayer) {
        for (const property of Object.keys(existingPlayer)) {
            delete existingPlayer[property];
        }

        Object.assign(existingPlayer, restoredPlayer);
    } else {
        combatPlayers.set(key, restoredPlayer);
    }

    if (snapshot.hadLastShotTime) {
        lastShotTimes.set(key, snapshot.lastShotTime);
    } else {
        lastShotTimes.delete(key);
    }

    // A reload timer cannot be recreated from a snapshot.
    // If it expired while the database request was pending,
    // do not leave the player permanently stuck reloading.
    if (
        restoredPlayer.isReloading &&
        !reloadTimers.has(key)
    ) {
        restoredPlayer.isReloading = false;
    }

    return {
        success: true,
        message: "Combat state restored successfully",
        player: restoredPlayer
    };
}

// ==========================================
// CANCEL RELOAD AFTER SUCCESSFUL PERSISTENCE
// ==========================================

function cancelPlayerReload(matchId, playerId) {
    const key = getPlayerKey(matchId, playerId);
    const timer = reloadTimers.get(key);

    if (timer) {
        clearTimeout(timer);
        reloadTimers.delete(key);
    }

    const player = getCombatPlayer(matchId, playerId);

    if (player) {
        player.isReloading = false;
    }

    return {
        success: true,
        message: "Player reload cancelled"
    };
}

// ==========================================
// ARMOR STATE SYNCHRONIZATION
// ==========================================

function syncCombatArmorState(matchId, playerId) {
    const player = getCombatPlayer(matchId, playerId);

    if (!player) {
        return {
            success: false,
            message: "Combat player not found"
        };
    }

    const equipped = getEquippedArmor(matchId, playerId);

    const helmet = equipped.helmet;
    const vest = equipped.vest;

    player.helmetLevel = helmet ? helmet.level : 0;
    player.helmetDurability = helmet ? helmet.durability : 0;

    player.vestLevel = vest ? vest.level : 0;
    player.vestDurability = vest ? vest.durability : 0;

    return {
        success: true,
        helmet: helmet ? { ...helmet } : null,
        vest: vest ? { ...vest } : null
    };
}

// ==========================================
// PLAYER COMBAT STATE
// ==========================================

function createCombatPlayer(matchId, playerId) {
    if (!matchId || playerId === undefined || playerId === null) {
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

        helmetLevel: 0,
        helmetDurability: 0,
        vestLevel: 0,
        vestDurability: 0,

        kills: 0,
        isAlive: true,
        isReloading: false,
        activeWeapon: null,
        weapons: {}
    };

    combatPlayers.set(key, player);

    syncCombatArmorState(matchId, playerId);

    return {
        success: true,
        message: "Combat player initialized",
        player
    };
}

function getCombatPlayer(matchId, playerId) {
    return combatPlayers.get(
        getPlayerKey(matchId, playerId)
    ) || null;
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

    if (player.isReloading) {
        return {
            success: false,
            message: "Cannot switch weapons while reloading"
        };
    }

    const weapon = getPlayerWeapon(matchId, playerId, weaponId);

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
// APPLY HELMET / VEST PROTECTION
// ==========================================

function applyEquippedArmor(matchId, targetId, hitLocation, damage) {
    let remainingDamage = damage;

    let helmetDamage = 0;
    let vestDamage = 0;

    let helmetBroken = false;
    let vestBroken = false;

    let helmet = null;
    let vest = null;

    let armorType = null;

    if (hitLocation === "head") {
        armorType = "helmet";
    } else if (
        hitLocation === "body" ||
        hitLocation === "legs"
    ) {
        armorType = "vest";
    }

    if (armorType) {
        const result = damageEquippedArmor(
            matchId,
            targetId,
            armorType,
            remainingDamage
        );

        if (!result.success) {
            return {
                success: false,
                message: result.message
            };
        }

        remainingDamage = result.remainingDamage;

        if (armorType === "helmet") {
            helmetDamage = result.absorbedDamage;
            helmetBroken = result.broken;
        }

        if (armorType === "vest") {
            vestDamage = result.absorbedDamage;
            vestBroken = result.broken;
        }
    }

    const equipped = getEquippedArmor(matchId, targetId);

    helmet = equipped.helmet;
    vest = equipped.vest;

    return {
        success: true,
        remainingDamage,
        helmetDamage,
        vestDamage,
        helmetBroken,
        vestBroken,
        helmet,
        vest
    };
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

    const weapon = getPlayerWeapon(matchId, playerId, weaponId);
    const weaponState = player.weapons[weaponId];

    if (!weapon || !weaponState) {
        return {
            success: false,
            message: "Weapon state unavailable"
        };
    }

    const magazineSize = getMagazineSize(weapon);

    const requiredAmmo = Math.max(
        0,
        magazineSize - weaponState.magazineAmmo
    );

    if (requiredAmmo <= 0) {
        return {
            success: false,
            message: "Magazine is already full"
        };
    }

    const ammoType = getAmmoType(weapon);

    if (!ammoType) {
        return {
            success: false,
            message: "Weapon ammunition type unavailable"
        };
    }

    const inventory = getInventory(matchId, playerId);

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

    const reloadTimeMs = getReloadTime(weapon);
    const key = getPlayerKey(matchId, playerId);

    player.isReloading = true;

    const timer = setTimeout(() => {
        try {
            if (!player.isAlive) {
                return;
            }

            const currentRequired = Math.max(
                0,
                magazineSize - weaponState.magazineAmmo
            );

            if (currentRequired <= 0) {
                return;
            }

            const currentInventory = getInventory(
                matchId,
                playerId
            );

            const currentAmmo = getAvailableAmmo(
                currentInventory,
                ammoType
            );

            const actualAmount = Math.min(
                currentRequired,
                currentAmmo
            );

            if (actualAmount <= 0) {
                return;
            }

            const consumed = consumeAmmunition(
                matchId,
                playerId,
                ammoType,
                actualAmount
            );

            if (consumed.status === "success") {
                weaponState.magazineAmmo += actualAmount;
            }
        } catch (error) {
            console.error(
                "[COMBAT] Reload failed:",
                error.message
            );
        } finally {
            player.isReloading = false;
            reloadTimers.delete(key);
        }
    }, reloadTimeMs);

    reloadTimers.set(key, timer);

    return {
        success: true,
        message: "Reload started",
        reloadTimeMs,
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

    if (String(shooterId) === String(targetId)) {
        return {
            success: false,
            message: "Cannot shoot yourself"
        };
    }

    if (shooter.knocked) {
        return {
            success: false,
            message: "Knocked players cannot shoot"
        };
    }

    if (shooter.matchId !== target.matchId) {
        return {
            success: false,
            message: "Players are not in the same match"
        };
    }

    const weaponId = shooter.activeWeapon;
    const weapon = getPlayerWeapon(matchId, shooterId, weaponId);

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

    // ----- Spread + recoil: the server decides where
    // each bullet / pellet actually goes. -----
    const savedRecoil = recoilStates.has(key)
        ? { ...recoilStates.get(key) }
        : null;

    const recoil = updateRecoil(key, weapon, now);
    const pellets = Number.isInteger(weapon.pellets) && weapon.pellets > 1
        ? weapon.pellets
        : 1;

    const cone = weapon.spread + recoil + (pellets > 1 ? weapon.pelletSpread : 0);

    const traces = [];

    for (let i = 0; i < pellets; i++) {
        const trace = validateShot({
            shooterPosition: shotData.shooterPosition,
            targetPosition: shotData.targetPosition,
            origin: shotData.origin,
            direction: applySpread(shotData.direction, cone),
            weaponId,
            maxRange: weapon.range,
            obstacles: shotData.obstacles
        });

        if (!trace.success) {
            // Invalid shot: undo the recoil we just added.
            if (savedRecoil) recoilStates.set(key, savedRecoil);
            else recoilStates.delete(key);

            return {
                success: false,
                message: trace.message
            };
        }

        traces.push(trace);
    }

    lastShotTimes.set(key, now);
    weaponState.magazineAmmo--;

    const hits = traces.filter(t => t.hit);
    const blockedTraces = traces.filter(t => t.blocked);

    if (hits.length === 0 && blockedTraces.length > 0) {
        return {
            success: true,
            message: "Shot blocked by gloo wall",
            shooterId,
            targetId,
            weapon: weapon.name,
            suppressed: weapon.suppressed,
            remainingAmmo: weaponState.magazineAmmo,
            hit: false,
            blocked: true,
            obstacleId: blockedTraces[0].obstacleId,
            wallDamage: calculateDamage(weapon, "body") * blockedTraces.length
        };
    }

    if (hits.length === 0) {
        return {
            success: true,
            message: "Shot missed",
            shooterId,
            targetId,
            weapon: weapon.name,
            suppressed: weapon.suppressed,
            remainingAmmo: weaponState.magazineAmmo,
            hit: false
        };
    }

    // Shotguns: damage from every pellet that hit.
    const falloff = getFalloffMultiplier(weapon, hits[0].distance);

    const hitValidation = {
        hitLocation: hits.some(t => t.hitLocation === "head")
            ? "head"
            : hits.some(t => t.hitLocation === "body") ? "body" : "legs"
    };

    const damage = Math.min(
        COMBAT_CONFIG.MAX_WEAPON_DAMAGE,
        Math.max(
            1,
            Math.round(
                hits.reduce(
                    (sum, t) => sum + calculateDamage(weapon, t.hitLocation),
                    0
                ) * falloff
            )
        )
    );

    // Knocked players' armor no longer protects them.
    const armorResult = target.knocked
        ? noArmorResult(matchId, targetId, damage)
        : applyEquippedArmor(
            matchId,
            targetId,
            hitValidation.hitLocation,
            damage
        );

    if (!armorResult.success) {
        weaponState.magazineAmmo++;

        if (previousShot) {
            lastShotTimes.set(key, previousShot);
        } else {
            lastShotTimes.delete(key);
        }

        return {
            success: false,
            message: armorResult.message
        };
    }

    let remainingDamage = armorResult.remainingDamage;

    const genericArmorDamage = target.knocked
        ? 0
        : Math.min(target.armor, remainingDamage);

    target.armor -= genericArmorDamage;
    remainingDamage -= genericArmorDamage;

    const healthDamage = remainingDamage;

    const outcome = applyHealthDamage(
        shooter,
        target,
        healthDamage,
        Boolean(shotData.allowKnock)
    );

    target.helmetLevel = armorResult.helmet
        ? armorResult.helmet.level
        : 0;

    target.helmetDurability = armorResult.helmet
        ? armorResult.helmet.durability
        : 0;

    target.vestLevel = armorResult.vest
        ? armorResult.vest.level
        : 0;

    target.vestDurability = armorResult.vest
        ? armorResult.vest.durability
        : 0;

    // Reload cancellation is deliberately deferred.
    // The socket should call cancelPlayerReload()
    // only after the database transaction succeeds.
    const eliminated = outcome.eliminated;
    const knocked = outcome.knocked;

    const totalArmorDamage =
        armorResult.helmetDamage +
        armorResult.vestDamage +
        genericArmorDamage;

    return {
        success: true,
        message: eliminated
            ? "Target eliminated"
            : knocked ? "Target knocked down" : "Target hit",
        knocked,
        targetKnocked: Boolean(target.knocked),
        knockHealth: target.knocked ? target.knockHealth : null,
        shooterId,
        targetId,
        weapon: weapon.name,
        suppressed: weapon.suppressed,
        hit: true,
        hitLocation: hitValidation.hitLocation,
        pelletsHit: pellets > 1 ? hits.length : undefined,
        damageFalloff: Number(falloff.toFixed(2)),

        damage,

        armorDamage: totalArmorDamage,

        helmetDamage: armorResult.helmetDamage,
        vestDamage: armorResult.vestDamage,
        genericArmorDamage,

        helmetBroken: armorResult.helmetBroken,
        vestBroken: armorResult.vestBroken,

        helmetLevel: target.helmetLevel,
        helmetDurability: target.helmetDurability,

        vestLevel: target.vestLevel,
        vestDurability: target.vestDurability,

        healthDamage,
        targetHealth: target.health,
        targetArmor: target.armor,

        remainingAmmo: weaponState.magazineAmmo,
        eliminated,
        totalKills: shooter.kills
    };
}

// Armor result used when armor is bypassed (knocked target).
function noArmorResult(matchId, targetId, damage) {
    const equipped = getEquippedArmor(matchId, targetId);

    return {
        success: true,
        remainingDamage: damage,
        helmetDamage: 0,
        vestDamage: 0,
        helmetBroken: false,
        vestBroken: false,
        helmet: equipped.helmet,
        vest: equipped.vest
    };
}

// ==========================================
// HEALTH DAMAGE WITH KNOCKDOWN
// ==========================================
// allowKnock: true in duo/squad when the target still has
// a standing teammate. Returns { knocked, eliminated }.

// Respawn modes (Clash Squad, Team Deathmatch) register a
// policy: matchId -> true when deaths are temporary there.
let respawnPolicy = () => false;
function setRespawnPolicy(fn) {
    respawnPolicy = typeof fn === "function" ? fn : () => false;
}

// Bring a downed player back (new round / respawn).
function revivePlayerForRound(matchId, playerId) {
    const player = combatPlayers.get(getPlayerKey(matchId, playerId));
    if (!player) return null;
    clearKnock(player);
    player.health = COMBAT_CONFIG.MAX_HEALTH;
    player.isAlive = true;
    player.respawnPending = false;
    player.isReloading = false;
    return player;
}

function applyHealthDamage(attacker, target, healthDamage, allowKnock) {
    const temporaryDeath = respawnPolicy(target.matchId);
    if (temporaryDeath) allowKnock = false;
    // Already knocked: damage goes to knock health, no armor.
    if (target.knocked) {
        target.knockHealth = Math.max(0, target.knockHealth - healthDamage);

        if (target.knockHealth <= 0) {
            clearKnock(target);
            target.health = 0;
            target.isAlive = false;
            if (attacker) attacker.kills++;
            return { knocked: false, eliminated: true };
        }

        return { knocked: false, eliminated: false };
    }

    target.health = Math.max(0, target.health - healthDamage);

    if (target.health > 0) {
        return { knocked: false, eliminated: false };
    }

    if (allowKnock) {
        knockPlayer(target, attacker ? attacker.playerId : null);
        return { knocked: true, eliminated: false };
    }

    target.isAlive = false;
    if (attacker) attacker.kills++;
    // Down until the next round / respawn, not out of the match.
    if (temporaryDeath) target.respawnPending = true;

    return { knocked: false, eliminated: true };
}

// ==========================================
// EXPLOSION DAMAGE (GRENADES)
// ==========================================

function applyExplosionDamage(matchId, attackerId, targetId, baseDamage, options = {}) {
    const attacker = getCombatPlayer(matchId, attackerId);
    const target = getCombatPlayer(matchId, targetId);

    if (!attacker || !target) {
        return {
            success: false,
            message: "Attacker or target not found"
        };
    }

    if (!target.isAlive) {
        return {
            success: false,
            message: "Target is eliminated"
        };
    }

    if (String(attackerId) === String(targetId)) {
        return {
            success: false,
            message: "Explosion cannot damage its thrower"
        };
    }

    if (!Number.isFinite(baseDamage) || baseDamage <= 0) {
        return {
            success: false,
            message: "Invalid explosion damage"
        };
    }

    const damage = Math.min(
        COMBAT_CONFIG.MAX_WEAPON_DAMAGE,
        Math.max(1, Math.round(baseDamage))
    );

    // Blast damage is absorbed by the vest, not the helmet.
    // Knocked players' armor no longer protects them.
    const armorResult = target.knocked
        ? noArmorResult(matchId, targetId, damage)
        : applyEquippedArmor(
            matchId,
            targetId,
            "body",
            damage
        );

    if (!armorResult.success) {
        return {
            success: false,
            message: armorResult.message
        };
    }

    let remainingDamage = armorResult.remainingDamage;

    const genericArmorDamage = target.knocked
        ? 0
        : Math.min(target.armor, remainingDamage);

    target.armor -= genericArmorDamage;
    remainingDamage -= genericArmorDamage;

    const healthDamage = remainingDamage;

    const outcome = applyHealthDamage(
        attacker,
        target,
        healthDamage,
        Boolean(options.allowKnock)
    );

    target.helmetLevel = armorResult.helmet ? armorResult.helmet.level : 0;
    target.helmetDurability = armorResult.helmet ? armorResult.helmet.durability : 0;
    target.vestLevel = armorResult.vest ? armorResult.vest.level : 0;
    target.vestDurability = armorResult.vest ? armorResult.vest.durability : 0;

    const eliminated = outcome.eliminated;
    const knocked = outcome.knocked;

    return {
        success: true,
        message: eliminated
            ? "Target eliminated"
            : knocked ? "Target knocked down" : "Target hit",
        knocked,
        targetKnocked: Boolean(target.knocked),
        knockHealth: target.knocked ? target.knockHealth : null,
        shooterId: attackerId,
        targetId,
        weapon: "Frag Grenade",
        hit: true,
        hitLocation: "body",

        damage,
        armorDamage:
            armorResult.helmetDamage +
            armorResult.vestDamage +
            genericArmorDamage,

        helmetDamage: armorResult.helmetDamage,
        vestDamage: armorResult.vestDamage,
        genericArmorDamage,

        helmetBroken: armorResult.helmetBroken,
        vestBroken: armorResult.vestBroken,

        helmetLevel: target.helmetLevel,
        helmetDurability: target.helmetDurability,
        vestLevel: target.vestLevel,
        vestDurability: target.vestDurability,

        healthDamage,
        targetHealth: target.health,
        targetArmor: target.armor,

        eliminated,
        totalKills: attacker.kills
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
    recoilStates.delete(key);

    return {
        success: true,
        message: "Combat player removed"
    };
}

// Snapshot: weapons / magazines / kills / knock state.
// Health and alive flags are also in the database, which
// wins on rejoin.
function exportMatchCombat(matchId) {
    const result = {};

    for (const player of combatPlayers.values()) {
        if (String(player.matchId) === String(matchId)) {
            const copy = cloneData(player);
            copy.isReloading = false;
            result[player.playerId] = copy;
        }
    }

    return result;
}

function importMatchCombat(matchId, data) {
    for (const [playerId, player] of Object.entries(data || {})) {
        const restored = cloneData(player);
        restored.isReloading = false;
        combatPlayers.set(getPlayerKey(matchId, playerId), restored);
    }
}

function removeMatchCombat(matchId) {
    for (const [key, player] of combatPlayers.entries()) {
        if (String(player.matchId) === String(matchId)) {
            removeCombatPlayer(
                matchId,
                player.playerId
            );
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
    setRespawnPolicy,
    revivePlayerForRound,
    COMBAT_CONFIG,

    createCombatPlayer,
    getCombatPlayer,

    equipWeapon,
    reloadWeapon,
    fireWeapon,
    applyExplosionDamage,
    clampMagazineToSize,
    getPlayerWeapon,
    exportMatchCombat,
    importMatchCombat,

    calculateDamage,
    calculateDistance,

    syncCombatArmorState,

    snapshotCombatState,
    restoreCombatState,
    cancelPlayerReload,

    removeCombatPlayer,
    removeMatchCombat
};
