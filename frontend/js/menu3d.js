// ==========================================
// Cinematic menus: intro, login base, lobby, matchmaking
// ==========================================
// A forward operating base at golden hour, drawn behind the
// login / lobby / waiting screens on its own canvas:
//   - login:       wide shot, flag, plane overhead, smoke, sentry
//   - lobby:       two heroes (Arjun, Meera) idling and inspecting
//                  weapons in front of a hangar; patrols behind
//   - matchmaking: tight shot on your hero, faster music, countdown
// Plus the logo intro, music per screen and the mute switch.
// Nothing here affects gameplay; the server stays authoritative.

import * as THREE from "three";
import { QUALITY, createRenderer, createSky, createGround, createMountains, createClouds, createPost } from "./gfx/environment.js";
import { createDecor } from "./gfx/vegetation.js";
import { makeCharacter, animateRig, setWeapon } from "./gfx/characters.js";
import { buildWeapon } from "./gfx/weapons.js";
import { createAircraft } from "./gfx/aircraft.js";
import { createEffects } from "./gfx/effects.js";
import { createFlag } from "./gfx/flag.js";
import { worldMapped, timeUniform } from "./gfx/materials.js";
import * as Tex from "./gfx/textures.js";
import * as Music from "./gfx/music.js";
import { setSfxMuted, unlockAudio } from "./gfx/audio.js";

const $ = id => document.getElementById(id);
const Y = GROUND_Y;

// ---------------- hero + loadout choice (cosmetic, saved locally) ----------------

export const HEROES = {
    arjun: { name: "Arjun", look: { body: "male", headgear: "helmet", eyes: "goggles", mask: true, skin: 1 } },
    meera: { name: "Meera", look: { body: "female", headgear: "cap", hair: "ponytail", eyes: "shades", skin: 2 } }
};
const LOADOUT = [
    ["vajra", "Vajra AR"], ["garuda", "Garuda AR"], ["trishul", "Trishul 762"], ["agni", "Agni SMG"],
    ["brahmastra", "Brahmastra Sniper"], ["drishti", "Drishti DMR"], ["vajram", "Vajram Shotgun"], ["surya", "Surya Pistol"]
];
const store = {
    get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} }
};
let hero = HEROES[store.get("ibf.hero", "arjun")] ? store.get("ibf.hero", "arjun") : "arjun";
let weaponIdx = Math.max(0, LOADOUT.findIndex(w => w[0] === store.get("ibf.weapon", "vajra")));
// The in-game renderer reads this for your own soldier.
window.IBF_HERO = () => HEROES[hero].look;

// ---------------- renderer + scene ----------------

const canvas = document.createElement("canvas");
canvas.id = "menu-canvas";
document.body.prepend(canvas);

const renderer = createRenderer(canvas);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 14000);

// Low golden-hour sun from behind-right: long shadows, warm rim light.
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 13), THREE.MathUtils.degToRad(215));
const { sun, hemi } = createSky(scene, renderer, { sunDir, sunColor: 0xffc38a, sunIntensity: 3.4, turbidity: 4 });
hemi.intensity = 0.45;
sun.position.copy(sunDir).multiplyScalar(120);
sun.target.position.set(0, Y, 0);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 400 });
sun.shadow.camera.updateProjectionMatrix();
scene.fog.density = 0.00035;
scene.fog.color.setHex(0xcfb08c);

createGround(scene);
createMountains(scene);
const clouds = createClouds(scene);
const decor = createDecor(scene);
// Keep the base yard clear of trees.
decor.clearAround((x, z) => Math.abs(x) < 70 && z > -90 && z < 40);
const post = createPost(renderer, scene, camera);
const fx = createEffects(scene);

// ---------------- materials ----------------

