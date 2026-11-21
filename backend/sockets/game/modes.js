// ==========================================
// INDIAN BATTLE FIELDS - sockets/game/modes.js
// ==========================================
// Clash Squad (rounds) and Team Deathmatch (respawns), plus
// match coins for every mode. Battle Royale keeps its normal
// aircraft / zone flow; this file only adds kill rewards and
// the post-landing buy window for it.
//
// How respawn modes stay compatible with the rest of the
// server: a killed player is "down" in memory (combat.isAlive
// false, respawnPending true) but stays alive in the database,
// so the normal last-team-standing check never ends the match.
// When this controller decides the winner, it marks the losing
// players eliminated in the database and runs the normal match
// completion (results, XP, coins).
//
// Events sent to clients:
//   mode-state            full mode/round/score state
//   round-ended           { round, winnerTeam, scores }
//   mode-respawn-pending  { playerId, respawnAt }
//   mode-respawn          { playerId, position, health }
//   store-state           { coins, buyEndsAt, catalog }
//   coins-updated         { coins, reason, amount }

const { supabaseAdmin } = require("../../config/supabase");
const { MATCH_TYPES, KILL_REWARD_COINS, matchTypeFromCode } = require("../../config/matchTypes");
const { getLayout } = require("../../config/mapLayout");
const { nearestFreePosition } = require("../../services/mapCollision");
const { markLanded, DROP_CONFIG } = require("../../services/parachuteService");
const {
    createCombatPlayer,
    getCombatPlayer,
    setRespawnPolicy,
    revivePlayerForRound
} = require("../../services/combatService");
const { createInventory, addLootItem } = require("../../services/inventoryService");
const Store = require("../../services/storeService");
const { playerPositions, getPlayerKey, setMatchMapName, getGameIo } = require("./state");

const GROUND = DROP_CONFIG.landingAltitude;

const knownTypes = new Map();   // matchId -> "br" | "cs" | "tdm"
const modes = new Map();        // matchId -> mode state (cs / tdm)
const starting = new Map();     // matchId -> Promise (start in progress)
const landedOnce = new Set();   // "match:player" (BR buy window opened)

// ---------------- type lookup ----------------

function registerMatchType(matchId, matchCode) {
    if (!matchId) return "br";
    const type = matchTypeFromCode(matchCode);
    knownTypes.set(matchId, type);
    return type;
}

function getMatchType(matchId) {
    return knownTypes.get(matchId) || "br";
}

function isRespawnMatch(matchId) {
    return Boolean(MATCH_TYPES[getMatchType(matchId)]?.respawn);
}

setRespawnPolicy(isRespawnMatch);

// ---------------- helpers ----------------

const io = () => getGameIo();
const room = matchId => `match:${matchId}`;

function hashString(s) {
    let h = 2166136261;
    for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return h >>> 0;
}

function emitCoins(matchId, playerId, reason, amount) {
    io()?.to(`player:${playerId}`).emit("coins-updated", {
        coins: Store.getCoins(matchId, playerId),
        reason,
        amount
    });
}

function emitStore(matchId, playerId) {
    io()?.to(`player:${playerId}`).emit("store-state", Store.getStoreState(matchId, playerId));
}

function arenaZone(state) {
    return {
        matchId: state.matchId,
        arena: true,
        phase: 1,
        totalPhases: 1,
        state: "arena",
        current: { center: { ...state.arena.center }, radius: state.arena.radius },
        next: null,
        shrinkStartsAt: null,
        shrinkEndsAt: null,
        damagePerSecond: 0,
        serverTime: Date.now()
    };
}

function publicState(state) {
    const cfg = MATCH_TYPES[state.type];
    return {
        matchId: state.matchId,
        type: state.type,
        name: cfg.name,
        gameMode: state.gameMode,
        round: state.round,
        roundsToWin: cfg.roundsToWin || null,
        killTarget: state.killTarget || null,
        scores: Object.fromEntries(state.scores),
        teamOf: Object.fromEntries(state.teamOf),
        phase: state.phase,
        phaseEndsAt: state.phaseEndsAt,
        matchEndsAt: state.matchEndsAt || null,
        serverTime: Date.now(),
        arena: state.arena,
        ended: state.ended
    };
}

function broadcastState(state) {
    io()?.to(room(state.matchId)).emit("mode-state", publicState(state));
}

function later(state, ms, fn) {
    const t = setTimeout(() => {
        state.timers.delete(t);
        if (!state.ended) fn();
    }, ms);
    state.timers.add(t);
    return t;
}

// Team key: the player in solo (free-for-all), else the team number.
function teamKeyFor(gameMode, member) {
    return gameMode === "solo" ? `p${member.player_id}` : `t${member.team_number}`;
}

