// ==========================================
// END-TO-END COVER TEST (BUILDINGS)
// ==========================================
// A is outside a house's solid east wall, B is inside.
// Checks: layout API, bullets blocked by the wall, B cannot
// walk through it, B is hidden from A, a grenade outside does
// not hurt B.
//
// WRITES TO THE REAL DATABASE (2 test accounts + 1 match),
// deleted at the end.
//
//   PORT=5055 ENABLE_DEV_TEST_EVENTS=true node server.js
//   node tests/e2e/cover.e2e.js 5055

const path = require("path");
const { createRequire } = require("module");

const BACKEND = path.resolve(__dirname, "..", "..");
const PORT = process.argv[2] || "5055";
const BASE = `http://localhost:${PORT}`;
const req = createRequire(path.join(BACKEND, "package.json"));

process.chdir(BACKEND);
req("dotenv").config({ quiet: true });
const { io } = req("socket.io-client");
const { supabaseAdmin } = req("./config/supabase");
const { getLayout } = req("./config/mapLayout");

const MAP = "E2E Cover";
const RUN = Date.now().toString(36);
const PASSWORD = "E2e-" + Math.random().toString(36).slice(2) + "-Aa1";
const created = { authUserIds: [], playerIds: [], matchId: null };
let failures = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function check(name, ok, detail = "") {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
    if (!ok) failures++;
}

async function api(method, url, token, body) {
    const res = await fetch(BASE + url, {
        method,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, json: await res.json().catch(() => null) };
}

function waitFor(socket, event, timeoutMs = 8000, predicate = () => true) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { socket.off(event, handler); reject(new Error(`timeout waiting for ${event}`)); }, timeoutMs);
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

async function main() {
    // A house whose east wall is solid (doorway elsewhere).
    const layout = getLayout(MAP);
    const house = layout.buildings.find(b => b.doorSide !== "east" && b.max.x - b.min.x >= 9);
    if (!house) throw new Error("no suitable house");

    const midZ = (house.min.z + house.max.z) / 2;
    const midX = (house.min.x + house.max.x) / 2;
    const outside = { x: house.max.x + 3, y: 5, z: midZ };
    const inside = { x: midX, y: 5, z: midZ };

    const P = [];
    for (const n of [1, 2]) {
        const username = `bbf_cov${n}_${RUN}`.slice(0, 20);
        const email = `bbf.cov${n}.${RUN}@example.com`;
        const reg = await api("POST", "/api/auth/register", null, { username, email, password: PASSWORD });
        if (reg.status !== 201) throw new Error("register failed");
        created.playerIds.push(reg.json.player.id);
        const { data: row } = await supabaseAdmin.from("players").select("auth_user_id").eq("id", reg.json.player.id).single();
        created.authUserIds.push(row.auth_user_id);
        const login = await api("POST", "/api/auth/login", null, { email, password: PASSWORD });
        P.push({ id: login.json.player.id, token: login.json.access_token });
    }
    const [A, B] = P;

    const create = await api("POST", "/api/matches/create", A.token, { map_name: MAP, game_mode: "solo" });
    created.matchId = create.json.match.id;
    await api("POST", `/api/matches/join/${created.matchId}`, B.token);

    // ---------- layout API ----------
    const lay = await api("GET", `/api/matches/${created.matchId}/layout`);
    check(
        "layout API returns this map's buildings",
        lay.status === 200 && lay.json.layout.mapName === MAP && lay.json.layout.buildings.length === layout.buildings.length,
        `${lay.json?.layout?.buildings?.length} buildings, ${lay.json?.layout?.obstacles?.length} obstacles`
    );

    await api("POST", `/api/matches/${created.matchId}/start`, A.token);
    const t0 = Date.now();
    while (Date.now() - t0 < 180000) {
        const { data } = await supabaseAdmin.from("matches").select("status, battlefield_status").eq("id", created.matchId).single();
        if (data?.status === "in_progress" && data?.battlefield_status === "active") break;
        await sleep(1000);
    }

    for (const p of P) {
        p.s = await connect(p.token);
        const j = waitFor(p.s, "joined-match");
        p.s.emit("join-match", { matchId: created.matchId });
        await j;
    }

    const teleport = async (p, position) => {
        const done = waitFor(p.s, "dev-teleported");
        p.s.emit("dev-teleport", { position });
        await done;
    };

    await teleport(A, outside);
    await teleport(B, inside);

    const prep = async (p, payload) => {
        const r = waitFor(p.s, "dev-combat-test-ready");
        p.s.emit("dev-prepare-combat-test", payload);
        await r;
    };
    await prep(A, { weaponId: "vajra", ammoId: "rifle_ammo", ammoQuantity: 60 });
    const eq = waitFor(A.s, "weapon-equipped");
    A.s.emit("equip-weapon", { weaponId: "vajra" });
    await eq;

    // ---------- bullets ----------
    const shot = waitFor(A.s, "shot-fired");
    A.s.emit("fire-weapon", {
        targetId: B.id,
        direction: { x: inside.x - outside.x, y: 1.05 - 1.5, z: 0 }
    });
    const s1 = await shot;
    check("bullet through the house wall is blocked", s1.blocked === true && s1.hit === false, `wall ${s1.wallId}`);

    // ---------- visibility ----------
    const seen = waitFor(A.s, "player-moved", 4000, m => Number(m.playerId) === Number(B.id)).catch(() => null);
    const moveB = waitFor(B.s, "player-move-ack");
    B.s.emit("player-move", { position: { x: inside.x, y: 5, z: inside.z + 0.5 } });
    await moveB;
    const m = await seen;
    check("player inside is hidden from player outside", m && m.hidden === true && m.position === null, m ? `hidden=${m.hidden}` : "no update");

    // ---------- walking through the wall ----------
    await teleport(B, { x: house.max.x - 1.2, y: 5, z: midZ });
    await sleep(80);
    const through = waitFor(B.s, "player-move-ack");
    B.s.emit("player-move", { position: { x: house.max.x + 0.4, y: 5, z: midZ } });
    const ack = await through;
    check("cannot walk through the wall", ack.success === false && /Blocked/.test(ack.message), ack.message);

    await teleport(B, inside);

    // ---------- grenade outside ----------
    let bDamaged = false;
    B.s.on("player-damaged", () => { bDamaged = true; });
    const exploded = waitFor(A.s, "grenade-exploded", 8000);
    A.s.emit("throw-grenade", { type: "frag", target: { x: house.max.x + 1.2, y: 5, z: midZ } });
    await exploded;
    await sleep(800);
    check("grenade outside does not hurt the player inside", !bDamaged);

    for (const p of P) p.s.close();
}

async function cleanup() {
    if (created.matchId) {
        await supabaseAdmin.from("match_state_snapshots").delete().eq("match_id", created.matchId);
        await supabaseAdmin.from("match_players").delete().eq("match_id", created.matchId);
        await supabaseAdmin.from("matches").delete().eq("id", created.matchId);
    }
    if (created.playerIds.length) await supabaseAdmin.from("players").delete().in("id", created.playerIds);
    for (const id of created.authUserIds) await supabaseAdmin.auth.admin.deleteUser(id);
    console.log("\nCleanup done.");
}

main()
    .catch(e => { failures++; console.log("ABORTED:", e.message); })
    .finally(async () => {
        try { await cleanup(); } catch (e) { console.log("CLEANUP ERROR:", e.message); }
        console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " FAILURE(S)"}`);
        process.exit(failures === 0 ? 0 : 1);
    });