function corrugated() {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d");
    for (let x = 0; x < 256; x++) {
        const v = 128 + Math.sin((x / 256) * Math.PI * 2 * 16) * 90;
        g.fillStyle = `rgb(${v},${v},255)`;
        g.fillRect(x, 0, 1, 256);
    }
    const nrm = new THREE.CanvasTexture(c);
    nrm.wrapS = nrm.wrapT = THREE.RepeatWrapping;
    return nrm;
}
const plaster = Tex.plaster(), blocks = Tex.blockWall(), planks = Tex.planks(), dirt = Tex.dirt();
const M = {
    hangar: new THREE.MeshStandardMaterial({ color: 0x6d7378, metalness: 0.45, roughness: 0.55, normalMap: corrugated(), normalScale: new THREE.Vector2(0.35, 0.35), side: THREE.DoubleSide }),
    hangarIn: new THREE.MeshStandardMaterial({ color: 0x2b2e31, roughness: 0.9 }),
    apron: (() => {
        // Plain tiling (4 m per tile) on the big apron slab.
        const map = blocks.map.clone(), nrm = blocks.normalMap.clone();
        for (const t of [map, nrm]) { t.repeat.set(70 / 4, 50 / 4); t.needsUpdate = true; }
        return new THREE.MeshStandardMaterial({ map, normalMap: nrm, color: 0xb3ada2, roughness: 0.9 });
    })(),
    house: worldMapped(new THREE.MeshStandardMaterial({ map: plaster.map, normalMap: plaster.normalMap, color: 0xe9dcc2, roughness: 0.92 }), { uvScale: 0.35, grime: true }),
    crate: worldMapped(new THREE.MeshStandardMaterial({ map: planks.map, normalMap: planks.normalMap, roughness: 0.8 }), { uvScale: 0.8 }),
    sand: new THREE.MeshStandardMaterial({ map: dirt.map, normalMap: dirt.normalMap, color: 0xc9b48a, roughness: 1 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.85 }),
    olive: new THREE.MeshStandardMaterial({ color: 0x4d5537, metalness: 0.4, roughness: 0.55 }),
    red: new THREE.MeshStandardMaterial({ color: 0x8c2a1e, metalness: 0.4, roughness: 0.5 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x55595d, metalness: 0.85, roughness: 0.35 }),
    lamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3, 1.8), toneMapped: false }),
    glass: new THREE.MeshStandardMaterial({ color: 0x182028, metalness: 0.9, roughness: 0.1 })
};

const add = (geo, mat, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    return m;
};

// ---------------- base layout ----------------

// Concrete apron.
add(new THREE.BoxGeometry(70, 0.1, 50), M.apron, 0, Y + 0.02, -10);

// Quonset hangar (half cylinder, open towards the camera).
{
    const R = 9, L = 24;
    const shell = add(new THREE.CylinderGeometry(R, R, L, 40, 1, true, -Math.PI / 2, Math.PI), M.hangar, 0, Y, -20);
    shell.rotation.set(-Math.PI / 2, 0, 0);     // axis along Z, arch above the ground
    const back = add(new THREE.CircleGeometry(R, 40, 0, Math.PI), M.hangarIn, 0, Y, -32);
    back.rotation.y = 0;
    // Door frame.
    const frame = add(new THREE.TorusGeometry(R, 0.25, 8, 40, Math.PI), M.steel, 0, Y, -8);
    // Interior: warm hanging lamps, crates, a supply drop.
    for (const z of [-12, -18, -24]) {
        add(new THREE.SphereGeometry(0.25, 12, 8), M.lamp, 0, Y + 7.3, z);
        const l = new THREE.PointLight(0xffb36b, 30, 18, 2);
        l.position.set(0, Y + 7, z);
        scene.add(l);
    }
    for (let i = 0; i < 6; i++) add(new THREE.BoxGeometry(1.2, 1.2, 1.2), M.crate, -5 + (i % 3) * 1.25, Y + 0.6 + Math.floor(i / 3) * 1.2, -26 + (i % 2) * 0.2);
    // Supply drop: red/blue crate with a folded parachute pack.
    add(new THREE.BoxGeometry(1.6, 1.4, 1.6), new THREE.MeshStandardMaterial({ color: 0x9b2c22, roughness: 0.6 }), 4.5, Y + 0.7, -22, 0.4);
    add(new THREE.BoxGeometry(1.65, 0.3, 1.65), new THREE.MeshStandardMaterial({ color: 0x1f4f8f, roughness: 0.6 }), 4.5, Y + 1.25, -22, 0.4);
}