function aliveTeams(state) {
    const alive = new Set();
    for (const [pid, team] of state.teamOf) {
        const c = getCombatPlayer(state.matchId, pid);
        if (c && c.isAlive) alive.add(team);
    }
    return alive;
}

// ---------------- spawning ----------------

function spawnPoint(state, pid) {
    const team = state.teamOf.get(String(pid));
    const base = state.spawns.get(team);
    const members = [...state.teamOf.entries()].filter(([, t]) => t === team).map(([id]) => id);
    const i = Math.max(0, members.indexOf(String(pid)));
    // Spread team-mates sideways around their spawn point.
    const side = (i - (members.length - 1) / 2) * 2.5;
    const pos = {
        x: base.x + Math.cos(base.facing) * side,
        y: GROUND,
        z: base.z - Math.sin(base.facing) * side
    };
    return nearestFreePosition(state.mapName, pos);
}

function spawnPlayer(state, pid) {
    const { matchId } = state;
    const position = spawnPoint(state, pid);
    markLanded(matchId, pid, position);
    playerPositions.set(getPlayerKey(matchId, pid), { ...position });
    const combat = revivePlayerForRound(matchId, pid);

    io()?.to(room(matchId)).emit("mode-respawn", {
        playerId: Number(pid),
        position,
        health: combat ? combat.health : 100
    });

    // Keep the stored health in step (the row stays alive).
    supabaseAdmin
        .from("match_players")
        .update({ health: 100 })
        .eq("match_id", matchId)
        .eq("player_id", pid)
        .then(({ error }) => { if (error) console.error("Respawn health save error:", error.message); });
}

function openBuy(state, pids, ms) {
    for (const pid of pids) {
        Store.openBuyWindow(state.matchId, pid, ms);
        emitStore(state.matchId, pid);
    }
}

// ---------------- start ----------------

// Called when the battlefield is ready, and again (harmlessly)
// when a client asks for the aircraft. Returns the match type.
async function startModeIfNeeded(matchId) {
    if (modes.has(matchId)) return modes.get(matchId).type;
    if (starting.has(matchId)) return starting.get(matchId);

    const job = (async () => {
        const { data: match, error } = await supabaseAdmin
            .from("matches")
            .select("id, match_code, map_name, game_mode, status")
            .eq("id", matchId)
            .single();
        if (error || !match) throw error || new Error("Match not found");

        const type = registerMatchType(matchId, match.match_code);
        if (type === "br" || match.status !== "in_progress") return type;

        const { data: members, error: membersError } = await supabaseAdmin
            .from("match_players")
            .select("player_id, team_number, is_alive")
            .eq("match_id", matchId);
        if (membersError) throw membersError;

        // Team modes need two sides. If the room put everyone on
        // one team (few players), split them evenly into teams 1/2.
        if (match.game_mode !== "solo" && (members || []).length >= 2 &&
            new Set(members.map(m => m.team_number)).size < 2) {
            const sorted = [...members].sort((a, b) => a.player_id - b.player_id);
            for (let i = 0; i < sorted.length; i++) {
                sorted[i].team_number = (i % 2) + 1;
                const { error: teamError } = await supabaseAdmin
                    .from("match_players")
                    .update({ team_number: sorted[i].team_number })
                    .eq("match_id", matchId)
                    .eq("player_id", sorted[i].player_id);
                if (teamError) console.error("Team split error:", teamError.message);
            }
            io()?.to(room(matchId)).emit("teams-updated", sorted.map(m => ({ playerId: m.player_id, team: m.team_number })));
        }

        const cfg = MATCH_TYPES[type];
        setMatchMapName(matchId, match.map_name);

        // Arena: one town, picked from the match id.
        const layout = getLayout(match.map_name);
        const towns = layout.towns?.length ? layout.towns : [{ center: { x: 0, z: 0 } }];
        const town = towns[hashString(matchId) % towns.length];
        const arena = { center: { x: town.center.x, z: town.center.z }, radius: cfg.arenaRadius };

        const state = {
            matchId,
            type,
            gameMode: match.game_mode,
            mapName: match.map_name,
            arena,
            teamOf: new Map(),
            spawns: new Map(),
            scores: new Map(),
            round: 0,
            phase: "starting",
            phaseEndsAt: null,
            killTarget: type === "tdm" ? cfg.killTarget[match.game_mode] || 25 : null,
            timers: new Set(),
            ended: false
        };

        for (const m of members || []) state.teamOf.set(String(m.player_id), teamKeyFor(match.game_mode, m));
        const teamKeys = [...new Set(state.teamOf.values())].sort();
        for (const k of teamKeys) state.scores.set(k, 0);

        // Teams start evenly around the arena, facing the middle.
        const a0 = (hashString(matchId + "a") % 360) * Math.PI / 180;
        teamKeys.forEach((k, i) => {
            const a = a0 + (i / teamKeys.length) * Math.PI * 2;
            const r = arena.radius * 0.62;
            state.spawns.set(k, {
                x: arena.center.x + Math.cos(a) * r,
                z: arena.center.z + Math.sin(a) * r,
                facing: a
            });
        });

        // Everyone starts with a pistol; the rest is bought.
        for (const pid of state.teamOf.keys()) {
            createCombatPlayer(matchId, Number(pid));
            createInventory(matchId, Number(pid));
            addLootItem(matchId, Number(pid), { itemType: "weapon", itemId: "surya" });
            addLootItem(matchId, Number(pid), { itemType: "ammunition", itemId: "pistol_ammo", quantity: 48 });
            Store.getCoins(matchId, pid);
        }

        modes.set(matchId, state);
        io()?.to(room(matchId)).emit("zone-update", arenaZone(state));

        if (type === "cs") startRound(state);
        else startDeathmatch(state);

        console.log(`MODE STARTED: ${cfg.name} (${match.game_mode}) in ${town.name || town.id || "arena"}:`, match.match_code);
        return type;
    })();

    starting.set(matchId, job);
    try {
        return await job;
    } finally {
        starting.delete(matchId);
    }
}

