// ==========================================
// END-TO-END ITEMS TEST
// ==========================================
// Attachments (detach / refit), dropping items, picking them
// up again, and swapping weapons when all slots are full.
// Uses a match still in the lobby (no countdown needed).
//
// WRITES TO THE REAL DATABASE (2 test accounts + 1 match)
// and deletes everything it created at the end.
//
//   PORT=5055 ENABLE_DEV_TEST_EVENTS=true node server.js
//   node tests/e2e/items.e2e.js 5055

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
const created = { authUserIds: [], playerIds: [], matchId: null };
let failures = 0;

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

// Emit and wait for either the success event or a game-error.
async function request(socket, event, payload, successEvent) {
    const ok = waitFor(socket, successEvent, 6000);
    const err = waitFor(socket, "game-error", 6000).then(e => ({ error: e.message })).catch(() => null);
    socket.emit(event, payload);
    return Promise.race([ok, err]);
}

function connect(token) {
    return new Promise((resolve, reject) => {
        const s = io(BASE, { auth: { token }, transports: ["websocket"], reconnection: false });
        s.once("connect", () => resolve(s));
        s.once("connect_error", reject);
    });
}

async function main() {
    const P = [];

    for (const n of [1, 2]) {
        const username = `bbf_itm${n}_${RUN}`.slice(0, 20);
        const email = `bbf.itm${n}.${RUN}@example.com`;
        const reg = await api("POST", "/api/auth/register", null, { username, email, password: PASSWORD });
        if (reg.status !== 201) throw new Error("register failed");
        created.playerIds.push(reg.json.player.id);
        const { data: row } = await supabaseAdmin.from("players").select("auth_user_id").eq("id", reg.json.player.id).single();
        created.authUserIds.push(row.auth_user_id);
        const login = await api("POST", "/api/auth/login", null, { email, password: PASSWORD });
        P.push({ id: login.json.player.id, token: login.json.access_token });
    }

    const [p1, p2] = P;

    const create = await api("POST", "/api/matches/create", p1.token, { map_name: "E2E Items", game_mode: "solo" });
    created.matchId = create.json.match.id;
    await api("POST", `/api/matches/join/${created.matchId}`, p2.token);

    for (const p of P) {
        p.s = await connect(p.token);
        const joined = waitFor(p.s, "joined-match");
        p.s.emit("join-match", { matchId: created.matchId });
        await joined;
    }

    // Open ground on this map (no cover in the way).
    const open = findOpenArea("E2E Items", { x: 100, z: 100 });
    const spot1 = { x: open.x, y: 5, z: open.z };
    const spot2 = { x: open.x + 2, y: 5, z: open.z };
    await request(p1.s, "dev-teleport", { position: spot1 }, "dev-teleported");
    await request(p2.s, "dev-teleport", { position: spot2 }, "dev-teleported");

    // Three weapons (full slots) + an extended magazine + ammo.
    for (const payload of [
        { weaponId: "vajra" },
        { weaponId: "agni" },
        { weaponId: "brahmastra", ammoId: "rifle_ammo", ammoQuantity: 60 },
        { attachmentId: "extended_mag" }
    ]) {
        await request(p1.s, "dev-prepare-combat-test", payload, "dev-combat-test-ready");
    }

    const inv = async () => (await request(p1.s, "get-inventory", undefined, "inventory-data")).inventory;
    const weapon = (i, id) => i.weapons.find(w => w.weaponId === id);

    let i = await inv();
    check("extended magazine fitted to the Vajra", weapon(i, "vajra")?.attachments?.magazine === "extended_mag");

    // ---------- detach / refit ----------
    const det = await request(p1.s, "detach-from-weapon", { weaponId: "vajra", slot: "magazine" }, "attachment-updated");
    check("detach moves it to spare storage", !det.error && det.inventory.attachments.includes("extended_mag"), det.error);

    const att = await request(p1.s, "attach-to-weapon", { weaponId: "agni", attachmentId: "extended_mag" }, "attachment-updated");
    check("refit onto the Agni SMG", !att.error && weapon(att.inventory, "agni")?.attachments?.magazine === "extended_mag", att.error);

    const bad = await request(p1.s, "attach-to-weapon", { weaponId: "brahmastra", attachmentId: "extended_mag" }, "attachment-updated");
    check("attaching something you do not have in storage is refused", Boolean(bad.error), bad.error);

    // ---------- drop + pick up a weapon ----------
    const dropped = await request(p1.s, "drop-item", { itemType: "weapon", itemId: "agni" }, "item-dropped");
    const agniLoot = dropped.dropped?.find(d => d.itemType === "weapon");
    check("drop the Agni on the ground", !dropped.error && !!agniLoot, dropped.error);
    check("its attachment stays in storage", dropped.inventory?.attachments?.includes("extended_mag"));

    const picked = await request(p1.s, "pickup-loot", { lootId: agniLoot.lootId }, "loot-collected");
    check("pick the Agni back up", !picked.error && !!weapon(picked.inventory, "agni"), picked.error);

    // ---------- drop part of a stack ----------
    const ammoDrop = await request(p1.s, "drop-item", { itemType: "ammunition", itemId: "rifle_ammo", quantity: 25 }, "item-dropped");
    check("drop 25 rifle rounds, keep the rest", !ammoDrop.error && ammoDrop.inventory.ammunition.rifle_ammo === 35, `left ${ammoDrop.inventory?.ammunition?.rifle_ammo}`);

    // ---------- weapon swap when slots are full ----------
    await request(p2.s, "dev-prepare-combat-test", { weaponId: "surya" }, "dev-combat-test-ready");
    const p2drop = await request(p2.s, "drop-item", { itemType: "weapon", itemId: "surya" }, "item-dropped");
    const suryaLoot = p2drop.dropped?.[0];

    const full = await request(p1.s, "pickup-loot", { lootId: suryaLoot.lootId }, "loot-collected");
    check("pickup refused when all 3 weapon slots are full", Boolean(full.error), full.error);

    const swap = await request(p1.s, "pickup-loot", { lootId: suryaLoot.lootId, swapWeaponId: "brahmastra" }, "loot-collected");
    i = swap.inventory;
    check(
        "swap: Surya picked up, Brahmastra dropped",
        !swap.error && !!weapon(i, "surya") && !weapon(i, "brahmastra") && i.weapons.length === 3,
        swap.error || i.weapons.map(w => w.weaponId).join(",")
    );

    for (const p of P) p.s.close();
}

async function cleanup() {
    if (created.matchId) {
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
