
const {
    LOOT_CONFIG,
    generateMatchLoot,
    getAvailableLoot,
    pickupLoot
} = require("../../services/lootService");

const {
    createInventory,
    getInventory,
    addLootItem
} = require("../../services/inventoryService");

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function runTest() {
    const matchId = "loot-test-" + Date.now();
    const playerId = 999;

    console.log("\n=== INDIAN BATTLE FIELDS ===");
    console.log("LOOT SERVICE TEST\n");

    // 1. Generate loot
    const generated = generateMatchLoot(matchId);

    assert(generated.status === "success", "Loot generation failed");
    assert(generated.totalLoot === 300, "Expected 300 loot items");

    console.log("PASS: 300 loot items generated");

    // 2. Create player inventory
    createInventory(matchId, playerId);

    // 3. Select one generated loot item
    const target = generated.loot[0];

    console.log("Selected item:", target.name);
    console.log("Item type:", target.itemType);
    console.log("Rarity:", target.rarity);

    // 4. Attempt pickup at exact loot position
    const pickup = pickupLoot(
        matchId,
        target.lootId,
        target.position
    );

    assert(pickup.success, "Pickup at loot position failed");

    console.log("PASS: Loot pickup successful");

    // 5. Add collected item to inventory
    const inventoryResult = addLootItem(
        matchId,
        playerId,
        pickup.item
    );

    assert(
        inventoryResult.success,
        "Inventory update failed: " + inventoryResult.message
    );

    console.log("PASS: Inventory updated");

    // 6. Verify inventory contains collected item
    const inventory = getInventory(matchId, playerId);

    assert(inventory, "Inventory missing");

    if (target.itemType === "weapon") {
        assert(
            inventory.weapons.some(w => w.weaponId === target.itemId),
            "Collected weapon not found in inventory"
        );
    } else {
        assert(
            inventory.ammunition[target.itemId] > 0,
            "Collected ammunition not found in inventory"
        );
    }

    console.log("PASS: Collected item exists in inventory");

    // 7. Attempt duplicate pickup
    const duplicate = pickupLoot(
        matchId,
        target.lootId,
        target.position
    );

    assert(
        !duplicate.success,
        "Duplicate pickup was incorrectly accepted"
    );

    console.log("PASS: Duplicate pickup rejected");

    // 8. Verify collected item is no longer available
    const stillAvailable = getAvailableLoot(matchId)
        .some(item => item.lootId === target.lootId);

    assert(
        !stillAvailable,
        "Collected loot is still available"
    );

    console.log("PASS: Collected loot removed from available list");

    // 9. Test distance restriction
    const secondItem = generated.loot[1];

    const farPickup = pickupLoot(
        matchId,
        secondItem.lootId,
        {
            x: secondItem.position.x + LOOT_CONFIG.pickupDistance + 10,
            y: secondItem.position.y,
            z: secondItem.position.z
        }
    );

    assert(
        !farPickup.success,
        "Pickup outside allowed distance was accepted"
    );

    assert(
        getAvailableLoot(matchId).some(
            item => item.lootId === secondItem.lootId
        ),
        "Out-of-range loot should remain available"
    );

    console.log("PASS: Out-of-range pickup rejected");

    console.log("\n================================");
    console.log(" ALL LOOT SERVICE TESTS PASSED");
    console.log("================================");
}

try {
    runTest();
} catch (error) {
    console.error("\nTEST FAILED:", error.message);
    process.exitCode = 1;
}
