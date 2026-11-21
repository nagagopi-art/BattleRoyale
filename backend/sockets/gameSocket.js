// ==========================================
// INDIAN BATTLE FIELDS - REAL-TIME GAME SERVER
// ==========================================
// Entry point for Socket.IO: authenticates connections,
// starts the background loops (zone, bleed-out, snapshots,
// position saving) and registers the event handlers.
//
//   sockets/game/      shared match state and game logic
//   sockets/handlers/  socket events, one file per feature

const { supabaseAdmin } = require("../config/supabase");
const { createSocketRateLimiter } = require("../services/rateLimiter");

const {
    MOVEMENT_CONFIG,
    SNAPSHOT_INTERVAL_MS,
    setGameIo
} = require("./game/state");
const { emitError } = require("./game/utils");
const { flushDirtyPositions } = require("./game/persistence");
const { processKnockdowns } = require("./game/teams");
const { processSafeZones, startSafeZone } = require("./game/zone");
const { saveAllMatchSnapshots } = require("./game/recovery");

const registerMatchHandlers = require("./handlers/match");
const registerAircraftHandlers = require("./handlers/aircraft");
const registerMovementHandlers = require("./handlers/movement");
const registerItemsHandlers = require("./handlers/items");
const registerEquipmentHandlers = require("./handlers/equipment");
const registerCombatHandlers = require("./handlers/combat");
const registerThrowablesHandlers = require("./handlers/throwables");
const registerHealingHandlers = require("./handlers/healing");
const registerSpectateHandlers = require("./handlers/spectate");
const registerDevHandlers = require("./handlers/dev");
const registerStoreHandlers = require("./handlers/store");

// ==========================================
// INITIALIZE SOCKET SERVER
// ==========================================

function initializeGameSocket(io) {
    console.log("Initializing INDIAN BATTLE FIELDS Socket.IO...");

    setGameIo(io);

    // Safe zone tick: shrink circles and apply zone damage.
    setInterval(() => processSafeZones(io), 1000).unref();

    // Knocked players bleed out.
    setInterval(() => processKnockdowns(io), 1000).unref();

    // Save live match state for crash recovery.
    setInterval(() => saveAllMatchSnapshots(), SNAPSHOT_INTERVAL_MS).unref();

    // Write changed player positions in batches.
    setInterval(
        () => flushDirtyPositions(),
        MOVEMENT_CONFIG.POSITION_FLUSH_MS
    ).unref();

    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth?.token;

            if (!token) {
                return next(new Error("Authentication token required"));
            }

            const { data, error } =
                await supabaseAdmin.auth.getUser(token);

            if (error || !data.user) {
                return next(new Error("Invalid authentication token"));
            }

            const { data: player, error: playerError } =
                await supabaseAdmin
                    .from("players")
                    .select("*")
                    .eq("auth_user_id", data.user.id)
                    .single();

            if (playerError || !player) {
                return next(new Error("Game player profile not found"));
            }

            socket.user = data.user;
            socket.player = player;

            next();
        } catch (error) {
            console.error("Socket authentication error:", error.message);
            next(new Error("Socket authentication failed"));
        }
    });

    io.on("connection", socket => {
        const player = socket.player;
        const playerRoom = `player:${player.id}`;

        socket.join(playerRoom);

        // Drop events that exceed their per-second limit.
        const allowEvent = createSocketRateLimiter();
        let lastLimitWarningAt = 0;

        socket.use(([eventName, payload], next) => {
            // Payloads, when sent, must be plain objects.
            if (
                payload !== undefined &&
                payload !== null &&
                (typeof payload !== "object" || Array.isArray(payload))
            ) {
                return emitError(socket, "Invalid request payload");
            }

            if (allowEvent(eventName)) return next();

            const now = Date.now();

            if (now - lastLimitWarningAt > 1000) {
                lastLimitWarningAt = now;
                socket.emit("rate-limited", {
                    event: eventName,
                    message: "Too many requests. Slow down."
                });
            }
            // Not calling next() drops the event.
        });

        console.log(
            `Player connected: ${player.username} (${player.id})`
        );

        socket.emit("connection-success", {
            success: true,
            message: "Connected to INDIAN BATTLE FIELDS",
            playerId: player.id,
            username: player.username
        });

        // Game events, grouped by feature (sockets/handlers/).
        registerMatchHandlers(io, socket, player);
        registerAircraftHandlers(io, socket, player);
        registerMovementHandlers(io, socket, player);
        registerItemsHandlers(io, socket, player);
        registerEquipmentHandlers(io, socket, player);
        registerCombatHandlers(io, socket, player);
        registerThrowablesHandlers(io, socket, player);
        registerHealingHandlers(io, socket, player);
        registerSpectateHandlers(io, socket, player);
        registerDevHandlers(io, socket, player);
        registerStoreHandlers(io, socket, player);
    });

    console.log(
        "INDIAN BATTLE FIELDS Socket.IO initialized successfully"
    );
}

// Save everything that is only in memory (used on shutdown).
async function persistAllState() {
    await flushDirtyPositions();
    await saveAllMatchSnapshots();
}

module.exports = {
    initializeGameSocket,
    startSafeZone,
    persistAllState
};
