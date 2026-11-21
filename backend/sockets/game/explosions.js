// ==========================================
// INDIAN BATTLE FIELDS - sockets/game/explosions.js
// ==========================================
// Frag grenade damage and flash blindness.

const { reportError } = require("../../services/errorReporter");
const { snapshotInventory, restoreInventory } = require("../../services/inventoryService");
const {
    getCombatPlayer,
    snapshotCombatState,
    restoreCombatState,
    cancelPlayerReload,
    applyExplosionDamage
} = require("../../services/combatService");
const {
    damageGlooWall,
    getExplosionDamage,
    findBlockingGlooWall,
    getFlashDuration,
    flashPlayer
} = require("../../services/throwableService");

const { playerPositions, getMatchMapName } = require("./state");
const { segmentBlocked } = require("../../services/mapCollision");

// Buildings, rocks, walls and crates shield from blasts and
// flashes (traced from just above the blast to the chest).
function coverBlocks(matchId, blastPosition, targetPosition) {
    const mapName = getMatchMapName(matchId);
    if (!mapName) return false;

    return Boolean(segmentBlocked(
        mapName,
        { x: blastPosition.x, y: blastPosition.y + 0.5, z: blastPosition.z },
        { x: targetPosition.x, y: targetPosition.y + 1.0, z: targetPosition.z }
    ));
}
const {
    calculateDistance,
    getSpectateRoom,
    isValidPlayerId,
    interruptHealing
} = require("./utils");
const { persistCombatResult } = require("./persistence");
const { dropDeathLoot } = require("./drops");
const { completeMatchIfFinished } = require("./lifecycle");
const {
    getMatchTeams,
    areTeammates,
    hasStandingTeammate,
    handleTeamWipe
} = require("./teams");

// Blind every living player near a flash explosion,
// unless a gloo wall shields them.
function applyFlashEffect(io, matchId, explosion) {
    const prefix = `${matchId}:`;
    const affected = [];

    for (const [key, position] of playerPositions.entries()) {
        if (!key.startsWith(prefix)) continue;

        const playerId = Number(key.slice(prefix.length));
        const combat = getCombatPlayer(matchId, playerId);

        if (!combat || !combat.isAlive) continue;

        const distance = calculateDistance(position, explosion.position);
        const durationMs = getFlashDuration(distance);

        if (durationMs <= 0) continue;

        if (
            findBlockingGlooWall(matchId, explosion.position, position) ||
            coverBlocks(matchId, explosion.position, position)
        ) {
            continue;
        }

        const blindUntil = flashPlayer(matchId, playerId, durationMs);

        io.to(`player:${playerId}`).emit("player-flashed", {
            grenadeId: explosion.grenadeId,
            durationMs,
            blindUntil,
            intensity: Number((durationMs / explosion.durationMs).toFixed(2))
        });

        affected.push({ playerId, durationMs });
    }

    return affected;
}

// ==========================================
// GRENADE EXPLOSION DAMAGE
// ==========================================

