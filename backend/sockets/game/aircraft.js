// ==========================================
// INDIAN BATTLE FIELDS - sockets/game/aircraft.js
// ==========================================
// Aircraft: ejecting players still on board when the flight ends.

const { supabaseAdmin } = require("../../config/supabase");
const {
    getAircraftPosition,
    jumpFromAircraft,
    getDropStatus
} = require("../../services/parachuteService");

const {
    playerPositions,
    matchFlights,
    getPlayerKey
} = require("./state");
const { persistPlayerPosition } = require("./persistence");

async function ejectRemainingPlayers(io, matchId) {
    const flight = matchFlights.get(matchId);
    if (!flight) return;

    const { data: members, error } = await supabaseAdmin
        .from("match_players")
        .select("player_id")
        .eq("match_id", matchId)
        .eq("is_alive", true);

    if (error) {
        console.error("Aircraft eject lookup error:", error.message);
        return;
    }

    const exitPosition = getAircraftPosition(flight.flightPath, 1);

    for (const member of members || []) {
        if (getDropStatus(matchId, member.player_id)) continue;

        const result = jumpFromAircraft(
            matchId,
            member.player_id,
            exitPosition
        );

        if (!result.success) continue;

        try {
            await persistPlayerPosition(matchId, member.player_id, exitPosition);
        } catch (persistError) {
            console.error("Aircraft eject position error:", persistError.message);
        }

        playerPositions.set(
            getPlayerKey(matchId, member.player_id),
            exitPosition
        );

        io.to(`player:${member.player_id}`).emit("jump-started", {
            ...result,
            forced: true,
            message: "Ejected at the end of the flight path"
        });

        io.to(`match:${matchId}`).emit("player-jumped", {
            playerId: member.player_id,
            forced: true
        });
    }
}

module.exports = {
    ejectRemainingPlayers
};
