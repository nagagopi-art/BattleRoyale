// ==========================================
// 3D renderer (three.js): world, characters, camera, aiming
// ==========================================
// Provides the same Render interface as the 2D map
// (draw, resize, canvas, addEffect, toWorld) plus
// moveVector (camera-relative WASD) and aimTarget
// (what the crosshair is on), then starts the UI.
//
// Visuals live in js/gfx/: sky and post-processing
// (environment), trees/grass/rocks (vegetation), soldiers
// (characters), guns and loot (weapons), the drop plane
// (aircraft), particles/explosions (effects) and sound (audio).

import * as THREE from "three";
import { QUALITY, createRenderer, createSky, followSun, createGround, createMountains, createClouds, createPost } from "./gfx/environment.js";
import { createDecor, createGrass, rockGeometry, rockMaterial } from "./gfx/vegetation.js";
import { makeCharacter, animateRig, registerHits, setWeapon, disposeRig, makeLabel, TEAM_COLORS } from "./gfx/characters.js";
import { buildLoot, buildThrowable, weaponCategory } from "./gfx/weapons.js";
import { createAircraft } from "./gfx/aircraft.js";
import { createEffects } from "./gfx/effects.js";
import { worldMapped, timeUniform } from "./gfx/materials.js";
import * as Tex from "./gfx/textures.js";
import * as Audio from "./gfx/audio.js";

const canvas = document.getElementById("canvas");
const crosshair = document.getElementById("crosshair");
const flashOverlay = document.getElementById("flash-overlay");
const lockHint = document.getElementById("lock-hint");

// Red edges when you take damage.
const hurtOverlay = document.createElement("div");
hurtOverlay.id = "hurt-overlay";
Object.assign(hurtOverlay.style, {
    position: "absolute", inset: "0", pointerEvents: "none", opacity: "0",
    background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(150,0,0,.75) 100%)"
});
canvas.parentElement?.appendChild(hurtOverlay);
let hurt = 0;

// ---------------- renderer, scene, camera ----------------

const renderer = createRenderer(canvas);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 14000);

const { sun } = createSky(scene, renderer);
createGround(scene);
createMountains(scene);
const clouds = createClouds(scene);
const post = createPost(renderer, scene, camera);
const fx = createEffects(scene);
fx.setLowQuality(QUALITY.name === "low");

// Map edge (-1000..1000): a faint boundary line.
{
    const pts = [[-1000, -1000], [1000, -1000], [1000, 1000], [-1000, 1000], [-1000, -1000]]
        .map(([x, z]) => new THREE.Vector3(x, GROUND_Y + 0.2, z));
    scene.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 })
    ));
}

// ---------------- scenery ----------------

const decor = createDecor(scene);
const grass = createGrass(scene);

// ---------------- map layout (buildings, cover) ----------------
// GET /api/matches/:id/layout: the same boxes the server uses
// to block movement, bullets, grenades and sight.

const plasterTex = Tex.plaster(), blockTex = Tex.blockWall(), roofTex = Tex.roofTiles(),
    plankTex = Tex.planks(), asphaltTex = Tex.asphalt();

const brickTex = Tex.brick();
const MATS = {};
function layoutMaterial(key) {
    if (MATS[key]) return MATS[key];
    const std = (tex, opts, mapped) => worldMapped(new THREE.MeshStandardMaterial({ map: tex.map, normalMap: tex.normalMap, envMapIntensity: 0.5, ...opts }), mapped);
    const make = {
        "house-wall:brick": () => std(brickTex, { roughness: 0.88 }, { uvScale: 0.45, grime: true }),
        "house-wall:plaster": () => std(plasterTex, { roughness: 0.92 }, { uvScale: 0.35, grime: true }),
        roof: () => std(plasterTex, { color: 0xa9a59c, roughness: 0.95 }, { uvScale: 0.3 }),
        wall: () => std(blockTex, { roughness: 0.9 }, { uvScale: 0.5, grime: true }),
        crate: () => std(plankTex, { roughness: 0.8 }, { uvScale: 0.7 }),
        floor: () => std(blockTex, { color: 0x9a948a, roughness: 0.85 }, { uvScale: 0.6 }),
        tiles: () => std(roofTex, { roughness: 0.7, side: THREE.DoubleSide }, { uvScale: 0.35 })
    }[key];
    MATS[key] = make ? make() : new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.9 });
    return MATS[key];
}
// Wall colour per building style (multiplies the plaster texture).
const STYLE_TINTS = {
    concrete: [0xc9c7c1, 0xb9b8b2, 0xd6d2c8],
    painted: [0xf2e2b8, 0xbfe0e8, 0xf0c8c0, 0xd8eac0, 0xf5d77e, 0xe9eef2],
    tiled: [0xf3e7cf, 0xffffff, 0xeedcc0],
    brick: [0xffffff, 0xf0e4dc, 0xe4d6cc]
};

const layoutGroup = new THREE.Group();
scene.add(layoutGroup);
const solidMeshes = [];       // for camera, aim and grenade rays (collision boxes)
let layoutFor = null;
let blockedGrid = null;       // 1 m raster of buildings/roads (grass & trees avoid it)

async function loadLayout(matchId) {
    layoutFor = matchId;
    const r = await Api.call("GET", `/api/matches/${matchId}/layout`);
    if (!r.ok || layoutFor !== matchId) return;
    buildLayout(r.json.layout);
}

const GRID = 2000;
function markRect(grid, x0, z0, x1, z1) {
    const a = Math.max(0, Math.floor(x0 + 1000)), b = Math.min(GRID - 1, Math.ceil(x1 + 1000));
    const c = Math.max(0, Math.floor(z0 + 1000)), d = Math.min(GRID - 1, Math.ceil(z1 + 1000));
    for (let z = c; z <= d; z++) grid.fill(1, z * GRID + a, z * GRID + b + 1);
}
function isBlocked(x, z, pad = 0) {
    if (!blockedGrid) return false;
    const probe = (px, pz) => {
        const gx = Math.floor(px + 1000), gz = Math.floor(pz + 1000);
        return gx >= 0 && gz >= 0 && gx < GRID && gz < GRID && blockedGrid[gz * GRID + gx] === 1;
    };
    if (probe(x, z)) return true;
    if (!pad) return false;
    return probe(x + pad, z) || probe(x - pad, z) || probe(x, z + pad) || probe(x, z - pad);
}

