// ==========================================
// Screens, lobby and HUD
// ==========================================

const UI = (() => {
    const $ = id => document.getElementById(id);
    const screens = ["screen-auth", "screen-lobby", "screen-waiting", "screen-game"];

    let waitPoll = null;
    let lastHud = 0;
    let createdBy = null;

    function show(screenId) {
        for (const id of screens) $(id).classList.toggle("hidden", id !== screenId);
    }

    function message(elId, text, isError = false) {
        const el = $(elId);
        el.textContent = text || "";
        el.classList.toggle("error", Boolean(isError));
    }

    // ---------------- auth ----------------

    function bindAuth() {
        document.querySelectorAll(".tab").forEach(tab => {
            tab.addEventListener("click", () => {
                document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t === tab));
                $("form-login").classList.toggle("hidden", tab.dataset.tab !== "login");
                $("form-register").classList.toggle("hidden", tab.dataset.tab !== "register");
                message("auth-message", "");
            });
        });

        $("form-login").addEventListener("submit", async e => {
            e.preventDefault();
            const f = new FormData(e.target);
            message("auth-message", "Logging in…");
            const r = await Api.login(f.get("email"), f.get("password"));
            if (!r.ok) return message("auth-message", r.json?.message || "Login failed", true);
            showLobby();
        });

        $("form-register").addEventListener("submit", async e => {
            e.preventDefault();
            const f = new FormData(e.target);
            message("auth-message", "Creating account…");

            const r = await Api.register({
                username: f.get("username"),
                email: f.get("email"),
                password: f.get("password")
            });

            if (!r.ok) return message("auth-message", r.json?.message || "Sign-up failed", true);

            const login = await Api.login(f.get("email"), f.get("password"));
            if (!login.ok) {
                return message("auth-message", "Account created. Confirm your email, then log in.");
            }
            showLobby();
        });
    }

    // ---------------- lobby ----------------

    async function showLobby() {
        show("screen-lobby");
        message("lobby-message", "");
        $("lobby-user").textContent = Api.session.player.username;

        const me = await Api.call("GET", "/api/players/me");
        if (me.status === 401) return logout();
        if (me.ok) {
            const p = me.json.player;
            const prog = me.json.progression;
            $("lobby-profile").textContent =
                `Level ${prog?.level ?? p.level} · ${p.experience} XP · ${p.coins} coins · ${p.rank_points ?? 0} rank points`;
        }

        const maps = await Api.call("GET", "/api/maps");
        const select = $("room-map");
        select.innerHTML = "";
        const list = maps.ok ? maps.json.maps : [{ map_name: "Bharat Plains" }];
        for (const m of list) {
            const opt = document.createElement("option");
            opt.value = m.map_name;
            opt.textContent = m.map_name;
            select.appendChild(opt);
        }

        refreshParty();
    }

    async function refreshParty() {
        const r = await Api.call("GET", "/api/parties/me");
        const party = r.json?.party;
        $("party-info").textContent = party
            ? `Party ${party.code} (${party.gameMode}) — members: ${party.members.join(", ")}${party.leaderId === String(Api.session.player.id) ? " — you lead" : ""}`
            : "Not in a party.";
    }

    async function enterMatch(r, fallbackMessage) {
        if (!r.ok) return message("lobby-message", r.json?.message || fallbackMessage, true);

        const matchId = r.json.matchId || r.json.match?.id;
        if (!matchId) return message("lobby-message", "No match id in the response", true);

        G = newGameState();
        createdBy = r.json.match?.created_by ?? null;
        Game.connect(matchId, r.json.serverUrl);
        showWaiting();
    }

    // Game mode picked in the lobby: br | cs | tdm (remembered).
    const MODE_INFO = {
        br: "Battle Royale: drop from the plane, loot, survive the zone. Store opens 30 s after landing.",
        cs: "Clash Squad: two sides fight in one town over rounds. Buy gear at the start of each round; first to 4 round wins.",
        tdm: "Team Deathmatch: respawn after 5 s. Buy at the start and after each respawn; first to the kill target wins."
    };
    let matchType = "br";
    try { matchType = localStorage.getItem("ibf.matchType") || "br"; } catch {}
    if (!MODE_INFO[matchType]) matchType = "br";

    function renderModePick() {
        document.querySelectorAll("#mode-pick [data-type]").forEach(b => b.classList.toggle("active", b.dataset.type === matchType));
        if ($("mode-desc")) $("mode-desc").textContent = MODE_INFO[matchType] + " Everyone starts each match with 1000 coins; unspent coins go to your account.";
    }

    function bindLobby() {
        $("btn-logout").addEventListener("click", logout);

        document.querySelectorAll("#mode-pick [data-type]").forEach(btn => {
            btn.addEventListener("click", () => {
                matchType = btn.dataset.type;
                try { localStorage.setItem("ibf.matchType", matchType); } catch {}
                renderModePick();
            });
        });
        renderModePick();

        document.querySelectorAll("[data-quick]").forEach(btn => {
            btn.addEventListener("click", async () => {
                message("lobby-message", "Finding a match…");
                const r = await Api.call("POST", "/api/matchmaking/quick-join", { game_mode: btn.dataset.quick, match_type: matchType });
                enterMatch(r, "Quick join failed");
            });
        });

        $("btn-create-room").addEventListener("click", async () => {
            const r = await Api.call("POST", "/api/matches/create", {
                map_name: $("room-map").value,
                game_mode: $("room-mode").value,
                match_type: matchType
            });
            enterMatch(r, "Could not create the room");
        });

        $("btn-join-code").addEventListener("click", async () => {
            const code = $("room-code").value.trim().toUpperCase();
            if (!code) return;
            const r = await Api.call("POST", `/api/matches/join/code/${encodeURIComponent(code)}`);
            enterMatch(r, "Could not join that room");
        });

        $("btn-party-create").addEventListener("click", async () => {
            const r = await Api.call("POST", "/api/parties", { game_mode: $("party-mode").value });
            message("lobby-message", r.json?.message || "", !r.ok);
            refreshParty();
        });

        $("btn-party-join").addEventListener("click", async () => {
            const r = await Api.call("POST", "/api/parties/join", { code: $("party-code").value.trim() });
            message("lobby-message", r.json?.message || "", !r.ok);
            refreshParty();
        });

        $("btn-party-leave").addEventListener("click", async () => {
            await Api.call("POST", "/api/parties/leave");
            refreshParty();
        });
    }

    async function logout() {
        Game.disconnect();
        await Api.logout();
        show("screen-auth");
    }

    // ---------------- waiting room ----------------

    function showWaiting() {
        G.phase = "waiting";
        show("screen-waiting");
        message("wait-message", "");
        setWaitingStatus("Connecting…");

        clearInterval(waitPoll);
        const poll = async () => {
            const r = await Api.call("GET", `/api/matches/${G.matchId}`);
            if (!r.ok) return;

            const m = r.json.match;
            createdBy = m.created_by;
            $("wait-code").textContent = `Room ${m.match_code} · ${m.game_mode} · ${m.map_name}`;
            $("wait-title").textContent = m.status === "waiting" ? "Waiting for players" : "Match starting";

            if (m.status === "waiting") {
                setWaitingStatus(`${m.current_players} / ${m.max_players} players`);
            }

            const isCreator = Number(m.created_by) === Number(Api.session.player.id);
            $("btn-start").classList.toggle("hidden", !(isCreator && m.status === "waiting" && !m.match_code.startsWith("QM-")));

            if (m.status === "in_progress") clearInterval(waitPoll);
        };

        poll();
        waitPoll = setInterval(poll, 2000);
        renderWaitingPlayers();
    }

    function setWaitingStatus(text) {
        $("wait-status").textContent = text;
    }

    function renderWaitingPlayers() {
        const ul = $("wait-players");
        if (!ul) return;
        ul.innerHTML = "";
        for (const [id, p] of G.players) {
            const li = document.createElement("li");
            li.textContent = (p.username || `#${id}`) + (Number(id) === Number(createdBy) ? " (host)" : "");
            ul.appendChild(li);
        }
    }

    function bindWaiting() {
        $("btn-start").addEventListener("click", async () => {
            const r = await Api.call("POST", `/api/matches/${G.matchId}/start`);
            message("wait-message", r.json?.message || "", !r.ok);
        });

        $("btn-leave-room").addEventListener("click", async () => {
            await Api.call("POST", `/api/matches/${G.matchId}/leave`);
            backToLobby();
        });
    }

    // ---------------- game ----------------

    function showGame() {
        clearInterval(waitPoll);
        show("screen-game");
        $("hud-dead").classList.add("hidden");
        $("hud-results").classList.add("hidden");
        Render.resize();
    }

    let centerTimer = null;

    function center(text, ms = 2000) {
        const el = $("hud-center");
        el.textContent = text;
        el.style.display = "block";
        clearTimeout(centerTimer);
        centerTimer = setTimeout(() => { el.style.display = "none"; }, ms);
    }

    function feed(text, kind = "info") {
        G.feed.unshift({ text, kind, at: Date.now() });
        G.feed = G.feed.slice(0, 12);

        const el = $("hud-feed");
        el.innerHTML = "";
        for (const f of G.feed) {
            const div = document.createElement("div");
            div.className = `feed-${f.kind}`;
            div.textContent = f.text;
            el.appendChild(div);
        }
    }

    function zoneText() {
        const z = G.zone;
        if (!z) return "Zone: —";
        if (z.arena) return `Arena · stay inside the boundary`;
        if (!z.shrinkStartsAt) return `Zone phase ${z.phase}/${z.totalPhases}: final`;

        // Server "now" = server time at receipt + time since receipt.
        const now = (z.serverTime || Date.now()) + (Date.now() - (z.receivedAt || Date.now()));
        const toShrink = Math.ceil((z.shrinkStartsAt - now) / 1000);
        const toEnd = Math.ceil((z.shrinkEndsAt - now) / 1000);

        return toShrink > 0
            ? `Zone ${z.phase}/${z.totalPhases}: shrinks in ${toShrink}s · ${z.damagePerSecond}/s outside`
            : `Zone ${z.phase}/${z.totalPhases}: shrinking (${Math.max(0, toEnd)}s) · ${z.damagePerSecond}/s outside`;
    }

    function updateHud() {
        const now = Date.now();
        if (now - lastHud < 100) return;
        lastHud = now;

        const phaseNames = {
            aircraft: "In the aircraft — SPACE to jump",
            dropping: G.parachute ? "Parachuting" : "Free fall — SPACE for parachute",
            ground: "On the ground",
            dead: "Eliminated",
            over: "Match over"
        };

        $("hud-phase").textContent = phaseNames[G.phase] || G.phase;
        $("hud-zone").textContent = zoneText();
        $("hud-alive").textContent = G.alivePlayers ? `${G.alivePlayers} alive · ${G.self.kills} kills` : `${G.self.kills} kills`;

        const hp = G.self.knocked ? G.self.knockHealth : G.self.health;
        $("bar-health").style.width = `${Math.max(0, Math.min(100, hp))}%`;
        $("bar-health").style.background = G.self.knocked ? "#f2a541" : "";
        $("txt-health").textContent = G.self.knocked ? `Knocked ${Math.round(hp)}` : `Health ${Math.round(hp)}`;
        $("bar-armor").style.width = `${Math.max(0, Math.min(100, G.self.armor))}%`;
        $("txt-armor").textContent = `Armor ${Math.round(G.self.armor)}`;

        const status = [];
        if (G.healing) status.push(`Healing ${Math.max(0, (G.healing.endsAt - now) / 1000).toFixed(1)}s`);
        if (G.self.flashedUntil > now) status.push("Blinded");
        if (G.self.pos) status.push(`x ${G.self.pos.x.toFixed(0)}  z ${G.self.pos.z.toFixed(0)}  h ${G.self.pos.y.toFixed(0)}`);
        $("hud-status").textContent = status.join(" · ");

        const weapons = G.inventory?.weapons || [];
        $("hud-weapons").innerHTML = weapons.length
            ? weapons.map((w, i) => `<span class="slot${w.weaponId === G.activeWeapon ? " active" : ""}">${i + 1} ${w.name}</span>`).join("")
            : "<span class='muted'>No weapon</span>";

        const active = weapons.find(w => w.weaponId === G.activeWeapon);
        const reserve = active ? G.inventory?.ammunition?.[active.ammoType] ?? 0 : 0;
        $("hud-ammo").textContent = active
            ? (G.reloading ? "Reloading…" : `${G.magazine ?? "-"} / ${reserve}`)
            : "";

        const t = G.throwables || {};
        const h = G.inventory?.healing || {};
        $("hud-items").textContent =
            `Frag ${t.frag ?? 0} · Smoke ${t.smoke ?? 0} · Flash ${t.flash ?? 0} · Gloo ${t.gloo ?? 0} · Bandage ${h.bandage ?? 0} · Medkit ${h.medkit ?? 0}`;
    }

    function showDead() {
        const panel = $("hud-dead");
        panel.classList.remove("hidden");

        const list = $("spectate-list");
        list.innerHTML = "<p class='muted'>Spectate:</p>";

        for (const [id, p] of G.players) {
            if (id === G.self.id || !p.alive) continue;
            const btn = document.createElement("button");
            btn.textContent = p.username || `#${id}`;
            btn.addEventListener("click", () => Game.emit("spectate-player", { targetId: id }));
            list.appendChild(btn);
        }
    }

    function showResults(r) {
        $("hud-dead").classList.add("hidden");
        $("hud-results").classList.remove("hidden");

        const won = Number(r.winnerPlayerId) === G.self.id ||
            (G.gameMode !== "solo" && Number(r.winnerTeam) === Number(G.self.team));
        $("results-title").textContent = won ? "WINNER" : "Match over";

        const rows = (r.results || [])
            .sort((a, b) => (a.placement || 999) - (b.placement || 999))
            .map(x => `<tr><td>#${x.placement ?? "-"}</td><td>${escapeHtml(x.username)}</td><td>${x.kills} kills</td><td>+${x.xpEarned ?? 0} XP</td></tr>`)
            .join("");

        $("results-table").innerHTML = `<tr><th>Place</th><th>Player</th><th>Kills</th><th>XP</th></tr>${rows}`;
    }

    function showProgression(p) {
        $("results-progress").textContent =
            `Level ${p.level}${p.leveledUp ? " (level up!)" : ""} · +${p.coinsEarned} coins (total ${p.totalCoins})`;
    }

    function backToLobby() {
        clearInterval(waitPoll);
        Game.disconnect();
        G = newGameState();
        showLobby();
    }

    function escapeHtml(s) {
        return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    // ---------------- start ----------------

    function init() {
        bindAuth();
        bindLobby();
        bindWaiting();
        $("btn-back-lobby").addEventListener("click", backToLobby);
        $("btn-results-lobby").addEventListener("click", backToLobby);

        Game.bindInput();
        Game.startLoops();

        if (Api.session?.token) showLobby();
        else show("screen-auth");
    }

    return {
        init,
        feed,
        center,
        updateHud,
        showGame,
        showWaiting,
        setWaitingStatus,
        renderWaitingPlayers,
        showDead,
        showResults,
        showProgression,
        backToLobby
    };
})();

// The 3D page starts the UI itself once three.js has loaded.
if (!window.DEFER_UI_INIT) UI.init();