// Sandbag walls (curved rows).
function sandbags(cx, cz, radius, a0, a1, rows = 3) {
    const geo = new THREE.CapsuleGeometry(0.17, 0.42, 4, 8).rotateZ(Math.PI / 2);
    const count = Math.round(((a1 - a0) * radius) / 0.62) * rows;
    const mesh = new THREE.InstancedMesh(geo, M.sand, count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    let n = 0;
    for (let r = 0; r < rows; r++) {
        const per = Math.round(((a1 - a0) * radius) / 0.62);
        for (let i = 0; i < per && n < count; i++) {
            const a = a0 + ((i + (r % 2) * 0.5) / per) * (a1 - a0);
            q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
            m.compose(new THREE.Vector3(cx + Math.cos(a) * radius, Y + 0.17 + r * 0.3, cz + Math.sin(a) * radius), q, new THREE.Vector3(1, 0.85, 1.25));
            mesh.setMatrixAt(n++, m);
        }
    }
    mesh.count = n;
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
}
sandbags(-7, 2, 3, Math.PI * 0.55, Math.PI * 1.25);
sandbags(8, 1, 3, -Math.PI * 0.2, Math.PI * 0.45);
sandbags(-16, -6, 4, 0, Math.PI);

// Fuel drums and crates.
for (let i = 0; i < 7; i++) {
    const d = add(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 16), i % 3 === 0 ? M.red : M.olive, 9.5 + (i % 4) * 0.65, Y + 0.45, -4 - Math.floor(i / 4) * 0.65);
    d.rotation.y = i;
}
[[-10, -3], [-11.2, -3], [-10.6, -3, 1]].forEach(([x, z, up]) => add(new THREE.BoxGeometry(1.1, 1.1, 1.1), M.crate, x, Y + 0.55 + (up ? 1.1 : 0), z, 0.2));

