
require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const { supabaseAdmin } = require("./config/supabase");

// ==========================================
// INDIAN BATTLE FIELDS - API ROUTES
// ==========================================

const authRoutes = require("./routes/auth");
const playerRoutes = require("./routes/players");
const matchRoutes = require("./routes/matches");
const leaderboardRoutes = require("./routes/leaderboard");
const mapRoutes = require("./routes/maps");
const cosmeticRoutes = require("./routes/cosmetics");
const {
    matchmakingRouter,
    partyRouter,
    QUICK_MATCH
} = require("./routes/matchmaking");
const { clearMatchGroups } = require("./services/partyService");
const { getActiveZones } = require("./services/safeZoneService");
const { reportError } = require("./services/errorReporter");

const {
    isClusterEnabled,
    getServerId,
    isHostedHere,
    claimMatch,
    startHeartbeat
} = require("./services/clusterService");
const {
    BOT_CONFIG,
    fillMatchWithBots,
    stopAllBots
} = require("./services/botService");

// ==========================================
// SOCKET INITIALIZATION
// ==========================================

const gameSocketModule = require("./sockets/gameSocket");
const Modes = require("./sockets/game/modes");

const initializeGameSocket =
    typeof gameSocketModule === "function"
        ? gameSocketModule
        : gameSocketModule.initializeGameSocket;

if (typeof initializeGameSocket !== "function") {
    throw new Error(
        "gameSocket.js must export initializeGameSocket"
    );
}

const startSafeZone = gameSocketModule.startSafeZone;

// ==========================================
// BATTLEFIELD SERVICE
// ==========================================

const {
    initializeBattlefield
} = require("./services/battlefieldService");

if (typeof initializeBattlefield !== "function") {
    throw new Error(
        "battlefieldService.js must export initializeBattlefield"
    );
}

// ==========================================
// APPLICATION CONFIGURATION
// ==========================================

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || "development";

const GAME_NAME = "INDIAN BATTLE FIELDS";

// ==========================================
// SECURITY CONFIGURATION
// ==========================================

