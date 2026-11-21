// ==========================================
// INDIAN BATTLE FIELDS - sockets/handlers/combat.js
// ==========================================
// Firing and reloading.
// Events: fire-weapon, reload-weapon

const { supabaseAdmin } = require("../../config/supabase");
const { reportError } = require("../../services/errorReporter");
const { recordAim } = require("../../services/antiCheatService");
const {
    getInventory,
    snapshotInventory,
    restoreInventory
} = require("../../services/inventoryService");
const {
    getCombatPlayer,
    reloadWeapon,
    fireWeapon,
    snapshotCombatState,
    restoreCombatState
} = require("../../services/combatService");
const { damageGlooWall } = require("../../services/throwableService");
const { obstaclesNear } = require("../../services/mapCollision");
const { getMatchMapName } = require("../game/state");

const {
    emitError,
    getSpectateRoom,
    rejectIfKnocked,
    getPosition,
    isValidPlayerId,
    isValidDirection,
    interruptHealing,
    getGlooWallObstacles
} = require("../game/utils");
const { persistCombatResult } = require("../game/persistence");
const { dropDeathLoot, broadcastGunshot } = require("../game/drops");
const { completeMatchIfFinished } = require("../game/lifecycle");
const {
    getMatchTeams,
    areTeammates,
    hasStandingTeammate,
    handleTeamWipe
} = require("../game/teams");

