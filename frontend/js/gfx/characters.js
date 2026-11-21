// ==========================================
// Soldier characters
// ==========================================
// Real proportions (1.82 m). Hit areas follow the server's
// hitboxes via userData.part ("head" | "body" | "legs"), not
// mesh heights, so the model can look natural.
// Arms use two-bone IK so both hands stay on the weapon.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import * as T from "./textures.js";
import { buildWeapon } from "./weapons.js";
import { seeded } from "./noise.js";

const UP = new THREE.Vector3(0, 1, 0);

// ---------------- shared materials ----------------

const camo = T.camo();
const fabric = T.fabric();

const SKIN_TONES = [0x8d5a3b, 0xa86f4c, 0xc68b62, 0x6f4430, 0xb98463];
const skinMats = SKIN_TONES.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.62 }));

const M = {
    boots: new THREE.MeshStandardMaterial({ color: 0x2f241b, roughness: 0.55, metalness: 0.05 }),
    gloves: new THREE.MeshStandardMaterial({ color: 0x1f1f1d, roughness: 0.75 }),
    strap: new THREE.MeshStandardMaterial({ color: 0x2c2a22, roughness: 0.9 }),
    goggleLens: new THREE.MeshStandardMaterial({ color: 0x2a1f0d, metalness: 1, roughness: 0.05, emissive: 0x120a02 }),
    lines: new THREE.LineBasicMaterial({ color: 0x2a2a2a, transparent: true, opacity: 0.55 }),
    hair: new THREE.MeshStandardMaterial({ color: 0x1a120c, roughness: 0.55, metalness: 0.1 })
};

const VEST_COLORS = [0x5a5d43, 0x6e6449, 0x3e4433, 0x2f3230];
const vestMats = VEST_COLORS.map(c => new THREE.MeshStandardMaterial({
    color: c, map: fabric.map, normalMap: fabric.normalMap, roughness: 0.88
}));
const helmetMats = [0x4f563d, 0x6e6449, 0x34372f].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.1 }));

export const TEAM_COLORS = {
    self: 0x3fa66b,
    team: 0x3d8fd6,
    enemy: 0xc4473f,
    dead: 0x555555
};

// ---------------- geometry (shared) ----------------

