// ==========================================
// END-TO-END MULTIPLAYER MATCH TEST
// ==========================================
// Plays a full 2-player match against a running backend:
// register, login, create/join/start, spawn, loadout, shoot,
// vest absorption, reload, gloo wall blocking, frag grenade
// kill, match completion and the results API.
//
// It WRITES TO THE REAL DATABASE (2 test accounts + 1 match)
// and deletes everything it created at the end.
//
// Start the server with dev events enabled:
//   PORT=5055 ENABLE_DEV_TEST_EVENTS=true node server.js
// Then run:
//   node tests/e2e/match.e2e.js 5055

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

const RUN = Date.now().toString(36);
const PASSWORD = "E2e-" + Math.random().toString(36).slice(2) + "-Aa1";
const users = [1, 2].map(n => ({
    username: `bbf_e2e${n}_${RUN}`.slice(0, 20),
    email: `bbf.e2e${n}.${RUN}@example.com`
}));

const created = { authUserIds: [], playerIds: [], matchId: null };
const results = [];
let failures = 0;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function check(name, ok, detail = "") {
    results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
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
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, json };
}

// Wait for the next event matching predicate (also captures game-error).
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

function lastError(socket) {
    return socket.__errors[socket.__errors.length - 1]?.message;
}

function connect(token) {
    return new Promise((resolve, reject) => {
        const s = io(BASE, { auth: { token }, transports: ["websocket"], reconnection: false });
        s.__errors = [];
        allSockets.push(s);
        s.on("game-error", e => s.__errors.push(e));
        s.once("connect", () => resolve(s));
        s.once("connect_error", e => reject(e));
    });
}

// Place a player directly (dev-teleport) instead of walking,
// which would take minutes under the server speed limit.
async function moveTo(socket, from, to) {
    const done = waitFor(socket, "dev-teleported", 8000);
    socket.emit("dev-teleport", { position: to });
    await done;
    return { ...to };
}

function aim(from, to) {
    const origin = { x: from.x, y: from.y + 1.5, z: from.z };
    const target = { x: to.x, y: to.y + 1.05, z: to.z };
    return { x: target.x - origin.x, y: target.y - origin.y, z: target.z - origin.z };
}

async function fire(s1, targetId, direction) {
    const shot = waitFor(s1, "shot-fired", 8000);
    const errCount = s1.__errors.length;
    s1.emit("fire-weapon", { targetId, direction });
    try {
        return await shot;
    } catch (e) {
        throw new Error("no shot-fired; game-error: " + (s1.__errors.slice(errCount).map(x => x.message).join(" | ") || "none"));
    }
}

