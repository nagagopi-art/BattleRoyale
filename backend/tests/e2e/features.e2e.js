// ==========================================
// END-TO-END FEATURE TEST: 4-PLAYER DUO MATCH
// ==========================================
// Teams by join order: T1 = A, B   T2 = C, D
// Covers: aircraft jump + parachute landing, friendly fire,
// smoke hiding positions, flash, attachments, knockdown and
// its restrictions, revive, reconnect, helmet headshot,
// team wipe, team win, death loot, results API.
//
// WRITES TO THE REAL DATABASE (4 test accounts + 1 match)
// and deletes everything it created at the end.
//
//   PORT=5055 ENABLE_DEV_TEST_EVENTS=true node server.js
//   node tests/e2e/features.e2e.js 5055

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
const { findOpenArea } = require("./helpers");

const RUN = Date.now().toString(36);
const PASSWORD = "E2e-" + Math.random().toString(36).slice(2) + "-Aa1";
const NAMES = ["A", "B", "C", "D"];

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

// Resolves with the next game-error message (or null).
async function nextError(socket, action, ms = 2000) {
    const p = waitFor(socket, "game-error", ms).then(e => e.message).catch(() => null);
    action();
    return p;
}

function connect(token) {
    return new Promise((resolve, reject) => {
        const s = io(BASE, { auth: { token }, transports: ["websocket"], reconnection: false });
        s.once("connect", () => resolve(s));
        s.once("connect_error", reject);
    });
}

const body = p => ({ x: p.x, y: p.y + 1.05, z: p.z });
const head = p => ({ x: p.x, y: p.y + 1.65, z: p.z });
function aim(from, targetPoint) {
    return {
        x: targetPoint.x - from.x,
        y: targetPoint.y - (from.y + 1.5),
        z: targetPoint.z - from.z
    };
}

