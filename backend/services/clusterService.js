// ==========================================
// INDIAN BATTLE FIELDS
// MULTI-SERVER (CLUSTER) SUPPORT
// ==========================================
// Enabled only when both SERVER_ID and SERVER_PUBLIC_URL are
// set (and database/migrations/005_multi_server.sql has run).
//
// Model: every match is hosted by exactly one server. All of
// a match's players connect to that server, so the in-memory
// game state never has to be shared. Servers:
//   - report themselves every 10s (server_instances);
//   - assign new matches to the least busy live server;
//   - only run background work for matches they host;
//   - send players who connect to the wrong server a
//     "wrong-server" event with the right address.

const { supabaseAdmin } = require("../config/supabase");

const SERVER_ID = process.env.SERVER_ID || null;
const PUBLIC_URL = process.env.SERVER_PUBLIC_URL || null;
const ENABLED = Boolean(SERVER_ID && PUBLIC_URL);

const HEARTBEAT_MS = 10000;
const LIVE_WINDOW_MS = 30000;

let urlCache = new Map(); // server_id -> url

function isClusterEnabled() {
    return ENABLED;
}

function getServerId() {
    return SERVER_ID;
}

async function heartbeat(stats = {}) {
    if (!ENABLED) return;

    const { error } = await supabaseAdmin
        .from("server_instances")
        .upsert(
            {
                server_id: SERVER_ID,
                public_url: PUBLIC_URL,
                live_matches: stats.liveMatches || 0,
                connected_players: stats.connectedPlayers || 0,
                last_seen: new Date().toISOString()
            },
            { onConflict: "server_id" }
        );

    if (error) console.error("Cluster heartbeat error:", error.message);
}

async function getLiveServers() {
    const since = new Date(Date.now() - LIVE_WINDOW_MS).toISOString();

    const { data, error } = await supabaseAdmin
        .from("server_instances")
        .select("server_id, public_url, live_matches, connected_players")
        .gte("last_seen", since);

    if (error) throw error;

    for (const s of data || []) urlCache.set(s.server_id, s.public_url);

    return data || [];
}

// Least busy live server for a new match (this server if
// nothing else is known).
async function pickHostServer() {
    if (!ENABLED) return null;

    try {
        const servers = await getLiveServers();
        if (servers.length === 0) return SERVER_ID;

        servers.sort(
            (a, b) =>
                a.live_matches - b.live_matches ||
                a.connected_players - b.connected_players
        );

        return servers[0].server_id;
    } catch (error) {
        console.error("Pick host server error:", error.message);
        return SERVER_ID;
    }
}

async function getServerUrl(serverId) {
    if (!ENABLED || !serverId) return null;
    if (urlCache.has(serverId)) return urlCache.get(serverId);

    const { data } = await supabaseAdmin
        .from("server_instances")
        .select("public_url")
        .eq("server_id", serverId)
        .maybeSingle();

    if (data?.public_url) urlCache.set(serverId, data.public_url);

    return data?.public_url || null;
}

// URL the client should connect its socket to for a match.
async function getMatchServerUrl(matchId) {
    if (!ENABLED) return null;

    const { data } = await supabaseAdmin
        .from("matches")
        .select("host_server")
        .eq("id", matchId)
        .maybeSingle();

    return getServerUrl(data?.host_server);
}

// Background work for this match belongs to this server?
function isHostedHere(match) {
    return !ENABLED || !match?.host_server || match.host_server === SERVER_ID;
}

// Take ownership of a match nobody hosts yet.
async function claimMatch(matchId) {
    if (!ENABLED) return true;

    const { data, error } = await supabaseAdmin
        .from("matches")
        .update({ host_server: SERVER_ID })
        .eq("id", matchId)
        .is("host_server", null)
        .select("id");

    if (error) {
        console.error("Claim match error:", error.message);
        return false;
    }

    return Array.isArray(data) && data.length > 0;
}

function startHeartbeat(getStats) {
    if (!ENABLED) return null;

    const beat = () => heartbeat(getStats()).catch(() => {});
    beat();

    const timer = setInterval(beat, HEARTBEAT_MS);
    timer.unref();

    console.log(`CLUSTER MODE: server ${SERVER_ID} at ${PUBLIC_URL}`);

    return timer;
}

module.exports = {
    isClusterEnabled,
    getServerId,
    pickHostServer,
    getServerUrl,
    getMatchServerUrl,
    isHostedHere,
    claimMatch,
    startHeartbeat
};
