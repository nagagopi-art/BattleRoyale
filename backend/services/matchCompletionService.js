
const { supabaseAdmin } = require("../config/supabase");

// ==========================================
// INDIAN BATTLE FIELDS
// MATCH COMPLETION SERVICE
// ==========================================

// ==========================================
// FINALIZE MATCH
// ==========================================

async function finalizeMatch(matchId) {
    if (!matchId) {
        throw new Error("Match ID is required");
    }

    const { data, error } = await supabaseAdmin.rpc(
        "finalize_match_if_ready",
        {
            p_match_id: matchId
        }
    );

    if (error) {
        console.error(
            "Match completion database error:",
            error.message
        );

        throw new Error("Unable to finalize match");
    }

    if (!data || !data.success) {
        return {
            success: false,
            completed: false,
            message: data?.message || "Match completion failed"
        };
    }

    if (!data.completed) {
        return {
            success: true,
            completed: false,
            aliveTeams: data.alive_teams ?? null,
            message: data.message || "Match is still in progress"
        };
    }

    return {
        success: true,
        completed: true,
        alreadyCompleted: Boolean(data.already_completed),
        matchId: data.match_id || matchId,
        winnerTeam: data.winner_team ?? null,
        winnerPlayerId: data.winner_player_id ?? null,
        resultsRecorded: data.results_recorded ?? 0,
        message: data.message || "Match completed"
    };
}

// ==========================================
// FETCH FINAL MATCH RESULTS
// ==========================================

async function getFinalMatchResults(matchId) {
    if (!matchId) {
        throw new Error("Match ID is required");
    }

    const { data: results, error: resultsError } =
        await supabaseAdmin
            .from("player_match_results")
            .select(`
                player_id,
                game_mode,
                map_name,
                kills,
                deaths,
                placement,
                is_winner,
                xp_earned,
                rank_points_earned,
                completed_at
            `)
            .eq("match_id", matchId)
            .order("placement", {
                ascending: true,
                nullsFirst: false
            })
            .order("kills", {
                ascending: false
            });

    if (resultsError) {
        console.error(
            "Final match results error:",
            resultsError.message
        );

        throw new Error("Unable to fetch final match results");
    }

    if (!results || results.length === 0) {
        return [];
    }

    // Fetch player identity details separately.
    // This avoids depending on a guessed foreign-key name.

    const playerIds = [
        ...new Set(results.map(item => item.player_id))
    ];

    const { data: players, error: playersError } =
        await supabaseAdmin
            .from("players")
            .select(`
                id,
                username,
                avatar_url,
                level
            `)
            .in("id", playerIds);

    if (playersError) {
        console.error(
            "Final results player lookup error:",
            playersError.message
        );

        throw new Error("Unable to fetch player details");
    }

    const playerMap = new Map(
        (players || []).map(player => [
            String(player.id),
            player
        ])
    );

    return results.map(result => {
        const player = playerMap.get(
            String(result.player_id)
        );

        return {
            playerId: result.player_id,
            username: player?.username || "Unknown Player",
            avatarUrl: player?.avatar_url || null,
            level: player?.level ?? 1,

            gameMode: result.game_mode,
            mapName: result.map_name,

            kills: result.kills,
            deaths: result.deaths,
            placement: result.placement,
            isWinner: result.is_winner,

            xpEarned: result.xp_earned,
            rankPointsEarned: result.rank_points_earned,

            completedAt: result.completed_at
        };
    });
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
    finalizeMatch,
    getFinalMatchResults
};