async function main() {
    // ---------- accounts ----------
    const P = {};

    for (const name of NAMES) {
        const username = `bbf_f${name}_${RUN}`.slice(0, 20);
        const email = `bbf.f${name.toLowerCase()}.${RUN}@example.com`;

        const reg = await api("POST", "/api/auth/register", null, { username, email, password: PASSWORD });
        if (reg.status !== 201) throw new Error(`register ${name}: HTTP ${reg.status}`);
        created.playerIds.push(reg.json.player.id);

        const { data: row } = await supabaseAdmin
            .from("players").select("auth_user_id").eq("id", reg.json.player.id).single();
        created.authUserIds.push(row.auth_user_id);

        const login = await api("POST", "/api/auth/login", null, { email, password: PASSWORD });
        if (login.status !== 200) throw new Error(`login ${name}`);

        P[name] = { id: login.json.player.id, token: login.json.access_token };
    }
    check("4 accounts registered and logged in", true);

    // ---------- duo match ----------
    const create = await api("POST", "/api/matches/create", P.A.token, { map_name: "E2E Duo", game_mode: "duo" });
    if (create.status !== 201) throw new Error("create match failed");
    const matchId = create.json.match.id;
    created.matchId = matchId;

    for (const name of ["B", "C", "D"]) {
        const join = await api("POST", `/api/matches/join/${matchId}`, P[name].token);
        if (join.status !== 200) throw new Error(`join ${name} failed`);
    }

    const start = await api("POST", `/api/matches/${matchId}/start`, P.A.token);
    if (start.status !== 200) throw new Error("start failed");

    const t0 = Date.now();
    while (Date.now() - t0 < 180000) {
        const { data } = await supabaseAdmin.from("matches").select("status, battlefield_status").eq("id", matchId).single();
        if (data?.status === "in_progress" && data?.battlefield_status === "active") break;
        await sleep(1000);
    }

    for (const name of NAMES) {
        P[name].s = await connect(P[name].token);
        const joined = waitFor(P[name].s, "joined-match");
        P[name].s.emit("join-match", { matchId });
        const jm = await joined;
        P[name].team = jm.members.find(m => Number(m.player_id) === Number(P[name].id)).team_number;
    }

    check(
        "duo teams: A+B together, C+D together",
        P.A.team === P.B.team && P.C.team === P.D.team && P.A.team !== P.C.team,
        `A${P.A.team} B${P.B.team} C${P.C.team} D${P.D.team}`
    );

    // ---------- 55: aircraft, jump, parachute, landing ----------
    const started = waitFor(P.A.s, "aircraft-started");
    P.A.s.emit("start-aircraft-drop");
    const flight = await started;
    check("aircraft started with flight duration", flight.flightDurationMs > 0, `${flight.flightDurationMs}ms`);

    const moveBlocked = waitFor(P.B.s, "player-move-ack");
    P.B.s.emit("player-move", { position: { x: 0, y: 100, z: 0 } });
    const mb = await moveBlocked;
    check("cannot walk while still in the aircraft", mb.success === false && /aircraft/i.test(mb.message), mb.message);

    let landing = null;

    for (const name of NAMES) {
        const s = P[name].s;
        const jumped = waitFor(s, "jump-started");
        s.emit("jump-from-aircraft", { progress: 0.5 });
        const j = await jumped;

        let pos = { ...j.position };
        let parachute = false;

        while (pos.y > 5) {
            pos = { x: pos.x, y: Math.max(5, pos.y - 190), z: pos.z };

            const upd = waitFor(s, "player-drop-position", 8000, d => Number(d.playerId) === Number(P[name].id));
            s.emit("drop-position-update", { position: pos });
            const d = await upd;

            if (!parachute && pos.y <= 500) {
                const dep = waitFor(s, "parachute-deployed", 3000).catch(() => null);
                s.emit("deploy-parachute");
                parachute = Boolean(await dep);
            }

            if (d.state === "landed") break;
        }

        const status = waitFor(s, "drop-status");
        s.emit("get-drop-status");
        const ds = await status;
        if (name === "A") {
            check("A jumped, deployed parachute and landed", parachute && ds.state === "landed", `y=${ds.position.y}`);
            landing = ds.position;
        }
    }

    // Ground rules after landing.
    const fly = waitFor(P.A.s, "player-move-ack");
    P.A.s.emit("player-move", { position: { x: landing.x, y: landing.y + 20, z: landing.z } });
    const flyAck = await fly;
    check("landed player cannot fly upward", flyAck.success === false, flyAck.message);

    // ---------- arena (y = ground level 5) ----------
    const g = landing.y;
    // Open ground near the landing spot (no cover in the way).
    const base = findOpenArea("E2E Duo", { x: landing.x, z: landing.z });
    const spots = {
        A: { x: base.x, y: g, z: base.z },
        B: { x: base.x, y: g, z: base.z + 3 },
        C: { x: base.x + 15, y: g, z: base.z },
        D: { x: base.x + 15, y: g, z: base.z + 2 }
    };

    for (const name of NAMES) {
        const done = waitFor(P[name].s, "dev-teleported");
        P[name].s.emit("dev-teleport", { position: spots[name] });
        await done;
    }

    // ---------- loadouts + attachments (12) ----------
    const prep = async (name, payload) => {
        const r = waitFor(P[name].s, "dev-combat-test-ready");
        P[name].s.emit("dev-prepare-combat-test", payload);
        return r;
    };

    await prep("A", { weaponId: "vajra", ammoId: "rifle_ammo", ammoQuantity: 200 });
    const att = await prep("A", { attachmentId: "extended_mag" });
    const fitted = att.inventory.weapons.find(w => w.weaponId === "vajra")?.attachments?.magazine;
    check("extended magazine auto-fitted to the Vajra", fitted === "extended_mag");

    const eq = waitFor(P.A.s, "weapon-equipped");
    P.A.s.emit("equip-weapon", { weaponId: "vajra" });
    const eqd = await eq;
    check("equipped Vajra has a 42-round magazine", eqd.weapon.magazineAmmo === 42, `magazine ${eqd.weapon.magazineAmmo}`);

    const dHelmet = await prep("D", { helmetLevel: 1 });
    const he = waitFor(P.D.s, "armor-equipped");
    P.D.s.emit("equip-helmet", { itemIdentifier: dHelmet.inventory.armor.helmets[0].instanceId });
    await he;
    await prep("C", { healingItemId: "bandage", healingQuantity: 3 });

    // ---------- 9: friendly fire ----------
    const ff = await nextError(P.A.s, () =>
        P.A.s.emit("fire-weapon", { targetId: P.B.id, direction: aim(spots.A, body(spots.B)) })
    );
    check("friendly fire is blocked", /teammates/i.test(ff || ""), ff);

    // ---------- 3: smoke hides positions ----------
    const smoke = waitFor(P.A.s, "smoke-deployed", 6000);
    P.B.s.emit("throw-grenade", { type: "smoke", target: { x: base.x + 7.5, y: g, z: base.z + 1 } });
    await smoke;

    const seen = waitFor(P.A.s, "player-moved", 4000, m => Number(m.playerId) === Number(P.D.id));
    P.D.s.emit("player-move", { position: { x: spots.D.x, y: g, z: spots.D.z + 0.5 } });
    const dMove = await seen;
    spots.D = { x: spots.D.x, y: g, z: spots.D.z + 0.5 };
    check("smoke hides D's position from A", dMove.hidden === true && dMove.position === null);

    // ---------- 4: flash ----------
    const flashedC = waitFor(P.C.s, "player-flashed", 6000);
    P.B.s.emit("throw-grenade", { type: "flash", target: { x: base.x + 15, y: g, z: base.z + 1 } });
    const fc = await flashedC;
    check("flash blinds C", fc.durationMs > 0, `${fc.durationMs}ms`);

    // ---------- shooting helper ----------
    async function shootUntil(target, point, done, maxShots = 60) {
        for (let i = 0; i < maxShots; i++) {
            await sleep(140);

            const fired = waitFor(P.A.s, "shot-fired", 4000).catch(() => null);
            const err = waitFor(P.A.s, "game-error", 4000).then(e => e.message).catch(() => null);

            P.A.s.emit("fire-weapon", { targetId: P[target].id, direction: aim(spots.A, point()) });

            const result = await Promise.race([fired, err]);

            if (typeof result === "string") {
                if (/Magazine empty/.test(result)) {
                    const reloaded = waitFor(P.A.s, "reload-completed", 10000);
                    P.A.s.emit("reload-weapon");
                    await reloaded;
                    continue;
                }
                if (/eliminated|unavailable/i.test(result)) return true;
                continue;
            }

            if (await done()) return true;
        }
        return false;
    }

    // ---------- 7: knockdown ----------
    let cKnocked = false;
    P.A.s.on("player-knocked", k => { if (Number(k.victimId) === Number(P.C.id)) cKnocked = true; });

    await shootUntil("C", () => body(spots.C), async () => cKnocked);
    check("C is knocked down (teammate D still standing)", cKnocked);

    const healErr = await nextError(P.C.s, () => P.C.s.emit("use-healing-item", { itemId: "bandage" }));
    check("knocked C cannot heal", /knocked down/i.test(healErr || ""), healErr);

    const crawl = waitFor(P.C.s, "player-move-ack");
    P.C.s.emit("player-move", { position: { x: spots.C.x - 9, y: g, z: spots.C.z } });
    const crawlAck = await crawl;
    check("knocked C cannot run", crawlAck.success === false, crawlAck.message);

    // ---------- 7: revive ----------
    const revived = waitFor(P.A.s, "player-revived", 15000, r => Number(r.playerId) === Number(P.C.id));
    const rs = waitFor(P.D.s, "revive-started", 4000);
    P.D.s.emit("revive-teammate", { targetId: P.C.id });
    await rs;
    const rv = await revived;
    check("D revives C to 25 health", rv.health === 25, `health ${rv.health}`);

    // ---------- 58: reconnect ----------
    const reconnected = waitFor(P.A.s, "player-reconnected", 8000, r => Number(r.playerId) === Number(P.B.id));
    P.B.s.close();
    await sleep(500);
    P.B.s = await connect(P.B.token);
    const rj = waitFor(P.B.s, "joined-match");
    P.B.s.emit("join-match", { matchId });
    const rejoin = await rj;
    await reconnected;
    const bPos = rejoin.playerPositions.find(p => Number(p.playerId) === Number(P.B.id))?.position;
    check("B reconnects with position kept", bPos && Math.abs(bPos.z - spots.B.z) < 0.01);

    // ---------- 18: helmet headshot ----------
    let headHit = null;
    const onDamage = d => { if (d.hitLocation === "head") headHit = d; };
    P.D.s.on("player-damaged", onDamage);
    await shootUntil("D", () => head(spots.D), async () => headHit !== null, 40);
    P.D.s.off("player-damaged", onDamage);
    check("headshot on D hits the helmet", headHit && headHit.helmetDamage > 0, headHit ? `damage ${headHit.damage}, helmet ${headHit.helmetDamage}` : "no head hit");

    // ---------- 8/14: team wipe, team win, death loot ----------
    const lootDrops = [];
    P.A.s.on("loot-dropped", l => { if (l.reason === "death") lootDrops.push(l); });
    const completed = waitFor(P.A.s, "match-completed", 90000);

    const outOfPlay = async name => {
        const { data } = await supabaseAdmin.from("match_players").select("is_alive")
            .eq("match_id", matchId).eq("player_id", P[name].id).single();
        return !data.is_alive;
    };

    for (const target of ["C", "D", "C", "D"]) {
        if (await outOfPlay(target)) continue;
        await shootUntil(target, () => body(spots[target]), async () => outOfPlay(target), 60);
    }

    const mc = await completed;
    check("team 1 wins after team 2 is wiped", Number(mc.winnerTeam) === Number(P.A.team), `winner team ${mc.winnerTeam}`);
    check("eliminated players dropped loot", lootDrops.length > 0, `${lootDrops.length} drops`);

    const res = await api("GET", `/api/matches/${matchId}/results`, P.A.token);
    check("results API lists all 4 players", res.status === 200 && res.json.totalPlayers === 4, `HTTP ${res.status}`);

    for (const name of NAMES) P[name].s.close();
}

