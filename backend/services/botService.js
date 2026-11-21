// ==========================================
// INDIAN BATTLE FIELDS
// BOTS (FILL QUICK MATCHES)
// ==========================================
// Bots are real player accounts (usernames "bot_...") that
// the server drives over an ordinary Socket.IO connection to
// itself. They go through exactly the same handlers as
// humans (validation, speed limits, armor, persistence), so
// no game rule is duplicated or bypassed.
//
// Enable with BOTS_ENABLED=true. BOT_FILL_TARGET sets how
// many players a quick match is filled up to (default 8).

const crypto = require("crypto");
const { io: ioClient } = require("socket.io-client");
const { createClient } = require("@supabase/supabase-js");
const { supabaseAdmin } = require("../config/supabase");

// Separate auth client per bot login, so bot sessions never
// touch the shared client used by the login routes.
function newAuthClient() {
    return createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_PUBLISHABLE_KEY,
        { auth: { persistSession: false, autoRefreshToken: false } }
    );
}

const BOT_CONFIG = {
    enabled: process.env.BOTS_ENABLED === "true",
    fillTarget: Math.min(150, Math.max(2, Number(process.env.BOT_FILL_TARGET) || 8)),
    poolSize: 60,
    tickMs: 250,
    // 2.2 units per 250ms = 8.8 units/s (under the 12/s limit).
    moveStep: 2.2,
    descendStep: 150,
    engageRange: 80,
    // Extra aim error on top of the server's weapon spread.
    aimErrorDegrees: 4,
    fireIntervalMs: 400,
    startAircraftAfterMs: 10000
};

const BOT_NAMES = [
    "arjun", "bheem", "chitra", "dhruv", "eshan", "farhan", "gauri", "hari",
    "isha", "jai", "kabir", "lakshmi", "manav", "nila", "om", "priya",
    "rana", "sita", "tara", "uday", "varun", "yash", "zoya", "aditi",
    "bala", "devika", "ganga", "indra", "kiran", "meera"
];

// ---------- accounts ----------

function botPassword(username) {
    return (
        "Bot-" +
        crypto
            .createHmac("sha256", process.env.SUPABASE_SECRET_KEY || "bbf-bots")
            .update(username)
            .digest("hex")
            .slice(0, 24) +
        "-Aa1"
    );
}

function botEmail(username) {
    return `${username}@bots.example.com`;
}

let botCache = null;

async function loadBots() {
    const { data, error } = await supabaseAdmin
        .from("players")
        .select("id, username")
        .like("username", "bot\\_%");

    if (error) throw error;

    botCache = data || [];
    return botCache;
}