const G = {
    thigh: new THREE.CapsuleGeometry(0.078, 0.34, 4, 10).translate(0, -0.22, 0),
    shin: new THREE.CapsuleGeometry(0.06, 0.34, 4, 10).translate(0, -0.21, 0),
    boot: new RoundedBoxGeometry(0.12, 0.11, 0.28, 2, 0.03).translate(0, -0.03, 0.05),
    pelvis: new RoundedBoxGeometry(0.33, 0.18, 0.21, 3, 0.07),
    abdomen: new RoundedBoxGeometry(0.31, 0.24, 0.2, 3, 0.07),
    chest: new RoundedBoxGeometry(0.4, 0.3, 0.23, 3, 0.08),
    vest: new RoundedBoxGeometry(0.42, 0.34, 0.29, 3, 0.05),
    pouch: new RoundedBoxGeometry(0.085, 0.11, 0.055, 2, 0.015),
    pack: new RoundedBoxGeometry(0.32, 0.42, 0.17, 3, 0.05),
    roll: new THREE.CylinderGeometry(0.07, 0.07, 0.34, 12).rotateZ(Math.PI / 2),
    neck: new THREE.CylinderGeometry(0.055, 0.06, 0.1, 10),
    head: new THREE.SphereGeometry(0.105, 20, 14),
    nose: new THREE.BoxGeometry(0.03, 0.045, 0.04),
    ear: new THREE.SphereGeometry(0.025, 8, 6),
    helmet: new THREE.SphereGeometry(0.135, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
    goggles: new RoundedBoxGeometry(0.17, 0.05, 0.05, 2, 0.015),
    goggleLens: new THREE.BoxGeometry(0.065, 0.032, 0.01),
    upperArm: new THREE.CapsuleGeometry(0.058, 0.21, 4, 10).translate(0, 0.16, 0),
    foreArm: new THREE.CapsuleGeometry(0.05, 0.22, 4, 10).translate(0, 0.16, 0),
    hand: new RoundedBoxGeometry(0.07, 0.09, 0.05, 2, 0.02),
    armband: new THREE.CylinderGeometry(0.064, 0.064, 0.05, 12, 1, true).translate(0, 0.2, 0),
    strap: new THREE.BoxGeometry(0.05, 0.36, 0.02),
    hairCap: new THREE.SphereGeometry(0.112, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
    ponytail: new THREE.CapsuleGeometry(0.035, 0.16, 4, 8).translate(0, -0.1, 0),
    cap: new THREE.SphereGeometry(0.118, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.42),
    brim: new THREE.BoxGeometry(0.17, 0.012, 0.09),
    shade: new RoundedBoxGeometry(0.06, 0.035, 0.012, 2, 0.01),
    shadeBar: new THREE.BoxGeometry(0.03, 0.006, 0.006),
    mask: new RoundedBoxGeometry(0.17, 0.09, 0.1, 3, 0.04)
};

const L_UPPER = 0.32, L_FORE = 0.32;

// ---------------- labels ----------------

export function makeLabel(text) {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 64;
    const g = c.getContext("2d");
    g.font = "bold 30px system-ui, sans-serif";
    g.textAlign = "center";
    g.lineWidth = 6;
    g.strokeStyle = "rgba(0,0,0,.7)";
    g.strokeText(text, 128, 42);
    g.fillStyle = "#fff";
    g.fillText(text, 128, 42);

    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(c),
        depthTest: false,
        transparent: true,
        fog: false
    }));
    sprite.scale.set(2.6, 0.65, 1);
    sprite.renderOrder = 10;
    return sprite;
}

// ---------------- parachute ----------------

function makeParachute(rand) {
    const SPAN = 8.4, CHORD = 2.9, CELLS = 9;
    const g = new THREE.PlaneGeometry(SPAN, CHORD, CELLS * 3, 8).toNonIndexed();
    const p = g.attributes.position;
    const col = new Float32Array(p.count * 3);
    const colors = [[0.85, 0.32, 0.12], [0.93, 0.9, 0.84], [0.16, 0.2, 0.3]];
    const scheme = Math.floor(rand() * 3);
    for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), yPlane = p.getY(i);
        const t = (yPlane + CHORD / 2) / CHORD;                 // 0 back -> 1 front
        const s = x / (SPAN / 2);
        // Arched span, airfoil camber along the chord, cell bulges.
        const cell = (x + SPAN / 2) / (SPAN / CELLS);
        const bulge = Math.sin((cell % 1) * Math.PI) * 0.06;
        const y = 6.4 - s * s * 1.35 + Math.sin(t * Math.PI) * 0.32 * (0.8 + t * 0.4) + bulge;
        p.setXYZ(i, x * (1 - s * s * 0.06), y, (t - 0.45) * CHORD);
        const c = colors[(Math.floor(cell) + scheme) % 3];
        const shade = 0.85 + bulge * 2;
        col.set([c[0] * shade, c[1] * shade, c[2] * shade], i * 3);
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();

    const canopy = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
        vertexColors: true, side: THREE.DoubleSide, roughness: 0.75, map: fabric.map
    }));
    canopy.castShadow = true;

    // Suspension lines from the canopy to the shoulder risers.
    const pts = [];
    for (let k = 0; k <= CELLS; k++) {
        const x = -SPAN / 2 + k * (SPAN / CELLS);
        const s = x / (SPAN / 2);
        const y = 6.4 - s * s * 1.35;
        for (const zt of [0.25, 0.7]) {
            const riser = new THREE.Vector3(Math.sign(x || 1) * 0.2, 1.55, 0);
            pts.push(new THREE.Vector3(x * 0.97, y + 0.05, (zt - 0.45) * CHORD), riser);
        }
    }
    const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), M.lines);
    const group = new THREE.Group();
    group.add(canopy, lines);
    group.visible = false;
    return group;
}

