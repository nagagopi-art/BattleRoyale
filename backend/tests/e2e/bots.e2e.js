// ==========================================
// END-TO-END BOTS TEST
// ==========================================
// One human quick-joins a solo match; after the lobby wait
// the server fills it with bots, starts it, and the bots
// parachute in, move and fight until the match ends.
//
// WRITES TO THE REAL DATABASE (1 test account, bot accounts,
// 1 match). The human account and match are deleted at the
// end; pass "--delete-bots" to delete the bot accounts too.
//
//   PORT=5055 BOTS_ENABLED=true BOT_FILL_TARGET=4 SAFE_ZONE_TIME_SCALE=0.05 node server.js
//   node tests/e2e/bots.e2e.js 5055 --delete-bots

const path = require("path");
const { createRequire } = require("module");

const BACKEND = path.resolve(__dirname, "..", "..");
const PORT = process.argv[2] || "5055";
const DELETE_BOTS = process.argv.includes("--delete-bots");
const FILL_TARGET = Number((process.argv.find(a => a.startsWith("--fill=")) || "").split("=")[1]) || 4;
const BASE = `http://localhost:${PORT}`;
const req = createRequire(path.join(BACKEND, "package.json"));

process.chdir(BACKEND);
req("dotenv").config({ quiet: true });
const { io } = req("socket.io-client");
const { supabaseAdmin } = req("./config/supabase");

const RUN = Date.now().toString(36);
const PASSWORD = "E2e-" + Math.random().toString(36).slice(2) + "-Aa1";
const created = { authUserIds: [], playerIds: [], matchId: null, botIds: [] };
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

async function main() {
    const username = `bbf_bott_${RUN}`.slice(0, 20);
    const email = `bbf.bott.${RUN}@example.com`;
    const reg = await api("POST", "/api/auth/register", null, { username, email, password: PASSWORD });
    if (reg.status !== 201) throw new Error("register failed");
    created.playerIds.push(reg.json.player.id);
    const { data: row } = await supabaseAdmin.from("players").select("auth_user_id").eq("id", reg.json.player.id).single();
    created.authUserIds.push(row.auth_user_id);
    const login = await api("POST", "/api/auth/login", null, { email, password: PASSWORD });
    const token = login.json.access_token;
    const me = login.json.player.id;

    const reserved = await api("POST", "/api/auth/register", null, { username: "bot_fake", email: `x.${RUN}@example.com`, password: PASSWORD });
    check("bot_ usernames are reserved", reserved.status === 400, reserved.json?.message);

    const quick = await api("POST", "/api/matchmaking/quick-join", token, { game_mode: "solo" });
    if (quick.status !== 200) throw new Error("quick join failed");
    created.matchId = quick.json.matchId;

    // Connect early so the human is in the match room.
    const s = io(BASE, { auth: { token }, transports: ["websocket"], reconnection: false });
    await new Promise(r => s.once("connect", r));
    s.emit("join-match", { matchId: created.matchId });

    const eliminations = [];
    const moversSeen = new Set();
    s.on("player-eliminated", e => eliminations.push(e));
    s.on("player-moved", m => moversSeen.add(Number(m.playerId)));
    s.on("match-started", () => s.emit("join-match", { matchId: created.matchId }));
    const completed = new Promise(r => s.on("match-completed", r));

    console.log("      (lobby wait 60s, bot fill, countdown, then the match...)");

    // ---------- bots fill the match ----------
    let members = [];
    const t0 = Date.now();
    while (Date.now() - t0 < 150000) {
        const { data } = await supabaseAdmin
            .from("match_players").select("player_id, players(username)").eq("match_id", created.matchId);
        members = data || [];
        if (members.length >= FILL_TARGET) break;
        await sleep(3000);
    }

    const bots = members.filter(m => /^bot_/.test(m.players?.username || ""));
    created.botIds = bots.map(b => b.player_id);
    check(`server filled the match with ${FILL_TARGET - 1} bots`, bots.length === FILL_TARGET - 1, bots.map(b => b.players.username).join(", "));

    // ---------- match runs to the end ----------
    const MATCH_TIMEOUT_MIN = Number((process.argv.find(a => a.startsWith("--timeout-min=")) || "").split("=")[1]) || 5;
    const result = await Promise.race([completed, sleep(MATCH_TIMEOUT_MIN * 60000).then(() => null)]);
    check("match with bots completes", !!result, result ? `winner ${result.winnerPlayerId}` : `timed out after ${MATCH_TIMEOUT_MIN} min`);

    const botMoved = created.botIds.some(id => moversSeen.has(Number(id)));
    check("human saw bots moving", botMoved, `${moversSeen.size} mover(s) seen`);

    const botKills = eliminations.filter(e => created.botIds.map(Number).includes(Number(e.attackerId)));
    console.log(`      eliminations: ${eliminations.map(e => `${e.victimId}<-${e.attackerId ?? e.cause}`).join(", ")}`);
    check("bots eliminated someone or the zone/time limit ended it", eliminations.length >= FILL_TARGET - 1, `${botKills.length} by bots`);

    const { data: results } = await supabaseAdmin.from("player_match_results").select("player_id").eq("match_id", created.matchId);
    check(`results recorded for all ${FILL_TARGET} players`, results?.length === FILL_TARGET, `${results?.length}`);

    const board = await api("GET", "/api/leaderboard?limit=100");
    const botOnBoard = (board.json?.leaderboard || board.json?.players || []).some(p => /^bot_/.test(p.username));
    check("bots are not on the leaderboard", !botOnBoard);

    s.close();
}

async function cleanup() {
    if (created.matchId) {
        await supabaseAdmin.from("match_state_snapshots").delete().eq("match_id", created.matchId);
        await supabaseAdmin.from("player_match_results").delete().eq("match_id", created.matchId);
        await supabaseAdmin.from("match_players").delete().eq("match_id", created.matchId);
        await supabaseAdmin.from("matches").delete().eq("id", created.matchId);
    }

    let ids = [...created.playerIds];
    let authIds = [...created.authUserIds];

    if (DELETE_BOTS) {
        const { data: allBots } = await supabaseAdmin.from("players").select("id, auth_user_id").like("username", "bot\\_%");
        ids = ids.concat((allBots || []).map(b => b.id));
        authIds = authIds.concat((allBots || []).map(b => b.auth_user_id));
    }

    if (ids.length) await supabaseAdmin.from("players").delete().in("id", ids);
    for (const id of authIds) await supabaseAdmin.auth.admin.deleteUser(id);
    console.log(`\nCleanup done${DELETE_BOTS ? " (bot accounts deleted too)" : ""}.`);
}

main()
    .catch(e => { failures++; console.log("ABORTED:", e.message); })
    .finally(async () => {
        try { await cleanup(); } catch (e) { console.log("CLEANUP ERROR:", e.message); }
        console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " FAILURE(S)"}`);
        process.exit(failures === 0 ? 0 : 1);
    });
