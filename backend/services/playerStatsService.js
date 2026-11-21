
const { supabaseAdmin } = require("../config/supabase");

// ==========================================
// INDIAN BATTLE FIELDS
// PLAYER STATISTICS SERVICE
// ==========================================

async function getPlayerProfile(playerId) {
    const { data: player, error: playerError } = await supabaseAdmin
        .from("players")
        .select(`
            id,
            player_uid,
            username,
            avatar_url,
            level,
            experience,
            coins,
            rank_points,
            created_at
        `)
        .eq("id", playerId)
        .single();

    if (playerError) {
        throw new Error(playerError.message);
    }

    const { data: results, error: resultsError } = await supabaseAdmin
        .from("player_match_results")
        .select(`
            kills,
            deaths,
            is_winner,
            xp_earned,
            rank_points_earned,
            placement,
            game_mode
        `)
        .eq("player_id", playerId);

    if (resultsError) {
        throw new Error(resultsError.message);
    }

    const matchesPlayed = results.length;

    const totalKills = results.reduce(
        (sum, result) => sum + result.kills, 0
    );

    const totalDeaths = results.reduce(
        (sum, result) => sum + result.deaths, 0
    );

    const wins = results.filter(
        result => result.is_winner
    ).length;

    const kdRatio = totalDeaths === 0
        ? totalKills
        : Number((totalKills / totalDeaths).toFixed(2));

    const winRate = matchesPlayed === 0
        ? 0
        : Number(((wins / matchesPlayed) * 100).toFixed(2));

    const daysPlaying = Math.max(
        0,
        Math.floor(
            (Date.now() - new Date(player.created_at).getTime())
            / (1000 * 60 * 60 * 24)
        )
    );

    return {
        player: {
            id: player.id,
            player_uid: player.player_uid,
            username: player.username,
            avatar_url: player.avatar_url,
            level: player.level,
            experience: player.experience,
            coins: player.coins,
            rank_points: player.rank_points,
            created_at: player.created_at,
            days_playing: daysPlaying,
            years_playing: Number((daysPlaying / 365.25).toFixed(2))
        },

        career: {
            matches_played: matchesPlayed,
            total_kills: totalKills,
            total_deaths: totalDeaths,
            wins,
            losses: matchesPlayed - wins,
            kd_ratio: kdRatio,
            win_rate: winRate
        }
    };
}

// ==========================================
// GET MATCH HISTORY
// ==========================================

async function getPlayerMatchHistory(playerId, limit = 20, offset = 0) {
    const safeLimit = Math.min(
        Math.max(parseInt(limit, 10) || 20, 1),
        100
    );

    const safeOffset = Math.max(
        parseInt(offset, 10) || 0,
        0
    );

    const { data, error, count } = await supabaseAdmin
        .from("player_match_results")
        .select(`
            match_id,
            game_mode,
            map_name,
            kills,
            deaths,
            placement,
            is_winner,
            xp_earned,
            rank_points_earned,
            completed_at
        `, { count: "exact" })
        .eq("player_id", playerId)
        .order("completed_at", { ascending: false })
        .range(
            safeOffset,
            safeOffset + safeLimit - 1
        );

    if (error) {
        throw new Error(error.message);
    }

    return {
        total: count || 0,
        limit: safeLimit,
        offset: safeOffset,
        matches: data || []
    };
}

// ==========================================
// GET RANK INFORMATION
// ==========================================

function calculateRank(rankPoints) {
    const ranks = [
        { name: "Bronze", min: 0 },
        { name: "Silver", min: 1000 },
        { name: "Gold", min: 2000 },
        { name: "Platinum", min: 3000 },
        { name: "Diamond", min: 4000 },
        { name: "Master", min: 5000 },
        { name: "Grandmaster", min: 6000 }
    ];

    let currentRank = ranks[0];
    let nextRank = ranks[1];

    for (let i = 0; i < ranks.length; i++) {
        if (rankPoints >= ranks[i].min) {
            currentRank = ranks[i];
            nextRank = ranks[i + 1] || null;
        }
    }

    return {
        rank: currentRank.name,
        rank_points: rankPoints,
        next_rank: nextRank ? nextRank.name : null,
        points_to_next_rank: nextRank
            ? Math.max(0, nextRank.min - rankPoints)
            : 0
    };
}

async function getPlayerRank(playerId) {
    const { data: player, error } = await supabaseAdmin
        .from("players")
        .select("id, username, rank_points")
        .eq("id", playerId)
        .single();

    if (error) {
        throw new Error(error.message);
    }

    return {
        player_id: player.id,
        username: player.username,
        ...calculateRank(player.rank_points || 0)
    };
}

module.exports = {
    getPlayerProfile,
    getPlayerMatchHistory,
    getPlayerRank,
    calculateRank
};
