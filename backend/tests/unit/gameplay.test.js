// Unit tests for pure game logic. No database or network.
// Run: npm test

const test = require("node:test");
const assert = require("node:assert/strict");

const { segmentIntersectsBox } = require("../../services/geometry");
const zones = require("../../services/safeZoneService");
const healing = require("../../services/healingService");
const { getEffectiveWeapon } = require("../../config/attachments");
const progression = require("../../services/progressionService");
const { getExplosionDamage } = require("../../services/throwableService");

// ---------- Geometry (gloo wall panels) ----------

test("segment hits a wall panel facing it", () => {
    // yaw 0: faces +Z, 4 wide along X.
    const box = {
        center: { x: 0, y: 0, z: 0 },
        halfExtents: { x: 2, y: 1.5, z: 0.25 },
        yaw: 0
    };

    const t = segmentIntersectsBox({ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: 5 }, box);
    assert.ok(t !== null);
    assert.ok(Math.abs(t - 0.475) < 1e-9);
});

test("segment beside a wall panel misses", () => {
    const box = {
        center: { x: 0, y: 0, z: 0 },
        halfExtents: { x: 2, y: 1.5, z: 0.25 },
        yaw: 0
    };

    assert.equal(
        segmentIntersectsBox({ x: 5, y: 0, z: -5 }, { x: 5, y: 0, z: 5 }, box),
        null
    );
});

test("rotated wall (yaw 90) blocks along X but not off to the side", () => {
    const box = {
        center: { x: 0, y: 0, z: 0 },
        halfExtents: { x: 2, y: 1.5, z: 0.25 },
        yaw: 90
    };

    assert.notEqual(
        segmentIntersectsBox({ x: -5, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, box),
        null
    );
    assert.equal(
        segmentIntersectsBox({ x: -5, y: 0, z: 3 }, { x: 5, y: 0, z: 3 }, box),
        null
    );
});

// ---------- Safe zone ----------

test("safe zone shrinks through its phases and closes", () => {
    const t0 = 1e12;
    const zone = zones.createZone("unit-zone", t0).zone;

    zones.updateZone(zone, t0);
    assert.equal(zone.state, "waiting");
    assert.equal(zone.currentRadius, zones.ZONE_CONFIG.startRadius);

    // Next circle always fits inside the current one.
    const dx = zone.nextCenter.x - zone.currentCenter.x;
    const dz = zone.nextCenter.z - zone.currentCenter.z;
    assert.ok(Math.hypot(dx, dz) + zone.nextRadius <= zone.currentRadius + 1e-6);

    zones.updateZone(zone, t0 + 1e8);
    assert.equal(zone.finished, true);
    assert.equal(zone.currentRadius, 0);

    zones.removeZone("unit-zone");
});

// ---------- Healing ----------

test("bandage heals 15 and stops at 75", () => {
    assert.equal(healing.calculateHealedHealth("bandage", 50), 65);
    assert.equal(healing.calculateHealedHealth("bandage", 70), 75);
    assert.equal(healing.calculateHealedHealth("bandage", 80), 80);
    assert.equal(healing.canHeal("bandage", 75).success, false);
});

test("medkit heals to full", () => {
    assert.equal(healing.calculateHealedHealth("medkit", 10), 100);
    assert.equal(healing.canHeal("medkit", 100).success, false);
});

// ---------- Attachments ----------

test("extended magazine increases magazine size", () => {
    const weapon = getEffectiveWeapon("vajra", { magazine: "extended_mag" });
    assert.equal(weapon.magazineSize, 42);
});

test("incompatible attachment is ignored", () => {
    const weapon = getEffectiveWeapon("vajra", { sight: "scope_8x" });
    assert.equal(weapon.attachments.sight, null);
    assert.equal(weapon.range, 300);
});

test("suppressor marks the weapon as suppressed", () => {
    const weapon = getEffectiveWeapon("vajra", { muzzle: "suppressor" });
    assert.equal(weapon.suppressed, true);
});

// ---------- Progression ----------

test("level curve", () => {
    assert.equal(progression.experienceForLevel(1), 0);
    assert.equal(progression.experienceForLevel(2), 100);
    assert.equal(progression.experienceForLevel(3), 250);
    assert.equal(progression.levelForExperience(249), 2);
    assert.equal(progression.levelForExperience(250), 3);
});

test("coins reward winning and kills", () => {
    const winner = progression.coinsForResult({ placement: 1, kills: 3, isWinner: true }, 50);
    const loser = progression.coinsForResult({ placement: 50, kills: 0, isWinner: false }, 50);
    assert.ok(winner > loser);
    assert.equal(loser, progression.PROGRESSION_CONFIG.coins.participation);
});

// ---------- Grenades ----------

test("explosion damage falls off with distance", () => {
    assert.equal(getExplosionDamage(100, 12, 0), 100);
    assert.equal(getExplosionDamage(100, 12, 6), 50);
    assert.equal(getExplosionDamage(100, 12, 13), 0);
});