function clearLayout() {
    for (const child of [...layoutGroup.children]) {
        layoutGroup.remove(child);
        child.geometry?.dispose();
    }
    solidMeshes.length = 0;
    blockedGrid = null;
}

let currentLayout = null;
function buildLayout(layout) {
    clearLayout();
    currentLayout = layout || null;
    if (!layout) return;

    const grid = new Uint8Array(GRID * GRID);
    const box = new THREE.BoxGeometry(1, 1, 1);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const color = new THREE.Color();

    // Which building an obstacle belongs to (so a house has one colour).
    const buildingOf = o => {
        const cx = (o.min.x + o.max.x) / 2, cz = (o.min.z + o.max.z) / 2;
        return layout.buildings.findIndex(b => cx >= b.min.x - 0.5 && cx <= b.max.x + 0.5 && cz >= b.min.z - 0.5 && cz <= b.max.z + 0.5);
    };

    const byKind = new Map();
    for (const o of layout.obstacles) {
        if (!byKind.has(o.kind)) byKind.set(o.kind, []);
        byKind.get(o.kind).push(o);
        markRect(grid, o.min.x - 0.6, o.min.z - 0.6, o.max.x + 0.6, o.max.z + 0.6);
    }
    for (const b of layout.buildings) markRect(grid, b.min.x - 0.5, b.min.z - 0.5, b.max.x + 0.5, b.max.z + 0.5);

    const rockGeo = rockGeometry(808);

    const boxMatrix = o => m.compose(
        new THREE.Vector3((o.min.x + o.max.x) / 2, (o.min.y + o.max.y) / 2, (o.min.z + o.max.z) / 2),
        q,
        new THREE.Vector3(o.max.x - o.min.x, o.max.y - o.min.y, o.max.z - o.min.z)
    ).clone();

    // Exact collision boxes (not drawn) for camera, aim and grenade rays.
    for (const [kind, list] of byKind) {
        const solid = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial(), list.length);
        solid.userData.kind = kind;
        list.forEach((o, i) => solid.setMatrixAt(i, boxMatrix(o)));
        solid.computeBoundingSphere();
        solid.updateMatrixWorld(true);
        solidMeshes.push(solid);
    }

    // Visuals, grouped by material (house walls by building style).
    const visuals = new Map();   // material key -> [{ o, tint }]
    const push = (key, o, tint) => { if (!visuals.has(key)) visuals.set(key, []); visuals.get(key).push({ o, tint }); };
    for (const o of layout.obstacles) {
        if (o.kind === "house-wall") {
            const bi = buildingOf(o);
            const b = layout.buildings[bi];
            const style = STYLE_TINTS[b?.style] ? b.style : "painted";
            const tints = STYLE_TINTS[style];
            push(style === "brick" ? "house-wall:brick" : "house-wall:plaster", o, tints[((b?.variant ?? 0) + Math.max(0, bi)) % tints.length]);
        } else {
            push(o.kind, o, null);
        }
    }

    for (const [key, list] of visuals) {
        let visual;
        if (key === "rock") {
            visual = new THREE.InstancedMesh(rockGeo, rockMaterial(), list.length);
            // Slightly larger than the box so it reads as a natural boulder.
            const grow = new THREE.Matrix4().makeScale(1.12, 1.08, 1.12);
            list.forEach(({ o }, i) => visual.setMatrixAt(i, boxMatrix(o).multiply(grow)));
        } else {
            visual = new THREE.InstancedMesh(box, layoutMaterial(key), list.length);
            list.forEach(({ o, tint }, i) => {
                visual.setMatrixAt(i, boxMatrix(o));
                if (tint !== null) visual.setColorAt(i, color.setHex(tint));
            });
        }
        visual.castShadow = visual.receiveShadow = true;
        visual.computeBoundingSphere();
        layoutGroup.add(visual);
    }

    // Windows (visual only) on both faces of long house walls.
    const windows = [];
    for (const o of byKind.get("house-wall") || []) {
        const dx = o.max.x - o.min.x, dz = o.max.z - o.min.z, h = o.max.y - o.min.y;
        const alongX = dx >= dz;
        const len = alongX ? dx : dz;
        if (h < 2.5 || len < 2.4) continue;
        const n = Math.max(1, Math.floor((len - 0.8) / 2.8));
        for (let i = 0; i < n; i++) {
            const t = (i + 0.5) / n;
            const y = o.min.y + 1.55;
            for (const side of [-1, 1]) {
                const x = alongX ? o.min.x + dx * t : (side < 0 ? o.min.x : o.max.x);
                const z = alongX ? (side < 0 ? o.min.z : o.max.z) : o.min.z + dz * t;
                windows.push({ x, y, z, alongX, side });
            }
        }
    }
    if (windows.length) {
        const frameMat = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.6 });
        const glassMat = new THREE.MeshStandardMaterial({ color: 0x1a2630, metalness: 0.9, roughness: 0.08, envMapIntensity: 1.4 });
        const frames = new THREE.InstancedMesh(box, frameMat, windows.length);
        const glass = new THREE.InstancedMesh(box, glassMat, windows.length);
        const sills = new THREE.InstancedMesh(box, frameMat, windows.length);
        windows.forEach((w, i) => {
            const out = (d) => w.alongX ? new THREE.Vector3(w.x, w.y, w.z + w.side * d) : new THREE.Vector3(w.x + w.side * d, w.y, w.z);
            const size = (a, b, c) => w.alongX ? new THREE.Vector3(a, b, c) : new THREE.Vector3(c, b, a);
            frames.setMatrixAt(i, m.compose(out(0.02), q, size(1.05, 1.2, 0.05)));
            glass.setMatrixAt(i, m.compose(out(0.05), q, size(0.86, 1.02, 0.01)));
            const sp = out(0.06); sp.y -= 0.63;
            sills.setMatrixAt(i, m.compose(sp, q, size(1.2, 0.06, 0.12)));
        });
        [frames, glass, sills].forEach(o => { o.castShadow = true; o.receiveShadow = true; o.computeBoundingSphere(); layoutGroup.add(o); });
    }

    // Pitched clay-tile roofs on "tiled" houses (above the flat roof slab).
    const tiled = layout.buildings.filter(b => b.style === "tiled");
    if (tiled.length) {
        const roofGeo = new THREE.ConeGeometry(1, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0);
        const roofs = new THREE.InstancedMesh(roofGeo, layoutMaterial("tiles"), tiled.length);
        tiled.forEach((b, i) => {
            const top = GROUND_Y + (b.height || 3.6) + 0.4;
            const hx = (b.max.x - b.min.x) / 2 + 0.5, hz = (b.max.z - b.min.z) / 2 + 0.5;
            roofs.setMatrixAt(i, m.compose(
                new THREE.Vector3((b.min.x + b.max.x) / 2, top - 0.05, (b.min.z + b.max.z) / 2), q,
                new THREE.Vector3(hx / Math.SQRT1_2, Math.min(hx, hz) * 0.55, hz / Math.SQRT1_2)));
        });
        roofs.castShadow = roofs.receiveShadow = true;
        roofs.computeBoundingSphere();
        layoutGroup.add(roofs);
    }

    // Concrete floors inside buildings (instead of grass indoors).
    if (layout.buildings.length) {
        const floors = new THREE.InstancedMesh(box, layoutMaterial("floor"), layout.buildings.length);
        layout.buildings.forEach((b, i) => {
            floors.setMatrixAt(i, m.compose(
                new THREE.Vector3((b.min.x + b.max.x) / 2, GROUND_Y + 0.03, (b.min.z + b.max.z) / 2), q,
                new THREE.Vector3(b.max.x - b.min.x + 0.4, 0.06, b.max.z - b.min.z + 0.4)));
        });
        floors.receiveShadow = true;
        floors.computeBoundingSphere();
        layoutGroup.add(floors);
    }

    // Roads (visual only): asphalt with centre dashes and edge lines.
    const asphalt = worldMapped(new THREE.MeshStandardMaterial({ map: asphaltTex.map, normalMap: asphaltTex.normalMap, roughness: 0.93, envMapIntensity: 0.4 }), { uvScale: 0.25 });
    const paint = new THREE.MeshStandardMaterial({ color: 0xe8e2cf, roughness: 0.6 });
    const shoulder = worldMapped(new THREE.MeshStandardMaterial({ map: Tex.dirt().map, normalMap: Tex.dirt().normalMap, roughness: 1 }), { uvScale: 0.3 });
    const segs = [];
    for (const road of layout.roads || []) {
        for (let i = 0; i < road.points.length - 1; i++) {
            segs.push({ a: road.points[i], b: road.points[i + 1], width: road.width, kind: road.kind });
        }
    }
    if (segs.length) {
        const surface = new THREE.InstancedMesh(box, asphalt, segs.length);
        const verge = new THREE.InstancedMesh(box, shoulder, segs.length);
        const marks = [];
        segs.forEach((s, i) => {
            const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z;
            const len = Math.hypot(dx, dz);
            const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-dz, dx));
            const mid = new THREE.Vector3((s.a.x + s.b.x) / 2, GROUND_Y + 0.03, (s.a.z + s.b.z) / 2);
            surface.setMatrixAt(i, m.compose(mid, rot, new THREE.Vector3(len + s.width, 0.04, s.width)));
            verge.setMatrixAt(i, m.compose(mid.clone().setY(GROUND_Y + 0.012), rot, new THREE.Vector3(len + s.width + 1.6, 0.02, s.width + 1.6)));

            // Rasterise for grass/trees.
            const steps = Math.ceil(len / 1);
            for (let k = 0; k <= steps; k++) {
                const px = s.a.x + dx * (k / steps), pz = s.a.z + dz * (k / steps), hw = s.width / 2 + 1;
                markRect(grid, px - hw, pz - hw, px + hw, pz + hw);
            }

            // Centre dashes (3 m every 7 m); highways also get edge lines.
            const ux = dx / len, uz = dz / len;
            for (let d = 2; d < len - 1; d += 7) {
                marks.push({ x: s.a.x + ux * (d + 1.5), z: s.a.z + uz * (d + 1.5), len: 3, w: 0.15, rot });
            }
            if (s.kind === "highway") {
                for (const side of [-1, 1]) {
                    const off = (s.width / 2 - 0.4) * side;
                    marks.push({ x: (s.a.x + s.b.x) / 2 - uz * off, z: (s.a.z + s.b.z) / 2 + ux * off, len, w: 0.18, rot });
                }
            }
        });
        const lines = new THREE.InstancedMesh(box, paint, Math.max(1, marks.length));
        marks.forEach((k, i) => lines.setMatrixAt(i, m.compose(new THREE.Vector3(k.x, GROUND_Y + 0.055, k.z), k.rot, new THREE.Vector3(k.len, 0.01, k.w))));
        lines.count = marks.length;
        surface.receiveShadow = verge.receiveShadow = lines.receiveShadow = true;
        [surface, verge, lines].forEach(o => { o.computeBoundingSphere(); layoutGroup.add(o); });
    }

    blockedGrid = grid;

    // The server's rocks replace the decorative ones; clear decor
    // and grass standing on buildings and roads.
    decor.setRocksVisible(false);
    decor.clearAround(isBlocked);
    grass.setBlocked(isBlocked);
}