function registerCombatHandlers(io, socket, player) {
    // ==========================================
    // FIRE WEAPON - SERVER HIT DETECTION
    // WITH DATABASE ROLLBACK
    // ==========================================

    socket.on("fire-weapon", async payload => {
        try {
            const matchId = socket.currentMatchId;

            if (!matchId) {
                return emitError(socket, "Join a match first");
            }

            if (require("../game/modes").isCombatFrozen(matchId)) {
                return emitError(socket, "Buy phase: wait for the round to start");
            }

            // Do not allow combat after match completion.
            const { data: match, error: matchError } =
                await supabaseAdmin
                    .from("matches")
                    .select("status")
                    .eq("id", matchId)
                    .single();

            if (matchError || !match) {
                return emitError(socket, "Unable to verify match status");
            }

            if (match.status !== "in_progress") {
                return emitError(socket, "Match is not in progress");
            }

            const { targetId, direction } = payload || {};

            if (!isValidPlayerId(targetId)) {
                return emitError(socket, "Invalid target player");
            }

            const numericTargetId = Number(targetId);

            if (numericTargetId === Number(player.id)) {
                return emitError(socket, "You cannot target yourself");
            }

            if (!isValidDirection(direction)) {
                return emitError(socket, "Invalid aim direction");
            }

            let teams;

            try {
                teams = await getMatchTeams(matchId);
            } catch (membershipError) {
                console.error(
                    "Combat membership lookup:",
                    membershipError.message
                );

                return emitError(socket, "Unable to verify match players");
            }

            const memberships = teams.members;

            // Friendly fire is off in duo and squad.
            if (areTeammates(teams, player.id, numericTargetId)) {
                return emitError(socket, "You cannot damage teammates");
            }

            const shooterMembership = (memberships || []).find(
                member => Number(member.player_id) === Number(player.id)
            );

            const targetMembership = (memberships || []).find(
                member => Number(member.player_id) === numericTargetId
            );

            if (!shooterMembership || !targetMembership) {
                return emitError(
                    socket,
                    "Both players must belong to the same match"
                );
            }

            if (
                !shooterMembership.is_alive ||
                !targetMembership.is_alive
            ) {
                return emitError(
                    socket,
                    "Shooter or target is eliminated"
                );
            }

            const shooterCombat = getCombatPlayer(
                matchId,
                player.id
            );

            const targetCombat = getCombatPlayer(
                matchId,
                numericTargetId
            );

            if (!shooterCombat || !shooterCombat.isAlive) {
                return emitError(
                    socket,
                    "Your combat state is unavailable or eliminated"
                );
            }

            if (!targetCombat || !targetCombat.isAlive) {
                return emitError(
                    socket,
                    "Target combat state is unavailable"
                );
            }

            const shooterPosition = getPosition(
                matchId,
                player.id
            );

            const targetPosition = getPosition(
                matchId,
                numericTargetId
            );

            if (!shooterPosition || !targetPosition) {
                return emitError(
                    socket,
                    "Shooter or target position unavailable"
                );
            }

            const origin = {
                x: shooterPosition.x,
                y: shooterPosition.y + 1.5,
                z: shooterPosition.z
            };

            // ==========================================
            // SNAPSHOT STATE FOR ROLLBACK
            // ==========================================

            const shooterCombatSnapshot = snapshotCombatState(
                matchId,
                player.id
            );

            const targetCombatSnapshot = snapshotCombatState(
                matchId,
                numericTargetId
            );

            const shooterInventorySnapshot = snapshotInventory(
                matchId,
                player.id
            );

            const targetInventorySnapshot = snapshotInventory(
                matchId,
                numericTargetId
            );

            const rollbackShot = () => {
                const restores = [
                    restoreCombatState(
                        matchId,
                        player.id,
                        shooterCombatSnapshot
                    ),
                    restoreCombatState(
                        matchId,
                        numericTargetId,
                        targetCombatSnapshot
                    ),
                    restoreInventory(
                        matchId,
                        player.id,
                        shooterInventorySnapshot
                    ),
                    restoreInventory(
                        matchId,
                        numericTargetId,
                        targetInventorySnapshot
                    )
                ];

                const failed = restores.filter(
                    restore => !restore || !restore.success
                );

                if (failed.length > 0) {
                    console.error(
                        "Combat rollback incomplete:",
                        failed.map(restore => restore?.message)
                    );
                }

                return failed.length === 0;
            };

            const result = fireWeapon(
                matchId,
                player.id,
                numericTargetId,
                {
                    shooterPosition,
                    targetPosition,
                    origin,
                    direction: {
                        x: direction.x,
                        y: direction.y,
                        z: direction.z
                    },
                    // Gloo walls plus buildings / rocks / walls /
                    // crates between shooter and target.
                    obstacles: [
                        ...getGlooWallObstacles(matchId),
                        ...(getMatchMapName(matchId)
                            ? obstaclesNear(getMatchMapName(matchId), origin, targetPosition)
                            : [])
                    ],
                    allowKnock: hasStandingTeammate(
                        teams,
                        matchId,
                        numericTargetId
                    )
                }
            );

            if (!result.success) {
                return emitError(socket, result.message);
            }

            // Flag inhuman aim snaps for review.
            recordAim(matchId, player.id, direction);

            // Firing cancels the shooter's own heal.
            interruptHealing(io, matchId, player.id, "fired weapon");

            broadcastGunshot(
                io,
                matchId,
                player.id,
                shooterPosition,
                result.weapon,
                result.suppressed
            );

            // ==========================================
            // SHOT BLOCKED BY GLOO WALL
            // ==========================================

            if (result.blocked) {
                // Buildings and other map cover are not damaged.
                const isMapCover = String(result.obstacleId).startsWith("static:");

                const wallHit = isMapCover
                    ? { success: false }
                    : damageGlooWall(
                        matchId,
                        result.obstacleId,
                        result.wallDamage
                    );

                if (wallHit.success) {
                    io.to(`match:${matchId}`).emit("gloo-wall-damaged", {
                        wallId: result.obstacleId,
                        health: wallHit.wall.health,
                        destroyed: wallHit.destroyed
                    });
                }

                socket.emit("shot-fired", {
                    success: true,
                    hit: false,
                    blocked: true,
                    wallId: result.obstacleId,
                    weapon: result.weapon,
                    targetId: numericTargetId,
                    remainingAmmo: result.remainingAmmo
                });

                socket.emit("damage-confirmed", {
                    success: true,
                    hit: false,
                    blocked: true,
                    targetId: numericTargetId,
                    damage: 0,
                    eliminated: false,
                    remainingAmmo: result.remainingAmmo
                });

                return;
            }

            if (!result.hit) {
                socket.emit("shot-fired", {
                    success: true,
                    hit: false,
                    weapon: result.weapon,
                    targetId: numericTargetId,
                    remainingAmmo: result.remainingAmmo
                });

                socket.emit("damage-confirmed", {
                    success: true,
                    hit: false,
                    targetId: numericTargetId,
                    damage: 0,
                    eliminated: false,
                    remainingAmmo: result.remainingAmmo
                });

                return;
            }

            let matchCounts = null;

            // ==========================================
            // SAVE COMBAT RESULT
            // ==========================================

            try {
                matchCounts = await persistCombatResult(
                    matchId,
                    player.id,
                    numericTargetId,
                    result
                );
            } catch (databaseError) {
                console.error(
                    "Combat database synchronization error:",
                    databaseError.message
                );
                reportError("Combat save failed", databaseError, { matchId });

                // Undo in-memory damage, ammo, armor and kills so
                // server memory stays consistent with the database.
                const rolledBack = rollbackShot();

                const restoredShooter = getCombatPlayer(
                    matchId,
                    player.id
                );

                socket.emit("combat-sync-warning", {
                    success: false,
                    rolledBack,
                    targetId: numericTargetId,
                    remainingAmmo:
                        restoredShooter?.weapons?.[
                            restoredShooter.activeWeapon
                        ]?.magazineAmmo,
                    message: rolledBack
                        ? "Shot could not be saved and was rolled back"
                        : "Combat database synchronization failed"
                });

                return;
            }

            interruptHealing(io, matchId, numericTargetId, "damaged");

            socket.emit("shot-fired", {
                success: true,
                hit: true,
                weapon: result.weapon,
                targetId: numericTargetId,
                remainingAmmo: result.remainingAmmo
            });

            // ==========================================
            // NOTIFY DAMAGED PLAYER
            // ==========================================

            io.to(`player:${numericTargetId}`).to(getSpectateRoom(matchId, numericTargetId)).emit(
                "player-damaged",
                {
                    success: true,
                    attackerId: player.id,
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
                }
            );

            // ==========================================
            // CONFIRM DAMAGE TO SHOOTER
            // ==========================================

            socket.emit("damage-confirmed", {
                success: true,
                hit: true,
                targetId: numericTargetId,
                hitLocation: result.hitLocation,
                damage: result.damage,
                armorDamage: result.armorDamage,
                healthDamage: result.healthDamage,
                targetHealth: result.targetHealth,
                targetArmor: result.targetArmor,
                helmetDamage: result.helmetDamage,
                vestDamage: result.vestDamage,
                helmetBroken: result.helmetBroken,
                vestBroken: result.vestBroken,
                helmetLevel: result.helmetLevel,
                helmetDurability: result.helmetDurability,
                vestLevel: result.vestLevel,
                vestDurability: result.vestDurability,
                eliminated: result.eliminated,
                remainingAmmo: result.remainingAmmo,
                totalKills: result.totalKills,
                alivePlayers: matchCounts.alivePlayers
            });

            // ==========================================
            // PLAYER KNOCKED DOWN / ELIMINATED
            // ==========================================

            if (result.knocked) {
                io.to(`match:${matchId}`).emit("player-knocked", {
                    attackerId: player.id,
                    victimId: numericTargetId,
                    weapon: result.weapon,
                    knockHealth: result.knockHealth
                });
            }

            if (result.eliminated) {

                dropDeathLoot(io, matchId, numericTargetId);

                io.to(`match:${matchId}`).emit(
                    "player-eliminated",
                    {
                        attackerId: player.id,
                        victimId: numericTargetId,
                        weapon: result.weapon,
                        totalKills: result.totalKills,
                        alivePlayers: matchCounts.alivePlayers,
                        eliminatedPlayers: matchCounts.eliminatedPlayers
                    }
                );
            }

            // A knock or kill may leave the team with nobody
            // standing: eliminate its knocked members.
            if (result.knocked || result.eliminated) {
                const wiped = await handleTeamWipe(
                    io,
                    matchId,
                    numericTargetId
                );

                // ======================================
                // AUTOMATIC MATCH COMPLETION
                // ======================================

                if (result.eliminated || wiped) {
                    await completeMatchIfFinished(io, matchId, player.id);
                }
            }

        } catch (error) {
            console.error("Fire weapon error:", error.message);
            emitError(socket, "Unable to process weapon shot");
        }
    });

    // ==================================
    // RELOAD WEAPON - MATCH STATUS PROTECTION
    // ==================================

    socket.on("reload-weapon", async () => {
        try {
            const matchId = socket.currentMatchId;

            if (!matchId) {
                return emitError(socket, "Join a match first");
            }

            // Verify match status.
            const { data: match, error: matchError } =
                await supabaseAdmin
                    .from("matches")
                    .select("status")
                    .eq("id", matchId)
                    .single();

            if (matchError || !match) {
                return emitError(socket, "Unable to verify match status");
            }

            if (match.status !== "in_progress") {
                return emitError(socket, "Match is not in progress");
            }

            // Verify player is alive in this match.
            const { data: membership, error: membershipError } =
                await supabaseAdmin
                    .from("match_players")
                    .select("is_alive")
                    .eq("match_id", matchId)
                    .eq("player_id", player.id)
                    .maybeSingle();

            if (membershipError || !membership) {
                return emitError(socket, "Match membership not found");
            }

            if (!membership.is_alive) {
                return emitError(socket, "Eliminated players cannot reload");
            }

            if (rejectIfKnocked(socket, matchId, player.id)) return;

            const combatPlayer = getCombatPlayer(
                matchId,
                player.id
            );

            if (!combatPlayer || !combatPlayer.isAlive) {
                return emitError(socket, "Combat player is unavailable or eliminated");
            }

            // Start reload.
            const result = reloadWeapon(matchId, player.id);

            if (!result.success) {
                return emitError(socket, result.message);
            }

            socket.emit("reload-started", result);

            // Notify completion only if the match and player
            // are still eligible when the timer finishes.
            setTimeout(async () => {
                try {
                    const { data: currentMatch, error: currentMatchError } =
                        await supabaseAdmin
                            .from("matches")
                            .select("status")
                            .eq("id", matchId)
                            .single();

                    if (
                        currentMatchError ||
                        !currentMatch ||
                        currentMatch.status !== "in_progress"
                    ) {
                        return;
                    }

                    const currentCombatPlayer = getCombatPlayer(
                        matchId,
                        player.id
                    );

                    if (
                        !currentCombatPlayer ||
                        !currentCombatPlayer.isAlive
                    ) {
                        return;
                    }

                    const weaponState =
                        currentCombatPlayer.weapons[
                            currentCombatPlayer.activeWeapon
                        ];

                    socket.emit("reload-completed", {
                        success: true,
                        inventory: getInventory(matchId, player.id),
                        combat: {
                            activeWeapon: currentCombatPlayer.activeWeapon,
                            weaponState: weaponState
                        }
                    });
                } catch (timerError) {
                    console.error(
                        "Reload completion error:",
                        timerError.message
                    );
                }
            }, result.reloadTimeMs + 100);

        } catch (error) {
            console.error("Reload weapon error:", error.message);
            emitError(socket, "Unable to reload weapon");
        }
    });
}

module.exports = registerCombatHandlers;