// Allowed client origins: CLIENT_URL, comma-separated.
// Unset = allow any origin (development only).
const ALLOWED_ORIGINS = (process.env.CLIENT_URL || "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);

if (NODE_ENV === "production" && ALLOWED_ORIGINS.length === 0) {
    console.error(
        "SECURITY: CLIENT_URL is not set in production. " +
        "Set it to your game client's URL(s), comma-separated."
    );
}

// Development test events must never run in production.
if (
    NODE_ENV === "production" &&
    process.env.ENABLE_DEV_TEST_EVENTS === "true"
) {
    console.error(
        "SECURITY: ENABLE_DEV_TEST_EVENTS ignored in production."
    );
    process.env.ENABLE_DEV_TEST_EVENTS = "false";
}

const corsOrigin = ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : "*";

const io = new Server(server, {
    cors: {
        origin: corsOrigin,
        methods: ["GET", "POST"],
        // Credentials are only valid with explicit origins.
        credentials: ALLOWED_ORIGINS.length > 0
    },
    transports: ["websocket", "polling"],
    // Reject oversized socket messages (game payloads are tiny).
    maxHttpBufferSize: 16 * 1024
});

// ==========================================
// MIDDLEWARE
// ==========================================

app.use(cors({
    origin: corsOrigin,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: ALLOWED_ORIGINS.length > 0
}));

app.use(express.json({ limit: "100kb" }));

app.use(express.urlencoded({
    extended: true,
    limit: "100kb"
}));

// ==========================================
// API ROUTES
// ==========================================

app.use("/api/auth", authRoutes);
app.use("/api/players", playerRoutes);
app.use("/api/matches", matchRoutes);
app.use("/api/leaderboard", leaderboardRoutes);
app.use("/api/maps", mapRoutes);
app.use("/api/cosmetics", cosmeticRoutes);
app.use("/api/matchmaking", matchmakingRouter);
app.use("/api/parties", partyRouter);

// Game client (../frontend) at /play. Served in production too
// (the Android app and browsers load the game from here); set
// SERVE_CLIENT=false to turn it off.
if (process.env.SERVE_CLIENT !== "false") {
    app.use(
        "/play",
        express.static(require("path").join(__dirname, "..", "frontend"))
    );
}

// ==========================================
// HEALTH CHECK
// ==========================================

app.get("/api/health", (req, res) => {
    const memory = process.memoryUsage();

    res.status(200).json({
        status: "success",
        game: GAME_NAME,
        message: `${GAME_NAME} server is online`,
        environment: NODE_ENV,
        multiplayer: "active",
        battlefield: "enabled",
        timestamp: new Date().toISOString(),

        // Monitoring
        uptimeSeconds: Math.round(process.uptime()),
        memoryMb: {
            rss: Math.round(memory.rss / 1048576),
            heapUsed: Math.round(memory.heapUsed / 1048576)
        },
        connectedSockets: io.engine.clientsCount,
        liveMatches: getActiveZones().length,
        serverId: isClusterEnabled() ? getServerId() : null
    });
});

// ==========================================
// DATABASE CONNECTION TEST
// ==========================================

app.get("/api/db-test", async (req, res) => {
    try {
        const { error } = await supabaseAdmin
            .from("players")
            .select("id")
            .limit(1);

        if (error) {
            throw error;
        }

        res.status(200).json({
            status: "success",
            game: GAME_NAME,
            message: "Supabase database connected successfully"
        });

    } catch (error) {
        console.error(
            "Database test error:",
            error.message
        );

        res.status(500).json({
            status: "error",
            message: "Database connection failed"
        });
    }
});

// ==========================================
// API INFORMATION
// ==========================================

app.get("/api", (req, res) => {
    res.status(200).json({
        name: `${GAME_NAME} API`,
        version: "1.4.0",
        status: "running",

        features: [
            "Authentication",
            "Player Profiles",
            "Matchmaking",
            "Solo Mode",
            "Duo Mode",
            "Squad Mode",
            "150 Player Matches",
            "Leaderboard",
            "Indian Battle Maps",
            "Socket Multiplayer",
            "Battlefield Spawning",
            "Team Assignment",
            "Match Countdown",
            "Battlefield Recovery"
        ],

        endpoints: {
            health: "GET /api/health",
            database: "GET /api/db-test",
            auth: "/api/auth",
            players: "/api/players",
            matches: "/api/matches",
            createMatch: "POST /api/matches/create",
            leaderboard: "/api/leaderboard",
            maps: "/api/maps"
        }
    });
});

// ==========================================
// INITIALIZE SOCKET.IO
// ==========================================

initializeGameSocket(io);

// ==========================================
// MATCH PROCESSOR STATE
// ==========================================

let countdownProcessing = false;
let isShuttingDown = false;
let countdownInterval = null;
let shutdownStarted = false;

// Retry failed battlefield initialization after 5 seconds.
// This Map is local to this server process.
const battlefieldRetryTimes = new Map();

const BATTLEFIELD_RETRY_DELAY = 5000;

// ==========================================
// FETCH LATEST MATCH STATE
// ==========================================

async function getLatestMatchState(matchId) {

    const { data, error } = await supabaseAdmin
        .from("matches")
        .select(
            "id, match_code, map_name, game_mode, max_players, current_players, status, start_at, battlefield_status"
        )
        .eq("id", matchId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return data;
}

// ==========================================
// INITIALIZE AND ANNOUNCE BATTLEFIELD
// ==========================================

async function initializeAndAnnounceBattlefield(match) {

    const matchRoom = `match:${match.id}`;

    const retryAt =
        battlefieldRetryTimes.get(match.id) || 0;

    if (Date.now() < retryAt) {
        return;
    }

    try {

        console.log("----------------------------------");
        console.log("INITIALIZING BATTLEFIELD");
        console.log("Match:", match.match_code);
        console.log("Mode:", match.game_mode);
        console.log("----------------------------------");

        const battlefield =
            await initializeBattlefield(match.id);

        if (
            !battlefield ||
            battlefield.success !== true ||
            !Array.isArray(battlefield.assignments)
        ) {
            throw new Error(
                "Battlefield initialization returned an invalid response"
            );
        }

        battlefieldRetryTimes.delete(match.id);

        // ==================================
        // PLAYER SPAWN NOTIFICATIONS
        // ==================================

        for (const assignment of battlefield.assignments) {

            const playerRoom =
                `player:${assignment.player_id}`;

            io.to(playerRoom).emit("player-spawned", {
                matchId: match.id,
                playerId: assignment.player_id,
                teamNumber: assignment.team_number,

                position: {
                    x: Number(assignment.spawn_x),
                    y: Number(assignment.spawn_y),
                    z: Number(assignment.spawn_z)
                },

                health: 100,
                armor: 0
            });
        }

        // ==================================
        // MATCH STARTED BROADCAST
        // ==================================

        io.to(matchRoom).emit("match-started", {
            status: "success",
            game: GAME_NAME,
            matchId: match.id,
            matchCode: match.match_code,
            mapName: match.map_name,
            gameMode: match.game_mode,
            matchType: Modes.registerMatchType(match.id, match.match_code),
            totalPlayers: battlefield.totalPlayers,
            maxPlayers: match.max_players,
            message: "Battlefield is ready"
        });

        // Battle Royale: start the shrinking safe zone.
        // Clash Squad / Team Deathmatch: ground spawns in an arena.
        const matchType = Modes.registerMatchType(match.id, match.match_code);

        if (matchType === "br") {
            if (typeof startSafeZone === "function") {
                startSafeZone(match.id);
            }
        } else {
            Modes.startModeIfNeeded(match.id).catch(error =>
                console.error("Mode start error:", match.match_code, error.message)
            );
        }

        console.log("----------------------------------");
        console.log("MATCH STARTED SUCCESSFULLY");
        console.log("Game:", GAME_NAME);
        console.log("Match:", match.match_code);
        console.log(
            "Players spawned:",
            battlefield.totalPlayers
        );
        console.log("Map:", match.map_name);
        console.log("Mode:", match.game_mode);
        console.log("----------------------------------");

    } catch (error) {

        battlefieldRetryTimes.set(
            match.id,
            Date.now() + BATTLEFIELD_RETRY_DELAY
        );

        console.error("----------------------------------");
        console.error("BATTLEFIELD INITIALIZATION FAILED");
        console.error("Match:", match.match_code);
        console.error("Reason:", error.message);
        console.error("Retry scheduled in 5 seconds");
        console.error("----------------------------------");

        io.to(matchRoom).emit("battlefield-error", {
            success: false,
            matchId: match.id,
            matchCode: match.match_code,
            message: "Battlefield initialization failed. Retrying."
        });
    }
}

// ==========================================
// QUICK-MATCH AUTO START + ABANDONED MATCH CLEANUP
// ==========================================

// ==========================================
// MULTI-SERVER HOSTING
// ==========================================
// host_server is only selected in cluster mode, so single
// servers do not need migration 005.

const CLUSTER_COLUMNS = isClusterEnabled() ? ", host_server" : "";

// True when this server should run the match's background
// work; claims matches that have no host yet.
async function hostsMatch(match) {
    if (!isClusterEnabled()) return true;
    if (match.host_server) return isHostedHere(match);

    const claimed = await claimMatch(match.id);
    if (claimed) match.host_server = getServerId();

    return claimed;
}

const LOBBY_CONFIG = {
    intervalMs: 15000,
    // Cancel matches that are clearly abandoned.
    waitingTimeoutMs: 30 * 60 * 1000,
    startingStuckMs: 10 * 60 * 1000,
    inProgressTimeoutMs: 60 * 60 * 1000
};

let lobbyInterval = null;
let lobbyProcessing = false;

async function cancelMatch(match, reason) {
    const { error } = await supabaseAdmin
        .from("matches")
        .update({
            status: "cancelled",
            completed_at: new Date().toISOString()
        })
        .eq("id", match.id)
        .eq("status", match.status);

    if (error) {
        console.error("Cancel match error:", match.match_code, error.message);
        return;
    }

    clearMatchGroups(match.id);

    io.to(`match:${match.id}`).emit("match-cancelled", {
        matchId: match.id,
        reason
    });

    console.log("MATCH CANCELLED:", match.match_code, "-", reason);
}

async function processLobbiesAndCleanup() {
    if (lobbyProcessing || isShuttingDown) return;
    lobbyProcessing = true;

    try {
        const now = Date.now();

        const { data: matches, error } = await supabaseAdmin
            .from("matches")
            .select("id, match_code, status, created_by, created_at, start_at, started_at, current_players, max_players" + CLUSTER_COLUMNS)
            .in("status", ["waiting", "starting", "in_progress"]);

        if (error) throw error;

        for (const match of matches || []) {
            // Multi-server: only the host runs this match's work.
            if (!(await hostsMatch(match))) continue;

            const createdAt = new Date(match.created_at).getTime();
            const startAt = match.start_at ? new Date(match.start_at).getTime() : null;
            const startedAt = match.started_at ? new Date(match.started_at).getTime() : null;

            // ---------- Abandoned matches ----------
            if (
                match.status === "waiting" &&
                now - createdAt > LOBBY_CONFIG.waitingTimeoutMs
            ) {
                await cancelMatch(match, "Lobby expired");
                continue;
            }

            if (
                match.status === "starting" &&
                startAt &&
                now - startAt > LOBBY_CONFIG.startingStuckMs
            ) {
                await cancelMatch(match, "Match failed to start");
                continue;
            }

            if (
                match.status === "in_progress" &&
                startedAt &&
                now - startedAt > LOBBY_CONFIG.inProgressTimeoutMs
            ) {
                await cancelMatch(match, "Match abandoned");
                continue;
            }

            // ---------- Fill short quick matches with bots ----------
            if (
                BOT_CONFIG.enabled &&
                match.status === "waiting" &&
                match.match_code.startsWith(QUICK_MATCH.codePrefix) &&
                match.current_players >= 1 &&
                match.current_players < BOT_CONFIG.fillTarget &&
                now - createdAt >= QUICK_MATCH.lobbyWaitMs
            ) {
                await fillMatchWithBots(
                    match.id,
                    BOT_CONFIG.fillTarget - match.current_players,
                    PORT
                );

                // Start on the next pass with the new head count.
                continue;
            }

            // ---------- Quick-match auto start ----------
            if (
                match.status === "waiting" &&
                match.match_code.startsWith(QUICK_MATCH.codePrefix) &&
                match.current_players >= QUICK_MATCH.minPlayersToStart &&
                (now - createdAt >= QUICK_MATCH.lobbyWaitMs ||
                    match.current_players >= match.max_players)
            ) {
                // The room creator may have left: fall back to
                // the earliest remaining member.
                const { data: members } = await supabaseAdmin
                    .from("match_players")
                    .select("player_id")
                    .eq("match_id", match.id)
                    .order("joined_at", { ascending: true })
                    .limit(1);

                const starterId = members?.some(
                    m => Number(m.player_id) === Number(match.created_by)
                )
                    ? match.created_by
                    : members?.[0]?.player_id;

                if (!starterId) continue;

                const { data: result, error: startError } = await supabaseAdmin.rpc(
                    "prepare_match_start",
                    { p_match_id: match.id, p_player_id: starterId }
                );

                if (startError || result?.status !== "success") {
                    console.error(
                        "Quick match auto-start failed:",
                        match.match_code,
                        startError?.message || result?.message
                    );
                } else {
                    console.log("QUICK MATCH AUTO-STARTED:", match.match_code);
                }
            }
        }
    } catch (error) {
        console.error("Lobby processor error:", error.message);
    } finally {
        lobbyProcessing = false;
    }
}

// ==========================================
// MATCH COUNTDOWN AND RECOVERY PROCESSOR
// ==========================================

async function processMatchCountdowns() {

    if (countdownProcessing || isShuttingDown) {
        return;
    }

    countdownProcessing = true;

    try {

        // Fetch both:
        // 1. Matches waiting for countdown completion.
        // 2. Matches already started but battlefield not active.

        // Only matches that still need work: active
        // battlefields are skipped in the query itself.
        const { data: matches, error } =
            await supabaseAdmin
                .from("matches")
                .select(
                    "id, match_code, map_name, game_mode, current_players, max_players, status, start_at, battlefield_status" + CLUSTER_COLUMNS
                )
                .in("status", ["starting", "in_progress"])
                .or("battlefield_status.is.null,battlefield_status.neq.active");

        if (error) {
            throw error;
        }

        for (const match of matches || []) {

            if (isShuttingDown) {
                break;
            }

            // Multi-server: only the host runs this match's work.
            if (!(await hostsMatch(match))) continue;

            const matchRoom = `match:${match.id}`;

            // ==================================
            // SKIP COMPLETED BATTLEFIELDS
            // ==================================

            if (match.battlefield_status === "active") {
                battlefieldRetryTimes.delete(match.id);
                continue;
            }

            // ==================================
            // PROCESS COUNTDOWN
            // ==================================

            if (match.status === "starting") {

                if (!match.start_at) {
                    console.error(
                        "Starting match has no start_at:",
                        match.match_code
                    );
                    continue;
                }

                const startAt =
                    new Date(match.start_at).getTime();

                if (!Number.isFinite(startAt)) {
                    console.error(
                        "Invalid match start time:",
                        match.match_code
                    );
                    continue;
                }

                const remainingSeconds = Math.max(
                    0,
                    Math.ceil(
                        (startAt - Date.now()) / 1000
                    )
                );

                // Broadcast remaining countdown.
                if (remainingSeconds > 0) {

                    io.to(matchRoom).emit(
                        "match-countdown",
                        {
                            matchId: match.id,
                            matchCode: match.match_code,
                            remainingSeconds,
                            startAt: match.start_at
                        }
                    );

                    continue;
                }

                // ==================================
                // COMPLETE MATCH START RPC
                // ==================================

                const { data, error: startError } =
                    await supabaseAdmin.rpc(
                        "complete_match_start",
                        {
                            p_match_id: match.id
                        }
                    );

                if (startError) {

                    console.error(
                        "Match start RPC error:",
                        match.match_code,
                        startError.message
                    );

                    // Another server process may have
                    // completed the transition.
                    // Check the latest database state.
                    let latestMatch;

                    try {
                        latestMatch =
                            await getLatestMatchState(match.id);
                    } catch (refreshError) {
                        console.error(
                            "Could not refresh match state:",
                            refreshError.message
                        );
                        continue;
                    }

                    if (
                        !latestMatch ||
                        latestMatch.status !== "in_progress"
                    ) {
                        continue;
                    }

                    Object.assign(match, latestMatch);

                } else if (!data || data.status !== "success") {

                    // The RPC may report that another
                    // process already started the match.
                    let latestMatch;

                    try {
                        latestMatch =
                            await getLatestMatchState(match.id);
                    } catch (refreshError) {
                        console.error(
                            "Could not refresh match state:",
                            refreshError.message
                        );
                        continue;
                    }

                    if (
                        !latestMatch ||
                        latestMatch.status !== "in_progress"
                    ) {
                        console.log(
                            "Match start not completed:",
                            match.match_code,
                            data
                        );
                        continue;
                    }

                    Object.assign(match, latestMatch);

                }
            }

            // ==================================
            // BATTLEFIELD RECOVERY
            // ==================================

            // This section handles:
            // - Newly started matches.
            // - Matches whose battlefield failed earlier.
            // - Matches recovered after server restart.

            if (match.status === "in_progress") {

                await initializeAndAnnounceBattlefield(match);
            }
        }

    } catch (error) {

        console.error(
            "Match processor error:",
            error.message
        );

    } finally {

        countdownProcessing = false;
    }
}

// ==========================================
// 404 HANDLER
// ==========================================

app.use((req, res) => {
    res.status(404).json({
        status: "error",
        message: "API endpoint not found",
        path: req.originalUrl
    });
});

// ==========================================
// CENTRAL ERROR HANDLER
// ==========================================

app.use((err, req, res, next) => {

    console.error("Server error:", err);

    res.status(500).json({
        status: "error",
        message: "Internal server error"
    });
});

// ==========================================
// START SERVER
// ==========================================

server.listen(PORT, () => {

    console.log("----------------------------------");
    console.log(` ${GAME_NAME}`);
    console.log("----------------------------------");

    console.log(`Server: http://localhost:${PORT}`);

    // LAN addresses, so other devices on the network can connect.
    for (const nets of Object.values(require("os").networkInterfaces())) {
        for (const net of nets || []) {
            if (net.family === "IPv4" && !net.internal) {
                console.log(`Network: http://${net.address}:${PORT}`);
            }
        }
    }
    console.log(`Environment: ${NODE_ENV}`);
    console.log("Supabase: Configured");
    console.log("Socket.IO: Active");
    console.log("Battlefield: Enabled");
    console.log("Matchmaking: Active");
    console.log("Countdown: Active");
    console.log("Battlefield Recovery: Enabled");
    console.log("Maximum players per match: 150");

    console.log("----------------------------------");

    // Recover countdowns and unfinished battlefields.
    processMatchCountdowns();

    countdownInterval = setInterval(
        processMatchCountdowns,
        1000
    );

    // Auto-start quick matches and cancel abandoned ones.
    lobbyInterval = setInterval(
        processLobbiesAndCleanup,
        LOBBY_CONFIG.intervalMs
    );

    // Multi-server: report this server's load (no-op otherwise).
    startHeartbeat(() => ({
        liveMatches: getActiveZones().length,
        connectedPlayers: io.engine.clientsCount
    }));
});

// ==========================================
// GRACEFUL SHUTDOWN
// ==========================================

async function shutdown(signal) {

    if (shutdownStarted) {
        return;
    }

    shutdownStarted = true;
    isShuttingDown = true;

    console.log(
        `${signal} received. Shutting down ${GAME_NAME}...`
    );

    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }

    if (lobbyInterval) {
        clearInterval(lobbyInterval);
        lobbyInterval = null;
    }

    stopAllBots();

    // Save in-memory match state so a restart can resume it.
    if (typeof gameSocketModule.persistAllState === "function") {
        try {
            await Promise.race([
                gameSocketModule.persistAllState(),
                new Promise(resolve => setTimeout(resolve, 5000))
            ]);
        } catch (error) {
            console.error("State save on shutdown failed:", error.message);
        }
    }

    io.close(() => {

        server.close(() => {

            console.log(
                `${GAME_NAME} server closed successfully`
            );

            process.exit(0);
        });
    });

    setTimeout(() => {
        console.error("Forced server shutdown");
        process.exit(1);
    }, 10000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ==========================================
// UNEXPECTED ERRORS
// ==========================================
// Log anything that escaped a try/catch with a clear tag so
// log monitoring can alert on it. An uncaught exception
// leaves the process in an unknown state, so shut down and
// let the process manager restart it.

process.on("unhandledRejection", reason => {
    console.error(
        "UNHANDLED REJECTION:",
        reason instanceof Error ? reason.stack : reason
    );
    reportError("Unhandled rejection", reason);
});

process.on("uncaughtException", error => {
    console.error("UNCAUGHT EXCEPTION:", error.stack || error);

    // Give the report a moment to send before shutting down.
    Promise.race([
        reportError("Uncaught exception", error),
        new Promise(resolve => setTimeout(resolve, 3000))
    ]).finally(() => shutdown("uncaughtException"));
});