// ---------------- Clash Squad ----------------

function startRound(state) {
    const cfg = MATCH_TYPES.cs;
    state.round++;
    state.phase = "buy";
    state.phaseEndsAt = Date.now() + cfg.buyPhaseMs;

    const pids = [...state.teamOf.keys()];
    for (const pid of pids) spawnPlayer(state, pid);
    openBuy(state, pids, cfg.buyPhaseMs);
    broadcastState(state);

    later(state, cfg.buyPhaseMs, () => {
        state.phase = "fight";
        state.phaseEndsAt = Date.now() + cfg.fightMs;
        for (const pid of pids) Store.closeBuyWindow(state.matchId, pid);
        broadcastState(state);
        later(state, cfg.fightMs, () => endRound(state, null));
    });
}

function endRound(state, winnerKey) {
    if (state.phase !== "fight") return;
    const cfg = MATCH_TYPES.cs;
    for (const t of state.timers) clearTimeout(t);
    state.timers.clear();

    // Time out: the side with more players (then more health) standing wins.
    if (!winnerKey) {
        const standing = new Map();
        for (const [pid, team] of state.teamOf) {
            const c = getCombatPlayer(state.matchId, pid);
            if (!c || !c.isAlive) continue;
            const s = standing.get(team) || { n: 0, hp: 0 };
            s.n++; s.hp += c.health;
            standing.set(team, s);
        }
        let best = null;
        for (const [team, s] of standing) {
            if (!best || s.n > best.s.n || (s.n === best.s.n && s.hp > best.s.hp)) best = { team, s };
        }
        winnerKey = best ? best.team : null;
    }

    if (winnerKey) state.scores.set(winnerKey, (state.scores.get(winnerKey) || 0) + 1);

    // Round income.
    for (const [pid, team] of state.teamOf) {
        const amount = team === winnerKey ? cfg.roundWinCoins : cfg.roundLossCoins;
        Store.addCoins(state.matchId, pid, amount);
        emitCoins(state.matchId, pid, team === winnerKey ? "round-win" : "round-loss", amount);
    }

    state.phase = "round-end";
    state.phaseEndsAt = Date.now() + cfg.roundEndPauseMs;
    io()?.to(room(state.matchId)).emit("round-ended", {
        round: state.round,
        winnerTeam: winnerKey,
        scores: Object.fromEntries(state.scores)
    });
    broadcastState(state);

    const leader = [...state.scores.entries()].sort((a, b) => b[1] - a[1])[0];
    if (leader && (leader[1] >= cfg.roundsToWin || state.round >= cfg.maxRounds)) {
        later(state, 2500, () => endMatch(state, leader[0]));
        return;
    }
    later(state, cfg.roundEndPauseMs, () => startRound(state));
}

// ---------------- Team Deathmatch ----------------

function startDeathmatch(state) {
    const cfg = MATCH_TYPES.tdm;
    const pids = [...state.teamOf.keys()];
    for (const pid of pids) spawnPlayer(state, pid);
    openBuy(state, pids, cfg.buyPhaseMs);

    state.round = 1;
    state.phase = "fight";
    state.matchEndsAt = Date.now() + cfg.durationMs;
    state.phaseEndsAt = state.matchEndsAt;
    broadcastState(state);

    later(state, cfg.durationMs, () => {
        const leader = [...state.scores.entries()].sort((a, b) => b[1] - a[1])[0];
        endMatch(state, leader ? leader[0] : null);
    });
}