async function applyGrenadeDamage(io, matchId, attackerId, explosion) {
    let teams;

    try {
        teams = await getMatchTeams(matchId);
    } catch (error) {
        console.error("Grenade team lookup error:", error.message);
        return;
    }

    if (teams.status !== "in_progress") {
        return;
    }

    // Find living players inside the blast radius.
    const prefix = `${matchId}:`;
    const targets = [];

    for (const [key, position] of playerPositions.entries()) {
        if (!key.startsWith(prefix)) continue;

        const targetId = Number(key.slice(prefix.length));

        if (!isValidPlayerId(targetId)) continue;
        if (targetId === Number(attackerId)) continue;

        // Friendly fire is off in duo and squad.
        if (areTeammates(teams, attackerId, targetId)) continue;

        const targetCombat = getCombatPlayer(matchId, targetId);
        if (!targetCombat || !targetCombat.isAlive) continue;

        const distance = calculateDistance(position, explosion.position);
        if (distance > explosion.radius) continue;

        // Behind a building or other cover: no damage.
        if (coverBlocks(matchId, explosion.position, position)) continue;

        const blockingWall = findBlockingGlooWall(
            matchId,
            explosion.position,
            position
        );

        if (blockingWall) {
            const wallHit = damageGlooWall(
                matchId,
                blockingWall.id,
                getExplosionDamage(explosion.damage, explosion.radius, distance)
            );

            if (wallHit.success) {
                io.to(`match:${matchId}`).emit("gloo-wall-damaged", {
                    wallId: blockingWall.id,
                    health: wallHit.wall.health,
                    destroyed: wallHit.destroyed
                });
            }

            continue;
        }

        targets.push({ targetId, distance });
    }

    let anyEliminated = false;

    // Apply and persist one target at a time so the
    // alive/eliminated counts from the database stay in order.
    for (const { targetId, distance } of targets) {
        const damage = getExplosionDamage(
            explosion.damage,
            explosion.radius,
            distance
        );

        if (damage <= 0) continue;

        const attackerCombatSnapshot = snapshotCombatState(matchId, attackerId);
        const targetCombatSnapshot = snapshotCombatState(matchId, targetId);
        const targetInventorySnapshot = snapshotInventory(matchId, targetId);

        const result = applyExplosionDamage(
            matchId,
            attackerId,
            targetId,
            damage,
            { allowKnock: hasStandingTeammate(teams, matchId, targetId) }
        );

        if (!result.success) continue;

        let matchCounts;

        try {
            matchCounts = await persistCombatResult(
                matchId,
                attackerId,
                targetId,
                result
            );
        } catch (databaseError) {
            console.error(
                "Grenade damage synchronization error:",
                databaseError.message
            );
            reportError("Grenade damage save failed", databaseError, { matchId });

            restoreCombatState(matchId, attackerId, attackerCombatSnapshot);
            restoreCombatState(matchId, targetId, targetCombatSnapshot);
            restoreInventory(matchId, targetId, targetInventorySnapshot);

            io.to(`player:${attackerId}`).emit("combat-sync-warning", {
                success: false,
                rolledBack: true,
                targetId,
                message: "Grenade damage could not be saved and was rolled back"
            });

            continue;
        }

        if (result.eliminated) {
            cancelPlayerReload(matchId, targetId);
        }

        interruptHealing(io, matchId, targetId, "damaged");

        io.to(`player:${targetId}`).to(getSpectateRoom(matchId, targetId)).emit("player-damaged", {
            success: true,
            attackerId,
            weapon: result.weapon,
            hitLocation: result.hitLocation,
            damage: result.damage,
            armorDamage: result.armorDamage,
            healthDamage: result.healthDamage,
            health: result.targetHealth,
            armor: result.targetArmor,
            helmetDamage: result.helmetDamage,
            vestDamage: result.vestDamage,
            helmetBroken: result.helmetBroken,
            vestBroken: result.vestBroken,
            helmetLevel: result.helmetLevel,
            helmetDurability: result.helmetDurability,
            vestLevel: result.vestLevel,
            vestDurability: result.vestDurability,
            eliminated: result.eliminated
        });

        io.to(`player:${attackerId}`).emit("damage-confirmed", {
            success: true,
            hit: true,
            weapon: result.weapon,
            targetId,
            hitLocation: result.hitLocation,
            damage: result.damage,
            armorDamage: result.armorDamage,
            healthDamage: result.healthDamage,
            targetHealth: result.targetHealth,
            targetArmor: result.targetArmor,
            eliminated: result.eliminated,
            totalKills: result.totalKills,
            alivePlayers: matchCounts.alivePlayers
        });

        if (result.knocked) {
            io.to(`match:${matchId}`).emit("player-knocked", {
                attackerId,
                victimId: targetId,
                weapon: result.weapon,
                knockHealth: result.knockHealth
            });
        }

        if (result.eliminated) {
            anyEliminated = true;

            dropDeathLoot(io, matchId, targetId);

            io.to(`match:${matchId}`).emit("player-eliminated", {
                attackerId,
                victimId: targetId,
                weapon: result.weapon,
                totalKills: result.totalKills,
                alivePlayers: matchCounts.alivePlayers,
                eliminatedPlayers: matchCounts.eliminatedPlayers
            });
        }

        if (result.knocked || result.eliminated) {
            if (await handleTeamWipe(io, matchId, targetId)) {
                anyEliminated = true;
            }
        }
    }

    if (anyEliminated) {
        await completeMatchIfFinished(io, matchId, attackerId);
    }
}

module.exports = {
    applyGrenadeDamage,
    applyFlashEffect
};