// Watchtower with a sentry.
const towerTop = new THREE.Vector3(-20, Y + 5.2, -14);
{
    for (const [dx, dz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) add(new THREE.BoxGeometry(0.22, 6, 0.22), M.wood, towerTop.x + dx, Y + 3, towerTop.z + dz);
    add(new THREE.BoxGeometry(3.2, 0.2, 3.2), M.wood, towerTop.x, towerTop.y - 0.1, towerTop.z);
    for (const s of [-1, 1]) {
        add(new THREE.BoxGeometry(3.2, 1, 0.12), M.wood, towerTop.x, towerTop.y + 0.5, towerTop.z + s * 1.55);
        add(new THREE.BoxGeometry(0.12, 1, 3.2), M.wood, towerTop.x + s * 1.55, towerTop.y + 0.5, towerTop.z);
    }
    const roof = add(new THREE.ConeGeometry(2.6, 1.2, 4), new THREE.MeshStandardMaterial({ color: 0x3e4a33, roughness: 0.9 }), towerTop.x, towerTop.y + 3.0, towerTop.z, Math.PI / 4);
    for (const [dx, dz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) add(new THREE.BoxGeometry(0.12, 2.4, 0.12), M.wood, towerTop.x + dx, towerTop.y + 1.2, towerTop.z + dz);
    // Searchlight.
    add(new THREE.CylinderGeometry(0.25, 0.35, 0.5, 12), M.steel, towerTop.x + 1.2, towerTop.y + 1.2, towerTop.z + 1.2).rotation.x = Math.PI / 2.5;
}

// Floodlight poles.
for (const [x, z] of [[-13, 6], [14, 6]]) {
    add(new THREE.CylinderGeometry(0.08, 0.12, 8, 8), M.steel, x, Y + 4, z);
    add(new THREE.BoxGeometry(1.2, 0.4, 0.3), M.steel, x, Y + 8, z);
    add(new THREE.BoxGeometry(1.0, 0.25, 0.05), M.lamp, x, Y + 7.85, z + 0.16);
    const spot = new THREE.SpotLight(0xffd29a, 60, 40, 0.6, 0.6, 1.5);
    spot.position.set(x, Y + 7.8, z);
    spot.target.position.set(x * 0.2, Y, 0);
    scene.add(spot, spot.target);
}

// The flag.
const flag = createFlag({ poleHeight: 12, width: 3.9 });
flag.position.set(-9, Y, -7);
scene.add(flag);

// Village buildings behind the base (smoke rises between them).
const smokeSources = [];
[[-38, -55, 10, 7, 5], [-24, -62, 8, 6, 4], [28, -58, 12, 8, 6], [45, -48, 8, 6, 4], [8, -75, 9, 7, 5]].forEach(([x, z, w, d, h], i) => {
    add(new THREE.BoxGeometry(w, h, d), M.house, x, Y + h / 2, z);
    add(new THREE.BoxGeometry(w + 0.4, 0.3, d + 0.4), M.apron, x, Y + h + 0.15, z);
    for (let k = 0; k < 3; k++) add(new THREE.BoxGeometry(0.9, 1.1, 0.06), M.glass, x - w / 3 + k * (w / 3), Y + h * 0.55, z + d / 2 + 0.03, 0);
    if (i % 2 === 0) smokeSources.push(new THREE.Vector3(x + w * 0.3, Y + h, z - 2));
});

// Plane crossing the sky.
const plane = createAircraft();
scene.add(plane);

// ---------------- characters ----------------

const heroes = {
    arjun: makeCharacter(9001, "", scene, HEROES.arjun.look),
    meera: makeCharacter(9002, "", scene, HEROES.meera.look)
};
const heroSpots = { arjun: new THREE.Vector3(-0.7, Y, 2.6), meera: new THREE.Vector3(0.55, Y, 2.85) };
for (const [k, r] of Object.entries(heroes)) {
    r.label.visible = false;
    r.setTeamColor(0x3fa66b);
    setWeapon(r, k === "arjun" ? "vajra" : "agni");
}

const sentry = makeCharacter(9003, "", scene, { headgear: "helmet" });
sentry.setTeamColor(0x3d8fd6);
const patrols = [0, 1].map(i => {
    const r = makeCharacter(9010 + i, "", scene, { headgear: i ? "cap" : "helmet" });
    r.setTeamColor(0x3d8fd6);
    r.onStep = rr => fx.footDust(rr.shown, 0.3);
    return { rig: r, a: new THREE.Vector3(-14 + i * 4, Y, -6 - i * 3), b: new THREE.Vector3(10 + i * 2, Y, -6 - i * 3), t: i * 0.5 };
});
[sentry, ...patrols.map(p => p.rig)].forEach(r => { r.label.visible = false; });

// Weapon on a display crate next to the heroes.
const stand = add(new THREE.BoxGeometry(0.9, 0.85, 0.6), M.crate, 0.0, Y + 0.425, 1.2, 0);
let shownWeapon = null;
function showWeapon() {
    if (shownWeapon) scene.remove(shownWeapon);
    shownWeapon = buildWeapon(LOADOUT[weaponIdx][0]);
    shownWeapon.scale.setScalar(1.7);
    shownWeapon.position.set(0.0, Y + 1.3, 1.2);
    scene.add(shownWeapon);
    setWeapon(heroes[hero], LOADOUT[weaponIdx][0]);
}

// ---------------- camera shots ----------------

const SHOTS = {
    intro: { pos: new THREE.Vector3(0, Y + 2.2, 16), look: new THREE.Vector3(0, Y + 3.5, -10) },
    login: { pos: new THREE.Vector3(15, Y + 6.5, 24), look: new THREE.Vector3(-2, Y + 4.5, -8) },
    lobby: () => {
        const h = heroSpots[hero];
        // Heroes on the right of the frame; the menu panel sits on the left.
        return { pos: new THREE.Vector3(h.x * 0.4 - 1.25, Y + 1.65, 8.6), look: new THREE.Vector3(h.x * 0.5 - 0.95, Y + 1.15, 2.4) };
    },
    waiting: () => {
        const h = heroSpots[hero];
        return { pos: new THREE.Vector3(h.x + 1.5, Y + 1.7, h.z + 2.5), look: new THREE.Vector3(h.x, Y + 1.45, h.z) };
    }
};
const camPos = SHOTS.intro.pos.clone();
const camLook = SHOTS.intro.look.clone();

// ---------------- screen tracking ----------------

function currentScreen() {
    if (!$("intro")?.classList.contains("done")) return "intro";
    if (!$("screen-game").classList.contains("hidden")) return "game";
    if (!$("screen-waiting").classList.contains("hidden")) return "waiting";
    if (!$("screen-lobby").classList.contains("hidden")) return "lobby";
    return "login";
}

const flashEl = document.createElement("div");
flashEl.id = "menu-flash";
document.body.appendChild(flashEl);
function flash(kind = "white") {
    flashEl.className = "";
    void flashEl.offsetWidth;
    flashEl.className = "on " + kind;
}

let lastScreen = null;
function onScreenChange(from, to) {
    canvas.classList.toggle("hidden", to === "game");
    if (to === "login") Music.play("login");
    if (to === "lobby") {
        Music.play("lobby");
        if (from === "login") { Music.sting("success"); flash("soft"); }
    }
    if (to === "waiting") { Music.play("matchmaking"); Music.sting("whoosh"); }
    if (to === "game") { Music.stop(1.2); Music.sting("found"); flash("white"); }
    document.body.dataset.menu = to;
}

// Countdown beeps in the waiting room (last 10 seconds).
let lastBeep = null;
new MutationObserver(() => {
    const m = /(\d+)\s*s\b/.exec($("wait-status")?.textContent || "");
    const n = m ? Number(m[1]) : null;
    if (n !== null && n <= 10 && n !== lastBeep) { Music.sting("beep"); lastBeep = n; }
}).observe($("wait-status"), { childList: true, characterData: true, subtree: true });

// ---------------- lobby controls (hero + loadout) ----------------

function buildLobbyControls() {
    const box = document.createElement("div");
    box.id = "hero-select";
    box.innerHTML = `
        <div class="hs-label">Operator</div>
        <div class="hs-row">${Object.entries(HEROES).map(([k, h]) => `<button data-hero="${k}">${h.name}</button>`).join("")}</div>
        <div class="hs-label">Weapon</div>
        <div class="hs-row hs-weapon"><button data-w="-1" aria-label="Previous weapon">‹</button><span id="hs-weapon"></span><button data-w="1" aria-label="Next weapon">›</button></div>`;
    $("screen-lobby").appendChild(box);
    const refresh = () => {
        box.querySelectorAll("[data-hero]").forEach(b => b.classList.toggle("active", b.dataset.hero === hero));
        $("hs-weapon").textContent = LOADOUT[weaponIdx][1];
    };
    box.addEventListener("click", e => {
        const b = e.target.closest("button");
        if (!b) return;
        Music.sting("click");
        if (b.dataset.hero) { hero = b.dataset.hero; store.set("ibf.hero", hero); showWeapon(); }
        if (b.dataset.w) {
            weaponIdx = (weaponIdx + Number(b.dataset.w) + LOADOUT.length) % LOADOUT.length;
            store.set("ibf.weapon", LOADOUT[weaponIdx][0]);
            showWeapon();
        }
        refresh();
    });
    refresh();
}

// Mute button (music + effects), shown on every screen.
function buildMute() {
    const b = document.createElement("button");
    b.id = "btn-mute";
    const set = () => { b.textContent = Music.isMuted() ? "🔇" : "🔊"; b.title = Music.isMuted() ? "Unmute" : "Mute"; };
    b.addEventListener("click", () => {
        const v = !Music.isMuted();
        Music.setMuted(v);
        setSfxMuted(v);
        set();
    });
    set();
    document.body.appendChild(b);
    setSfxMuted(Music.isMuted());
}

// UI click sounds on menu buttons.
document.addEventListener("click", e => {
    if (e.target.closest(".panel button, .panel .tab")) Music.sting("click");
});

// ---------------- intro ----------------

function buildIntro() {
    const el = document.createElement("div");
    el.id = "intro";
    const letters = word => [...word].map(c => c === " " ? "<i class='gap'></i>" :
        `<span style="--dx:${(Math.random() - 0.5) * 600}px;--dy:${(Math.random() - 0.5) * 300}px;--r:${(Math.random() - 0.5) * 120}deg;--d:${(0.4 + Math.random() * 1.4).toFixed(2)}s">${c}</span>`).join("");
    el.innerHTML = `
        <canvas id="intro-fx"></canvas>
        <img class="intro-art" src="img/key-art.jpg" alt="" onerror="this.remove()">
        <div class="intro-logo">
            <div class="intro-title"><div class="l1">${letters("INDIAN")}</div><div class="l2">${letters("BATTLE FIELDS")}</div></div>
            <div class="intro-sub"><b>★</b> BATTLE ROYALE <b>★</b></div>
        </div>
        <div class="intro-press">Press any key or tap to start</div>
        <div class="intro-load"><i></i><span>Loading battlefield…</span></div>
        <button class="intro-skip">Skip ›</button>`;
    document.body.appendChild(el);

    // Ember particles (saffron, white, green) and sparks.
    const c = el.querySelector("#intro-fx");
    const g = c.getContext("2d");
    const embers = [];
    const COLORS = ["255,153,51", "255,210,120", "255,255,255", "19,170,40", "255,120,40"];
    let burst = 0;
    const size = () => { c.width = innerWidth; c.height = innerHeight; };
    size();
    addEventListener("resize", size);
    function tick() {
        if (el.classList.contains("done")) return;
        g.clearRect(0, 0, c.width, c.height);
        if (embers.length < 140) embers.push({ x: Math.random() * c.width, y: c.height + 10, vx: (Math.random() - 0.5) * 0.6, vy: -0.6 - Math.random() * 1.6, s: 1 + Math.random() * 2.5, c: COLORS[Math.floor(Math.random() * COLORS.length)], life: 1 });
        while (burst > 0) {
            burst--;
            const a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 9;
            embers.push({ x: c.width / 2 + (Math.random() - 0.5) * c.width * 0.5, y: c.height * 0.45, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2, s: 1.5 + Math.random() * 2, c: "255,200,120", life: 1, spark: true });
        }
        for (let i = embers.length - 1; i >= 0; i--) {
            const p = embers[i];
            p.x += p.vx; p.y += p.vy;
            if (p.spark) { p.vy += 0.25; p.life -= 0.02; } else { p.vx += (Math.random() - 0.5) * 0.05; p.life -= 0.003; }
            if (p.life <= 0 || p.y < -20) { embers.splice(i, 1); continue; }
            g.globalCompositeOperation = "lighter";
            g.fillStyle = `rgba(${p.c},${p.life * (p.spark ? 1 : 0.7)})`;
            g.beginPath();
            if (p.spark) { g.lineWidth = p.s; g.strokeStyle = g.fillStyle; g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx * 2, p.y - p.vy * 2); g.stroke(); }
            else { g.arc(p.x, p.y, p.s, 0, Math.PI * 2); g.fill(); }
        }
        requestAnimationFrame(tick);
    }
    tick();

    let started = false, timers = [];
    const finish = () => {
        if (el.classList.contains("done")) return;
        timers.forEach(clearTimeout);
        el.classList.add("leaving");
        setTimeout(() => { el.classList.add("done"); }, 700);
    };
    const start = () => {
        if (started) return;
        started = true;
        unlockAudio();
        Music.resume();
        el.classList.add("play");
        setTimeout(() => Music.sting("intro"), 60);
        timers.push(setTimeout(() => { el.classList.add("impact"); burst = 90; }, 2200));
        timers.push(setTimeout(() => el.classList.add("sweep"), 2700));
        timers.push(setTimeout(finish, 6400));
    };
    el.addEventListener("pointerdown", e => { if (!e.target.closest(".intro-skip")) start(); });
    addEventListener("keydown", e => { if (!started) start(); else if (e.key === "Escape" || e.key === " " || e.key === "Enter") finish(); });
    el.querySelector(".intro-skip").addEventListener("click", e => { e.stopPropagation(); if (!started) { unlockAudio(); Music.resume(); started = true; } finish(); });
}

// ---------------- frame ----------------

let last = performance.now();
function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    post.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = w < h ? 58 : 42;
    camera.updateProjectionMatrix();
}
addEventListener("resize", resize);

