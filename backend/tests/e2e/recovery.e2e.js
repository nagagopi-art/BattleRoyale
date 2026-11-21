// ==========================================
// END-TO-END CRASH RECOVERY TEST (two phases)
// ==========================================
// Phase "setup": starts a 2-player match, changes in-memory
// state (loadout, shots, bandages, gloo wall), waits for a
// snapshot, then exits leaving the match running.
// Restart the server, then phase "verify": rejoin and check
// the state came back; also checks leaving a match (item 57);
// deletes everything it created.
//
// Requires database/migrations/001_match_state_snapshots.sql.
// WRITES TO THE REAL DATABASE (2 test accounts + 1 match).
//
//   PORT=5055 ENABLE_DEV_TEST_EVENTS=true node server.js
//   node tests/e2e/recovery.e2e.js setup 5055
//   (stop and start the server again)
//   node tests/e2e/recovery.e2e.js verify 5055

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createRequire } = require("module");

const BACKEND = path.resolve(__dirname, "..", "..");
const PHASE = process.argv[2];
const PORT = process.argv[3] || "5055";
const BASE = `http://localhost:${PORT}`;
const STATE_FILE = path.join(os.tmpdir(), "bbf-recovery-test.json");
const req = createRequire(path.join(BACKEND, "package.json"));

process.chdir(BACKEND);
req("dotenv").config({ quiet: true });
const { io } = req("socket.io-client");
const { supabaseAdmin } = req("./config/supabase");

let failures = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function check(name, ok, detail = "") {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
    if (!ok) failures++;
}

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

function waitFor(socket, event, timeoutMs = 8000, predicate = () => true) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off(event, handler);
            reject(new Error(`timeout waiting for ${event}`));
        }, timeoutMs);
        function handler(data) {
            if (!predicate(data)) return;
            clearTimeout(timer);
            socket.off(event, handler);
            resolve(data);
        }
        socket.on(event, handler);
    });
}

function connect(token) {
    return new Promise((resolve, reject) => {
        const s = io(BASE, { auth: { token }, transports: ["websocket"], reconnection: false });
        s.once("connect", () => resolve(s));
        s.once("connect_error", reject);
    });
}

async function joinMatch(token, matchId) {
    const s = await connect(token);
    const joined = waitFor(s, "joined-match");
    s.emit("join-match", { matchId });
    return { s, joined: await joined };
}

// ---------------- SETUP ----------------
async function setup() {
    const RUN = Date.now().toString(36);
    const PASSWORD = "E2e-" + Math.random().toString(36).slice(2) + "-Aa1";
    const state = { players: [], matchId: null };

    for (const n of [1, 2]) {
        const username = `bbf_rec${n}_${RUN}`.slice(0, 20);
        const email = `bbf.rec${n}.${RUN}@example.com`;
        const reg = await api("POST", "/api/auth/register", null, { username, email, password: PASSWORD });
        if (reg.status !== 201) throw new Error("register failed");

        const { data: row } = await supabaseAdmin.from("players").select("auth_user_id").eq("id", reg.json.player.id).single();
        const login = await api("POST", "/api/auth/login", null, { email, password: PASSWORD });

        state.players.push({
            id: reg.json.player.id,
            authUserId: row.auth_user_id,
            token: login.json.access_token
        });
        fs.writeFileSync(STATE_FILE, JSON.stringify(state));
    }

    const [p1, p2] = state.players;

    const create = await api("POST", "/api/matches/create", p1.token, { map_name: "E2E Recovery", game_mode: "solo" });
    state.matchId = create.json.match.id;
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));

    await api("POST", `/api/matches/join/${state.matchId}`, p2.token);
    await api("POST", `/api/matches/${state.matchId}/start`, p1.token);

    const t0 = Date.now();
    while (Date.now() - t0 < 180000) {
        const { data } = await supabaseAdmin.from("matches").select("status, battlefield_status").eq("id", state.matchId).single();
        if (data?.status === "in_progress" && data?.battlefield_status === "active") break;
        await sleep(1000);
    }

    const a = await joinMatch(p1.token, state.matchId);
    const b = await joinMatch(p2.token, state.matchId);
    const pos1 = a.joined.playerPositions.find(p => Number(p.playerId) === Number(p1.id)).position;

    // Loadout + attachment + bandages for p1.
    for (const payload of [
        { weaponId: "vajra", ammoId: "rifle_ammo", ammoQuantity: 90 },
        { attachmentId: "extended_mag" },
        { healingItemId: "bandage", healingQuantity: 4 }
    ]) {
        const r = waitFor(a.s, "dev-combat-test-ready");
        a.s.emit("dev-prepare-combat-test", payload);
        await r;
    }

    const eq = waitFor(a.s, "weapon-equipped");
    a.s.emit("equip-weapon", { weaponId: "vajra" });
    await eq;

    // Fire 3 shots into the air near p2 (misses are fine).
    for (let i = 0; i < 3; i++) {
        await sleep(200);
        const shot = waitFor(a.s, "shot-fired", 4000).catch(() => null);
        a.s.emit("fire-weapon", { targetId: p2.id, direction: { x: 0, y: 1, z: 0 } });
        await shot;
    }

    // p2 places a gloo wall next to themselves.
    const pos2 = b.joined.playerPositions.find(p => Number(p.playerId) === Number(p2.id)).position;
    const wall = waitFor(b.s, "gloo-wall-deployed");
    b.s.emit("deploy-gloo-wall", { position: { x: pos2.x + 3, y: pos2.y, z: pos2.z }, facing: 45 });
    await wall;

    // Expected state.
    const inv = waitFor(a.s, "inventory-data");
    a.s.emit("get-inventory");
    const inventory = (await inv).inventory;

    const cs = waitFor(a.s, "combat-state-data");
    a.s.emit("combat-state");
    const combat = (await cs).combat;

    const zs = waitFor(a.s, "zone-update");
    a.s.emit("get-zone-state");
    const zone = await zs;

    state.expected = {
        magazine: combat.weapons.vajra.magazineAmmo,
        reserveAmmo: inventory.ammunition.rifle_ammo,
        bandages: inventory.healing.bandage,
        attachment: inventory.weapons.find(w => w.weaponId === "vajra").attachments.magazine,
        zoneShrinkStartsAt: zone.shrinkStartsAt,
        zonePhase: zone.phase,
        position: pos1
    };

    // Wait for the 10-second snapshot loop.
    await sleep(12000);

    const { data: snap } = await supabaseAdmin.from("match_state_snapshots")
        .select("updated_at").eq("match_id", state.matchId).maybeSingle();
    check("snapshot saved to the database", !!snap, snap?.updated_at);

    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
    console.log("Setup done. Expected:", JSON.stringify(state.expected));

    a.s.close();
    b.s.close();
}