// Distance along a ray to the first wall, or Infinity.
function wallDistance(ray, far = Infinity) {
    if (!solidMeshes.length) return Infinity;
    const rc = new THREE.Raycaster(ray.origin, ray.direction, 0, far);
    const hit = rc.intersectObjects(solidMeshes, false)[0];
    return hit ? hit.distance : Infinity;
}

function wallHit(from, to) {
    if (!solidMeshes.length) return null;
    const dir = to.clone().sub(from);
    const len = dir.length();
    const rc = new THREE.Raycaster(from, dir.normalize(), 0, len);
    const hit = rc.intersectObjects(solidMeshes, false)[0];
    return hit ? { point: hit.point, normal: hit.face ? hit.face.normal.clone() : dir.clone().negate(), kind: hit.object.userData.kind } : null;
}

function glooHit(group, from, to) {
    const dir = to.clone().sub(from);
    const rc = new THREE.Raycaster(from, dir.clone().normalize(), 0, dir.length() + 2);
    const hit = rc.intersectObject(group.userData.wall, false)[0];
    if (hit) return { point: hit.point, normal: hit.face.normal.clone().transformDirection(group.userData.wall.matrixWorld) };
    // Server says it was blocked: put the impact at the wall centre height.
    const p = group.position.clone().setY(group.position.y + group.userData.size.height * 0.6);
    return { point: p, normal: dir.normalize().negate() };
}

