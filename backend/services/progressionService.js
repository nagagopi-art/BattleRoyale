// ==========================================
// INDIAN BATTLE FIELDS
// PLAYER PROGRESSION: LEVELS AND COINS
// ==========================================
// XP and rank points are awarded by the database function
// finalize_match_if_ready. This service, run after a match
// completes:
//   1. derives each player's level from their total XP;
//   2. awards coins once per match (needs the coins_earned
//      column from database/migrations/002_progression.sql).

const { supabaseAdmin } = require("../config/supabase");

const PROGRESSION_CONFIG = {
    maxLevel: 100,
    // XP needed to go from level L to L+1: base + (L-1) * step
    xpBase: 100,
    xpStep: 50,

    coins: {
        participation: 20,
        perKill: 10,
        winner: 100,
        top10Percent: 50,
        top25Percent: 25,
        perLevelGained: 100
    }
};

// Total XP needed to reach `level`.
function experienceForLevel(level) {
    const { xpBase, xpStep } = PROGRESSION_CONFIG;
    const n = Math.max(0, level - 1);

    return n * xpBase + (xpStep * n * (n - 1)) / 2;
}

function levelForExperience(experience) {
    const xp = Math.max(0, Number(experience) || 0);
    let level = 1;

    while (
        level < PROGRESSION_CONFIG.maxLevel &&
        experienceForLevel(level + 1) <= xp
    ) {
        level++;
    }

    return level;
}

// Progress toward the next level, for profile screens.
function getLevelProgress(experience) {
    const level = levelForExperience(experience);
    const current = experienceForLevel(level);
    const next = level >= PROGRESSION_CONFIG.maxLevel
        ? null
        : experienceForLevel(level + 1);

    return {
        level,
        experience: Math.max(0, Number(experience) || 0),
        levelStartXp: current,
        nextLevelXp: next,
        progress: next === null
            ? 1
            : Number(((experience - current) / (next - current)).toFixed(3))
    };
}

function coinsForResult({ placement, kills, isWinner }, totalPlayers) {
    const c = PROGRESSION_CONFIG.coins;
    let coins = c.participation + (Number(kills) || 0) * c.perKill;

    if (isWinner) {
        coins += c.winner;
    } else if (placement && totalPlayers > 0) {
        const fraction = placement / totalPlayers;

        if (fraction <= 0.1) coins += c.top10Percent;
        else if (fraction <= 0.25) coins += c.top25Percent;
    }

    return coins;
}

let coinsColumnMissing = false;

// Returns [{ playerId, level, leveledUp, levelsGained,
//            coinsEarned, totalCoins }]
// options.leftoverCoins: Map playerId -> unspent match coins
// (players missing from it never spent any: they get the full
// starting amount).
async function applyMatchProgression(matchId, options = {}) {
    const { STARTING_MATCH_COINS } = require("../config/matchTypes");
    const leftoverCoins = options.leftoverCoins || new Map();
    const { data: results, error } = await supabaseAdmin
        .from("player_match_results")
        .select("player_id, placement, kills, is_winner")
        .eq("match_id", matchId);

    if (error) throw error;
    if (!results || results.length === 0) return [];

    const playerIds = results.map(r => r.player_id);

    const { data: players, error: playersError } = await supabaseAdmin
        .from("players")
        .select("id, level, experience, coins")
        .in("id", playerIds);

    if (playersError) throw playersError;

    const byId = new Map((players || []).map(p => [String(p.id), p]));
    const summary = [];

    for (const result of results) {
        const player = byId.get(String(result.player_id));
        if (!player) continue;

        const oldLevel = Number(player.level) || 1;
        const newLevel = levelForExperience(player.experience);
        const levelsGained = Math.max(0, newLevel - oldLevel);

        // ----- Coins: claim this match's award exactly once -----
        let coinsEarned = 0;

        if (!coinsColumnMissing) {
            const award =
                coinsForResult(
                    {
                        placement: result.placement,
                        kills: result.kills,
                        isWinner: result.is_winner
                    },
                    results.length
                ) +
                levelsGained * PROGRESSION_CONFIG.coins.perLevelGained +
                (leftoverCoins.get(String(result.player_id)) ?? STARTING_MATCH_COINS);

            const { data: claimed, error: claimError } = await supabaseAdmin
                .from("player_match_results")
                .update({ coins_earned: award })
                .eq("match_id", matchId)
                .eq("player_id", result.player_id)
                .is("coins_earned", null)
                .select("player_id");

            if (claimError) {
                if (/coins_earned/.test(claimError.message || "")) {
                    coinsColumnMissing = true;
                    console.warn(
                        "Coin awards disabled: run database/migrations/002_progression.sql"
                    );
                } else {
                    console.error("Coin claim error:", claimError.message);
                }
            } else if (claimed && claimed.length > 0) {
                coinsEarned = award;
            }
        }

        const update = {};
        if (newLevel !== oldLevel) update.level = newLevel;
        if (coinsEarned > 0) update.coins = (Number(player.coins) || 0) + coinsEarned;

        if (Object.keys(update).length > 0) {
            const { error: updateError } = await supabaseAdmin
                .from("players")
                .update(update)
                .eq("id", player.id);

            if (updateError) {
                console.error("Progression update error:", updateError.message);
                continue;
            }
        }

        summary.push({
            playerId: player.id,
            level: newLevel,
            leveledUp: levelsGained > 0,
            levelsGained,
            coinsEarned,
            totalCoins: update.coins ?? player.coins,
            ...getLevelProgress(player.experience)
        });
    }

    return summary;
}

module.exports = {
    PROGRESSION_CONFIG,
    experienceForLevel,
    levelForExperience,
    getLevelProgress,
    coinsForResult,
    applyMatchProgression
};