async function createBot(username) {
    const { data: auth, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: botEmail(username),
        password: botPassword(username),
        email_confirm: true
    });

    if (authError) throw authError;

    const { data: player, error } = await supabaseAdmin
        .from("players")
        .insert({
            auth_user_id: auth.user.id,
            player_uid: `BOT-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
            username,
            email: botEmail(username),
            password_hash: null,
            level: 1,
            experience: 0,
            coins: 0
        })
        .select("id, username")
        .single();

    if (error) {
        await supabaseAdmin.auth.admin.deleteUser(auth.user.id);
        throw error;
    }

    return player;
}

// Make sure at least `count` bot accounts exist.
async function ensureBotAccounts(count) {
    const bots = botCache || (await loadBots());
    const taken = new Set(bots.map(b => b.username));

    for (let i = 0; bots.length < count && i < count * 3; i++) {
        const base = BOT_NAMES[i % BOT_NAMES.length];
        const username = `bot_${base}${Math.floor(i / BOT_NAMES.length) || ""}`.slice(0, 20);

        if (taken.has(username)) continue;

        try {
            bots.push(await createBot(username));
            taken.add(username);
        } catch (error) {
            console.error("Bot account creation failed:", username, error.message);
        }
    }

    return bots;
}

// ---------- filling matches ----------

const busyBots = new Set();       // bot player ids in a match
const controllers = new Map();    // bot id -> controller

async function fillMatchWithBots(matchId, count, port) {
    if (!BOT_CONFIG.enabled || count <= 0) return 0;

    // Only create as many accounts as are needed right now.
    const pool = await ensureBotAccounts(
        Math.min(BOT_CONFIG.poolSize, busyBots.size + count)
    );
    const idle = pool.filter(b => !busyBots.has(b.id));
    let added = 0;

    for (const bot of idle.slice(0, count)) {
        const { data, error } = await supabaseAdmin.rpc("join_match", {
            p_match_id: matchId,
            p_player_id: bot.id
        });

        if (error || data?.status !== "success") continue;

        busyBots.add(bot.id);
        added++;

        startBotController(bot, matchId, port).catch(err => {
            console.error("Bot controller failed:", bot.username, err.message);
            busyBots.delete(bot.id);
        });
    }

    if (added > 0) {
        console.log(`BOTS: added ${added} bot(s) to match ${matchId}`);
    }

    return added;
}

// ---------- behaviour ----------

function aimWithError(from, to, errorDegrees) {
    const d = {
        x: to.x - from.x,
        y: to.y + 1.05 - (from.y + 1.5),
        z: to.z - from.z
    };

    const yaw = ((Math.random() * 2 - 1) * errorDegrees * Math.PI) / 180;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);

    return {
        x: d.x * cos - d.z * sin,
        y: d.y + (Math.random() * 2 - 1) * 0.05 * Math.hypot(d.x, d.z),
        z: d.x * sin + d.z * cos
    };
}

async function startBotController(bot, matchId, port) {
    const { data: session, error } = await newAuthClient().auth.signInWithPassword({
        email: botEmail(bot.username),
        password: botPassword(bot.username)
    });

    if (error || !session?.session) {
        throw new Error("bot login failed: " + (error?.message || "no session"));
    }

    const socket = ioClient(`http://127.0.0.1:${port}`, {
        auth: { token: session.session.access_token },
        transports: ["websocket"],
        reconnection: true,
        reconnectionAttempts: 5
    });

    const state = {
        id: Number(bot.id),
        team: null,
        teams: new Map(),        // playerId -> team
        others: new Map(),       // playerId -> { pos, hidden }
        pos: null,
        matchLive: false,
        liveSince: 0,
        aircraft: false,
        jumped: false,
        dropping: false,
        parachute: false,
        landed: false,
        zoneTarget: null,
        lastFire: 0,
        reloading: false,
        equipped: false,
        stopped: false,
        lastAccepted: null,
        detourDir: null,
        detourUntil: 0
    };

    const stop = () => {
        if (state.stopped) return;
        state.stopped = true;
        clearInterval(timer);
        socket.close();
        busyBots.delete(bot.id);
        controllers.delete(bot.id);
    };

    controllers.set(bot.id, { stop });

    socket.on("connect", () => socket.emit("join-match", { matchId }));

    socket.on("joined-match", jm => {
        for (const m of jm.members || []) {
            state.teams.set(Number(m.player_id), m.team_number);
        }
        state.team = state.teams.get(state.id);

        for (const p of jm.playerPositions || []) {
            if (Number(p.playerId) === state.id) state.pos = { ...p.position };
            else state.others.set(Number(p.playerId), { pos: p.position, hidden: false });
        }

        if (jm.matchStatus === "in_progress") {
            if (!state.matchLive) state.liveSince = Date.now();
            state.matchLive = true;

            if (!state.equipped) {
                socket.emit("get-inventory");
            }
        }
    });

    // Refresh positions and teams once the battlefield exists.
    socket.on("match-started", () => socket.emit("join-match", { matchId }));

    socket.on("inventory-data", ({ inventory }) => {
        const weapon = inventory?.weapons?.[0];
        if (weapon && !state.equipped) {
            socket.emit("equip-weapon", { weaponId: weapon.weaponId });
        }
    });

    socket.on("weapon-equipped", () => { state.equipped = true; });

    socket.on("aircraft-started", flight => {
        state.aircraft = true;
        const progress = 0.2 + Math.random() * 0.6;

        setTimeout(() => {
            if (!state.stopped && !state.jumped) {
                socket.emit("jump-from-aircraft", { progress });
            }
        }, flight.flightDurationMs * progress);
    });

    socket.on("jump-started", j => {
        state.jumped = true;
        state.dropping = true;
        state.pos = { ...j.position };
    });

    socket.on("player-drop-position", d => {
        if (Number(d.playerId) !== state.id) return;
        state.pos = { ...d.position };
        if (d.state === "landed") {
            state.dropping = false;
            state.landed = true;
        }
    });

    socket.on("player-moved", m => {
        state.others.set(Number(m.playerId), {
            pos: m.position || state.others.get(Number(m.playerId))?.pos,
            hidden: Boolean(m.hidden)
        });
    });

    socket.on("zone-update", z => {
        state.zoneTarget = z.next?.center || z.current?.center || null;
    });

    socket.on("player-eliminated", e => {
        if (Number(e.victimId) === state.id) stop();
        else state.others.delete(Number(e.victimId));
    });

    socket.on("game-error", e => {
        if (/Magazine empty/.test(e.message) && !state.reloading) {
            state.reloading = true;
            socket.emit("reload-weapon");
        }
        if (/This match has ended|not a member/.test(e.message)) stop();
    });

    socket.on("reload-completed", () => { state.reloading = false; });

    // Walked into a wall / rock / building: go back to the last
    // accepted spot and sidestep for a moment.
    socket.on("player-move-ack", ack => {
        if (ack.success) {
            state.lastAccepted = { ...ack.position };
            return;
        }

        if (state.lastAccepted) state.pos = { ...state.lastAccepted };

        if (/Blocked/.test(ack.message || "")) {
            const angle = Math.random() * Math.PI * 2;
            state.detourDir = { x: Math.cos(angle), z: Math.sin(angle) };
            state.detourUntil = Date.now() + 1500;
        }
    });
    socket.on("match-completed", stop);
    socket.on("match-cancelled", stop);
    socket.on("disconnect", reason => {
        if (reason === "io server disconnect") stop();
    });

    const timer = setInterval(() => {
        if (state.stopped || !state.matchLive || !state.pos) return;

        const now = Date.now();

        // Nobody started the aircraft: a bot does it.
        if (!state.aircraft && now - state.liveSince > BOT_CONFIG.startAircraftAfterMs) {
            state.aircraft = true;
            socket.emit("start-aircraft-drop");
            return;
        }

        // ----- parachute descent -----
        if (state.dropping) {
            const next = { ...state.pos, y: Math.max(5, state.pos.y - BOT_CONFIG.descendStep) };

            if (!state.parachute && next.y <= 500) {
                state.parachute = true;
                socket.emit("deploy-parachute");
            }

            socket.emit("drop-position-update", { position: next });
            return;
        }

        if (!state.landed) return;

        // ----- fight the nearest visible enemy -----
        let target = null;
        let targetDistance = Infinity;

        for (const [id, other] of state.others) {
            if (!other.pos || other.hidden) continue;
            if (state.team !== null && state.teams.get(id) === state.team) continue;

            const d = Math.hypot(other.pos.x - state.pos.x, other.pos.z - state.pos.z);
            if (d < targetDistance) {
                target = { id, pos: other.pos };
                targetDistance = d;
            }
        }

        if (
            target &&
            targetDistance <= BOT_CONFIG.engageRange &&
            state.equipped &&
            !state.reloading &&
            now - state.lastFire >= BOT_CONFIG.fireIntervalMs
        ) {
            state.lastFire = now;
            socket.emit("fire-weapon", {
                targetId: target.id,
                direction: aimWithError(state.pos, target.pos, BOT_CONFIG.aimErrorDegrees)
            });
        }

        // ----- move toward the safe zone (or wander) -----
        // While detouring around an obstacle, walk sideways.
        const detouring = now < state.detourUntil && state.detourDir;

        const goal = detouring
            ? { x: state.pos.x + state.detourDir.x * 10, z: state.pos.z + state.detourDir.z * 10 }
            : state.zoneTarget && Math.hypot(state.zoneTarget.x - state.pos.x, state.zoneTarget.z - state.pos.z) > 15
                ? state.zoneTarget
                : { x: state.pos.x + (Math.random() - 0.5) * 20, z: state.pos.z + (Math.random() - 0.5) * 20 };

        const dx = goal.x - state.pos.x;
        const dz = goal.z - state.pos.z;
        const len = Math.hypot(dx, dz) || 1;
        const step = Math.min(BOT_CONFIG.moveStep, len);

        const next = {
            x: Math.max(-995, Math.min(995, state.pos.x + (dx / len) * step)),
            y: state.pos.y,
            z: Math.max(-995, Math.min(995, state.pos.z + (dz / len) * step))
        };

        state.pos = next;
        socket.emit("player-move", { position: next });
    }, BOT_CONFIG.tickMs);
}

function isBotUsername(username) {
    return /^bot_/i.test(String(username || ""));
}

function stopAllBots() {
    for (const controller of controllers.values()) controller.stop();
}

module.exports = {
    BOT_CONFIG,
    isBotUsername,
    ensureBotAccounts,
    fillMatchWithBots,
    stopAllBots
};