async function main() {
    // ---------- accounts ----------
    const tokens = [];
    const players = [];
    for (const u of users) {
        const reg = await api("POST", "/api/auth/register", null, { ...u, password: PASSWORD });
        check(`register ${u.username}`, reg.status === 201, `HTTP ${reg.status} ${reg.json?.message || ""}`);
        if (reg.status !== 201) throw new Error("registration failed");
        created.playerIds.push(reg.json.player.id);
        const { data: row } = await supabaseAdmin.from("players").select("auth_user_id").eq("id", reg.json.player.id).single();
        created.authUserIds.push(row.auth_user_id);

        const login = await api("POST", "/api/auth/login", null, { email: u.email, password: PASSWORD });
        check(`login ${u.username}`, login.status === 200 && !!login.json?.access_token, `HTTP ${login.status}`);
        if (login.status !== 200) throw new Error("login failed");
        tokens.push(login.json.access_token);
        players.push(login.json.player);
    }
    const [p1, p2] = players;

    // ---------- match setup ----------
    const create = await api("POST", "/api/matches/create", tokens[0], { map_name: "E2E Test Map", game_mode: "solo" });
    check("create match", create.status === 201, `HTTP ${create.status} ${create.json?.message || ""}`);
    if (create.status !== 201) throw new Error("create match failed");
    const matchId = create.json.match.id;
    created.matchId = matchId;

    const join = await api("POST", `/api/matches/join/${matchId}`, tokens[1]);
    check("player 2 joins match", join.status === 200, `HTTP ${join.status} ${join.json?.message || ""}`);

    const s1 = await connect(tokens[0]);
    const s2 = await connect(tokens[1]);
    check("both sockets connected", s1.connected && s2.connected);

    // Results endpoint before completion must be 409.
    const early = await api("GET", `/api/matches/${matchId}/results`, tokens[0]);
    check("results before completion -> 409", early.status === 409, `HTTP ${early.status}`);

    const start = await api("POST", `/api/matches/${matchId}/start`, tokens[0]);
    check("start match (countdown)", start.status === 200, `HTTP ${start.status} ${start.json?.message || ""}`);
    if (start.status !== 200) throw new Error("start failed");

    // Wait for in_progress + active battlefield.
    let live = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 180000) {
        const { data } = await supabaseAdmin.from("matches").select("status, battlefield_status").eq("id", matchId).single();
        if (data?.status === "in_progress" && data?.battlefield_status === "active") { live = true; break; }
        await sleep(1000);
    }
    check("match reached in_progress with battlefield active", live, `${Math.round((Date.now() - t0) / 1000)}s`);
    if (!live) throw new Error("match never started");

    const j1 = waitFor(s1, "joined-match");
    const j2 = waitFor(s2, "joined-match");
    s1.emit("join-match", { matchId });
    s2.emit("join-match", { matchId });
    const [jm1, jm2] = await Promise.all([j1, j2]);
    const pos1 = jm1.playerPositions.find(p => Number(p.playerId) === Number(p1.id))?.position;
    let pos2 = jm2.playerPositions.find(p => Number(p.playerId) === Number(p2.id))?.position;
    check("both players joined socket match with spawn positions", !!pos1 && !!pos2);

    // ---------- loadout ----------
    const r1 = waitFor(s1, "dev-combat-test-ready");
    s1.emit("dev-prepare-combat-test", { weaponId: "vajra", ammoId: "rifle_ammo", ammoQuantity: 120 });
    await r1;
    const eq = waitFor(s1, "weapon-equipped");
    s1.emit("equip-weapon", { weaponId: "vajra" });
    const eqd = await eq;
    check("player 1 equips Vajra", eqd.success === true);

    const r2 = waitFor(s2, "dev-combat-test-ready");
    s2.emit("dev-prepare-combat-test", { vestLevel: 1 });
    const ready2 = await r2;
    const vest = ready2.inventory.armor.vests[0];
    const ev = waitFor(s2, "armor-equipped");
    s2.emit("equip-vest", { itemIdentifier: vest.instanceId });
    const evd = await ev;
    check("player 2 equips level-1 vest (persisted)", evd.success === true && evd.armor?.vest?.level === 1);

    // ---------- movement ----------
    const meet = { x: pos1.x + 15, y: pos1.y, z: pos1.z };
    pos2 = await moveTo(s2, pos2, meet);
    check("player 2 walks to 15m from player 1", true, `from spawn, ${Math.round(Math.hypot(meet.x - pos1.x, meet.z - pos1.z))}m apart`);

    // ---------- shooting ----------
    const dmg1 = waitFor(s2, "player-damaged", 8000);
    const shot1 = await fire(s1, p2.id, aim(pos1, pos2));
    check("shot hits player 2", shot1.hit === true);
    const d1 = await dmg1;
    check("player 2 receives damage, vest absorbs some", d1.damage > 0 && d1.vestDamage > 0, `damage ${d1.damage}, vest ${d1.vestDamage}, health ${d1.health}`);

    // ---------- reload ----------
    const rs = waitFor(s1, "reload-started");
    const rc = waitFor(s1, "reload-completed", 10000);
    s1.emit("reload-weapon");
    const rsd = await rs;
    check("reload starts", rsd.success === true, `${rsd.reloadTimeMs}ms`);
    const rcd = await rc;
    check("reload completes", rcd.success === true, `magazine ${rcd.combat?.weaponState?.magazineAmmo}`);

    // ---------- gloo wall blocks bullets ----------
    const wallPos = { x: pos1.x + 7.5, y: pos1.y, z: pos1.z };
    const wd = waitFor(s2, "gloo-wall-deployed");
    s2.emit("deploy-gloo-wall", { position: wallPos, facing: 90 }); // panel faces the shooter (+X)
    const wall = await wd;
    check("player 2 deploys gloo wall facing the shooter", !!wall?.id);

    await sleep(300); // weapon cooldown
    const wallDamaged = waitFor(s1, "gloo-wall-damaged", 8000);
    const shot2 = await fire(s1, p2.id, aim(pos1, pos2));
    check("shot through wall is blocked", shot2.blocked === true && shot2.hit === false);
    const wdmg = await wallDamaged;
    check("wall takes the bullet damage", wdmg.health < 500, `wall health ${wdmg.health}`);

    // Step out from behind the wall.
    const side = { x: pos1.x, y: pos1.y, z: pos1.z + 15 };
    pos2 = await moveTo(s2, pos2, side);

    // ---------- grenade ----------
    const thrown = waitFor(s1, "grenade-thrown");
    const exploded = waitFor(s1, "grenade-exploded", 8000);
    const gDmg = waitFor(s2, "player-damaged", 10000, d => d.weapon === "Frag Grenade");
    s1.emit("throw-grenade", { type: "frag", target: pos2 });
    const g = await thrown;
    check("frag grenade thrown", !!g?.grenade?.id);
    const ex = await exploded;
    check("grenade explodes", ex.type === "frag", `radius ${ex.radius}`);
    const gd = await gDmg;
    check("grenade damages player 2", gd.damage > 0, `damage ${gd.damage}, health ${gd.health}, eliminated ${gd.eliminated}`);

    // ---------- finish the match ----------
    const completed = waitFor(s1, "match-completed", 60000);
    const progression = waitFor(s1, "progression-updated", 60000);
    let eliminated = gd.eliminated;
    for (let i = 0; i < 40 && !eliminated; i++) {
        await sleep(300);
        let shot;
        try { shot = await fire(s1, p2.id, aim(pos1, pos2)); }
        catch (e) {
            if (/Magazine empty/.test(e.message)) {
                const done = waitFor(s1, "reload-completed", 10000);
                s1.emit("reload-weapon");
                await done;
                continue;
            }
            throw e;
        }
        const conf = await waitFor(s1, "damage-confirmed", 8000).catch(() => null);
        if (conf?.eliminated) eliminated = true;
    }
    check("player 2 eliminated", eliminated);

    const mc = await completed;
    check("match-completed broadcast", mc.success === true && Number(mc.winnerPlayerId) === Number(p1.id), `winner ${mc.winnerPlayerId}, results ${mc.results?.length}`);

    // After completion: combat blocked.
    await sleep(500);
    const errCount = s1.__errors.length;
    s1.emit("fire-weapon", { targetId: p2.id, direction: aim(pos1, pos2) });
    await sleep(1500);
    check("firing after completion is rejected", s1.__errors.slice(errCount).some(e => /not in progress/i.test(e.message)), lastError(s1));

    // ---------- results API ----------
    const res = await api("GET", `/api/matches/${matchId}/results`, tokens[0]);
    check("GET results -> 200", res.status === 200, `HTTP ${res.status}`);
    const winner = res.json?.results?.find(r => Number(r.playerId) === Number(p1.id));
    check("results list both players, player 1 placement 1 winner", res.json?.totalPlayers === 2 && winner?.placement === 1 && winner?.isWinner === true, JSON.stringify(res.json?.results?.map(r => ({ p: r.playerId, place: r.placement, k: r.kills, win: r.isWinner, xp: r.xpEarned }))));

    // ---------- coins (migration 002) ----------
    const prog = await progression;
    check("winner is awarded coins once", prog.coinsEarned > 0, `+${prog.coinsEarned} coins, total ${prog.totalCoins}, level ${prog.level}`);

    const { data: coinRow } = await supabaseAdmin.from("player_match_results")
        .select("coins_earned").eq("match_id", matchId).eq("player_id", p1.id).single();
    check("coin award recorded on the result", coinRow.coins_earned === prog.coinsEarned, `coins_earned ${coinRow.coins_earned}`);

    // ---------- cosmetics (migration 003) ----------
    const catalog = await api("GET", "/api/cosmetics");
    check("cosmetics catalog lists 10 items", catalog.status === 200 && catalog.json.total === 10, `HTTP ${catalog.status}`);

    const buy = await api("POST", "/api/cosmetics/emote_victory_drum/buy", tokens[0]);
    check("buy a cosmetic with coins", buy.status === 200 && buy.json.coins === prog.totalCoins - 250, `coins left ${buy.json?.coins}`);

    const again = await api("POST", "/api/cosmetics/emote_victory_drum/buy", tokens[0]);
    check("cannot buy the same cosmetic twice", again.status === 409, again.json?.message);

    const tooLow = await api("POST", "/api/cosmetics/char_himalayan_sentinel/buy", tokens[0]);
    check("level-locked cosmetic is refused", tooLow.status === 409 && /level/i.test(tooLow.json?.message || ""), tooLow.json?.message);

    const notOwned = await api("POST", "/api/cosmetics/chute_lotus/equip", tokens[0]);
    check("cannot equip a cosmetic you do not own", notOwned.status === 403, `HTTP ${notOwned.status}`);

    const equip = await api("POST", "/api/cosmetics/emote_victory_drum/equip", tokens[0]);
    const mine = await api("GET", "/api/cosmetics/mine", tokens[0]);
    check("equip and see it in /mine", equip.status === 200 && mine.json?.equipped?.emote === "emote_victory_drum", JSON.stringify(mine.json?.equipped));

    const maps = await api("GET", "/api/maps");
    check("maps route returns the 12 maps", maps.status === 200 && (maps.json?.maps?.length ?? maps.json?.total) === 12, `HTTP ${maps.status}`);

    s1.close();
    s2.close();
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

const allSockets = [];

main()
    .catch(e => {
        failures++;
        console.log("ABORTED:", e.message);
        for (const s of allSockets) {
            if (s.__errors.length) console.log("  game-errors:", s.__errors.map(x => x.message).join(" | "));
        }
    })
    .finally(async () => {
        try { await cleanup(); } catch (e) { console.log("CLEANUP ERROR:", e.message); }
        console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " FAILURE(S)"}`);
        process.exit(failures === 0 ? 0 : 1);
    });