let inspectT = 0;
function frame() {
    requestAnimationFrame(frame);
    const screen = currentScreen();
    if (screen !== lastScreen) { onScreenChange(lastScreen, screen); lastScreen = screen; }
    if (screen === "game" || document.hidden) { last = performance.now(); return; }

    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const t = now / 1000;
    timeUniform.value = t;

    // Heroes: breathing, weight shift, glancing around, and a weapon
    // inspection every ~9 s (staggered between the two).
    inspectT += dt;
    for (const [k, r] of Object.entries(heroes)) {
        const off = k === "arjun" ? 0 : 4.5;
        const cyc = ((inspectT + off) % 9) / 9;                   // 0..1
        const ins = cyc > 0.62 ? Math.sin(((cyc - 0.62) / 0.38) * Math.PI) : 0;
        const look = Math.sin(t * 0.37 + off) * 0.35 * (1 - ins);
        animateRig(r, heroSpots[k], dt, {
            faceYaw: (k === "arjun" ? 0.25 : -0.3) + (screen === "waiting" && k === hero ? 0.35 : 0),
            inspect: ins,
            lookYaw: look - ins * 0.35,
            lookPitch: ins * 0.3,
            idleShift: off,
            pitch: -0.05,
            lowReady: 0.55 * (1 - ins),
            hideLabel: true
        });
        r.root.visible = screen !== "waiting" || k === hero;
    }

    // Sentry on the tower, scanning.
    animateRig(sentry, towerTop, dt, { faceYaw: Math.sin(t * 0.2) * 1.2 + 0.4, lookYaw: Math.sin(t * 0.5) * 0.4, hideLabel: true });

    // Patrols walk back and forth.
    for (const p of patrols) {
        p.t += dt / 16;
        const k = (Math.sin(p.t * Math.PI * 2) + 1) / 2;
        const target = p.a.clone().lerp(p.b, k);
        animateRig(p.rig, target, dt, { pitch: 0.15, hideLabel: true });
    }

    // Plane passes every 70 s high over the base.
    const pt = (t % 70) / 70;
    plane.position.set(-1400 + pt * 2800, Y + 260, -260);
    plane.rotation.y = Math.PI / 2;
    plane.userData.update(dt, t);

    // Smoke columns behind the village, dust motes, hangar sparks.
    for (const s of smokeSources) {
        if (Math.random() < dt * 5) fx.spawn("alpha", {
            pos: s.clone().add(new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5)),
            vel: new THREE.Vector3(0.6 + Math.random() * 0.4, 1.4 + Math.random(), 0), life: 9 + Math.random() * 4,
            size: [1.5, 9], color: [0.22, 0.2, 0.19], alpha: t2 => Math.min(1, t2 * 6) * (1 - t2) * 0.55, drag: 0.2
        });
    }
    if (Math.random() < dt * 8) fx.spawn("add", {
        pos: camPos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.3) * 3, -2 - Math.random() * 6)),
        vel: new THREE.Vector3(0.1 + Math.random() * 0.1, (Math.random() - 0.5) * 0.05, 0), life: 5, size: [0.025, 0.02],
        color: [1.2, 0.95, 0.6], alpha: t2 => Math.sin(t2 * Math.PI) * 0.6
    });
    if (Math.random() < dt * 0.5) {
        const p = new THREE.Vector3(-4 + Math.random() * 2, Y + 1.0, -16);
        for (let i = 0; i < 25; i++) fx.spawn("add", {
            pos: p.clone(), vel: new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3, Math.random() * 2), life: 0.4 + Math.random() * 0.5,
            size: [0.04, 0.015], color: [5, 3, 1.2], alpha: [1, 0], gravity: 9.8, floor: Y + 0.05
        });
    }
    fx.update(dt);

    // Weapon on the display crate turns slowly.
    if (shownWeapon) shownWeapon.rotation.y = t * 0.5;
    clouds.position.x = t * 2;

    // Camera: ease toward the current shot, with a gentle drift.
    const shot = typeof SHOTS[screen] === "function" ? SHOTS[screen]() : SHOTS[screen] || SHOTS.login;
    const ease = 1 - Math.exp(-dt * (screen === "intro" ? 0.4 : 1.6));
    camPos.lerp(shot.pos, ease);
    camLook.lerp(shot.look, ease);
    camera.position.copy(camPos).add(new THREE.Vector3(Math.sin(t * 0.13) * 0.25, Math.sin(t * 0.17) * 0.12, 0));
    camera.lookAt(camLook);

    post.render();
}

// ---------------- start ----------------

// Read-only handle for debugging in the browser console.
window.IBF_MENU = {
    heroes, camera, scene,
    // Jump the camera to the current shot (for screenshots).
    snap() {
        const s = currentScreen();
        const shot = typeof SHOTS[s] === "function" ? SHOTS[s]() : SHOTS[s] || SHOTS.login;
        camPos.copy(shot.pos); camLook.copy(shot.look);
    }
};

buildIntro();
buildMute();
buildLobbyControls();
showWeapon();
resize();
frame();