async function cleanup() {
    const log = [];
    const del = async (label, q) => {
        const { error, count } = await q;
        log.push(`${label}: ${error ? "ERROR " + error.message : "ok"}${count != null ? ` (${count})` : ""}`);
    };
    if (created.matchId) {
        await del("player_match_results", supabaseAdmin.from("player_match_results").delete({ count: "exact" }).eq("match_id", created.matchId));
        await del("match_players", supabaseAdmin.from("match_players").delete({ count: "exact" }).eq("match_id", created.matchId));
        await del("matches", supabaseAdmin.from("matches").delete({ count: "exact" }).eq("id", created.matchId));
    }
    if (created.playerIds.length) {
        await del("players", supabaseAdmin.from("players").delete({ count: "exact" }).in("id", created.playerIds));
    }
    for (const id of created.authUserIds) {
        const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
        log.push(`auth user: ${error ? "ERROR " + error.message : "ok"}`);
    }
    console.log("\nCLEANUP:\n  " + log.join("\n  "));
}

main()
    .catch(e => { failures++; console.log("ABORTED:", e.message); })
    .finally(async () => {
        try { await cleanup(); } catch (e) { console.log("CLEANUP ERROR:", e.message); }
        console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " FAILURE(S)"}`);
        process.exit(failures === 0 ? 0 : 1);
    });
