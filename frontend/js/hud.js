// ==========================================
// Mobile HUD: touch controls, minimap, full map, settings
// ==========================================
// - Floating joystick (left), drag anywhere else to look.
// - Fire (right, plus a left fire button), aim, reload, grenades
//   (tap to throw, small button cycles frag/smoke/flash), gloo
//   wall, bandage, medkit, weapon slots.
// - Context buttons: jump/parachute in the air, pick up / swap
//   near loot, revive near a knocked team-mate, store in a buy
//   phase.
// - Minimap (top right; tap or M for the full map).
// - Settings: touch on/off, left-handed, sensitivity, graphics,
//   FPS/ping, and a layout editor (drag, size, opacity, save,
//   reset). Saved in this browser.
// Desktop keys still work; touch controls show automatically on
// phones/tablets and can be switched on in settings for testing.

const HUD = (() => {
    const $ = id => document.getElementById(id);
    const KEY = "ibf.hud.v1";

    // ---------------- settings ----------------

    const DEFAULTS = {
        touch: "auto",          // auto | on | off
        leftHanded: false,
        sens: 1,                // camera sensitivity multiplier
        aimSens: 1,
        opacity: 0.85,
        scale: 1,
        showFps: true,
        layout: {}              // id -> { x, y, size } (x/y = fraction of screen)
    };
    let cfg = { ...DEFAULTS };
    try { cfg = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch {}
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch {} };

    window.IBF_SENS = () => cfg.sens;

    const touchCapable = () => matchMedia?.("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
    const touchOn = () => cfg.touch === "on" || (cfg.touch === "auto" && touchCapable());

    // ---------------- icons ----------------

    const svg = (body, vb = "0 0 24 24") => `<svg viewBox="${vb}" aria-hidden="true">${body}</svg>`;
    const I = {
        fire: svg('<path d="M10 2h4l1 4v14a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2V6z" fill="currentColor"/><rect x="9" y="18" width="6" height="2" fill="#000" opacity=".3"/>'),
        aim: svg('<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>'),
        reload: svg('<path d="M20 12a8 8 0 1 1-2.3-5.6" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M20 3v6h-6" fill="none" stroke="currentColor" stroke-width="2.4"/>'),
        grenade: svg('<ellipse cx="12" cy="14" rx="6" ry="7" fill="currentColor"/><rect x="10" y="4" width="4" height="4" fill="currentColor"/><path d="M14 5h4v2" stroke="currentColor" stroke-width="2" fill="none"/>'),
        gloo: svg('<path d="M3 20V9q9-7 18 0v11z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 20v-7M12 20v-9M17 20v-7" stroke="currentColor" stroke-width="2"/>'),
        bandage: svg('<rect x="3" y="8" width="18" height="8" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 9v6M9 12h6" stroke="currentColor" stroke-width="2"/>'),
        medkit: svg('<rect x="3" y="7" width="18" height="13" rx="2" fill="currentColor"/><path d="M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 10v7M8.5 13.5h7" stroke="#b3221e" stroke-width="2.6"/>'),
        pickup: svg('<path d="M7 11V5a1.5 1.5 0 0 1 3 0v5V3.5a1.5 1.5 0 0 1 3 0V10V5a1.5 1.5 0 0 1 3 0v6V8a1.5 1.5 0 0 1 3 0v6c0 4-3 7-7 7h-1c-3 0-5-2-6.5-4L2 13a1.5 1.5 0 0 1 2.4-1.8z" fill="currentColor"/>'),
        swap: svg('<path d="M4 8h13l-3-3M20 16H7l3 3" fill="none" stroke="currentColor" stroke-width="2.2"/>'),
        revive: svg('<path d="M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11z" fill="currentColor"/><path d="M12 9v6M9 12h6" stroke="#0a3" stroke-width="2"/>'),
        jump: svg('<path d="M12 3l7 8h-4v9H9v-9H5z" fill="currentColor"/>'),
        store: svg('<path d="M3 4h2l2 11h11l2-8H6.2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="19" r="1.6" fill="currentColor"/><circle cx="17" cy="19" r="1.6" fill="currentColor"/>'),
        gear: svg('<circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" stroke="currentColor" stroke-width="2"/>'),
        full: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2.2"/>'),
        cancel: svg('<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.6"/>')
    };

    // ---------------- buttons ----------------
    // x/y: centre as a fraction of the screen; size in px (before scale).
    // show(ctx): context rule; hold: fires down/up.

    let grenadeType = "frag";
    const GRENADES = ["frag", "smoke", "flash"];
    const GRENADE_NAMES = { frag: "Frag", smoke: "Smoke", flash: "Flash" };

    const BUTTONS = [
        { id: "fire", icon: I.fire, x: 0.885, y: 0.70, size: 92, hold: true, cls: "big" },
        { id: "fire2", icon: I.fire, x: 0.1, y: 0.5, size: 58, hold: true },
        { id: "aim", icon: I.aim, x: 0.745, y: 0.72, size: 56 },
        { id: "reload", icon: I.reload, x: 0.8, y: 0.91, size: 54 },
        { id: "grenade", icon: I.grenade, x: 0.655, y: 0.86, size: 54, label: () => GRENADE_NAMES[grenadeType] + " " + (G.throwables?.[grenadeType] ?? 0) },
        { id: "grenade-type", icon: I.swap, x: 0.715, y: 0.85, size: 32 },
        { id: "gloo", icon: I.gloo, x: 0.955, y: 0.53, size: 54, label: () => String(G.throwables?.gloo ?? 0) },
        { id: "bandage", icon: I.bandage, x: 0.2, y: 0.3, size: 46, label: () => healCount("bandage") },
        { id: "medkit", icon: I.medkit, x: 0.26, y: 0.3, size: 46, label: () => healCount("medkit") },
        { id: "cancel", icon: I.cancel, x: 0.5, y: 0.32, size: 44, show: () => Boolean(G.healing) },
        { id: "jump", icon: I.jump, x: 0.885, y: 0.70, size: 92, cls: "big", show: c => c.air,
          label: () => (G.phase === "aircraft" ? "Jump" : "Parachute") },
        { id: "pickup", icon: I.pickup, x: 0.58, y: 0.56, size: 58, show: c => Boolean(c.loot), label: c => c.loot?.name || "" },
        { id: "swap", icon: I.swap, x: 0.58, y: 0.4, size: 42, show: c => c.loot?.itemType === "weapon" && G.activeWeapon, label: () => "Swap" },
        { id: "revive", icon: I.revive, x: 0.47, y: 0.62, size: 58, show: c => c.knockedMate, label: () => "Revive" },
        { id: "store", icon: I.store, x: 0.33, y: 0.3, size: 50, show: c => c.buyOpen, label: () => "Store" }
    ];

    function healCount(id) {
        const h = G.inventory?.healing || G.inventory?.healingItems || {};
        const v = typeof h[id] === "object" ? h[id]?.quantity : h[id];
        return String(v ?? 0);
    }

    function press(id, down) {
        if (editing) return;
        const act = (n, a) => Game.act?.(n, a);
        switch (id) {
            case "fire": case "fire2": act(down ? "fire-down" : "fire-up"); break;
            case "aim": if (down) Render.setAds?.(!Render.isAiming?.()); break;
            case "reload": if (down) act("reload"); break;
            case "grenade": if (down) act("throw", grenadeType); break;
            case "grenade-type":
                if (down) { grenadeType = GRENADES[(GRENADES.indexOf(grenadeType) + 1) % GRENADES.length]; UI.feed(`Grenade: ${GRENADE_NAMES[grenadeType]}`, "info"); }
                break;
            case "gloo": if (down) act("gloo"); break;
            case "bandage": if (down) act("heal", "bandage"); break;
            case "medkit": if (down) act("heal", "medkit"); break;
            case "cancel": if (down) act("cancel"); break;
            case "jump": if (down) act("jump"); break;
            case "pickup": if (down) act("pickup", false); break;
            case "swap": if (down) act("pickup", true); break;
            case "revive": if (down) act("revive"); break;
            case "store": if (down && typeof ModeUI !== "undefined") ModeUI.toggleStore(true); break;
        }
    }

    // ---------------- DOM ----------------

    let root, joy, knob, weaponsBar, editing = false, selected = null;
    const els = new Map();

    function build() {
        const game = $("screen-game");
        if (!game || $("touch-hud")) return;

        game.insertAdjacentHTML("beforeend", `
            <div id="touch-hud">
                <div id="look-pad"></div>
                <div id="joy"><div id="joy-knob"></div></div>
                <div id="touch-weapons"></div>
            </div>
            <canvas id="minimap" width="300" height="300" title="Map (M)"></canvas>
            <div id="hud-stats"></div>
            <div id="top-buttons">
                <button id="btn-full" title="Fullscreen">${I.full}</button>
                <button id="btn-settings" title="Settings">${I.gear}</button>
            </div>
            <div id="bigmap" class="hidden"><canvas id="bigmap-canvas"></canvas><button id="bigmap-close" aria-label="Close map">✕</button><div class="bigmap-legend">You ▲ · Team ● · Safe zone ○ · Next zone ┄ · Plane path —</div></div>
            <div id="hud-settings" class="hidden" role="dialog" aria-label="Settings"></div>
            <div id="hud-edit-bar" class="hidden">
                <span>Drag buttons to move them. Tap one to select it.</span>
                <label>Size <input type="range" id="edit-size" min="0.6" max="1.6" step="0.05"></label>
                <label>Opacity <input type="range" id="edit-opacity" min="0.3" max="1" step="0.05"></label>
                <button id="edit-save" class="primary">Save</button>
                <button id="edit-reset">Reset</button>
                <button id="edit-exit">Exit</button>
            </div>
            <div id="rotate-hint">Turn your device sideways to play</div>`);

        root = $("touch-hud");
        joy = $("joy");
        knob = $("joy-knob");
        weaponsBar = $("touch-weapons");

        for (const b of BUTTONS) {
            const el = document.createElement("button");
            el.className = "tbtn " + (b.cls || "");
            el.dataset.id = b.id;
            el.innerHTML = b.icon + `<span class="tlabel"></span>`;
            root.appendChild(el);
            els.set(b.id, el);
            bindButton(el, b);
        }

        bindLook();
        $("minimap").addEventListener("click", () => toggleMap(true));
        $("bigmap-close").addEventListener("click", () => toggleMap(false));
        $("btn-settings").addEventListener("click", openSettings);
        $("btn-full").addEventListener("click", fullscreen);
        $("edit-save").addEventListener("click", () => { save(); setEditing(false); UI.feed("HUD layout saved", "good"); });
        $("edit-reset").addEventListener("click", () => { cfg.layout = {}; cfg.scale = 1; cfg.opacity = DEFAULTS.opacity; applyLayout(); syncEditInputs(); });
        $("edit-exit").addEventListener("click", () => { try { cfg = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch {} setEditing(false); applyLayout(); });
        $("edit-size").addEventListener("input", e => {
            const v = Number(e.target.value);
            if (selected) { cfg.layout[selected] = { ...posOf(selected), size: v }; } else cfg.scale = v;
            applyLayout();
        });
        $("edit-opacity").addEventListener("input", e => { cfg.opacity = Number(e.target.value); applyLayout(); });

        applyMode();
        applyLayout();
        addEventListener("resize", applyLayout);
        setInterval(tick, 150);
        requestAnimationFrame(drawMaps);
    }

    function posOf(id) {
        const b = BUTTONS.find(x => x.id === id);
        const saved = cfg.layout[id] || {};
        let x = saved.x ?? b.x;
        if (cfg.leftHanded && saved.x === undefined) x = 1 - x;
        return { x, y: saved.y ?? b.y, size: saved.size ?? 1 };
    }

    function applyLayout() {
        if (!root) return;
        const W = innerWidth, H = innerHeight;
        const unit = Math.min(1.25, Math.max(0.7, Math.min(W, H) / 420)) * cfg.scale;
        for (const b of BUTTONS) {
            const el = els.get(b.id);
            const p = posOf(b.id);
            const s = b.size * unit * p.size;
            Object.assign(el.style, {
                width: s + "px", height: s + "px",
                left: (p.x * W - s / 2) + "px", top: (p.y * H - s / 2) + "px",
                opacity: cfg.opacity
            });
        }
        joy.style.opacity = cfg.opacity;
        root.classList.toggle("left-handed", cfg.leftHanded);
    }

    function applyMode() {
        document.body.classList.toggle("touch", touchOn());
        document.body.classList.toggle("show-fps", cfg.showFps);
    }

    // ---------------- input ----------------

    function bindButton(el, b) {
        let dragging = null;
        el.addEventListener("pointerdown", e => {
            e.preventDefault();
            e.stopPropagation();
            el.setPointerCapture(e.pointerId);
            if (editing) {
                selected = b.id;
                els.forEach(x => x.classList.toggle("selected", x === el));
                syncEditInputs();
                const r = el.getBoundingClientRect();
                dragging = { dx: e.clientX - (r.left + r.width / 2), dy: e.clientY - (r.top + r.height / 2) };
                return;
            }
            el.classList.add("down");
            press(b.id, true);
        });
        el.addEventListener("pointermove", e => {
            if (!editing || !dragging) return;
            const x = (e.clientX - dragging.dx) / innerWidth, y = (e.clientY - dragging.dy) / innerHeight;
            cfg.layout[b.id] = { ...posOf(b.id), x: Math.min(0.98, Math.max(0.02, x)), y: Math.min(0.98, Math.max(0.02, y)) };
            applyLayout();
        });
        const up = () => {
            dragging = null;
            if (el.classList.contains("down")) { el.classList.remove("down"); if (b.hold) press(b.id, false); }
        };
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
        el.addEventListener("contextmenu", e => e.preventDefault());
    }

    // Left part of the screen: floating joystick. Everywhere else: look.
    function bindLook() {
        const pad = $("look-pad");
        const pointers = new Map();
        const R = () => 60 * cfg.scale;

        pad.addEventListener("pointerdown", e => {
            if (editing) return;
            e.preventDefault();
            pad.setPointerCapture(e.pointerId);
            const joySide = cfg.leftHanded ? e.clientX > innerWidth * 0.6 : e.clientX < innerWidth * 0.4;
            const usingJoy = [...pointers.values()].some(p => p.kind === "joy");
            if (joySide && e.clientY > innerHeight * 0.3 && !usingJoy) {
                pointers.set(e.pointerId, { kind: "joy", x0: e.clientX, y0: e.clientY });
                joy.style.left = e.clientX + "px";
                joy.style.top = e.clientY + "px";
                joy.classList.add("active");
                knob.style.transform = "translate(-50%, -50%)";
            } else {
                pointers.set(e.pointerId, { kind: "look", x: e.clientX, y: e.clientY });
            }
        });
        pad.addEventListener("pointermove", e => {
            const p = pointers.get(e.pointerId);
            if (!p) return;
            if (p.kind === "joy") {
                let dx = e.clientX - p.x0, dy = e.clientY - p.y0;
                const len = Math.hypot(dx, dy), r = R();
                if (len > r) { dx *= r / len; dy *= r / len; }
                knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
                G.touchMove = { x: dx / r, y: dy / r };
            } else {
                Render.look?.((e.clientX - p.x) * 1.6, (e.clientY - p.y) * 1.6);
                p.x = e.clientX;
                p.y = e.clientY;
            }
        });
        const end = e => {
            const p = pointers.get(e.pointerId);
            if (!p) return;
            pointers.delete(e.pointerId);
            if (p.kind === "joy") {
                G.touchMove = null;
                joy.classList.remove("active");
            }
        };
        pad.addEventListener("pointerup", end);
        pad.addEventListener("pointercancel", end);
    }

    // ---------------- per-tick state ----------------

    function tick() {
        if (!root) return;
        const ctx = {
            air: G.phase === "aircraft" || (G.phase === "dropping" && !G.parachute),
            buyOpen: Boolean(G.store?.buyEndsAt && G.store.buyEndsAt > Date.now()),
            ...(G.phase === "ground" && G.self.alive ? Game.nearbyContext?.() || {} : {})
        };
        const alive = G.self.alive && G.phase !== "over";
        for (const b of BUTTONS) {
            const el = els.get(b.id);
            let visible = alive && (b.show ? b.show(ctx) : G.phase === "ground");
            // The jump button sits where the fire button is: show one or the other.
            if (b.id === "fire" && ctx.air) visible = false;
            if (editing) visible = true;
            el.classList.toggle("hidden", !visible);
            if (b.label) el.querySelector(".tlabel").textContent = b.label(ctx);
        }
        els.get("aim").classList.toggle("on", Boolean(Render.isAiming?.()));

        // Weapon slots.
        const weapons = G.inventory?.weapons || [];
        const html = weapons.slice(0, 3).map((w, i) => {
            const active = w.weaponId === G.activeWeapon;
            const ammo = active && G.magazine !== null && G.magazine !== undefined ? `${G.magazine}` : "";
            return `<button data-slot="${i}" class="${active ? "active" : ""}"><b>${i + 1}</b> ${w.name}${ammo ? ` <i>${ammo}</i>` : ""}</button>`;
        }).join("");
        if (weaponsBar.dataset.html !== html) {
            weaponsBar.dataset.html = html;
            weaponsBar.innerHTML = html;
            weaponsBar.querySelectorAll("[data-slot]").forEach(btn =>
                btn.addEventListener("pointerdown", e => { e.stopPropagation(); Game.act?.("slot", btn.dataset.slot); }));
        }

        // FPS / ping.
        $("hud-stats").textContent = `${Render.getFps?.() ?? 0} FPS${ping ? ` · ${ping} ms` : ""}`;
    }

    let ping = 0;
    setInterval(async () => {
        if (document.hidden || !G.matchId) return;
        const t = performance.now();
        try { await fetch("/api/health", { cache: "no-store" }); ping = Math.round(performance.now() - t); } catch { ping = 0; }
    }, 5000);

    // ---------------- maps ----------------

    let mapOpen = false;
    function toggleMap(force) {
        mapOpen = force ?? !mapOpen;
        $("bigmap")?.classList.toggle("hidden", !mapOpen);
        if (mapOpen) document.exitPointerLock?.();
    }

    const RARITY = { common: "#d8d8d8", uncommon: "#55d16a", rare: "#3d9bff", epic: "#b466ff", legendary: "#ffa82e" };

    // Draw the world into a canvas. view: { cx, cz, range } in metres.
    function drawWorld(c, view, full) {
        const g = c.getContext("2d");
        const W = c.width, H = c.height;
        const s = Math.min(W, H) / (view.range * 2);
        const X = x => W / 2 + (x - view.cx) * s;
        const Z = z => H / 2 + (z - view.cz) * s;

        g.fillStyle = "#3d5230";
        g.fillRect(0, 0, W, H);

        const layout = Render.getLayout?.();
        if (layout) {
            g.strokeStyle = "#5d5f62";
            g.lineCap = "round";
            for (const road of layout.roads || []) {
                g.lineWidth = Math.max(1.5, road.width * s);
                g.beginPath();
                road.points.forEach((p, i) => (i ? g.lineTo(X(p.x), Z(p.z)) : g.moveTo(X(p.x), Z(p.z))));
                g.stroke();
            }
            g.fillStyle = "#c9b48e";
            for (const b of layout.buildings || []) {
                g.fillRect(X(b.min.x), Z(b.min.z), Math.max(1, (b.max.x - b.min.x) * s), Math.max(1, (b.max.z - b.min.z) * s));
            }
            if (full) {
                g.fillStyle = "#fff";
                g.font = "bold 13px system-ui";
                g.textAlign = "center";
                for (const t of layout.towns || []) if (t.name) g.fillText(t.name, X(t.center.x), Z(t.center.z) - 6);
            }
        }

        // Map edge.
        g.strokeStyle = "rgba(255,255,255,.35)";
        g.lineWidth = 1;
        g.strokeRect(X(-1000), Z(-1000), 2000 * s, 2000 * s);

        // Plane path.
        if (G.flight && (full || G.phase === "aircraft")) {
            const f = G.flight.flightPath;
            g.strokeStyle = "#fff";
            g.setLineDash([]);
            g.lineWidth = 2;
            g.beginPath(); g.moveTo(X(f.start.x), Z(f.start.z)); g.lineTo(X(f.end.x), Z(f.end.z)); g.stroke();
        }

        // Zones.
        const z = G.zone;
        if (z?.current) {
            g.strokeStyle = z.arena ? "#7fd3ff" : "#4fb3ff";
            g.lineWidth = 2;
            g.beginPath(); g.arc(X(z.current.center.x), Z(z.current.center.z), z.current.radius * s, 0, Math.PI * 2); g.stroke();
            if (z.next) {
                g.strokeStyle = "#fff";
                g.setLineDash([6, 5]);
                g.beginPath(); g.arc(X(z.next.center.x), Z(z.next.center.z), z.next.radius * s, 0, Math.PI * 2); g.stroke();
                g.setLineDash([]);
            }
        }

        // Loot (minimap only, it is local).
        if (!full) {
            for (const item of G.loot.values()) {
                g.fillStyle = RARITY[item.rarity] || "#ddd";
                g.fillRect(X(item.position.x) - 1.5, Z(item.position.z) - 1.5, 3, 3);
            }
        }

        // Team-mates.
        for (const [id, p] of G.players) {
            if (!p.pos || !isTeammate(id)) continue;
            g.fillStyle = p.alive ? (p.knocked ? "#f2a541" : "#4fb3ff") : "#777";
            g.beginPath(); g.arc(X(p.pos.x), Z(p.pos.z), full ? 5 : 4, 0, Math.PI * 2); g.fill();
        }

        // Me: arrow pointing where the camera looks.
        const me = G.phase === "aircraft" && G.flight ? null : G.self.pos;
        if (me) {
            const yaw = Render.getYaw?.() ?? 0;
            g.save();
            g.translate(X(me.x), Z(me.z));
            g.rotate(-yaw);
            g.fillStyle = "#ffe14d";
            g.strokeStyle = "#000";
            g.lineWidth = 1.5;
            const a = full ? 9 : 8;
            g.beginPath(); g.moveTo(0, -a); g.lineTo(a * 0.65, a * 0.7); g.lineTo(0, a * 0.35); g.lineTo(-a * 0.65, a * 0.7); g.closePath();
            g.fill(); g.stroke();
            g.restore();
        }
    }

    function drawMaps() {
        requestAnimationFrame(drawMaps);
        if ($("screen-game")?.classList.contains("hidden")) return;
        const mini = $("minimap");
        if (mini) {
            const me = G.self.pos || { x: 0, z: 0 };
            drawWorld(mini, { cx: me.x, cz: me.z, range: 160 }, false);
        }
        if (mapOpen) {
            const c = $("bigmap-canvas");
            const size = Math.min(innerWidth, innerHeight) - 40;
            if (c.width !== size) { c.width = c.height = size; }
            drawWorld(c, { cx: 0, cz: 0, range: 1050 }, true);
        }
    }

    // ---------------- settings ----------------

    function openSettings() {
        document.exitPointerLock?.();
        const quality = new URLSearchParams(location.search).get("gfx") || "auto";
        const el = $("hud-settings");
        el.innerHTML = `
            <div class="set-head"><h2>Settings</h2><button id="set-close" aria-label="Close">✕</button></div>
            <h3>Controls</h3>
            <label>Touch controls
                <select id="set-touch"><option value="auto">Automatic</option><option value="on">Always on</option><option value="off">Off</option></select></label>
            <label><input type="checkbox" id="set-left"> Left-handed (swap sides)</label>
            <button id="set-edit">Customize HUD layout…</button>
            <h3>Sensitivity</h3>
            <label>Camera <input type="range" id="set-sens" min="0.3" max="2.5" step="0.05"></label>
            <h3>Graphics</h3>
            <label>Quality
                <select id="set-gfx"><option value="auto">Automatic</option><option value="high">High</option><option value="low">Low (faster)</option></select></label>
            <label><input type="checkbox" id="set-fps"> Show FPS and ping</label>
            <h3>Keyboard (PC)</h3>
            <p class="hint">WASD move · mouse look · left click fire · right click aim · R reload · 1–3 weapons · F pick up · G/T/Y grenades · Q gloo wall · H/J heal · E revive · B store · M map · Space jump/parachute</p>`;
        el.classList.remove("hidden");
        $("set-touch").value = cfg.touch;
        $("set-left").checked = cfg.leftHanded;
        $("set-sens").value = cfg.sens;
        $("set-gfx").value = quality;
        $("set-fps").checked = cfg.showFps;

        $("set-close").addEventListener("click", () => el.classList.add("hidden"));
        $("set-touch").addEventListener("change", e => { cfg.touch = e.target.value; save(); applyMode(); });
        $("set-left").addEventListener("change", e => { cfg.leftHanded = e.target.checked; save(); applyLayout(); });
        $("set-sens").addEventListener("input", e => { cfg.sens = Number(e.target.value); save(); });
        $("set-fps").addEventListener("change", e => { cfg.showFps = e.target.checked; save(); applyMode(); });
        $("set-gfx").addEventListener("change", e => {
            const u = new URL(location.href);
            if (e.target.value === "auto") u.searchParams.delete("gfx"); else u.searchParams.set("gfx", e.target.value);
            if (confirm("Reload the game to change graphics quality?")) location.href = u.toString();
        });
        $("set-edit").addEventListener("click", () => { el.classList.add("hidden"); setEditing(true); });
    }

    function syncEditInputs() {
        $("edit-size").value = selected ? posOf(selected).size : cfg.scale;
        $("edit-opacity").value = cfg.opacity;
    }

    function setEditing(on) {
        editing = on;
        selected = null;
        if (on && !touchOn()) { cfg.touch = "on"; applyMode(); }
        document.body.classList.toggle("hud-editing", on);
        $("hud-edit-bar").classList.toggle("hidden", !on);
        els.forEach(x => x.classList.remove("selected"));
        syncEditInputs();
        tick();
    }

    function fullscreen() {
        const d = document.documentElement;
        if (!document.fullscreenElement) {
            (d.requestFullscreen?.() || Promise.resolve()).then(() => screen.orientation?.lock?.("landscape").catch(() => {})).catch(() => {});
        } else {
            document.exitFullscreen?.();
        }
    }

    // Build once the page is ready.
    if (document.readyState === "loading") addEventListener("DOMContentLoaded", build);
    else build();

    return { toggleMap, openSettings };
})();
window.HUD = HUD;