// ---------------- character ----------------

// look (all optional): { body: "male"|"female", headgear: "helmet"|"cap"|"none",
//   hair: "short"|"ponytail", eyes: "goggles"|"shades", mask: bool,
//   skin: 0-4, outfit: hex tint, pack: bool }
export function makeCharacter(playerId, name, scene, look = {}) {
    const rand = seeded(Number(playerId) * 7919 + 13 || 1);
    const female = look.body === "female";
    const headgear = look.headgear || (female ? "none" : "helmet");
    const outfit = new THREE.MeshStandardMaterial({
        map: camo.map, normalMap: camo.normalMap, normalScale: new THREE.Vector2(0.6, 0.6),
        color: 0xffffff, roughness: 0.9
    });
    const teamMat = new THREE.MeshStandardMaterial({ color: TEAM_COLORS.enemy, roughness: 0.6, emissive: TEAM_COLORS.enemy, emissiveIntensity: 0.25 });
    const skin = skinMats[look.skin ?? Math.floor(rand() * skinMats.length)];
    const vestMat = vestMats[Math.floor(rand() * vestMats.length)];
    const helmetMat = helmetMats[Math.floor(rand() * helmetMats.length)];

    const tag = (mesh, part) => {
        mesh.userData.playerId = playerId;
        mesh.userData.part = part;
        mesh.castShadow = true;
        return mesh;
    };
    const mesh = (geo, mat, part) => tag(new THREE.Mesh(geo, mat), part);

    const root = new THREE.Group();
    const body = new THREE.Group();        // whole-body lean (knocked, skydive)
    root.add(body);
    const hips = new THREE.Group();
    hips.position.y = 0.95;
    body.add(hips);

    // Legs.
    const legs = [-0.095, 0.095].map(x => {
        const hip = new THREE.Group();
        hip.position.set(x, -0.02, 0);
        hip.add(mesh(G.thigh, outfit, "legs"));
        const knee = new THREE.Group();
        knee.position.y = -0.44;
        knee.add(mesh(G.shin, outfit, "legs"));
        const boot = mesh(G.boot, M.boots, "legs");
        boot.position.y = -0.43;
        knee.add(boot);
        hip.add(knee);
        hips.add(hip);
        return { hip, knee };
    });
    hips.add(mesh(G.pelvis, outfit, "body"));

    // Torso (spine bends to aim).
    const torso = new THREE.Group();
    torso.position.y = 0.06;
    hips.add(torso);
    const abdomen = mesh(G.abdomen, outfit, "body");
    abdomen.position.y = 0.12;
    const chest = mesh(G.chest, outfit, "body");
    chest.position.y = 0.36;
    const vest = mesh(G.vest, vestMat, "body");
    vest.position.set(0, 0.34, 0.01);
    torso.add(abdomen, chest, vest);
    for (let i = 0; i < 3; i++) {
        const p = mesh(G.pouch, vestMat, "body");
        p.position.set(-0.11 + i * 0.11, 0.25, 0.165);
        torso.add(p);
    }
    for (const sx of [-0.12, 0.12]) {
        const s = mesh(G.strap, vestMat, "body");
        s.position.set(sx, 0.47, 0.0);
        s.rotation.x = Math.PI / 2;
        s.scale.set(1, 0.75, 1);
        torso.add(s);
    }
    if (look.pack !== false) {
        const pack = mesh(G.pack, outfit, "body");
        pack.position.set(0, 0.33, -0.22);
        const roll = mesh(G.roll, vestMat, "body");
        roll.position.set(0, 0.6, -0.22);
        torso.add(pack, roll);
    }
    if (female) {
        // Slimmer build.
        abdomen.scale.set(0.86, 1, 0.92);
        chest.scale.set(0.88, 1, 0.98);
        vest.scale.set(0.9, 0.95, 0.95);
        hips.children.filter(c => c.geometry === G.pelvis).forEach(c => c.scale.set(0.98, 1, 0.95));
    }

    // Head.
    const neck = mesh(G.neck, skin, "head");
    neck.position.y = 0.56;
    const head = new THREE.Group();
    head.position.y = 0.68;
    const skull = mesh(G.head, skin, "head");
    skull.scale.set(1, 1.15, 1.08);
    const nose = mesh(G.nose, skin, "head");
    nose.position.set(0, -0.01, 0.11);
    const ears = [-1, 1].map(s => { const e = mesh(G.ear, skin, "head"); e.position.set(s * 0.1, 0, 0); e.scale.set(0.5, 1, 0.8); return e; });
    head.add(skull, nose, ...ears);
    if (female) skull.scale.set(0.94, 1.1, 1.02);

    if (headgear === "helmet") {
        const helmet = mesh(G.helmet, helmetMat, "head");
        helmet.position.set(0, 0.03, -0.005);
        helmet.scale.set(1, 0.95, 1.1);
        head.add(helmet);
    } else {
        // Hair, and optionally a field cap.
        const hairMat = M.hair;
        const cap = mesh(G.hairCap, hairMat, "head");
        cap.position.set(0, 0.03, -0.012);
        cap.scale.set(1.02, 1.0, 1.08);
        head.add(cap);
        if ((look.hair || (female ? "ponytail" : "short")) === "ponytail") {
            const tie = mesh(G.ponytail, hairMat, "head");
            tie.position.set(0, 0.0, -0.15);
            tie.rotation.x = 0.5;
            head.add(tie);
        }
        if (headgear === "cap") {
            const c = mesh(G.cap, helmetMat, "head");
            c.position.set(0, 0.06, -0.005);
            const brim = mesh(G.brim, helmetMat, "head");
            brim.position.set(0, 0.075, 0.12);
            brim.rotation.x = -0.12;
            head.add(c, brim);
        }
    }

    const eyes = look.eyes || (headgear === "helmet" ? "goggles" : "none");
    if (eyes === "goggles") {
        const goggles = mesh(G.goggles, M.strap, "head");
        goggles.position.set(0, 0.075, 0.115);
        goggles.rotation.x = -0.35;
        head.add(goggles);
        for (const sx of [-0.04, 0.04]) {
            const lens = mesh(G.goggleLens, M.goggleLens, "head");
            lens.position.set(sx, 0.075, 0.142);
            lens.rotation.x = -0.35;
            head.add(lens);
        }
    } else if (eyes === "shades") {
        for (const sx of [-0.038, 0.038]) {
            const lens = mesh(G.shade, M.goggleLens, "head");
            lens.position.set(sx, 0.02, 0.1);
            head.add(lens);
        }
        const bridge = mesh(G.shadeBar, M.gloves, "head");
        bridge.position.set(0, 0.03, 0.105);
        head.add(bridge);
    }
    if (look.mask) {
        const m = mesh(G.mask, M.gloves, "head");
        m.position.set(0, -0.055, 0.045);
        head.add(m);
    }
    torso.add(neck, head);

    // Arms (segments placed by IK every frame, in torso space).
    const arms = [-1, 1].map(side => {
        const upper = mesh(G.upperArm, outfit, "body");
        const fore = mesh(G.foreArm, outfit, "body");
        const hand = mesh(G.hand, M.gloves, "body");
        const band = side === -1 ? mesh(G.armband, teamMat, "body") : null;
        if (band) upper.add(band);
        torso.add(upper, fore, hand);
        return { side, upper, fore, hand, shoulder: new THREE.Vector3(side * (female ? 0.19 : 0.215), 0.47, 0) };
    });

    // Parachute and name.
    const chute = makeParachute(rand);
    root.add(chute);

    const label = makeLabel(name || `#${playerId}`);
    label.position.y = 2.4;
    root.add(label);

    if (look.scale) root.scale.setScalar(look.scale);
    scene.add(root);

    const rig = {
        root, body, hips, torso, head, legs, arms, chute, label,
        outfit, teamMat,
        name,
        weapon: null,
        weaponId: null,
        shown: null,
        yaw: 0,
        walk: 0,
        recoil: 0,
        stepPhase: 0,
        onStep: null,
        hits: [],
        setTeamColor(hex) {
            if (this.teamHex === hex) return;
            this.teamHex = hex;
            // Camo keeps its pattern; the team colour tints it lightly.
            const c = new THREE.Color(hex);
            outfit.color.setRGB(0.72 + c.r * 0.38, 0.72 + c.g * 0.38, 0.72 + c.b * 0.38);
            teamMat.color.setHex(hex);
            teamMat.emissive.setHex(hex);
        }
    };
    setWeapon(rig, "vajra");
    return rig;
}

