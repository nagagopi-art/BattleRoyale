
const assert = require("assert");

const inventory = require("../../services/inventoryService");
const combat = require("../../services/combatService");

const MATCH_PREFIX = `armor-test-${Date.now()}`;

function normalize(vector) {
    const length = Math.sqrt(
        vector.x ** 2 +
        vector.y ** 2 +
        vector.z ** 2
    );

    return {
        x: vector.x / length,
        y: vector.y / length,
        z: vector.z / length
    };
}

function testArmorCombat(armorType, level) {
    const matchId = `${MATCH_PREFIX}-${armorType}-${level}`;
    const shooterId = 1;
    const targetId = 2;

    const protection = level * 0.10 + 0.10;
    const initialDurability = level === 1 ? 100 :
        level === 2 ? 150 : 200;

    // Give shooter a Vajra AR.
    const weaponAdded = inventory.addWeapon(
        matchId,
        shooterId,
        "vajra"
    );

    assert.strictEqual(weaponAdded.status, "success");

    // Give target the selected armor.
    const armorAdded = armorType === "helmet"
        ? inventory.addHelmet(matchId, targetId, level)
        : inventory.addVest(matchId, targetId, level);

    assert.strictEqual(armorAdded.status, "success");

    const targetInventory = inventory.getInventory(
        matchId,
        targetId
    );

    const armorList = armorType === "helmet"
        ? targetInventory.armor.helmets
        : targetInventory.armor.vests;

    const armorItem = armorList[0];

    const equipped = armorType === "helmet"
        ? inventory.equipHelmet(matchId, targetId, armorItem.instanceId)
        : inventory.equipVest(matchId, targetId, armorItem.instanceId);

    assert.strictEqual(equipped.status, "success");

    // Initialize isolated combat players.
    assert.strictEqual(
        combat.createCombatPlayer(matchId, shooterId).success,
        true
    );

    assert.strictEqual(
        combat.createCombatPlayer(matchId, targetId).success,
        true
    );

    assert.strictEqual(
        combat.equipWeapon(matchId, shooterId, "vajra").success,
        true
    );

    // Aim at the actual head or body hitbox.
    const shooterPosition = { x: 0, y: 5, z: 0 };
    const targetPosition = { x: 10, y: 5, z: 0 };

    const hitY = armorType === "helmet"
        ? targetPosition.y + 1.65
        : targetPosition.y + 1.05;

    const origin = {
        x: shooterPosition.x,
        y: shooterPosition.y + 1.5,
        z: shooterPosition.z
    };

    const direction = normalize({
        x: targetPosition.x - origin.x,
        y: hitY - origin.y,
        z: targetPosition.z - origin.z
    });

    const result = combat.fireWeapon(
        matchId,
        shooterId,
        targetId,
        {
            shooterPosition,
            targetPosition,
            origin,
            direction
        }
    );

    assert.strictEqual(result.success, true, result.message);

    const expectedLocation = armorType === "helmet"
        ? "head"
        : "body";

    assert.strictEqual(result.hitLocation, expectedLocation);

    const expectedDamage = armorType === "helmet" ? 64 : 32;
    const expectedAbsorption = Math.floor(
        expectedDamage * protection
    );

    assert.strictEqual(result.damage, expectedDamage);

    assert.strictEqual(
        result.armorDamage,
        expectedAbsorption
    );

    assert.strictEqual(
        result.healthDamage,
        expectedDamage - expectedAbsorption
    );

    assert.strictEqual(
        armorType === "helmet"
            ? result.helmetDurability
            : result.vestDurability,
        initialDurability - expectedAbsorption
    );

    console.log(
        `PASS: ${armorType.toUpperCase()} Level ${level} combat`
    );

    console.log({
        hitLocation: result.hitLocation,
        damage: result.damage,
        armorDamage: result.armorDamage,
        healthDamage: result.healthDamage,
        helmetDurability: result.helmetDurability,
        vestDurability: result.vestDurability
    });
}

function testArmorBreakage() {
    const matchId = `${MATCH_PREFIX}-breakage`;
    const playerId = 10;

    const added = inventory.addHelmet(matchId, playerId, 1);
    assert.strictEqual(added.status, "success");

    const helmet = inventory.getInventory(
        matchId,
        playerId
    ).armor.helmets[0];

    assert.strictEqual(
        inventory.equipHelmet(
            matchId,
            playerId,
            helmet.instanceId
        ).status,
        "success"
    );

    const result = inventory.damageEquippedArmor(
        matchId,
        playerId,
        "helmet",
        1000
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.absorbedDamage, 100);
    assert.strictEqual(result.remainingDamage, 900);
    assert.strictEqual(result.broken, true);

    assert.strictEqual(
        inventory.getEquippedArmor(matchId, playerId).helmet,
        null
    );

    console.log("PASS: Helmet breaks at zero durability");
}

function testArmorRestoration() {
    const matchId = `${MATCH_PREFIX}-restoration`;
    const playerId = 20;

    const result = inventory.restoreEquippedArmor(
        matchId,
        playerId,
        {
            helmet_level: 2,
            helmet_durability: 77,
            vest_level: 3,
            vest_durability: 123
        }
    );

    assert.strictEqual(result.success, true);

    const restored = inventory.getEquippedArmor(
        matchId,
        playerId
    );

    assert.strictEqual(restored.helmet.level, 2);
    assert.strictEqual(restored.helmet.durability, 77);
    assert.strictEqual(restored.vest.level, 3);
    assert.strictEqual(restored.vest.durability, 123);

    console.log("PASS: Helmet and vest restoration");
}

function main() {
    console.log("\nINDIAN BATTLE FIELDS");
    console.log("ARMOR COMBAT TEST\n");

    for (const level of [1, 2, 3]) {
        testArmorCombat("helmet", level);
        testArmorCombat("vest", level);
    }

    testArmorBreakage();
    testArmorRestoration();

    console.log("\n================================");
    console.log("ALL ARMOR TESTS PASSED");
    console.log("================================\n");
}

try {
    main();
} catch (error) {
    console.error("\nARMOR TEST FAILED");
    console.error(error);
    process.exitCode = 1;
}
