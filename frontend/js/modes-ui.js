// ==========================================
// Game modes and the store: in-match HUD
// ==========================================
// - Mode bar: Battle Royale / Clash Squad round + score /
//   Team Deathmatch kills + clock.
// - Coins and the store (B), open only during a buy phase.
// - Respawn / next-round overlay instead of the death screen
//   in Clash Squad and Team Deathmatch.
// Server events: mode-state, store-state, store-purchased,
// store-error, coins-updated, round-ended, mode-respawn,
// mode-respawn-pending, teams-updated.

const ModeUI = (() => {
    const $ = id => document.getElementById(id);
    let emit = () => {};
    let storeOpen = false;
    let serverOffset = 0;            // server clock - local clock
    const now = () => Date.now() + serverOffset;

    const TYPE_NAMES = { br: "Battle Royale", cs: "Clash Squad", tdm: "Team Deathmatch" };

    // ---------------- DOM ----------------

    function build() {
        const game = $("screen-game");
        if (!game || $("hud-mode")) return;
        game.insertAdjacentHTML("beforeend", `
            <div id="hud-mode" class="hud hidden"></div>
            <div id="hud-coins" class="hud hidden"></div>
            <div id="hud-respawn" class="hud hidden"></div>
            <div id="store" class="hud hidden" role="dialog" aria-label="Store">
                <div class="store-head">
                    <h2>Store</h2>
                    <span id="store-coins"></span>
                    <span id="store-timer"></span>
                    <button id="store-close" aria-label="Close store">✕</button>
                </div>
                <div id="store-list"></div>
                <p class="hint">B opens and closes the store. Buying is only possible during the buy phase.</p>
            </div>`);
        $("store-close").addEventListener("click", () => toggleStore(false));
        $("store-list").addEventListener("click", e => {
            const b = e.target.closest("[data-buy]");
            if (b && !b.disabled) emit("store-buy", { key: b.dataset.buy });
        });
    }

    function buyOpen() {
        return Boolean(G.store?.buyEndsAt && G.store.buyEndsAt > now());
    }

    function renderStore() {
        if (!G.store || !$("store-list")) return;
        $("store-coins").textContent = `🪙 ${G.store.coins}`;
        const groups = new Map();
        for (const item of G.store.catalog || []) {
            if (!groups.has(item.category)) groups.set(item.category, []);
            groups.get(item.category).push(item);
        }
        const open = buyOpen();
        $("store-list").innerHTML = [...groups].map(([cat, items]) => `
            <div class="store-cat">
                <h3>${cat}</h3>
                <div class="store-items">${items.map(it => `
                    <button class="store-item" data-buy="${it.key}" ${!open || it.price > G.store.coins ? "disabled" : ""}>
                        <span class="si-name">${it.name}</span>
                        <span class="si-price">🪙 ${it.price}</span>
                    </button>`).join("")}</div>
            </div>`).join("");
    }

    function toggleStore(force) {
        build();
        storeOpen = force ?? !storeOpen;
        if (storeOpen && !buyOpen()) {
            storeOpen = false;
            UI.feed("The store is closed: buy phase only", "info");
        }
        $("store").classList.toggle("hidden", !storeOpen);
        if (storeOpen) {
            document.exitPointerLock?.();
            renderStore();
        }
    }

    // ---------------- per-frame HUD ----------------

    const teamLabel = key => {
        if (!key) return "—";
        if (key.startsWith("p")) {
            const id = Number(key.slice(1));
            return id === G.self.id ? "You" : (G.usernames.get(id) || G.players.get(id)?.username || `#${id}`);
        }
        const mine = G.mode?.teamOf?.[String(G.self.id)];
        return key === mine ? "Your team" : `Team ${key.slice(1)}`;
    };

    function update() {
        if (!$("hud-mode")) return;
        const m = G.mode;
        const t = now();

        // Mode bar.
        if (m && m.type && m.type !== "br" && m.scores) {
            const mine = m.teamOf?.[String(G.self.id)];
            const entries = Object.entries(m.scores).sort((a, b) => (b[0] === mine) - (a[0] === mine) || b[1] - a[1]).slice(0, 4);
            const secs = m.phaseEndsAt ? Math.max(0, Math.ceil((m.phaseEndsAt - t) / 1000)) : null;
            const clock = secs === null ? "" : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
            const phase = m.type === "cs"
                ? ({ buy: "Buy phase", fight: "Fight", "round-end": "Round over", ended: "Match over" }[m.phase] || "")
                : (m.phase === "ended" ? "Match over" : `First to ${m.killTarget}`);
            $("hud-mode").innerHTML = `
                <div class="hm-title">${m.name}${m.type === "cs" ? ` · Round ${m.round}` : ""}</div>
                <div class="hm-scores">${entries.map(([k, v]) => `<span class="${k === mine ? "mine" : ""}">${teamLabel(k)} <b>${v}</b></span>`).join("")}</div>
                <div class="hm-phase">${phase}${clock ? " · " + clock : ""}${m.type === "cs" ? ` · first to ${m.roundsToWin}` : ""}</div>`;
            $("hud-mode").classList.remove("hidden");
        } else if (m && m.type === "br") {
            $("hud-mode").innerHTML = `<div class="hm-title">Battle Royale</div>`;
            $("hud-mode").classList.remove("hidden");
        }

        // Coins + store hint.
        if (G.store) {
            const open = buyOpen();
            const left = open ? Math.ceil((G.store.buyEndsAt - t) / 1000) : 0;
            $("hud-coins").innerHTML = `🪙 <b>${G.store.coins}</b>${open ? ` · <span class="buy-open">B: Store (${left}s)</span>` : ""}`;
            $("hud-coins").classList.remove("hidden");
            if (storeOpen) {
                $("store-timer").textContent = open ? `closes in ${left}s` : "closed";
                if (!open) toggleStore(false);
            }
        }

        // Respawn / next round overlay.
        const r = G.respawn;
        if (r && !G.self.alive) {
            const secs = r.respawnAt ? Math.max(0, Math.ceil((r.respawnAt - t) / 1000)) : null;
            $("hud-respawn").innerHTML = r.nextRound
                ? `<b>You're down</b><span>Back in the next round</span>`
                : `<b>Respawning in ${secs}</b><span>Get ready</span>`;
            $("hud-respawn").classList.remove("hidden");
        } else {
            $("hud-respawn").classList.add("hidden");
        }
    }

    // ---------------- socket ----------------

    function bind(socket, emitFn) {
        emit = emitFn;
        build();

        socket.on("mode-state", s => {
            if (s.serverTime) serverOffset = s.serverTime - Date.now();
            const prevPhase = G.mode?.phase;
            G.mode = s;
            G.matchType = s.type || G.matchType;
            if (s.type === "cs" && s.phase === "buy" && prevPhase !== "buy") UI.center(`Round ${s.round} — buy phase`, 2500);
            if (s.type === "cs" && s.phase === "fight" && prevPhase === "buy") UI.center("Fight!", 1500);
        });

        socket.on("store-state", s => {
            if (s.serverTime) serverOffset = s.serverTime - Date.now();
            const wasOpen = buyOpen();
            G.store = s;
            if (!wasOpen && buyOpen()) UI.feed("Store open — press B to buy", "good");
            if (storeOpen) renderStore();
        });

        socket.on("coins-updated", c => {
            if (!G.store) G.store = { coins: c.coins, catalog: [] };
            G.store.coins = c.coins;
            const why = { kill: "kill", "round-win": "round won", "round-loss": "round lost" }[c.reason] || c.reason;
            if (c.amount) UI.feed(`+${c.amount} coins (${why})`, "good");
            if (storeOpen) renderStore();
        });

        socket.on("store-purchased", r => {
            G.store.coins = r.coins;
            G.inventory = r.inventory;
            if (r.throwables) G.throwables = r.throwables;
            UI.feed(`Bought ${r.item.name}`, "good");
            // Use what was bought straight away.
            if (r.item.itemType === "weapon") emit("equip-weapon", { weaponId: r.item.itemId });
            if (r.item.itemType === "helmet") emit("equip-helmet", { itemIdentifier: r.item.itemId });
            if (r.item.itemType === "vest") emit("equip-vest", { itemIdentifier: r.item.itemId });
            renderStore();
        });

        socket.on("store-error", e => UI.feed(e.message, "info"));

        socket.on("round-ended", r => {
            const mine = G.mode?.teamOf?.[String(G.self.id)];
            const won = r.winnerTeam && r.winnerTeam === mine;
            UI.center(r.winnerTeam ? (won ? `Round ${r.round} won!` : `Round ${r.round} lost`) : `Round ${r.round}: draw`, 3000);
        });

        socket.on("mode-respawn-pending", p => {
            if (p.serverTime) serverOffset = p.serverTime - Date.now();
            if (Number(p.playerId) === G.self.id) G.respawn = p;
        });

        socket.on("mode-respawn", p => {
            const id = Number(p.playerId);
            if (id === G.self.id) {
                G.self.alive = true;
                G.self.knocked = false;
                G.self.health = p.health ?? 100;
                G.self.pos = { ...p.position };
                G.phase = "ground";
                G.respawn = null;
                Game.resetAck?.(p.position);
                $("hud-dead")?.classList.add("hidden");
            } else {
                const e = G.players.get(id);
                if (e) { e.alive = true; e.knocked = false; e.pos = { ...p.position }; e.seenAt = Date.now(); }
            }
        });

        socket.on("teams-updated", list => {
            for (const t of list || []) {
                const id = Number(t.playerId);
                if (id === G.self.id) G.self.team = t.team;
                const e = G.players.get(id);
                if (e) e.team = t.team;
            }
        });

        setInterval(update, 200);
    }

    // True when deaths in this match are temporary (no death screen).
    function handlesDeath() {
        return G.matchType === "cs" || G.matchType === "tdm";
    }

    return { bind, toggleStore, handlesDeath, TYPE_NAMES };
})();