export function setWeapon(rig, weaponId) {
    if (rig.weaponId === weaponId) return;
    if (rig.weapon) rig.torso.remove(rig.weapon);
    rig.weaponId = weaponId;
    rig.weapon = null;
    rig.hits = rig.hits.filter(m => !m.userData.isWeapon);
    if (!weaponId) return;

    const w = buildWeapon(weaponId);
    w.traverse(o => {
        if (o.isMesh) { o.userData.playerId = rig.root.userData.playerId; o.userData.isWeapon = true; }
    });
    rig.torso.add(w);
    rig.weapon = w;
}

export function registerHits(rig, playerId) {
    rig.root.userData.playerId = playerId;
    rig.hits = [];
    rig.root.traverse(obj => {
        if (obj.isMesh && obj.userData.part) rig.hits.push(obj);
    });
}

export function disposeRig(rig, scene) {
    scene.remove(rig.root);
    rig.outfit.dispose();
    rig.teamMat.dispose();
    rig.label.material.map.dispose();
    rig.label.material.dispose();
}

// ---------------- IK ----------------

const _d = new THREE.Vector3(), _bend = new THREE.Vector3(), _e = new THREE.Vector3(), _h = new THREE.Vector3(), _seg = new THREE.Vector3();

function placeSegment(m, from, to) {
    m.position.copy(from);
    _seg.subVectors(to, from).normalize();
    m.quaternion.setFromUnitVectors(UP, _seg);
}

