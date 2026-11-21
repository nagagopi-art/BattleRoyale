// ==========================================
// INDIAN BATTLE FIELDS - sockets/game/disconnect.js
// ==========================================
// Reconnect grace period and disconnect elimination.

const { supabaseAdmin } = require("../../config/supabase");
const { getCombatPlayer } = require("../../services/combatService");
const { clearKnock } = require("../../services/knockdownService");

const {
    getPlayerKey,
    RECONNECT_GRACE_MS,
    disconnectTimers
} = require("./state");
const { interruptHealing } = require("./utils");
const { persistZoneDamage } = require("./persistence");
const { dropDeathLoot } = require("./drops");
const { completeMatchIfFinished } = require("./lifecycle");
const { handleTeamWipe } = require("./teams");

function clearDisconnectTimer(matchId, playerId) {
    const key = getPlayerKey(matchId, playerId);
    const timer = disconnectTimers.get(key);

    if (timer) {
        clearTimeout(timer);
        disconnectTimers.delete(key);
        return true;
    }

    return false;
}

async function scheduleDisconnectElimination(io, matchId, playerId) {
    // Still connected from another tab/device: nothing to do.
    const sockets = await io.in(`player:${playerId}`).fetchSockets();
    if (sockets.some(s => s.currentMatchId === matchId)) return;

    const combat = getCombatPlayer(matchId, playerId);
    if (combat && !combat.isAlive) return;

    clearDisconnectTimer(matchId, playerId);

    const timer = setTimeout(async () => {
        disconnectTimers.delete(getPlayerKey(matchId, playerId));

        try {
            const { data: match } = await supabaseAdmin
                .from("matches")
                .select("status")
                .eq("id", matchId)
                .maybeSingle();

            if (!match || match.status !== "in_progress") return;

            const current = getCombatPlayer(matchId, playerId);

            if (current) {
                clearKnock(current);
                current.health = 0;
                current.isAlive = false;
            }

            const saved = await persistZoneDamage(matchId, playerId, 0, true);
            if (!saved.applied) return;

            interruptHealing(io, matchId, playerId, "disconnected");
            dropDeathLoot(io, matchId, playerId);

            io.to(`match:${matchId}`).emit("player-eliminated", {
                attackerId: null,
                victimId: playerId,
                cause: "disconnected",
                weapon: "Disconnected",
                alivePlayers: saved.alivePlayers,
                eliminatedPlayers: saved.eliminatedPlayers
            });

            await handleTeamWipe(io, matchId, playerId);
            await completeMatchIfFinished(io, matchId);

        } catch (error) {
            console.error("Disconnect elimination error:", error.message);
        }
    }, RECONNECT_GRACE_MS);

    timer.unref?.();
    disconnectTimers.set(getPlayerKey(matchId, playerId), timer);
}

module.exports = {
    scheduleDisconnectElimination,
    clearDisconnectTimer
};