// ---------------- VERIFY ----------------
async function verify() {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    const [p1, p2] = state.players;
    const e = state.expected;

    try {
        const a = await joinMatch(p1.token, state.matchId);

        const inv = waitFor(a.s, "inventory-data");
        a.s.emit("get-inventory");
        const inventory = (await inv).inventory;

        check("weapon + attachment restored", inventory?.weapons?.find(w => w.weaponId === "vajra")?.attachments?.magazine === e.attachment);
        check("reserve ammo restored", inventory?.ammunition?.rifle_ammo === e.reserveAmmo, `${inventory?.ammunition?.rifle_ammo} / expected ${e.reserveAmmo}`);
        check("bandages restored", inventory?.healing?.bandage === e.bandages, `${inventory?.healing?.bandage} / expected ${e.bandages}`);

        const cs = waitFor(a.s, "combat-state-data");
        a.s.emit("combat-state");
        const combat = (await cs).combat;
        check("loaded magazine restored", combat?.weapons?.vajra?.magazineAmmo === e.magazine, `${combat?.weapons?.vajra?.magazineAmmo} / expected ${e.magazine}`);

        const zs = waitFor(a.s, "zone-update");
        a.s.emit("get-zone-state");
        const zone = await zs;
        check("safe zone continues on the same schedule", zone.shrinkStartsAt === e.zoneShrinkStartsAt, `phase ${zone.phase}`);

        const walls = waitFor(a.s, "gloo-walls-state");
        a.s.emit("get-gloo-walls");
        const w = await walls;
        check("gloo wall restored", w.length === 1 && w[0].facing === 45, `${w.length} wall(s)`);

        // ---------- 57: leaving mid-match ----------
        const b = await joinMatch(p2.token, state.matchId);
        const left = waitFor(b.s, "left-match", 8000).catch(() => null);
        const seen = waitFor(a.s, "player-left", 8000).catch(() => null);
        b.s.emit("leave-match");
        const l = await left;
        const s = await seen;
        check("player can leave mid-match", !!l && !!s, l ? JSON.stringify(l).slice(0, 80) : "no left-match event");

        a.s.close();
        b.s.close();
    } finally {
        await cleanup(state);
    }
}

async function cleanup(state) {
    if (state.matchId) {
        await supabaseAdmin.from("match_state_snapshots").delete().eq("match_id", state.matchId);
        await supabaseAdmin.from("player_match_results").delete().eq("match_id", state.matchId);
        await supabaseAdmin.from("match_players").delete().eq("match_id", state.matchId);
        await supabaseAdmin.from("matches").delete().eq("id", state.matchId);
    }
    const ids = state.players.map(p => p.id);
    if (ids.length) await supabaseAdmin.from("players").delete().in("id", ids);
    for (const p of state.players) await supabaseAdmin.auth.admin.deleteUser(p.authUserId);
    fs.rmSync(STATE_FILE, { force: true });
    console.log("Cleanup done.");
}

const run = PHASE === "setup" ? setup : PHASE === "verify" ? verify : PHASE === "cleanup"
    ? async () => cleanup(JSON.parse(fs.readFileSync(STATE_FILE, "utf8")))
    : null;

if (!run) {
    console.log("Usage: node tests/e2e/recovery.e2e.js setup|verify|cleanup [port]");
    process.exit(1);
}

run()
    .catch(err => { failures++; console.log("ABORTED:", err.message); })
    .finally(() => {
        console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " FAILURE(S)"}`);
        process.exit(failures === 0 ? 0 : 1);
    });
