// ==========================================
// Client-side game state (what this player knows)
// ==========================================

const GROUND_Y = 5;

function newGameState() {
    return {
        matchId: null,
        matchCode: null,
        gameMode: null,
        serverUrl: null,
        socket: null,

        // lobby | waiting | aircraft | dropping | ground | dead | over
        phase: "lobby",
        matchStatus: null,

        self: {
            id: null,
            pos: null,
            team: null,
            health: 100,
            armor: 0,
            alive: true,
            knocked: false,
            knockHealth: 0,
            kills: 0,
            flashedUntil: 0
        },

        // playerId -> { pos, hidden, team, username, alive, knocked, seenAt }
        players: new Map(),
        usernames: new Map(),

        loot: new Map(),        // lootId -> item
        smokes: new Map(),      // id -> { position, radius, expiresAt }
        walls: new Map(),       // id -> wall
        grenades: new Map(),    // id -> { position, type, explodesAt }
        effects: [],            // short-lived drawings (shots, blasts, pings)

        zone: null,
        flight: null,           // { flightPath, startedAt, durationMs }
        jumped: false,
        parachute: false,

        inventory: null,
        throwables: null,
        activeWeapon: null,
        magazine: null,
        reloading: false,
        healing: null,          // { itemId, endsAt }
        alivePlayers: null,

        spectating: null,

        // Game mode (br | cs | tdm), mode/round state, match coins and store.
        matchType: "br",
        mode: null,
        store: null,
        respawn: null,
        feed: [],

        // input
        keys: new Set(),
        mouse: { x: 0, y: 0, down: false },
        zoom: 4
    };
}

let G = newGameState();

function isTeammate(playerId) {
    if (G.gameMode === "solo") return false;
    const p = G.players.get(Number(playerId));
    return p && p.team !== null && p.team === G.self.team;
}

function distance2d(a, b) {
    return Math.hypot(a.x - b.x, a.z - b.z);
}