function solveArm(arm, target, pole) {
    const s = arm.shoulder;
    _d.subVectors(target, s);
    const reach = L_UPPER + L_FORE - 0.005;
    const dist = Math.min(reach, Math.max(0.08, _d.length()));
    _d.normalize();
    const cosA = (L_UPPER * L_UPPER + dist * dist - L_FORE * L_FORE) / (2 * L_UPPER * dist);
    const a = Math.acos(Math.max(-1, Math.min(1, cosA)));
    _bend.copy(pole).addScaledVector(_d, -pole.dot(_d)).normalize();
    _e.copy(s).addScaledVector(_d, Math.cos(a) * L_UPPER).addScaledVector(_bend, Math.sin(a) * L_UPPER);
    _h.copy(s).addScaledVector(_d, dist);
    placeSegment(arm.upper, s, _e);
    placeSegment(arm.fore, _e, _h);
    arm.hand.position.copy(_h);
    arm.hand.quaternion.copy(arm.fore.quaternion);
}

// ---------------- animation ----------------

const POLE_R = new THREE.Vector3(0.7, -1, -0.4).normalize();
const POLE_L = new THREE.Vector3(-0.8, -1, -0.1).normalize();
const _t = new THREE.Vector3(), _t2 = new THREE.Vector3();
const lerp = THREE.MathUtils.lerp;

