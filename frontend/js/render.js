// ==========================================
// Top-down canvas renderer
// ==========================================
// World x -> screen x, world z -> screen y (north up).

const Render = (() => {
    const canvas = document.getElementById("canvas");
    const ctx = canvas.getContext("2d");

    const LOOT_COLORS = {
        weapon: "#f2a541",
        ammunition: "#c9b458",
        helmet: "#4fb3ff",
        vest: "#4fb3ff",
        throwable: "#e5534b",
        healing: "#4cc38a",
        attachment: "#b48ead"
    };

    function resize() {
        canvas.width = canvas.clientWidth * devicePixelRatio;
        canvas.height = canvas.clientHeight * devicePixelRatio;
    }

    window.addEventListener("resize", resize);

    // Camera follows the player (or the spectated player).
    function cameraCenter() {
        if (G.spectating) {
            const p = G.players.get(G.spectating);
            if (p?.pos) return p.pos;
        }
        return G.self.pos || { x: 0, y: 0, z: 0 };
    }

    function scale() {
        return G.zoom * devicePixelRatio;
    }

    function toScreen(p) {
        const c = cameraCenter();
        const s = scale();
        return {
            x: canvas.width / 2 + (p.x - c.x) * s,
            y: canvas.height / 2 + (p.z - c.z) * s
        };
    }

    function toWorld(sx, sy) {
        const c = cameraCenter();
        const s = scale();
        return {
            x: c.x + (sx * devicePixelRatio - canvas.width / 2) / s,
            y: G.self.pos ? G.self.pos.y : GROUND_Y,
            z: c.z + (sy * devicePixelRatio - canvas.height / 2) / s
        };
    }

    function circle(p, r, fill, stroke, width = 1) {
        const sp = toScreen(p);
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, Math.max(1, r * scale()), 0, Math.PI * 2);
        if (fill) { ctx.fillStyle = fill; ctx.fill(); }
        if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width * devicePixelRatio; ctx.stroke(); }
    }

    function label(p, text, color, dy = -14) {
        const sp = toScreen(p);
        ctx.fillStyle = color;
        ctx.font = `${11 * devicePixelRatio}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(text, sp.x, sp.y + dy * devicePixelRatio);
    }

    function drawGrid() {
        const s = scale();
        const step = s * 50 < 30 ? 250 : 50;
        const c = cameraCenter();

        ctx.strokeStyle = "#1b222c";
        ctx.lineWidth = 1;

        const halfW = canvas.width / 2 / s;
        const halfH = canvas.height / 2 / s;

        for (let x = Math.floor((c.x - halfW) / step) * step; x <= c.x + halfW; x += step) {
            const a = toScreen({ x, z: c.z - halfH });
            const b = toScreen({ x, z: c.z + halfH });
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }

        for (let z = Math.floor((c.z - halfH) / step) * step; z <= c.z + halfH; z += step) {
            const a = toScreen({ x: c.x - halfW, z });
            const b = toScreen({ x: c.x + halfW, z });
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }

        // Map border (-1000..1000).
        const tl = toScreen({ x: -1000, z: -1000 });
        const br = toScreen({ x: 1000, z: 1000 });
        ctx.strokeStyle = "#3a4555";
        ctx.lineWidth = 2 * devicePixelRatio;
        ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    }

    function drawZone() {
        const z = G.zone;
        if (!z) return;

        const center = { x: z.current.center.x, z: z.current.center.z };
        const sp = toScreen(center);
        const r = z.current.radius * scale();

        // Darken everything outside the safe circle.
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, canvas.width, canvas.height);
        ctx.arc(sp.x, sp.y, Math.max(0, r), 0, Math.PI * 2, true);
        ctx.fillStyle = "rgba(90, 40, 160, 0.22)";
        ctx.fill("evenodd");
        ctx.restore();

        circle(center, z.current.radius, null, "#6aa8ff", 2);

        if (z.next) {
            ctx.setLineDash([8 * devicePixelRatio, 6 * devicePixelRatio]);
            circle({ x: z.next.center.x, z: z.next.center.z }, z.next.radius, null, "#ffffff", 1.5);
            ctx.setLineDash([]);
        }
    }

    function drawFlight() {
        const f = G.flight;
        if (!f) return;

        const a = toScreen(f.flightPath.start);
        const b = toScreen(f.flightPath.end);
        ctx.strokeStyle = "rgba(242, 165, 65, .5)";
        ctx.setLineDash([10 * devicePixelRatio, 8 * devicePixelRatio]);
        ctx.lineWidth = 2 * devicePixelRatio;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.setLineDash([]);

        const progress = Math.min(1, (Date.now() - f.startedAt) / f.durationMs);
        if (progress < 1) {
            const plane = {
                x: f.flightPath.start.x + (f.flightPath.end.x - f.flightPath.start.x) * progress,
                z: f.flightPath.start.z + (f.flightPath.end.z - f.flightPath.start.z) * progress
            };
            circle(plane, 6, "#f2a541");
            label(plane, "AIRCRAFT", "#f2a541");
        }
    }

    function drawLoot() {
        for (const item of G.loot.values()) {
            const sp = toScreen(item.position);
            const size = Math.max(3, 1.2 * scale());
            ctx.fillStyle = LOOT_COLORS[item.itemType] || "#aaa";
            ctx.fillRect(sp.x - size / 2, sp.y - size / 2, size, size);

            if (G.self.pos && distance2d(G.self.pos, item.position) < 12) {
                label(item.position, item.name + (item.quantity ? ` x${item.quantity}` : ""), "#cdd5df", -8);
            }
        }
    }

    function drawWallsAndSmoke() {
        for (const s of G.smokes.values()) {
            circle(s.position, s.radius, "rgba(200, 205, 215, 0.45)");
        }

        for (const w of G.walls.values()) {
            const yaw = (w.facing * Math.PI) / 180;
            const half = (w.size?.width || 4) / 2;
            const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
            const a = toScreen({ x: w.position.x - right.x * half, z: w.position.z - right.z * half });
            const b = toScreen({ x: w.position.x + right.x * half, z: w.position.z + right.z * half });

            ctx.strokeStyle = "#7fd3ff";
            ctx.lineWidth = Math.max(3, 0.6 * scale());
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }

        for (const g of G.grenades.values()) {
            circle(g.position, 0.8, "#e5534b");
            const left = Math.max(0, (g.explodesAt - Date.now()) / 1000);
            label(g.position, `${g.type} ${left.toFixed(1)}s`, "#e5534b", -8);
        }
    }

    function drawPlayers() {
        for (const [id, p] of G.players) {
            if (!p.pos || id === G.self.id) continue;

            const color = !p.alive
                ? "#444"
                : isTeammate(id) ? "#4fb3ff" : "#e5534b";

            const stale = p.hidden || Date.now() - (p.seenAt || 0) > 4000;
            circle(p.pos, 1.2, stale ? null : color, color, 2);
            label(p.pos, (p.username || `#${id}`) + (p.knocked ? " (knocked)" : ""), color);
        }

        if (G.self.pos) {
            const color = G.self.knocked ? "#f2a541" : G.self.alive ? "#4cc38a" : "#444";
            circle(G.self.pos, 1.4, color, "#ffffff", 2);

            // Aim line to the cursor.
            if (G.phase === "ground" && G.self.alive) {
                const sp = toScreen(G.self.pos);
                ctx.strokeStyle = "rgba(255,255,255,.18)";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(sp.x, sp.y);
                ctx.lineTo(G.mouse.x * devicePixelRatio, G.mouse.y * devicePixelRatio);
                ctx.stroke();
            }
        }
    }

    function drawEffects() {
        const now = Date.now();
        G.effects = G.effects.filter(e => e.until > now);

        for (const e of G.effects) {
            const alpha = Math.max(0, (e.until - now) / (e.until - e.start));

            if (e.kind === "line") {
                const a = toScreen(e.from);
                const b = toScreen(e.to);
                ctx.strokeStyle = `rgba(${e.rgb}, ${alpha})`;
                ctx.lineWidth = 2 * devicePixelRatio;
                ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            } else if (e.kind === "ring") {
                circle(e.at, e.radius, null, `rgba(${e.rgb}, ${alpha})`, 2);
            }
        }
    }

    function draw() {
        if (!canvas.width) resize();

        ctx.fillStyle = "#0d1117";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        drawGrid();
        drawZone();
        drawFlight();
        drawLoot();
        drawWallsAndSmoke();
        drawPlayers();
        drawEffects();

        // Flash: white out the screen while blinded.
        const flashLeft = G.self.flashedUntil - Date.now();
        if (flashLeft > 0) {
            ctx.fillStyle = `rgba(255,255,255,${Math.min(0.95, flashLeft / 1500)})`;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
    }

    function addEffect(effect, ms = 300) {
        G.effects.push({ ...effect, start: Date.now(), until: Date.now() + ms });
    }

    return { draw, resize, toWorld, addEffect, canvas };
})();
