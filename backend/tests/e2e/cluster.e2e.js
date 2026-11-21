// ==========================================
// END-TO-END MULTI-SERVER TEST
// ==========================================
// Two servers share one database. A match gets exactly one
// host; API responses carry that host's URL; a socket that
// joins on the wrong server is redirected.
//
// Requires database/migrations/005_multi_server.sql.
// WRITES TO THE REAL DATABASE (1 test account + 1 match),
// deleted at the end.
//
//   PORT=5055 SERVER_ID=a SERVER_PUBLIC_URL=http://localhost:5055 node server.js
//   PORT=5056 SERVER_ID=b SERVER_PUBLIC_URL=http://localhost:5056 node server.js
//   node tests/e2e/cluster.e2e.js

const path = require("path");
const { createRequire } = require("module");

const BACKEND = path.resolve(__dirname, "..", "..");
const req = createRequire(path.join(BACKEND, "package.json"));

process.chdir(BACKEND);
req("dotenv").config({ quiet: true });
const { io } = req("socket.io-client");
const { supabaseAdmin } = req("./config/supabase");

const SERVERS = { a: "http://localhost:5055", b: "http://localhost:5056" };
const RUN = Date.now().toString(36);
const PASSWORD = "E2e-" + Math.random().toString(36).slice(2) + "-Aa1";
const created = { authUserIds: [], playerIds: [], matchId: null };
let failures = 0;

function check(name, ok, detail = "") {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
    if (!ok) failures++;
}

async function api(base, method, url, token, body) {
    const res = await fetch(base + url, {
        method,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, json: await res.json().catch(() => null) };
}

function joinOn(base, token, matchId) {
    return new Promise((resolve, reject) => {
        const s = io(base, { auth: { token }, transports: ["websocket"], reconnection: false });
        const timer = setTimeout(() => { s.close(); reject(new Error("no reply")); }, 8000);

        s.once("connect", () => s.emit("join-match", { matchId }));
        s.once("joined-match", jm => { clearTimeout(timer); resolve({ s, joined: jm }); });
        s.once("wrong-server", w => { clearTimeout(timer); resolve({ s, wrong: w }); });
        s.once("connect_error", reject);
    });
}

async function main() {
    for (const [id, base] of Object.entries(SERVERS)) {
        const health = await api(base, "GET", "/api/health");
        check(`server ${id} is up in cluster mode`, health.json?.serverId === id, `serverId ${health.json?.serverId}`);
    }

    // Wait for both heartbeats.
    await new Promise(r => setTimeout(r, 2000));

    const { data: live } = await supabaseAdmin.from("server_instances").select("server_id").in("server_id", ["a", "b"]);
    check("both servers registered", live?.length === 2, JSON.stringify(live?.map(s => s.server_id)));

    const username = `bbf_clu_${RUN}`.slice(0, 20);
    const email = `bbf.clu.${RUN}@example.com`;
    const reg = await api(SERVERS.a, "POST", "/api/auth/register", null, { username, email, password: PASSWORD });
    created.playerIds.push(reg.json.player.id);
    const { data: row } = await supabaseAdmin.from("players").select("auth_user_id").eq("id", reg.json.player.id).single();
    created.authUserIds.push(row.auth_user_id);
    const login = await api(SERVERS.a, "POST", "/api/auth/login", null, { email, password: PASSWORD });
    const token = login.json.access_token;

    const create = await api(SERVERS.a, "POST", "/api/matches/create", token, { map_name: "E2E Cluster", game_mode: "solo" });
    created.matchId = create.json.match.id;
    const host = create.json.match.host_server;

    check("new match is assigned a host server", ["a", "b"].includes(host), `host ${host}`);
    check("create response carries the host's URL", create.json.serverUrl === SERVERS[host], create.json.serverUrl);

    const other = host === "a" ? "b" : "a";

    const wrong = await joinOn(SERVERS[other], token, created.matchId);
    check("joining on the wrong server is redirected", !!wrong.wrong && wrong.wrong.serverUrl === SERVERS[host], wrong.wrong?.serverUrl);
    wrong.s.close();

    const right = await joinOn(SERVERS[host], token, created.matchId);
    check("joining on the host server works", !!right.joined);
    right.s.close();
}

async function cleanup() {
    if (created.matchId) {
        await supabaseAdmin.from("match_players").delete().eq("match_id", created.matchId);
        await supabaseAdmin.from("matches").delete().eq("id", created.matchId);
    }
    if (created.playerIds.length) await supabaseAdmin.from("players").delete().in("id", created.playerIds);
    for (const id of created.authUserIds) await supabaseAdmin.auth.admin.deleteUser(id);
    await supabaseAdmin.from("server_instances").delete().in("server_id", ["a", "b"]);
    console.log("\nCleanup done.");
}

main()
    .catch(e => { failures++; console.log("ABORTED:", e.message); })
    .finally(async () => {
        try { await cleanup(); } catch (e) { console.log("CLEANUP ERROR:", e.message); }
        console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " FAILURE(S)"}`);
        process.exit(failures === 0 ? 0 : 1);
    });