// Bullet impact effect per surface.
const SURFACE = { crate: "wood", rock: "stone", "house-wall": "concrete", wall: "concrete", roof: "concrete" };

// ---------------- safe zone ----------------

const zoneWall = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 1, 160, 1, true),
    new THREE.ShaderMaterial({
        uniforms: { time: timeUniform, color: { value: new THREE.Color(0.55, 0.35, 1.0) } },
        vertexShader: `
            varying vec2 vUv; varying float vY;
            void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vY = w.y;
                gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `
            uniform float time; uniform vec3 color; varying vec2 vUv; varying float vY;
            void main(){
                float bands = sin(vUv.x * 900.0 + vY * 0.35 - time * 2.0) * 0.5 + 0.5;
                float rise = sin(vY * 0.08 - time * 1.4) * 0.5 + 0.5;
                float ground = exp(-max(0.0, vY - ${GROUND_Y.toFixed(1)}) * 0.6);
                float a = 0.03 + bands * 0.025 + rise * 0.03 + ground * 0.35;
                a *= smoothstep(600.0, 200.0, vY);
                gl_FragColor = vec4(color * (1.0 + ground), a);
            }`,
        transparent: true, depthWrite: false, side: THREE.DoubleSide
    })
);
zoneWall.visible = false;
scene.add(zoneWall);

const circlePoints = [];
for (let i = 0; i <= 160; i++) {
    const a = (i / 160) * Math.PI * 2;
    circlePoints.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
}
const nextZone = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(circlePoints),
    new THREE.LineBasicMaterial({ color: 0xffffff })
);
nextZone.visible = false;
scene.add(nextZone);

// ---------------- characters ----------------

const rigs = new Map(); // playerId -> rig

function rigFor(id, name) {
    let rig = rigs.get(id);

    if (rig && name && rig.name !== name) {
        rig.root.remove(rig.label);
        rig.label = makeLabel(name);
        rig.label.position.y = 2.4;
        rig.root.add(rig.label);
        rig.name = name;
    }

    if (!rig) {
        // Your own soldier uses the operator picked in the lobby.
        rig = makeCharacter(id, name, scene, id === G.self.id ? (window.IBF_HERO?.() || {}) : {});
        registerHits(rig, id);
        rig.onStep = (r, run) => {
            fx.footDust(r.shown, run);
            Audio.playFootstep(r.shown, run);
        };
        rigs.set(id, rig);
    }

    return rig;
}

function removeRig(id) {
    const rig = rigs.get(id);
    if (!rig) return;
    disposeRig(rig, scene);
    rigs.delete(id);
}

// Landing detection per player (dust burst when they touch down).
const wasAirborne = new Map();
function checkLanding(id, pos, airborne) {
    if (wasAirborne.get(id) && !airborne && pos) fx.landingDust(pos);
    wasAirborne.set(id, airborne);
}

// ---------------- aircraft ----------------

const aircraft = createAircraft();
aircraft.visible = false;
scene.add(aircraft);

function aircraftPosition() {
    const f = G.flight;
    if (!f) return null;

    const t = (Date.now() - f.startedAt) / f.durationMs;
    if (t > 1.05) return null;

    const s = f.flightPath.start;
    const e = f.flightPath.end;
    const p = Math.max(0, Math.min(1, t));

    return {
        pos: new THREE.Vector3(s.x + (e.x - s.x) * p, s.y, s.z + (e.z - s.z) * p),
        yaw: Math.atan2(e.x - s.x, e.z - s.z)
    };
}

// ---------------- loot, smoke, walls, grenades ----------------

const lootMeshes = new Map();
const smokeMeshes = new Map();
const wallMeshes = new Map();
const grenadeMeshes = new Map();

function syncMap(store, data, create, update, remove) {
    for (const [id, obj] of store) {
        if (!data.has(id)) {
            scene.remove(obj);
            store.delete(id);
            remove?.(id, obj);
        }
    }
    for (const [id, item] of data) {
        let obj = store.get(id);
        if (!obj) {
            obj = create(item, id);
            scene.add(obj);
            store.set(id, obj);
        }
        if (update) update(obj, item, id);
    }
}

function createLoot(item) {
    const { group, spin } = buildLoot(item);
    const label = makeLabel(item.name + (item.quantity ? ` x${item.quantity}` : ""));
    label.scale.set(2.2, 0.55, 1);
    label.position.y = 1.2;
    label.visible = false;
    group.add(label);

    group.userData = { spin, label };
    group.position.set(item.position.x, item.position.y, item.position.z);
    group.rotation.y = (item.position.x * 13.7 + item.position.z * 7.1) % (Math.PI * 2);
    return group;
}

// Smoke is drawn with particles; this marker only tracks its lifetime.
function createSmoke() {
    return new THREE.Group();
}

// Gloo wall: a blue hexagonal energy shield. Cells build up from
// the ground, bullets send ripples across it, and it shatters
// when it is destroyed.
const GLOO_VERT = `
    varying vec3 vLocal; varying vec3 vNormalL; varying vec3 vViewN; varying vec3 vViewDir;
    void main() {
        vLocal = position; vNormalL = normal;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewN = normalize(normalMatrix * normal); vViewDir = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
    }`;
const GLOO_FRAG = `
    uniform float time; uniform float build; uniform float damage; uniform vec3 size; uniform vec4 hits[4];
    varying vec3 vLocal; varying vec3 vNormalL; varying vec3 vViewN; varying vec3 vViewDir;
    float hexDist(vec2 p) { p = abs(p); return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x); }
    vec4 hexCoords(vec2 uv) {
        vec2 r = vec2(1.0, 1.7320508), h = r * 0.5;
        vec2 a = mod(uv, r) - h, b = mod(uv - h, r) - h;
        vec2 gv = dot(a, a) < dot(b, b) ? a : b;
        return vec4(gv, uv - gv);
    }
    float rand(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
        vec2 p = abs(vNormalL.x) > 0.5 ? vLocal.zy : (abs(vNormalL.y) > 0.5 ? vLocal.xz : vLocal.xy);
        vec4 hc = hexCoords(p * 3.2);
        float edge = smoothstep(0.06, 0.0, 0.5 - hexDist(hc.xy));
        float r = rand(hc.zw);
        // Build-up: cells appear bottom to top with a bright front.
        float yN = vLocal.y / size.y + 0.5;
        float reveal = build * 1.35 - r * 0.35;
        if (yN > reveal) discard;
        float front = smoothstep(0.12, 0.0, reveal - yN) * (1.0 - step(1.0, build));
        // Damage: cells crack, then break out, and the shield shifts toward orange.
        float cracked = step(r, damage);
        if (r < damage * 0.45 && rand(hc.zw + 3.7) > 0.45) discard;
        float ang = r * 6.283;
        float crack = cracked * smoothstep(0.035, 0.0, abs(hc.x * cos(ang) + hc.y * sin(ang)));
        float flicker = damage > 0.6 ? step(0.5, fract(sin(time * 23.0 + r * 40.0) * 43758.5)) : 1.0;
        // Bullet ripples.
        float ring = 0.0;
        for (int i = 0; i < 4; i++) {
            float t = time - hits[i].w;
            if (t > 0.0 && t < 1.2) {
                float d = distance(vLocal, hits[i].xyz);
                ring += exp(-pow((d - t * 4.0) / 0.18, 2.0)) * exp(-t * 3.0) + exp(-d * 6.0) * exp(-t * 8.0);
            }
        }
        float pulse = 0.5 + 0.5 * sin(time * 2.0 + r * 6.283);
        float fres = pow(1.0 - abs(dot(vViewN, vViewDir)), 2.0);
        vec3 base = mix(vec3(0.25, 0.65, 1.0), vec3(1.0, 0.55, 0.3), damage * 0.6);
        vec3 col = base * (0.35 + edge * (1.4 + pulse * 0.6) * flicker + fres * 0.9 + ring * 3.0 + front * 3.0)
            + vec3(0.1, 0.12, 0.15) * r + vec3(1.6, 1.9, 2.2) * crack;
        float a = 0.32 + edge * 0.45 + fres * 0.3 + ring * 0.5 + front * 0.5 + crack * 0.5;
        gl_FragColor = vec4(col, clamp(a, 0.0, 0.95));
    }`;

function createWall(w) {
    const size = w.size || { width: 4, height: 3, thickness: 0.5 };
    const group = new THREE.Group();
    const uniforms = {
        time: timeUniform,
        build: { value: 0 },
        damage: { value: 0 },
        size: { value: new THREE.Vector3(size.width, size.height, size.thickness) },
        hits: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, -10)) }
    };
    const wall = new THREE.Mesh(
        new THREE.BoxGeometry(size.width, size.height, size.thickness),
        new THREE.ShaderMaterial({ uniforms, vertexShader: GLOO_VERT, fragmentShader: GLOO_FRAG, transparent: true, depthWrite: false, toneMapped: false })
    );
    wall.position.y = size.height / 2;
    wall.castShadow = true;
    group.add(wall);
    group.position.set(w.position.x, w.position.y, w.position.z);
    // facing (degrees): 0 = face points +Z, 90 = +X.
    group.rotation.y = (w.facing * Math.PI) / 180;
    group.userData = { wall, uniforms, born: performance.now(), size, nextHit: 0, hitAt: 0 };
    fx.glooForm(group.position.clone(), size, group.rotation.y);
    return group;
}

// Ripple on a gloo wall where a bullet struck it (world point).
function glooRipple(group, worldPoint) {
    const local = group.userData.wall.worldToLocal(worldPoint.clone());
    const slot = group.userData.uniforms.hits.value[group.userData.nextHit++ % 4];
    slot.set(local.x, local.y, local.z, timeUniform.value);
}

function glooRemoved(id, group) {
    fx.glooShatter(group.position.clone(), group.userData.size, group.rotation.y);
    group.userData.wall.geometry.dispose();
    group.userData.wall.material.dispose();
}

function createGrenade(g) {
    const mesh = buildThrowable(g.type);
    mesh.position.set(g.position.x, g.position.y + 0.08, g.position.z);
    return mesh;
}

// ---------------- effects (called by game.js) ----------------

const selfMuzzle = () => {
    const rig = rigs.get(G.self.id);
    if (!rig?.weapon) return null;
    rig.root.updateMatrixWorld(true);
    const pos = new THREE.Vector3();
    rig.weapon.userData.muzzle.getWorldPosition(pos);
    return { rig, pos };
};

function rigNear(position, maxDist, exceptId) {
    let best = null, bestD = maxDist;
    for (const [id, rig] of rigs) {
        if (id === exceptId || !rig.shown || !rig.root.visible) continue;
        const d = Math.hypot(rig.shown.x - position.x, rig.shown.z - position.z);
        if (d < bestD) { best = rig; bestD = d; }
    }
    return best;
}

function addEffect(effect) {
    const now = new THREE.Vector3();

    switch (effect.fx) {
        case "shot": {
            const m = selfMuzzle();
            const from = m ? m.pos : new THREE.Vector3(effect.from.x, effect.from.y + 1.45, effect.from.z);
            const target = new THREE.Vector3(effect.to.x, (effect.to.y ?? GROUND_Y) + (effect.toHeight ?? 1.15), effect.to.z);
            const dir = target.clone().sub(from).normalize();
            const category = m?.rig.weapon?.userData.category || "ar";
            fx.muzzleFlash(from, dir, { category });
            Audio.playGunshot(from, category, false);
            if (m) {
                m.rig.recoil = 1;
                const right = new THREE.Vector3(Math.cos(m.rig.root.rotation.y), 0, -Math.sin(m.rig.root.rotation.y));
                if (category !== "shotgun") fx.ejectCasing(from.clone().addScaledVector(dir, -0.4), right);
            }
            fx.addShake(category === "sniper" ? 0.25 : 0.08);

            const gloo = effect.blocked ? wallMeshes.get(effect.wallId) : null;
            const wall = effect.blocked ? (gloo ? glooHit(gloo, from, target) : wallHit(from, target)) : null;
            if (gloo && wall) {
                fx.tracer(from.clone().addScaledVector(dir, 0.3), wall.point);
                glooRipple(gloo, wall.point);
                fx.impact(wall.point, "dust", wall.normal);
                return;
            }
            const end = wall ? wall.point : effect.hit ? target : target.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.5, (Math.random() - 0.7) * 1.2, (Math.random() - 0.5) * 1.5));
            fx.tracer(from.clone().addScaledVector(dir, 0.3), end);
            if (wall) fx.impact(wall.point, SURFACE[wall.kind] || "concrete", wall.normal);
            else if (effect.hit) fx.impact(target, "blood", dir.clone().negate());
            else fx.impact(end.y < GROUND_Y + 0.3 ? end.setY(GROUND_Y + 0.05) : end, "dust");
            return;
        }

        case "gunshot": {
            const pos = new THREE.Vector3(effect.at.x, (effect.at.y ?? GROUND_Y) + 1.4, effect.at.z);
            const category = weaponCategory("", effect.weapon || "");
            const shooter = rigNear(pos, 8, G.self.id);
            if (shooter?.weapon) {
                shooter.root.updateMatrixWorld(true);
                const mp = new THREE.Vector3();
                shooter.weapon.userData.muzzle.getWorldPosition(mp);
                const dir = new THREE.Vector3(Math.sin(shooter.root.rotation.y), 0, Math.cos(shooter.root.rotation.y));
                shooter.recoil = 1;
                if (!effect.suppressed) fx.muzzleFlash(mp, dir, { category, light: effect.distance < 60 });
                fx.tracer(mp.clone().addScaledVector(dir, 0.3), mp.clone().addScaledVector(dir, 60));
                Audio.playGunshot(mp, category, effect.suppressed);
            } else {
                Audio.playGunshot(pos, category, effect.suppressed);
            }
            return;
        }

        case "hurt": {
            hurt = Math.min(1, hurt + 0.6);
            fx.addShake(0.3);
            const self = rigs.get(G.self.id);
            if (self?.shown) {
                const chest = self.shown.clone().add(new THREE.Vector3(0, 1.2, 0));
                fx.impact(chest, "blood", new THREE.Vector3(0, 0.3, 0));
                const attacker = rigs.get(Number(effect.attackerId));
                if (attacker?.weapon && attacker.root.visible) {
                    attacker.root.updateMatrixWorld(true);
                    const mp = new THREE.Vector3();
                    attacker.weapon.userData.muzzle.getWorldPosition(mp);
                    fx.tracer(mp, chest);
                }
            }
            return;
        }

        case "explosion": {
            const pos = new THREE.Vector3(effect.at.x, effect.at.y ?? GROUND_Y, effect.at.z);
            fx.explosion(pos, effect.radius, effect.type);
            const focus = cameraFocus().point;
            const d = focus.distanceTo(pos);
            if (effect.type === "frag") fx.addShake(Math.max(0, 1.2 - d / 35));
            return;
        }

        case "ping":
            return;
    }

    // Legacy effects without an fx tag.
    if (effect.kind === "line" && effect.from && effect.to) {
        const from = new THREE.Vector3(effect.from.x, effect.from.y + 1.45, effect.from.z);
        const to = new THREE.Vector3(effect.to.x, (effect.to.y ?? GROUND_Y) + 1.1, effect.to.z);
        fx.tracer(from, to);
    } else if (effect.at) {
        now.set(effect.at.x, (effect.at.y ?? GROUND_Y) + 0.3, effect.at.z);
        fx.impact(now, "dust");
    }
}

// ---------------- camera & input ----------------

let yaw = 0;
let pitch = -0.15;

canvas.addEventListener("click", () => {
    if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
});

document.addEventListener("pointerlockchange", () => {
    lockHint.style.display = document.pointerLockElement === canvas ? "none" : "block";
});

document.addEventListener("mousemove", e => {
    if (document.pointerLockElement !== canvas) return;
    look(e.movementX, e.movementY);
});

// Camera turn by a pointer movement in pixels (mouse or touch drag).
// Sensitivity is set in the HUD settings; aiming slows it down.
function look(dx, dy) {
    const s = 0.0025 * (window.IBF_SENS?.() ?? 1) * (aiming ? (scopeZoom() < 30 ? 0.35 : 0.6) : 1);
    yaw -= dx * s;
    pitch = Math.max(-1.25, Math.min(0.9, pitch - dy * s));
}

// Aim down sights: narrower view; sniper / DMR scopes zoom further.
let aiming = false;
let fov = 65;
function scopeZoom() {
    const id = G.activeWeapon || "";
    return /brahmastra/.test(id) ? 18 : /drishti|garuda/.test(id) ? 30 : 45;
}
function setAds(on) {
    aiming = Boolean(on) && G.phase === "ground";
    crosshair.classList.toggle("ads", aiming);
}

function lookDirection() {
    return new THREE.Vector3(
        -Math.sin(yaw) * Math.cos(pitch),
        Math.sin(pitch),
        -Math.cos(yaw) * Math.cos(pitch)
    );
}

function moveVector(keys) {
    const fwx = -Math.sin(yaw), fwz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);

    // Touch joystick: analog, camera-relative (length 0..1 = speed).
    const tm = G.touchMove;
    if (tm && Math.hypot(tm.x, tm.y) > 0.12) {
        const mag = Math.min(1, Math.hypot(tm.x, tm.y));
        const fx = fwx * -tm.y + rx * tm.x, fz = fwz * -tm.y + rz * tm.x;
        const len = Math.hypot(fx, fz) || 1;
        return { x: (fx / len) * mag, z: (fz / len) * mag };
    }

    let x = 0, z = 0;
    if (keys.has("w")) { x += fwx; z += fwz; }
    if (keys.has("s")) { x -= fwx; z -= fwz; }
    if (keys.has("d")) { x += rx; z += rz; }
    if (keys.has("a")) { x -= rx; z -= rz; }
    const len = Math.hypot(x, z);
    return len ? { x: x / len, z: z / len } : null;
}

function cameraFocus() {
    if (G.phase === "aircraft") {
        const a = aircraftPosition();
        if (a) return { point: a.pos, distance: 55 };
    }

    if (G.spectating && rigs.get(G.spectating)?.shown) {
        return { point: rigs.get(G.spectating).shown.clone().add(new THREE.Vector3(0, 1.6, 0)), distance: 7 };
    }

    const self = rigs.get(G.self.id);
    if (self?.shown) {
        const airborne = G.phase === "dropping";
        return {
            point: self.shown.clone().add(new THREE.Vector3(0, 1.6, 0)),
            distance: airborne ? (G.parachute ? 12 : 9) : aiming ? 2.2 : Math.max(2.5, Math.min(40, 24 / G.zoom))
        };
    }

    return { point: new THREE.Vector3(0, 120, 0), distance: 40 };
}

function updateCamera(t) {
    const { point, distance } = cameraFocus();

    // Field of view eases toward the aiming zoom.
    if (G.phase !== "ground") aiming = false;
    const targetFov = aiming ? scopeZoom() : 65;
    if (Math.abs(fov - targetFov) > 0.05) {
        fov += (targetFov - fov) * 0.25;
        camera.fov = fov;
        camera.updateProjectionMatrix();
    }
    const dir = lookDirection();
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const shoulder = G.phase === "ground" ? 0.7 : 0;

    // Pull the camera in front of walls behind the player.
    const back = dir.clone().negate();
    const blocked = wallDistance(new THREE.Ray(point.clone(), back), distance);
    const camDistance = Math.max(0.6, Math.min(distance, blocked - 0.3));

    const pos = point.clone()
        .addScaledVector(dir, -camDistance)
        .addScaledVector(right, shoulder);
    pos.y = Math.max(pos.y, GROUND_Y + 0.4);

    // Shake (explosions, recoil, hits).
    const s = fx.shake;
    if (s > 0) {
        pos.x += (Math.sin(t * 91) + Math.sin(t * 57)) * 0.05 * s;
        pos.y += (Math.sin(t * 77) + Math.sin(t * 43)) * 0.05 * s;
    }

    camera.position.copy(pos);
    camera.lookAt(point.clone().addScaledVector(dir, 20).addScaledVector(right, shoulder));

    followSun(sun, point);
    Audio.setListener(camera.position, yaw);
    return point;
}

// ---------------- aiming ----------------

const raycaster = new THREE.Raycaster();
const CENTER = new THREE.Vector2(0, 0);
const PART_HEIGHT = { head: 1.65, body: 1.05, legs: 0.33 };   // server hitbox centres

function aimTarget() {
    raycaster.setFromCamera(CENTER, camera);

    const candidates = [];
    for (const [id, rig] of rigs) {
        if (id === G.self.id || !rig.root.visible) continue;
        const p = G.players.get(id);
        if (!p || !p.alive || !p.pos || p.hidden || isTeammate(id)) continue;
        candidates.push(...rig.hits);
    }

    const hit = raycaster.intersectObjects(candidates, false)[0];
    const wall = wallDistance(raycaster.ray);

    if (hit && hit.distance > wall) return null;   // a wall is in the way

    if (hit) {
        const id = hit.object.userData.playerId;
        const p = G.players.get(id).pos;
        // Aim at the server's position for that body part.
        return { id, point: { x: p.x, y: p.y + (PART_HEIGHT[hit.object.userData.part] ?? 1.05), z: p.z } };
    }

    // Small assist: an enemy's chest within ~1.2 degrees.
    let best = null;
    let bestAngle = (1.2 * Math.PI) / 180;
    for (const [id, p] of G.players) {
        if (id === G.self.id || !p.alive || !p.pos || p.hidden || isTeammate(id)) continue;
        const chest = new THREE.Vector3(p.pos.x, p.pos.y + 1.05, p.pos.z);
        const toChest = chest.clone().sub(raycaster.ray.origin);
        const angle = raycaster.ray.direction.angleTo(toChest);
        if (angle < bestAngle && toChest.length() < wall) { best = { id, point: { x: chest.x, y: chest.y, z: chest.z } }; bestAngle = angle; }
    }

    return best;
}

// Ground point under the crosshair (grenades, gloo walls).
function toWorld() {
    raycaster.setFromCamera(CENTER, camera);
    const y = G.self.pos ? G.self.pos.y : GROUND_Y;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
    const point = new THREE.Vector3();

    if (raycaster.ray.intersectPlane(plane, point) && G.self.pos &&
        Math.hypot(point.x - G.self.pos.x, point.z - G.self.pos.z) < 200) {
        return { x: point.x, y, z: point.z };
    }

    const f = moveVector(new Set(["w"])) || { x: 0, z: -1 };
    const base = G.self.pos || { x: 0, z: 0 };
    return { x: base.x + f.x * 30, y, z: base.z + f.z * 30 };
}

// ---------------- frame ----------------

let lastFrame = performance.now();
let windCooldown = 0;

function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    post.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);

let fpsValue = 0, fpsFrames = 0, fpsSince = performance.now();
function draw() {
    const now = performance.now();
    fpsFrames++;
    if (now - fpsSince > 1000) { fpsValue = Math.round(fpsFrames * 1000 / (now - fpsSince)); fpsFrames = 0; fpsSince = now; }
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    const t = now / 1000;
    timeUniform.value = t;

    if (canvas.width === 300 && canvas.height === 150) resize();

    if (G.matchId && G.matchId !== layoutFor) loadLayout(G.matchId);
    if (!G.matchId && layoutFor) {
        layoutFor = null;
        clearLayout();
        decor.setRocksVisible(true);
        decor.restore();
        grass.setBlocked(() => false);
    }

    // ----- characters -----
    const seen = new Set();

    for (const [id, p] of G.players) {
        if (id === G.self.id || !p.pos) continue;
        seen.add(id);

        const rig = rigFor(id, p.username);
        const team = isTeammate(id);
        rig.setTeamColor(!p.alive ? TEAM_COLORS.dead : team ? TEAM_COLORS.team : TEAM_COLORS.enemy);

        const stale = Date.now() - (p.seenAt || 0) > 6000;
        rig.root.visible = !p.hidden && !stale;

        const airborne = p.pos.y > GROUND_Y + 2;
        checkLanding(id, p.pos, airborne);
        animateRig(rig, p.pos, dt, {
            knocked: p.knocked,
            dead: !p.alive,
            airborne,
            skydive: p.pos.y >= 520,
            parachute: airborne && p.pos.y < 520,
            hideLabel: !p.alive
        });
    }

    if (G.self.pos && G.self.id) {
        seen.add(G.self.id);
        const rig = rigFor(G.self.id, Api.session?.player?.username);
        rig.setTeamColor(G.self.alive ? TEAM_COLORS.self : TEAM_COLORS.dead);
        rig.root.visible = G.phase !== "aircraft";
        setWeapon(rig, G.activeWeapon || null);

        const airborne = G.phase === "dropping";
        checkLanding(G.self.id, G.self.pos, airborne);
        const fwd = moveVector(new Set(["w"]));
        animateRig(rig, G.self.pos, dt, {
            snappy: true,
            faceYaw: (G.phase === "ground" || airborne) && fwd ? Math.atan2(fwd.x, fwd.z) : undefined,
            knocked: G.self.knocked,
            dead: !G.self.alive,
            airborne,
            skydive: airborne && !G.parachute,
            parachute: airborne && G.parachute,
            hideLabel: true,
            pitch: G.phase === "ground" ? pitch : 0
        });
    }

    for (const id of [...rigs.keys()]) {
        if (!seen.has(id)) { removeRig(id); wasAirborne.delete(id); }
    }

    // ----- aircraft -----
    const a = aircraftPosition();
    aircraft.visible = Boolean(a);
    if (a) {
        aircraft.position.copy(a.pos);
        aircraft.rotation.y = a.yaw;
        aircraft.userData.update(dt, t);
    }

    // ----- zone -----
    if (G.zone) {
        const z = G.zone;
        zoneWall.visible = true;
        zoneWall.position.set(z.current.center.x, GROUND_Y + 300, z.current.center.z);
        zoneWall.scale.set(Math.max(0.1, z.current.radius), 600, Math.max(0.1, z.current.radius));

        nextZone.visible = Boolean(z.next);
        if (z.next) {
            nextZone.position.set(z.next.center.x, GROUND_Y + 0.3, z.next.center.z);
            nextZone.scale.set(Math.max(0.1, z.next.radius), 1, Math.max(0.1, z.next.radius));
        }
    } else {
        zoneWall.visible = nextZone.visible = false;
    }

    // ----- world objects -----
    syncMap(lootMeshes, G.loot, createLoot, (obj, item) => {
        obj.userData.spin.rotation.y = t * 0.6;
        obj.userData.spin.position.y = 0.05 + Math.sin(t * 2 + obj.position.x) * 0.05;
        obj.userData.label.visible = Boolean(G.self.pos) &&
            Math.hypot(item.position.x - G.self.pos.x, item.position.z - G.self.pos.z) < 8;
    });

    syncMap(smokeMeshes, G.smokes, createSmoke, (obj, s, id) => fx.smokeCloud(id, s, dt), id => fx.smokeGone(id));
    syncMap(wallMeshes, G.walls, createWall, (obj, w) => {
        // Cells form over 0.45 s; cracks follow its health (500 max).
        obj.userData.uniforms.build.value = Math.min(1.01, (now - obj.userData.born) / 450);
        obj.userData.uniforms.damage.value = w.health !== undefined ? Math.min(1, Math.max(0, 1 - w.health / 500)) : 0;
        if (w.hitAt && w.hitAt !== obj.userData.hitAt) {
            obj.userData.hitAt = w.hitAt;
            // Damage from a grenade or someone else's shot: ripple near the middle.
            const u = obj.userData.size;
            glooRipple(obj, obj.userData.wall.localToWorld(new THREE.Vector3((Math.random() - 0.5) * u.width * 0.6, (Math.random() - 0.3) * u.height * 0.5, 0)));
        }
    }, glooRemoved);
    syncMap(grenadeMeshes, G.grenades, createGrenade, (obj, g) => {
        obj.rotation.y += dt * 4;
        // Frag fuse sparks / smoke trail.
        if (g.type === "frag" && Math.random() < 0.5) fx.fuse(obj.position);
    });

    // ----- camera, scenery, effects -----
    const focus = updateCamera(t);
    grass.update(focus, camera.position.y);
    clouds.position.x = t * 3;           // drifting clouds

    // Wind rush while free-falling.
    if (G.phase === "dropping" && !G.parachute) {
        fx.fallStreaks(camera.position);
        windCooldown -= dt;
        if (windCooldown <= 0) { Audio.playWind(0.35); windCooldown = 2.2; }
    }

    fx.update(dt);

    // Crosshair turns red when it is on an enemy.
    crosshair.classList.toggle("on-target", G.phase === "ground" && Boolean(aimTarget()));

    // Flash blindness and damage.
    const flashLeft = G.self.flashedUntil - Date.now();
    flashOverlay.style.opacity = flashLeft > 0 ? Math.min(0.97, flashLeft / 1500) : 0;
    hurt = Math.max(0, hurt - dt * 1.4);
    const lowHealth = G.self.alive && G.self.health < 30 ? 0.35 + Math.sin(t * 4) * 0.1 : 0;
    hurtOverlay.style.opacity = Math.max(hurt, lowHealth).toFixed(3);

    post.render();
}

// ---------------- start ----------------

window.Render = { draw, resize, canvas, addEffect, toWorld, moveVector, aimTarget };
// Set the camera angle directly (screenshots, touch controls).
window.Render.debugView = (y, p) => { yaw = y; pitch = p; };
window.Render.fxStats = () => fx.stats();
Object.assign(window.Render, {
    look,
    setAds,
    isAiming: () => aiming,
    getYaw: () => yaw,
    getLayout: () => currentLayout,
    getFps: () => fpsValue
});

resize();
lockHint.style.display = "block";
UI.init();
