// ==========================================
// END-TO-END API TEST: ACCOUNTS, PROFILE, LEADERBOARD,
// PARTIES, QUICK MATCH, AUTO-START, DISCONNECT
// ==========================================
// WRITES TO THE REAL DATABASE (2 test accounts + 1 match)
// and deletes everything it created at the end.
//
// Start the server with a short reconnect window:
//   PORT=5055 ENABLE_DEV_TEST_EVENTS=true RECONNECT_GRACE_MS=5000 node server.js
//   node tests/e2e/api.e2e.js 5055

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

const created = { authUserIds: [], playerIds: [], matchIds: new Set() };
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

async function main() {
    // ---------- accounts ----------
    const P = {};

    for (const name of ["A", "B"]) {
        const username = `bbf_api${name}_${RUN}`.slice(0, 20);
        const email = `bbf.api${name.toLowerCase()}.${RUN}@example.com`;

        const reg = await api("POST", "/api/auth/register", null, { username, email, password: PASSWORD });
        if (reg.status !== 201) throw new Error(`register ${name}: HTTP ${reg.status}`);
        created.playerIds.push(reg.json.player.id);

        const { data: row } = await supabaseAdmin
            .from("players").select("auth_user_id").eq("id", reg.json.player.id).single();
        created.authUserIds.push(row.auth_user_id);

        const login = await api("POST", "/api/auth/login", null, { email, password: PASSWORD });
        if (login.status !== 200) throw new Error(`login ${name}`);

        P[name] = {
            id: login.json.player.id,
            email,
            token: login.json.access_token,
            refresh: login.json.refresh_token
        };
    }

    // ---------- 25/26: session endpoints ----------
    const refreshed = await api("POST", "/api/auth/refresh", null, { refresh_token: P.A.refresh });
    check("refresh returns a new access token", refreshed.status === 200 && !!refreshed.json?.access_token, `HTTP ${refreshed.status}`);
    if (refreshed.status === 200) {
        P.A.token = refreshed.json.access_token;
        P.A.refresh = refreshed.json.refresh_token;
    }

    const badRefresh = await api("POST", "/api/auth/refresh", null, { refresh_token: "not-a-token" });
    check("invalid refresh token -> 401", badRefresh.status === 401, `HTTP ${badRefresh.status}`);

    const forgot = await api("POST", "/api/auth/forgot-password", null, { email: "nobody-" + RUN + "@example.com" });
    check("forgot-password answers the same for unknown emails", forgot.status === 200, `HTTP ${forgot.status}`);

    const resend = await api("POST", "/api/auth/resend-verification", null, { email: P.A.email });
    check("resend-verification responds", resend.status === 200, `HTTP ${resend.status}`);

    // Logout B's session, then log back in.
    const logout = await api("POST", "/api/auth/logout", P.B.token);
    check("logout succeeds", logout.status === 200, `HTTP ${logout.status}`);
    const reuse = await api("POST", "/api/auth/refresh", null, { refresh_token: P.B.refresh });
    check("refresh token is revoked after logout", reuse.status === 401, `HTTP ${reuse.status}`);
    const relogin = await api("POST", "/api/auth/login", null, { email: P.B.email, password: PASSWORD });
    P.B.token = relogin.json.access_token;

    // Reset password (with a normal session token), then log in with it.
    const newPassword = PASSWORD + "x";
    const reset = await api("POST", "/api/auth/reset-password", P.B.token, { new_password: newPassword });
    check("reset-password updates the password", reset.status === 200, `HTTP ${reset.status}`);
    const loginNew = await api("POST", "/api/auth/login", null, { email: P.B.email, password: newPassword });
    check("login works with the new password", loginNew.status === 200, `HTTP ${loginNew.status}`);
    if (loginNew.status === 200) P.B.token = loginNew.json.access_token;

    // ---------- 27/30/31: profile, stats, leaderboard ----------
    const me = await api("GET", "/api/players/me", P.A.token);
    check("GET /players/me includes level progression", me.status === 200 && me.json?.progression?.level === 1, `HTTP ${me.status}`);

    const profile = await api("GET", "/api/players/profile", P.A.token);
    check("GET /players/profile", profile.status === 200, `HTTP ${profile.status} ${profile.json?.message || ""}`);

    const stats = await api("GET", "/api/players/stats", P.A.token);
    check("GET /players/stats", stats.status === 200, `HTTP ${stats.status} ${stats.json?.message || ""}`);

    const other = await api("GET", `/api/players/${P.B.id}/profile`, P.A.token);
    check("GET /players/:id/profile", other.status === 200, `HTTP ${other.status} ${other.json?.message || ""}`);

    const board = await api("GET", "/api/leaderboard");
    check("GET /leaderboard", board.status === 200, `HTTP ${board.status} ${board.json?.message || ""}`);

    // ---------- 24/29: setup-dependent routes ----------
    const maps = await api("GET", "/api/maps");
    check("maps route answers (200 if set up, 503 if not)", [200, 503].includes(maps.status), `HTTP ${maps.status}`);

    const cosmetics = await api("GET", "/api/cosmetics");
    check("cosmetics route answers (200 if set up, 503 if not)", [200, 503].includes(cosmetics.status), `HTTP ${cosmetics.status}`);

    // ---------- 34: parties ----------
    const party = await api("POST", "/api/parties", P.A.token, { game_mode: "duo" });
    check("A creates a duo party", party.status === 201 && !!party.json?.party?.code, `HTTP ${party.status}`);

    const joinParty = await api("POST", "/api/parties/join", P.B.token, { code: party.json.party.code });
    check("B joins A's party by code", joinParty.status === 200 && joinParty.json.party.members.length === 2, `HTTP ${joinParty.status}`);

    const notLeader = await api("POST", "/api/matchmaking/quick-join", P.B.token, { game_mode: "duo" });
    check("only the party leader can queue", notLeader.status === 403, `HTTP ${notLeader.status}`);

    // ---------- 32: quick join ----------
    const quick = await api("POST", "/api/matchmaking/quick-join", P.A.token, { game_mode: "duo" });
    check("party quick-joins one match together", quick.status === 200 && quick.json.partyMembers.length === 2, `HTTP ${quick.status} ${quick.json?.message || ""}`);

    const matchId = quick.json?.matchId;
    if (!matchId) throw new Error("no match from quick join");
    created.matchIds.add(matchId);

    const { data: members } = await supabaseAdmin.from("match_players").select("player_id").eq("match_id", matchId);
    check("both party members are in the match", members.length === 2);

    // ---------- 33: quick match auto-starts ----------
    console.log("      (waiting up to 3 min for auto-start + countdown...)");
    const t0 = Date.now();
    let live = false;
    while (Date.now() - t0 < 180000) {
        const { data } = await supabaseAdmin.from("matches").select("status, battlefield_status").eq("id", matchId).single();
        if (data?.status === "in_progress" && data?.battlefield_status === "active") { live = true; break; }
        await sleep(2000);
    }
    check("quick match started by itself", live, `${Math.round((Date.now() - t0) / 1000)}s`);
    if (!live) throw new Error("quick match never started");

    const { data: teams } = await supabaseAdmin.from("match_players").select("player_id, team_number").eq("match_id", matchId);
    check("party members share a team", teams[0].team_number === teams[1].team_number, JSON.stringify(teams.map(t => t.team_number)));

    // ---------- 21: disconnect -> eliminated after grace ----------
    const sA = await connect(P.A.token);
    const sB = await connect(P.B.token);

    for (const s of [sA, sB]) {
        const joined = waitFor(s, "joined-match");
        s.emit("join-match", { matchId });
        await joined;
    }

    const disc = waitFor(sA, "player-disconnected", 5000, d => Number(d.playerId) === Number(P.B.id));
    const elim = waitFor(sA, "player-eliminated", 30000, e => Number(e.victimId) === Number(P.B.id));
    sB.close();

    const d = await disc;
    check("A is told B disconnected, with the grace period", d.reconnectGraceMs > 0, `${d.reconnectGraceMs}ms`);

    const e = await elim;
    check("B is eliminated after not reconnecting", e.cause === "disconnected", e.cause);

    sA.close();

    // ---------- leave party ----------
    const leave = await api("POST", "/api/parties/leave", P.B.token);
    check("B leaves the party", leave.status === 200, `HTTP ${leave.status}`);
    await api("POST", "/api/parties/leave", P.A.token);
}

async function cleanup() {
    const log = [];
    const del = async (label, q) => {
        const { error, count } = await q;
        log.push(`${label}: ${error ? "ERROR " + error.message : "ok"}${count != null ? ` (${count})` : ""}`);
    };
    for (const matchId of created.matchIds) {
        await del("player_match_results", supabaseAdmin.from("player_match_results").delete({ count: "exact" }).eq("match_id", matchId));
        await del("match_players", supabaseAdmin.from("match_players").delete({ count: "exact" }).eq("match_id", matchId));
        await del("matches", supabaseAdmin.from("matches").delete({ count: "exact" }).eq("id", matchId));
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