function scheduleRespawn(state, pid) {
    const cfg = MATCH_TYPES.tdm;
    const respawnAt = Date.now() + cfg.respawnDelayMs;
    io()?.to(room(state.matchId)).emit("mode-respawn-pending", { playerId: Number(pid), respawnAt, serverTime: Date.now() });
    later(state, cfg.respawnDelayMs, () => {
        spawnPlayer(state, pid);
        openBuy(state, [pid], cfg.respawnBuyMs);
    });
}

// ---------------- deaths (all modes) ----------------

// Called by persistence after a kill was saved.
function onPlayerDown(matchId, victimId, killerId) {
    try {
        // Kill reward in every mode.
        if (killerId && String(killerId) !== String(victimId)) {
            Store.addCoins(matchId, killerId, KILL_REWARD_COINS);
            emitCoins(matchId, killerId, "kill", KILL_REWARD_COINS);
        }

        const state = modes.get(matchId);
        if (!state || state.ended) return;

        const victimTeam = state.teamOf.get(String(victimId));
        const killerTeam = killerId ? state.teamOf.get(String(killerId)) : null;

        if (state.type === "tdm") {
            if (killerTeam && killerTeam !== victimTeam) {
                state.scores.set(killerTeam, (state.scores.get(killerTeam) || 0) + 1);
            }
            broadcastState(state);
            if (killerTeam && state.scores.get(killerTeam) >= state.killTarget) {
                endMatch(state, killerTeam);
                return;
            }
            scheduleRespawn(state, victimId);
            return;
        }

        // Clash Squad: dead until next round; round ends when one side is left.
        io()?.to(room(matchId)).emit("mode-respawn-pending", { playerId: Number(victimId), respawnAt: null, nextRound: true });
        const alive = aliveTeams(state);
        if (state.phase === "fight" && alive.size <= 1) endRound(state, [...alive][0] || killerTeam || null);
    } catch (error) {
        console.error("Mode death handling error:", error.message);
    }
}

// ---------------- end ----------------

async function endMatch(state, winnerKey) {
    if (state.ended) return;
    state.ended = true;
    for (const t of state.timers) clearTimeout(t);
    state.timers.clear();
    state.phase = "ended";
    broadcastState(state);

    const { matchId } = state;
    const { persistZoneDamage } = require("./persistence");
    const { completeMatchIfFinished } = require("./lifecycle");

    // Losers are eliminated in the database (fewest kills first,
    // so placements follow performance); the normal completion
    // then records the winner, XP and coins.
    const losers = [...state.teamOf.entries()]
        .filter(([, team]) => team !== winnerKey)
        .map(([pid]) => ({ pid, kills: getCombatPlayer(matchId, pid)?.kills || 0 }))
        .sort((a, b) => a.kills - b.kills);

    for (const { pid } of losers) {
        try {
            await persistZoneDamage(matchId, Number(pid), 0, true);
        } catch (error) {
            console.error("Mode end elimination error:", error.message);
        }
    }

    await completeMatchIfFinished(io(), matchId);
}

// ---------------- queries used by handlers ----------------

// No shooting or grenades during the Clash Squad buy phase and between rounds.
function isCombatFrozen(matchId) {
    const s = modes.get(matchId);
    return Boolean(s && (s.phase === "buy" || s.phase === "round-end" || s.phase === "ended" || s.phase === "starting"));
}

function outsideArena(matchId, position) {
    const s = modes.get(matchId);
    if (!s || !position) return false;
    return Math.hypot(position.x - s.arena.center.x, position.z - s.arena.center.z) > s.arena.radius;
}

function getArenaZone(matchId) {
    const s = modes.get(matchId);
    return s ? arenaZone(s) : null;
}

function getModeState(matchId) {
    const s = modes.get(matchId);
    return s ? publicState(s) : { matchId, type: getMatchType(matchId), name: MATCH_TYPES[getMatchType(matchId)].name };
}

// Battle Royale: the store opens for a while after landing.
function onPlayerLanded(matchId, playerId) {
    if (getMatchType(matchId) !== "br") return;
    const k = `${matchId}:${playerId}`;
    if (landedOnce.has(k)) return;
    landedOnce.add(k);
    Store.openBuyWindow(matchId, playerId, MATCH_TYPES.br.buyWindowMs);
    emitStore(matchId, playerId);
}

function removeMatchMode(matchId) {
    const s = modes.get(matchId);
    if (s) {
        s.ended = true;
        for (const t of s.timers) clearTimeout(t);
    }
    modes.delete(matchId);
    knownTypes.delete(matchId);
    for (const k of [...landedOnce]) if (k.startsWith(`${matchId}:`)) landedOnce.delete(k);
    Store.removeMatchStore(matchId);
}

module.exports = {
    registerMatchType,
    getMatchType,
    isRespawnMatch,
    startModeIfNeeded,
    onPlayerDown,
    onPlayerLanded,
    isCombatFrozen,
    outsideArena,
    getArenaZone,
    getModeState,
    removeMatchMode
};
