// ==========================================
// LOAD TEST: MANY PLAYERS IN ONE MATCH
// ==========================================
// Creates N test players, puts them in one match, starts it,
// then has every player move (10/s) and fire (2/s) for a
// while. Reports movement acknowledgement latency.
//
// WRITES TO THE REAL DATABASE (N test accounts + 1 match)
// and deletes everything it created at the end.
//
// Start the server with dev events enabled:
//   PORT=5055 ENABLE_DEV_TEST_EVENTS=true node server.js
// Then run (players, seconds, port):
//   node tests/load/load-test.js 20 60 5055

const path = require("path");
const { createRequire } = require("module");

const BACKEND = path.resolve(__dirname, "..", "..");
const req = createRequire(path.join(BACKEND, "package.json"));

process.chdir(BACKEND);
req("dotenv").config({ quiet: true });

const { io } = req("socket.io-client");
const { supabaseAdmin } = req("./config/supabase");

const PLAYERS = Math.max(2, Number(process.argv[2]) || 20);
const SECONDS = Math.max(10, Number(process.argv[3]) || 60);
const PORT = process.argv[4] || "5055";
const BASE = `http://localhost:${PORT}`;

const RUN = Date.now().toString(36);
const PASSWORD = "Load-" + Math.random().toString(36).slice(2) + "-Aa1";

const created = { authUserIds: [], playerIds: [], matchId: null };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(method, url, token, body) {
    const res = await fetch(BASE + url, {
        method,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, json: await res.json().catch(() => null) };
}

function percentile(values, p) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function main() {
    console.log(`Load test: ${PLAYERS} players for ${SECONDS}s on ${BASE}`);

    // ---------- accounts ----------
    const players = [];

    for (let i = 0; i < PLAYERS; i++) {
        const username = `bbf_load${i}_${RUN}`.slice(0, 20);
        const email = `bbf.load${i}.${RUN}@example.com`;

        const reg = await api("POST", "/api/auth/register", null, { username, email, password: PASSWORD });
        if (reg.status !== 201) throw new Error(`register ${i}: HTTP ${reg.status}`);

        created.playerIds.push(reg.json.player.id);

        const { data: row } = await supabaseAdmin
            .from("players").select("auth_user_id").eq("id", reg.json.player.id).single();
        created.authUserIds.push(row.auth_user_id);

        const login = await api("POST", "/api/auth/login", null, { email, password: PASSWORD });
        if (login.status !== 200) throw new Error(`login ${i}: HTTP ${login.status}`);

        players.push({ id: login.json.player.id, token: login.json.access_token });
    }

    // ---------- match ----------
    const create = await api("POST", "/api/matches/create", players[0].token, {
        map_name: "Load Test Map",
        game_mode: "solo"
    });
    if (create.status !== 201) throw new Error("create match failed");

    const matchId = create.json.match.id;
    created.matchId = matchId;

    for (const p of players.slice(1)) {
        const join = await api("POST", `/api/matches/join/${matchId}`, p.token);
        if (join.status !== 200) throw new Error("join failed");
    }

    const start = await api("POST", `/api/matches/${matchId}/start`, players[0].token);
    if (start.status !== 200) throw new Error("start failed");

    console.log("Waiting for countdown...");

    const t0 = Date.now();
    while (Date.now() - t0 < 180000) {
        const { data } = await supabaseAdmin
            .from("matches").select("status, battlefield_status").eq("id", matchId).single();
        if (data?.status === "in_progress" && data?.battlefield_status === "active") break;
        await sleep(1000);
    }

    // ---------- connect + join ----------
    for (const p of players) {
        p.socket = io(BASE, { auth: { token: p.token }, transports: ["websocket"], reconnection: false });
        await new Promise((resolve, reject) => {
            p.socket.once("connect", resolve);
            p.socket.once("connect_error", reject);
        });

        const joined = new Promise(resolve => p.socket.once("joined-match", resolve));
        p.socket.emit("join-match", { matchId });
        const jm = await joined;
        p.position = jm.playerPositions.find(x => Number(x.playerId) === Number(p.id))?.position;

        // Everyone gets a rifle so firing generates real work.
        p.socket.emit("dev-prepare-combat-test", { weaponId: "vajra", ammoId: "rifle_ammo", ammoQuantity: 200 });
        p.socket.emit("equip-weapon", { weaponId: "vajra" });
    }

    // ---------- traffic ----------
    const latencies = [];
    let moves = 0, rejected = 0, shots = 0;
    const stopAt = Date.now() + SECONDS * 1000;

    for (const p of players) {
        p.socket.on("player-move-ack", ack => {
            if (p.pendingMoveAt) latencies.push(Date.now() - p.pendingMoveAt);
            p.pendingMoveAt = null;
            if (!ack.success) rejected++;
        });

        // Move ~1 unit every 100ms (10 units/s, under the limit).
        p.moveTimer = setInterval(() => {
            if (Date.now() > stopAt || !p.position) return;
            const angle = Math.random() * Math.PI * 2;
            p.position = {
                x: Math.max(-990, Math.min(990, p.position.x + Math.cos(angle))),
                y: p.position.y,
                z: Math.max(-990, Math.min(990, p.position.z + Math.sin(angle)))
            };
            p.pendingMoveAt = Date.now();
            p.socket.emit("player-move", { position: p.position });
            moves++;
        }, 100);

        // Fire at a random other player twice a second.
        p.fireTimer = setInterval(() => {
            if (Date.now() > stopAt) return;
            const target = players[Math.floor(Math.random() * players.length)];
            if (target === p || !target.position || !p.position) return;
            p.socket.emit("fire-weapon", {
                targetId: target.id,
                direction: {
                    x: target.position.x - p.position.x,
                    y: target.position.y - p.position.y,
                    z: target.position.z - p.position.z
                }
            });
            shots++;
        }, 500);
    }

    await sleep(SECONDS * 1000 + 1000);

    for (const p of players) {
        clearInterval(p.moveTimer);
        clearInterval(p.fireTimer);
        p.socket.close();
    }

    console.log("\nRESULTS");
    console.log(`  movement events sent: ${moves} (${Math.round(moves / SECONDS)}/s)`);
    console.log(`  movement rejected:    ${rejected}`);
    console.log(`  shots fired:          ${shots}`);
    console.log(`  move ack latency ms:  p50 ${percentile(latencies, 50)}  p95 ${percentile(latencies, 95)}  p99 ${percentile(latencies, 99)}`);
}

async function cleanup() {
    if (created.matchId) {
        await supabaseAdmin.from("player_match_results").delete().eq("match_id", created.matchId);
        await supabaseAdmin.from("match_players").delete().eq("match_id", created.matchId);
        await supabaseAdmin.from("matches").delete().eq("id", created.matchId);
    }
    if (created.playerIds.length) {
        await supabaseAdmin.from("players").delete().in("id", created.playerIds);
    }
    for (const id of created.authUserIds) {
        await supabaseAdmin.auth.admin.deleteUser(id);
    }
    console.log("Cleanup done.");
}

main()
    .catch(error => console.error("LOAD TEST ABORTED:", error.message))
    .finally(async () => {
        await cleanup().catch(error => console.error("Cleanup error:", error.message));
        process.exit(0);
    });
