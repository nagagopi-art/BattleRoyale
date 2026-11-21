// ==========================================
// INDIAN BATTLE FIELDS - sockets/handlers/spectate.js
// ==========================================
// Spectating and safe-zone state requests.
// Events: spectate-player, stop-spectating, get-zone-state

const { getCombatPlayer } = require("../../services/combatService");
const { getZone, getZoneState } = require("../../services/safeZoneService");

const {
    emitError,
    getSpectateRoom,
    getPosition,
    isValidPlayerId
} = require("../game/utils");
const { getMatchTeams } = require("../game/teams");

function registerSpectateHandlers(io, socket, player) {
    // ==========================================
    // SPECTATE (ELIMINATED PLAYERS ONLY)
    // ==========================================

    socket.on("spectate-player", async payload => {
        try {
            const matchId = socket.currentMatchId;
            if (!matchId) return emitError(socket, "Join a match first");

            const targetId = Number(payload?.targetId);

            if (!isValidPlayerId(targetId) || targetId === Number(player.id)) {
                return emitError(socket, "Invalid spectate target");
            }

            const teams = await getMatchTeams(matchId);

            const self = teams.members.find(
                m => Number(m.player_id) === Number(player.id)
            );
            const target = teams.members.find(
                m => Number(m.player_id) === targetId
            );

            if (!self) return emitError(socket, "You are not in this match");

            if (self.is_alive) {
                return emitError(socket, "Only eliminated players can spectate");
            }

            if (!target || !target.is_alive) {
                return emitError(socket, "That player is not alive");
            }

            if (socket.spectateRoom) {
                await socket.leave(socket.spectateRoom);
            }

            socket.spectateRoom = getSpectateRoom(matchId, targetId);
            await socket.join(socket.spectateRoom);

            const combat = getCombatPlayer(matchId, targetId);

            socket.emit("spectate-started", {
                targetId,
                teamNumber: target.team_number,
                position: getPosition(matchId, targetId),
                health: combat ? combat.health : null,
                knocked: Boolean(combat?.knocked),
                kills: combat ? combat.kills : null,
                activeWeapon: combat ? combat.activeWeapon : null
            });

        } catch (error) {
            console.error("Spectate error:", error.message);
            emitError(socket, "Unable to spectate");
        }
    });

    socket.on("stop-spectating", async () => {
        if (socket.spectateRoom) {
            await socket.leave(socket.spectateRoom);
            socket.spectateRoom = null;
        }

        socket.emit("spectate-stopped", { success: true });
    });

    socket.on("get-zone-state", () => {
        const matchId = socket.currentMatchId;
        if (!matchId) return emitError(socket, "Join a match first");

        const zone = getZone(matchId);

        if (!zone) {
            // Clash Squad / Team Deathmatch: the fixed arena boundary.
            const arena = require("../game/modes").getArenaZone(matchId);
            if (arena) return socket.emit("zone-update", arena);
            return emitError(socket, "Safe zone has not started");
        }

        socket.emit("zone-update", getZoneState(zone));
    });
}

module.exports = registerSpectateHandlers;
