// ==========================================
// INDIAN BATTLE FIELDS - match types
// ==========================================
// Three ways to play, each as solo / duo / squad
// (matches.game_mode keeps the team size):
//
//   br   Battle Royale: aircraft drop, loot, shrinking zone,
//        last team standing wins.
//   cs   Clash Squad: two teams (or free-for-all in solo) fight
//        in one town over rounds; first to 4 round wins.
//   tdm  Team Deathmatch: respawn after 5 s; first team to the
//        kill target (or most kills when time runs out) wins.
//
// The type is stored in the match code prefix, so no database
// change is needed:
//   rooms         BR-XXXXXXXX  CS-XXXXXXXX  TD-XXXXXXXX
//   quick matches QM-BR-XXXX…  QM-CS-XXXX…  QM-TD-XXXX…
// Older quick matches ("QM-" + hex) are Battle Royale.

const MATCH_TYPES = {
    br: {
        id: "br",
        name: "Battle Royale",
        roomPrefix: "BR-",
        quickPrefix: "QM-BR-",
        respawn: false,
        // Store opens for 30 s after landing.
        buyWindowMs: 30000
    },
    cs: {
        id: "cs",
        name: "Clash Squad",
        roomPrefix: "CS-",
        quickPrefix: "QM-CS-",
        respawn: true,
        roundsToWin: 4,
        maxRounds: 7,
        buyPhaseMs: 15000,
        fightMs: 120000,
        roundEndPauseMs: 5000,
        arenaRadius: 75,
        roundWinCoins: 300,
        roundLossCoins: 200,
        // Players per match by team size (two teams in duo/squad).
        maxPlayers: { solo: 8, duo: 4, squad: 8 }
    },
    tdm: {
        id: "tdm",
        name: "Team Deathmatch",
        roomPrefix: "TD-",
        quickPrefix: "QM-TD-",
        respawn: true,
        buyPhaseMs: 15000,
        respawnDelayMs: 5000,
        respawnBuyMs: 10000,
        durationMs: 8 * 60 * 1000,
        killTarget: { solo: 20, duo: 25, squad: 40 },
        arenaRadius: 90,
        maxPlayers: { solo: 8, duo: 4, squad: 8 }
    }
};

const KILL_REWARD_COINS = 100;
const STARTING_MATCH_COINS = 1000;

function matchTypeFromCode(code) {
    const c = String(code || "").toUpperCase();
    if (c.startsWith("CS-") || c.startsWith("QM-CS-")) return "cs";
    if (c.startsWith("TD-") || c.startsWith("QM-TD-")) return "tdm";
    return "br";
}

function normalizeMatchType(value) {
    return MATCH_TYPES[value] ? value : "br";
}

// Room code: prefix + 8 hex characters.
const ROOM_CODE_PATTERN = /^(BR|CS|TD)-[A-F0-9]{8}$/;

module.exports = {
    MATCH_TYPES,
    KILL_REWARD_COINS,
    STARTING_MATCH_COINS,
    ROOM_CODE_PATTERN,
    matchTypeFromCode,
    normalizeMatchType
};