// opts: snappy, faceYaw, knocked, dead, airborne, parachute,
//       skydive, hideLabel, pitch, armed
export function animateRig(rig, target, dt, opts) {
    if (!rig.shown) rig.shown = new THREE.Vector3(target.x, target.y, target.z);

    const bx = rig.shown.x, bz = rig.shown.z;
    const k = 1 - Math.exp(-dt * (opts.snappy ? 20 : 12));
    rig.shown.x += (target.x - rig.shown.x) * k;
    rig.shown.y += (target.y - rig.shown.y) * k;
    rig.shown.z += (target.z - rig.shown.z) * k;
    rig.root.position.copy(rig.shown);

    const moved = Math.hypot(rig.shown.x - bx, rig.shown.z - bz);
    const speed = dt > 0 ? moved / dt : 0;

    if (opts.faceYaw !== undefined) rig.yaw = opts.faceYaw;
    else if (moved > 0.002) rig.yaw = Math.atan2(rig.shown.x - bx, rig.shown.z - bz);
    // Smooth turning.
    let dy = rig.yaw - rig.root.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    rig.root.rotation.y += dy * Math.min(1, dt * 14);

    const lying = opts.knocked || opts.dead;
    const grounded = !opts.airborne && !lying;
    const walking = speed > 0.4 && grounded;
    const run = Math.min(1, speed / 6);

    // ----- legs -----
    const prevPhase = rig.walk;
    rig.walk += walking ? dt * Math.min(11, 3 + speed * 1.1) : 0;
    const ph = rig.walk;
    const amp = walking ? 0.35 + run * 0.35 : 0;
    const settle = 1 - Math.exp(-dt * 10);
    for (let i = 0; i < 2; i++) {
        const p = ph + i * Math.PI;
        let hipX = -Math.sin(p) * amp;
        let kneeX = walking ? Math.max(0, Math.sin(p - 1.2)) * (0.5 + run * 0.7) + 0.08 : 0.04;
        if (opts.skydive) { hipX = 0.25 + i * 0.1; kneeX = 0.7 + i * 0.2; }
        else if (opts.airborne) { hipX = -0.15 + Math.sin(performance.now() / 600 + i) * 0.08; kneeX = 0.25; }
        else if (opts.knocked) { hipX = -0.1 - Math.sin(performance.now() / 400 + i * Math.PI) * 0.15; kneeX = 0.6; }
        rig.legs[i].hip.rotation.x = lerp(rig.legs[i].hip.rotation.x, hipX, walking ? 1 : settle);
        rig.legs[i].knee.rotation.x = lerp(rig.legs[i].knee.rotation.x, kneeX, walking ? 1 : settle);
    }
    // Footstep callback (dust puffs).
    if (walking && rig.onStep && Math.floor(prevPhase / Math.PI) !== Math.floor(ph / Math.PI)) rig.onStep(rig, run);

    // ----- hips / torso -----
    const bob = walking ? Math.abs(Math.sin(ph)) * 0.04 * (0.5 + run) : 0;
    const breathe = Math.sin(performance.now() / 900) * 0.006;
    rig.hips.position.y = 0.95 - bob + breathe - (walking ? run * 0.04 : 0);
    rig.hips.rotation.y = walking ? Math.sin(ph) * 0.08 : 0;
    const pitch = opts.pitch ?? 0;
    const lean = walking ? run * 0.12 : 0;
    rig.torso.rotation.x = lerp(rig.torso.rotation.x, grounded ? lean - pitch * 0.35 : 0, settle);
    const armedPose = opts.armed !== false && rig.weapon && grounded;
    const twist = armedPose ? 0.3 : 0;   // bladed stance: left shoulder forward
    rig.torso.rotation.y = twist + (walking ? -Math.sin(ph) * 0.06 : 0);
    rig.head.rotation.x = (grounded ? -pitch * 0.4 : (opts.skydive ? -0.9 : 0)) + (opts.lookPitch || 0);
    rig.head.rotation.y = opts.lookYaw || 0;
    // Idle weight shift (lobby).
    if (opts.idleShift) rig.hips.rotation.z = Math.sin(performance.now() / 2600 + opts.idleShift) * 0.035;

    // ----- whole body -----
    let bodyX = 0, bodyY = 0;
    if (lying) { bodyX = -Math.PI / 2; bodyY = 0.18; }
    else if (opts.skydive) { bodyX = Math.PI / 2 * 0.85; bodyY = 1.0; }
    rig.body.rotation.x = lerp(rig.body.rotation.x, bodyX, k);
    rig.body.position.y = lerp(rig.body.position.y, bodyY, k);

    // ----- weapon + arms -----
    rig.recoil = Math.max(0, rig.recoil - dt * 9);
    const armed = armedPose;
    if (rig.weapon) {
        rig.weapon.visible = !opts.dead;
        if (armed) {
            // Shouldered: grip in front of the right chest.
            // Positions are chosen in body space, then undone by the twist.
            const sway = walking ? Math.sin(ph * 2) * 0.012 : 0;
            const pistolGrip = rig.weapon.userData.category === "pistol";
            _t.set(pistolGrip ? 0.02 : 0.14, (pistolGrip ? 0.36 : 0.33) + sway - rig.recoil * 0.01,
                (pistolGrip ? 0.5 : 0.42) - rig.recoil * 0.06).applyAxisAngle(UP, -twist);
            rig.weapon.rotation.order = "YXZ";
            rig.weapon.position.copy(_t);
            rig.weapon.rotation.set(-pitch * 0.65 - rig.recoil * 0.12 + (opts.lowReady || 0), -twist, 0);
            if (opts.lowReady) rig.weapon.position.y -= opts.lowReady * 0.12;
            // Weapon inspection (lobby): lift the gun and turn it to look at it.
            const ins = opts.inspect || 0;
            if (ins > 0) {
                _t2.set(0.04, 0.27, 0.36).applyAxisAngle(UP, -twist);
                rig.weapon.position.lerp(_t2, ins);
                rig.weapon.rotation.set(
                    lerp(rig.weapon.rotation.x, 0.25, ins),
                    lerp(-twist, -twist - 0.85, ins),
                    lerp(0, 1.05, ins));
            }
        } else {
            // Slung across the back.
            rig.weapon.rotation.order = "YXZ";
            rig.weapon.position.set(0.02, 0.33, -0.33);
            rig.weapon.rotation.set(0, 0, -Math.PI / 2 + 0.6);
        }
    }

    const [left, right] = rig.arms;
    if (armed) {
        rig.weapon.updateMatrix();
        _t.set(0, -0.03, 0).applyMatrix4(rig.weapon.matrix);                    // grip
        solveArm(right, _t, POLE_R);
        const sup = rig.weapon.userData.support;
        if (sup) {
            _t2.copy(sup).applyMatrix4(rig.weapon.matrix);
            solveArm(left, _t2, POLE_L);
        } else {
            _t2.copy(_t).add(new THREE.Vector3(-0.03, -0.01, 0.0));            // pistol: two-hand grip
            solveArm(left, _t2, POLE_L);
        }
    } else if (opts.skydive) {
        solveArm(left, _t.set(-0.62, 0.62, 0.1), POLE_L);
        solveArm(right, _t2.set(0.62, 0.62, 0.1), POLE_R);
    } else if (opts.airborne) {
        // Hands up on the steering toggles.
        const pull = Math.sin(performance.now() / 700) * 0.04;
        solveArm(left, _t.set(-0.26, 1.0 + pull, 0.05), POLE_L);
        solveArm(right, _t2.set(0.26, 1.0 - pull, 0.05), POLE_R);
    } else {
        // Relaxed arms swinging.
        const sw = walking ? Math.sin(ph) * 0.18 * (0.5 + run) : 0;
        solveArm(left, _t.set(-0.25, 0.0, 0.06 + sw), POLE_L.clone().set(-0.3, 0, -1));
        solveArm(right, _t2.set(0.25, 0.0, 0.06 - sw), POLE_R.clone().set(0.3, 0, -1));
    }

    // ----- parachute -----
    rig.chute.visible = Boolean(opts.parachute);
    if (rig.chute.visible) {
        const t = performance.now() / 1000;
        rig.chute.rotation.z = Math.sin(t * 0.7) * 0.06;
        rig.chute.rotation.x = Math.sin(t * 0.5) * 0.04 - 0.08;
    }

    rig.label.visible = !opts.hideLabel;
}
