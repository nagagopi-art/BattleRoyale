// ==========================================
// Socket connection, server events and controls
// ==========================================

const Game = (() => {
    const MOVE_TICK_MS = 100;
    const MOVE_STEP = 1.1;          // 11 units/s (server limit 12)
    const CRAWL_STEP = 0.25;        // 2.5 units/s (knocked limit 3)
    const DROP_TICK_MS = 250;
    const DROP_STEP = 150;          // server max 200 per update
    const FIRE_TICK_MS = 120;

    let lastAckPos = null;
    let lastErrorText = "";
    let lastErrorAt = 0;
    let aircraftRequested = false;

    const name = id => G.usernames.get(Number(id)) || G.players.get(Number(id))?.username || `#${id}`;

    function playerEntry(id) {
        id = Number(id);
        if (!G.players.has(id)) {
            G.players.set(id, { pos: null, hidden: false, team: null, username: G.usernames.get(id), alive: true, knocked: false, seenAt: 0 });
        }
        return G.players.get(id);
    }

    // ---------------- connection ----------------

    function connect(matchId, serverUrl) {
        disconnect();

        G.matchId = matchId;
        G.serverUrl = serverUrl || null;
        G.self.id = Number(Api.session.player.id);

        const socket = io(serverUrl || window.location.origin, {
            auth: { token: Api.token },
            transports: ["websocket"],
            reconnectionAttempts: 10
        });

        G.socket = socket;
        bindEvents(socket);
        loadUsernames();
    }

    function disconnect() {
        if (G.socket) {
            G.socket.removeAllListeners();
            G.socket.close();
        }
        G.socket = null;
    }

    async function loadUsernames() {
        const r = await Api.call("GET", `/api/matches/${G.matchId}/players`);
        if (!r.ok) return;

        for (const p of r.json.players || []) {
            const id = Number(p.player_id);
            G.usernames.set(id, p.players?.username);
            playerEntry(id).username = p.players?.username;
        }

        UI.renderWaitingPlayers();
    }

    function emit(event, payload) {
        if (G.socket?.connected) G.socket.emit(event, payload);
    }

    function rejoin() {
        emit("join-match", { matchId: G.matchId });
    }

    // ---------------- server events ----------------

    function bindEvents(s) {
        // Game modes, coins and the store (js/modes-ui.js).
        if (typeof ModeUI !== "undefined") ModeUI.bind(s, emit);

        s.on("connect", rejoin);

        s.on("connect_error", async err => {
            if (/token/i.test(err.message) && (await Api.refresh())) {
                s.auth.token = Api.token;
            } else {
                UI.feed(`Connection error: ${err.message}`, "kill");
            }
        });

        s.on("wrong-server", w => {
            UI.feed("Moving to the match's server…", "info");
            connect(G.matchId, w.serverUrl);
        });

        s.on("joined-match", jm => {
            G.matchStatus = jm.matchStatus;
            G.gameMode = jm.gameMode;
            G.matchType = jm.matchType || "br";
            G.matchCode = jm.matchCode;

            for (const m of jm.members || []) {
                const p = playerEntry(m.player_id);
                p.team = m.team_number;
                p.alive = m.is_alive !== false;
            }

            G.self.team = playerEntry(G.self.id).team;

            for (const p of jm.playerPositions || []) {
                if (Number(p.playerId) === G.self.id) {
                    G.self.pos = { ...p.position };
                    lastAckPos = { ...p.position };
                } else {
                    const entry = playerEntry(p.playerId);
                    entry.pos = { ...p.position };
                    entry.seenAt = Date.now();
                }
            }

            const me = (jm.members || []).find(m => Number(m.player_id) === G.self.id);
            if (me && me.is_alive === false) G.self.alive = false;

            if (jm.matchStatus === "in_progress") {
                startGameView();
            } else {
                UI.showWaiting();
            }
        });

        s.on("player-joined", p => {
            G.usernames.set(Number(p.playerId), p.username);
            playerEntry(p.playerId).username = p.username;
            UI.renderWaitingPlayers();
        });

        s.on("player-left", p => {
            G.players.delete(Number(p.playerId));
            UI.feed(`${name(p.playerId)} left`, "info");
            UI.renderWaitingPlayers();
        });

        s.on("match-countdown", c => UI.setWaitingStatus(`Starting in ${c.remainingSeconds}s`));
        s.on("match-started", () => rejoin());
        s.on("match-cancelled", c => { UI.feed(`Match cancelled: ${c.reason}`, "kill"); UI.backToLobby(); });
        s.on("battlefield-error", e => UI.feed(e.message, "kill"));

        s.on("player-spawned", p => {
            if (Number(p.playerId) === G.self.id && p.position) {
                G.self.pos = { ...p.position };
                lastAckPos = { ...p.position };
            }
        });

        // ----- aircraft & parachute -----
        s.on("aircraft-started", f => {
            G.flight = { flightPath: f.flightPath, startedAt: Date.now(), durationMs: f.flightDurationMs || 20000 };
            if (!G.jumped && G.self.alive) {
                G.phase = "aircraft";
                UI.center("Press SPACE to jump", 3000);
            }
        });

        s.on("jump-started", j => {
            G.jumped = true;
            G.phase = "dropping";
            G.self.pos = { ...j.position };
            if (j.forced) UI.feed("Ejected at the end of the flight", "info");
        });

        s.on("parachute-deployed", () => { G.parachute = true; });

        s.on("player-drop-position", d => {
            if (Number(d.playerId) === G.self.id) {
                G.self.pos = { ...d.position };
                lastAckPos = { ...d.position };
                if (d.state === "landed") {
                    G.phase = "ground";
                    G.self.pos.y = GROUND_Y;
                    UI.center("Landed", 1500);
                }
            } else {
                const p = playerEntry(d.playerId);
                p.pos = { ...d.position };
                p.seenAt = Date.now();
            }
        });

        s.on("drop-status", ds => {
            if (!ds) return;
            G.self.pos = { ...ds.position };
            lastAckPos = { ...ds.position };
            G.jumped = true;
            G.parachute = Boolean(ds.parachuteDeployed);
            G.phase = ds.state === "landed" ? "ground" : "dropping";
        });

        // ----- movement -----
        s.on("player-moved", m => {
            const p = playerEntry(m.playerId);
            p.hidden = Boolean(m.hidden);
            if (m.position) {
                p.pos = { ...m.position };
                p.seenAt = Date.now();
            }
        });

        s.on("spectated-player-moved", m => {
            const p = playerEntry(m.playerId);
            p.pos = { ...m.position };
            p.seenAt = Date.now();
        });

        s.on("player-move-ack", a => {
            if (a.success) lastAckPos = { ...a.position };
            else if (lastAckPos) G.self.pos = { ...lastAckPos };
        });

        // ----- loot & inventory -----
        s.on("nearby-loot", r => {
            G.loot = new Map((r.loot || []).map(item => [item.lootId, item]));
        });

        s.on("loot-collected", r => {
            G.loot.delete(r.item.lootId);
            G.inventory = r.inventory;
            if (r.throwables) G.throwables = r.throwables;
            UI.feed(`Picked up ${r.item.name}${r.item.quantity ? " x" + r.item.quantity : ""}`, "good");

            if (r.item.itemType === "weapon" && !G.activeWeapon) {
                emit("equip-weapon", { weaponId: r.item.itemId });
            }
        });

        s.on("loot-removed", r => {
            for (const id of r.lootIds || [r.lootId]) G.loot.delete(id);
        });

        s.on("loot-dropped", r => {
            for (const item of r.items || []) G.loot.set(item.lootId, item);
        });

        s.on("item-dropped", r => {
            G.inventory = r.inventory;
            if (r.throwables) G.throwables = r.throwables;
        });

        s.on("inventory-data", r => { G.inventory = r.inventory; });
        s.on("attachment-updated", r => {
            G.inventory = r.inventory;
            UI.feed(r.message || "Attachment updated", "good");
        });
        s.on("throwable-inventory-updated", inv => { G.throwables = inv; });

        s.on("weapon-equipped", r => {
            G.activeWeapon = r.weapon?.id || null;
            G.magazine = r.weapon?.magazineAmmo ?? null;
            G.reloading = false;
        });

        s.on("armor-equipped", r => UI.feed(`Equipped ${r.armorType}`, "good"));

        s.on("combat-state-data", r => {
            const c = r.combat;
            if (!c) return;
            G.self.health = c.health;
            G.self.armor = c.armor;
            G.self.kills = c.kills;
            G.self.alive = c.isAlive;
            G.self.knocked = Boolean(c.knocked);
            G.self.knockHealth = c.knockHealth || 0;
            G.activeWeapon = c.activeWeapon;
            G.magazine = c.weapons?.[c.activeWeapon]?.magazineAmmo ?? null;
        });

        // ----- combat -----
        s.on("shot-fired", r => {
            G.magazine = r.remainingAmmo;
            const target = G.players.get(Number(r.targetId));
            if (target?.pos && G.self.pos) {
                Render.addEffect({
                    kind: "line",
                    fx: "shot",
                    hit: Boolean(r.hit),
                    blocked: Boolean(r.blocked),
                    wallId: r.wallId,
                    weapon: r.weapon,
                    from: G.self.pos,
                    to: target.pos,
                    rgb: r.blocked ? "127,211,255" : r.hit ? "242,165,65" : "160,160,160"
                }, 200);
            }
        });

        s.on("damage-confirmed", d => {
            if (d.alivePlayers) G.alivePlayers = d.alivePlayers;
            if (d.hit) UI.feed(`Hit ${name(d.targetId)} for ${d.damage}${d.hitLocation === "head" ? " (head)" : ""}`, "good");
        });

        s.on("player-damaged", d => {
            G.self.health = d.health;
            G.self.armor = d.armor;
            UI.feed(`${name(d.attackerId)} hit you for ${d.damage} (${d.weapon})`, "kill");
            if (G.self.pos) Render.addEffect({ kind: "ring", fx: "hurt", attackerId: d.attackerId, at: G.self.pos, radius: 3, rgb: "229,83,75" }, 300);
        });

        s.on("player-knocked", k => {
            if (Number(k.victimId) === G.self.id) {
                G.self.knocked = true;
                G.self.knockHealth = k.knockHealth || 100;
                UI.center("You are knocked down — a teammate can revive you (E)", 3000);
            } else {
                playerEntry(k.victimId).knocked = true;
            }
            UI.feed(`${name(k.attackerId)} knocked ${name(k.victimId)}`, "kill");
        });

        s.on("bleeding", b => { G.self.knockHealth = b.knockHealth; });

        s.on("player-revived", r => {
            if (Number(r.playerId) === G.self.id) {
                G.self.knocked = false;
                G.self.health = r.health;
            } else {
                playerEntry(r.playerId).knocked = false;
            }
            UI.feed(`${name(r.reviverId)} revived ${name(r.playerId)}`, "good");
        });

        s.on("player-eliminated", e => {
            if (e.alivePlayers) G.alivePlayers = e.alivePlayers;

            const killer = e.attackerId ? name(e.attackerId) : (e.cause || "zone");
            UI.feed(`${killer} ✕ ${name(e.victimId)}${e.weapon ? " (" + e.weapon + ")" : ""}`, "kill");

            if (Number(e.attackerId) === G.self.id) G.self.kills++;

            if (Number(e.victimId) === G.self.id) {
                G.self.alive = false;
                G.self.knocked = false;
                G.phase = "dead";
                // Clash Squad / Team Deathmatch: respawn overlay instead.
                if (!(typeof ModeUI !== "undefined" && ModeUI.handlesDeath())) UI.showDead();
            } else {
                const p = playerEntry(e.victimId);
                p.alive = false;
                p.knocked = false;
            }
        });

        s.on("reload-started", r => {
            G.reloading = true;
            UI.feed(`Reloading (${(r.reloadTimeMs / 1000).toFixed(1)}s)`, "info");
        });

        s.on("reload-completed", r => {
            G.reloading = false;
            G.inventory = r.inventory || G.inventory;
            G.magazine = r.combat?.weaponState?.magazineAmmo ?? G.magazine;
        });

        s.on("gunshot-heard", g => {
            Render.addEffect({ kind: "ring", fx: "gunshot", weapon: g.weapon, suppressed: g.suppressed, distance: g.distance, at: g.position, radius: g.suppressed ? 3 : 6, rgb: "242,165,65" }, 700);
        });

        // ----- throwables -----
        s.on("grenade-thrown", r => {
            const g = r.grenade;
            G.grenades.set(g.id, { position: g.position, type: g.type, explodesAt: g.explodesAt - g.createdAt + Date.now() });
        });

        s.on("grenade-exploded", ex => {
            G.grenades.delete(ex.grenadeId);
            Render.addEffect({ kind: "ring", fx: "explosion", type: ex.type, at: ex.position, radius: ex.radius, rgb: ex.type === "frag" ? "229,83,75" : "230,230,230" }, 600);
        });

        s.on("smoke-deployed", sm => G.smokes.set(sm.id, sm));
        s.on("smoke-cleared", sm => G.smokes.delete(sm.id));
        s.on("smoke-clouds-state", list => {
            G.smokes = new Map(list.map(sm => [sm.id, sm]));
        });

        s.on("player-flashed", f => {
            G.self.flashedUntil = Date.now() + f.durationMs;
        });

        s.on("gloo-wall-deployed", w => G.walls.set(w.id, w));
        s.on("gloo-wall-damaged", w => {
            if (w.destroyed) return G.walls.delete(w.wallId);
            const wall = G.walls.get(w.wallId);
            if (wall) { wall.health = w.health; wall.hitAt = Date.now(); }
        });
        s.on("gloo-walls-state", list => {
            G.walls = new Map(list.map(w => [w.id, w]));
        });

        // ----- healing & revive -----
        s.on("healing-started", h => {
            G.healing = { itemId: h.itemId, endsAt: Date.now() + h.durationMs };
        });
        s.on("healing-completed", h => {
            G.healing = null;
            G.self.health = h.health;
            G.inventory = h.inventory || G.inventory;
            UI.feed(`Healed +${h.healed}`, "good");
        });
        s.on("healing-cancelled", h => {
            G.healing = null;
            UI.feed(`Healing cancelled (${h.reason})`, "info");
        });
        s.on("healing-failed", () => { G.healing = null; });

        s.on("revive-started", () => UI.feed("Reviving…", "info"));
        s.on("being-revived", r => UI.feed(`${name(r.reviverId)} is reviving you`, "good"));
        s.on("revive-cancelled", r => UI.feed(`Revive cancelled (${r.reason})`, "info"));

        // ----- zone -----
        // Keep the arrival time to convert server timestamps.
        s.on("zone-update", z => { G.zone = { ...z, receivedAt: Date.now() }; });
        s.on("zone-damage", z => { G.self.health = z.health; });

        // ----- end of match -----
        s.on("match-completed", r => {
            G.phase = "over";
            UI.showResults(r);
        });
        s.on("progression-updated", p => UI.showProgression(p));

        s.on("spectate-started", r => {
            G.spectating = Number(r.targetId);
            UI.feed(`Spectating ${name(r.targetId)}`, "info");
        });

        s.on("player-disconnected", p => UI.feed(`${name(p.playerId)} disconnected`, "info"));
        s.on("player-reconnected", p => UI.feed(`${name(p.playerId)} reconnected`, "good"));
        s.on("left-match", () => UI.backToLobby());

        s.on("game-error", e => {
            const now = Date.now();
            if (e.message === lastErrorText && now - lastErrorAt < 1500) return;
            lastErrorText = e.message;
            lastErrorAt = now;

            if (/Magazine empty/.test(e.message) && !G.reloading) {
                emit("reload-weapon");
                return;
            }

            if (/Aircraft drop has already started/.test(e.message)) return;

            UI.feed(e.message, "info");
        });
    }

    // Called once the match is in progress.
    function startGameView() {
        UI.showGame();

        if (!G.self.alive) {
            G.phase = "dead";
            UI.showDead();
        } else if (G.phase === "lobby" || G.phase === "waiting") {
            G.phase = "ground";
        }

        emit("get-drop-status");
        emit("get-inventory");
        emit("get-throwable-inventory");
        emit("get-zone-state");
        emit("get-gloo-walls");
        emit("get-smoke-clouds");
        emit("combat-state");

        // Someone has to start the aircraft; the server ignores repeats.
        if (!aircraftRequested) {
            aircraftRequested = true;
            setTimeout(() => {
                if (!G.flight && G.phase !== "over") emit("start-aircraft-drop");
            }, 5000);
        }
    }

    // ---------------- controls ----------------

    function moveDirection() {
        // 3D view: movement is relative to where the camera looks.
        if (typeof Render.moveVector === "function") {
            return Render.moveVector(G.keys);
        }

        let dx = 0, dz = 0;
        if (G.keys.has("w")) dz -= 1;
        if (G.keys.has("s")) dz += 1;
        if (G.keys.has("a")) dx -= 1;
        if (G.keys.has("d")) dx += 1;
        const len = Math.hypot(dx, dz);
        return len ? { x: dx / len, z: dz / len } : null;
    }

    const clamp = v => Math.max(-995, Math.min(995, v));

    function cursorWorld() {
        return Render.toWorld(G.mouse.x, G.mouse.y);
    }

    function nearestEnemyToCursor(maxDistance = 8) {
        const cursor = cursorWorld();
        let best = null;
        let bestD = maxDistance;

        for (const [id, p] of G.players) {
            if (id === G.self.id || !p.alive || !p.pos || p.hidden) continue;
            if (isTeammate(id)) continue;
            const d = distance2d(p.pos, cursor);
            if (d < bestD) { best = { id, p }; bestD = d; }
        }

        return best;
    }

    function fire() {
        if (G.phase !== "ground" || !G.self.alive || G.self.knocked || !G.self.pos) return;
        if (!G.activeWeapon) return UI.feed("No weapon — find one and press F", "info");
        if (G.reloading) return;

        const from = G.self.pos;

        // 3D view: shoot exactly where the crosshair points.
        if (typeof Render.aimTarget === "function") {
            const aim = Render.aimTarget();
            if (!aim) return;

            emit("fire-weapon", {
                targetId: aim.id,
                direction: {
                    x: aim.point.x - from.x,
                    y: aim.point.y - (from.y + 1.5),
                    z: aim.point.z - from.z
                }
            });
            return;
        }

        const target = nearestEnemyToCursor();
        if (!target) return;

        const to = target.p.pos;

        emit("fire-weapon", {
            targetId: target.id,
            direction: { x: to.x - from.x, y: to.y + 1.05 - (from.y + 1.5), z: to.z - from.z }
        });
    }

    function throwAtCursor(type) {
        if (G.phase !== "ground" || !G.self.pos) return;
        const c = cursorWorld();
        const dx = c.x - G.self.pos.x;
        const dz = c.z - G.self.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        const reach = Math.min(d, 38);

        emit("throw-grenade", {
            type,
            target: {
                x: G.self.pos.x + (dx / d) * reach,
                y: G.self.pos.y,
                z: G.self.pos.z + (dz / d) * reach
            }
        });
    }

    function glooWall() {
        if (G.phase !== "ground" || !G.self.pos) return;
        const c = cursorWorld();
        const dx = c.x - G.self.pos.x;
        const dz = c.z - G.self.pos.z;
        const d = Math.hypot(dx, dz) || 1;

        emit("deploy-gloo-wall", {
            position: { x: G.self.pos.x + (dx / d) * 4, y: G.self.pos.y, z: G.self.pos.z + (dz / d) * 4 },
            facing: (Math.atan2(dx, dz) * 180) / Math.PI
        });
    }

    function pickupNearest(swap) {
        if (!G.self.pos) return;
        let best = null;
        let bestD = 5;

        for (const item of G.loot.values()) {
            const d = distance2d(item.position, G.self.pos);
            if (d < bestD) { best = item; bestD = d; }
        }

        if (!best) return UI.feed("Nothing within reach — walk onto an item", "info");

        emit("pickup-loot", {
            lootId: best.lootId,
            ...(swap && G.activeWeapon ? { swapWeaponId: G.activeWeapon } : {})
        });
    }

    function reviveNearest() {
        if (!G.self.pos) return;
        for (const [id, p] of G.players) {
            if (id !== G.self.id && p.knocked && isTeammate(id) && p.pos && distance2d(p.pos, G.self.pos) <= 2.5) {
                return emit("revive-teammate", { targetId: id });
            }
        }
        UI.feed("No knocked teammate within reach", "info");
    }

    function onKeyDown(e) {
        if (e.target.tagName === "INPUT") return;
        const k = e.key.toLowerCase();
        G.keys.add(k);
        if (e.repeat) return;

        switch (k) {
            case " ":
                e.preventDefault();
                if (G.phase === "aircraft" && G.flight) {
                    const progress = Math.min(1, Math.max(0, (Date.now() - G.flight.startedAt) / G.flight.durationMs));
                    emit("jump-from-aircraft", { progress });
                } else if (G.phase === "dropping" && !G.parachute) {
                    emit("deploy-parachute");
                }
                break;
            case "r": emit("reload-weapon"); break;
            case "b": if (typeof ModeUI !== "undefined") ModeUI.toggleStore(); break;
            case "m": window.HUD?.toggleMap(); break;
            case "f": pickupNearest(e.shiftKey); break;
            case "g": throwAtCursor("frag"); break;
            case "t": throwAtCursor("smoke"); break;
            case "y": throwAtCursor("flash"); break;
            case "q": glooWall(); break;
            case "h": emit("use-healing-item", { itemId: "bandage" }); break;
            case "j": emit("use-healing-item", { itemId: "medkit" }); break;
            case "x": emit("cancel-healing"); emit("cancel-revive"); break;
            case "e": reviveNearest(); break;
            case "1": case "2": case "3": {
                const w = G.inventory?.weapons?.[Number(k) - 1];
                if (w) emit("equip-weapon", { weaponId: w.weaponId });
                break;
            }
        }
    }

    function bindInput() {
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", e => G.keys.delete(e.key.toLowerCase()));
        window.addEventListener("blur", () => G.keys.clear());

        const c = Render.canvas;
        c.addEventListener("mousemove", e => { G.mouse.x = e.clientX; G.mouse.y = e.clientY; });
        c.addEventListener("mousedown", e => {
            if (e.button === 0) { G.mouse.down = true; fire(); }
            if (e.button === 2) Render.setAds?.(true);          // right mouse: aim
        });
        window.addEventListener("mouseup", e => {
            if (e.button === 2) Render.setAds?.(false);
            else G.mouse.down = false;
        });
        c.addEventListener("wheel", e => {
            e.preventDefault();
            G.zoom = Math.max(0.3, Math.min(14, G.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        }, { passive: false });
        c.addEventListener("contextmenu", e => e.preventDefault());
    }

    // ---------------- loops ----------------

    function startLoops() {
        // Walking.
        setInterval(() => {
            if (G.phase !== "ground" || !G.self.alive || !G.self.pos) return;
            const dir = moveDirection();
            if (!dir) return;

            const step = G.self.knocked ? CRAWL_STEP : MOVE_STEP;
            G.self.pos = {
                x: clamp(G.self.pos.x + dir.x * step),
                y: G.jumped ? GROUND_Y : G.self.pos.y,
                z: clamp(G.self.pos.z + dir.z * step)
            };
            emit("player-move", { position: G.self.pos });
        }, MOVE_TICK_MS);

        // Parachute descent (steer with WASD).
        setInterval(() => {
            if (G.phase !== "dropping" || !G.self.pos) return;
            const dir = moveDirection();
            const next = {
                x: clamp(G.self.pos.x + (dir ? dir.x * 20 : 0)),
                y: Math.max(GROUND_Y, G.self.pos.y - DROP_STEP),
                z: clamp(G.self.pos.z + (dir ? dir.z * 20 : 0))
            };

            if (!G.parachute && next.y <= 500) {
                G.parachute = true;
                emit("deploy-parachute");
            }

            emit("drop-position-update", { position: next });
        }, DROP_TICK_MS);

        // Automatic fire while the button is held.
        setInterval(() => { if (G.mouse.down) fire(); }, FIRE_TICK_MS);

        // Loot around the player.
        setInterval(() => { if (G.phase === "ground") emit("get-nearby-loot"); }, 1000);

        // Draw.
        const frame = () => {
            if (G.phase !== "lobby" && G.phase !== "waiting") {
                Render.draw();
                UI.updateHud();
            }
            requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    }

    // Accept a server-placed position (respawns) as the new baseline.
    function resetAck(position) {
        lastAckPos = position ? { ...position } : null;
    }

    // Actions for the touch controls (js/hud.js).
    function act(name, arg) {
        switch (name) {
            case "fire-down": G.mouse.down = true; fire(); break;
            case "fire-up": G.mouse.down = false; break;
            case "reload": emit("reload-weapon"); break;
            case "pickup": pickupNearest(Boolean(arg)); break;
            case "revive": reviveNearest(); break;
            case "throw": throwAtCursor(arg || "frag"); break;
            case "gloo": glooWall(); break;
            case "heal": emit("use-healing-item", { itemId: arg || "bandage" }); break;
            case "cancel": emit("cancel-healing"); emit("cancel-revive"); break;
            case "slot": {
                const w = G.inventory?.weapons?.[Number(arg)];
                if (w) emit("equip-weapon", { weaponId: w.weaponId });
                break;
            }
            case "jump":
                if (G.phase === "aircraft" && G.flight) {
                    const progress = Math.min(1, Math.max(0, (Date.now() - G.flight.startedAt) / G.flight.durationMs));
                    emit("jump-from-aircraft", { progress });
                } else if (G.phase === "dropping" && !G.parachute) {
                    emit("deploy-parachute");
                }
                break;
        }
    }

    // Nearest loot within pickup reach / knocked teammate within revive reach.
    function nearbyContext() {
        const me = G.self.pos;
        if (!me) return { loot: null, knockedMate: false };
        let loot = null, best = 5;
        for (const item of G.loot.values()) {
            const d = Math.hypot(item.position.x - me.x, item.position.z - me.z);
            if (d < best) { best = d; loot = item; }
        }
        let knockedMate = false;
        for (const [id, p] of G.players) {
            if (p.knocked && p.pos && isTeammate(id) && Math.hypot(p.pos.x - me.x, p.pos.z - me.z) < 3) knockedMate = true;
        }
        return { loot, knockedMate };
    }

    return {
        act,
        nearbyContext,
        resetAck,
        connect,
        disconnect,
        emit,
        bindInput,
        startLoops,
        name
    };
})();
