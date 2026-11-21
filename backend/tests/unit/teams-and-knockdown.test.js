// Unit tests for team assignment and knockdown.
// battlefieldService loads the Supabase client module but
// these tests never call the database.
// Run: npm test

const test = require("node:test");
const assert = require("node:assert/strict");

const { assignTeams } = require("../../services/battlefieldService");
const inventory = require("../../services/inventoryService");
const combat = require("../../services/combatService");

test("a party is placed on one team", () => {
    const players = [1, 2, 3, 4, 5, 6, 7].map(id => ({ player_id: id }));
    const assignments = assignTeams(players, "squad", [["6", "7"]]);

    const teamOf = id => assignments.find(a => a.player_id === id).team_number;

    assert.equal(assignments.length, 7);
    assert.equal(teamOf(6), teamOf(7));

    const teamSizes = {};
    for (const a of assignments) {
        teamSizes[a.team_number] = (teamSizes[a.team_number] || 0) + 1;
    }
    for (const size of Object.values(teamSizes)) {
        assert.ok(size <= 4);
    }
});

test("solo mode gives everyone their own team", () => {
    const players = [1, 2, 3].map(id => ({ player_id: id }));
    const teams = new Set(assignTeams(players, "solo").map(a => a.team_number));
    assert.equal(teams.size, 3);
});

test("lethal damage knocks down when allowed, then finishing eliminates", () => {
    const matchId = `unit-knock-${Date.now()}`;

    for (const id of [1, 2]) {
        inventory.createInventory(matchId, id);
        combat.createCombatPlayer(matchId, id);
    }

    const knock = combat.applyExplosionDamage(matchId, 1, 2, 150, { allowKnock: true });
    assert.equal(knock.success, true);
    assert.equal(knock.knocked, true);
    assert.equal(knock.eliminated, false);
    assert.equal(combat.getCombatPlayer(matchId, 2).isAlive, true);

    const finish = combat.applyExplosionDamage(matchId, 1, 2, 150, { allowKnock: true });
    assert.equal(finish.eliminated, true);
    assert.equal(combat.getCombatPlayer(matchId, 2).isAlive, false);
    assert.equal(combat.getCombatPlayer(matchId, 1).kills, 1);

    combat.removeMatchCombat(matchId);
});

test("lethal damage eliminates directly in solo (no knock)", () => {
    const matchId = `unit-solo-${Date.now()}`;

    for (const id of [1, 2]) {
        inventory.createInventory(matchId, id);
        combat.createCombatPlayer(matchId, id);
    }

    const result = combat.applyExplosionDamage(matchId, 1, 2, 150);
    assert.equal(result.knocked, false);
    assert.equal(result.eliminated, true);

    combat.removeMatchCombat(matchId);
});
