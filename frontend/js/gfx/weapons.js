// ==========================================
// Weapon and loot models (built from primitives, real sizes)
// ==========================================
// Weapon space: +Z is forward, origin at the pistol grip.
// userData.muzzle  - Object3D at the barrel tip
// userData.support - where the left hand holds it (local point)

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const MAT = {
    metal: new THREE.MeshStandardMaterial({ color: 0x2b2d30, metalness: 0.85, roughness: 0.36 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x18191b, metalness: 0.7, roughness: 0.45 }),
    polymer: new THREE.MeshStandardMaterial({ color: 0x1d1e20, metalness: 0.05, roughness: 0.62 }),
    tan: new THREE.MeshStandardMaterial({ color: 0x8b7757, metalness: 0.05, roughness: 0.7 }),
    olive: new THREE.MeshStandardMaterial({ color: 0x4f5638, metalness: 0.1, roughness: 0.65 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x6a3f22, metalness: 0, roughness: 0.48 }),
    lens: new THREE.MeshStandardMaterial({ color: 0x1b3a6b, metalness: 1, roughness: 0.04, emissive: 0x071226 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xc9a046, metalness: 1, roughness: 0.3 }),
    red: new THREE.MeshStandardMaterial({ color: 0xb3221e, roughness: 0.5 }),
    white: new THREE.MeshStandardMaterial({ color: 0xe9e7e1, roughness: 0.55 }),
    cloth: new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.95 })
};
export const WEAPON_MATERIALS = MAT;

// ---------------- helpers ----------------

function rbox(w, h, d, mat, x = 0, y = 0, z = 0, r = 0.006) {
    const radius = Math.min(r, w / 2.2, h / 2.2, d / 2.2);
    const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, radius), mat);
    m.position.set(x, y, z);
    return m;
}

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return m;
}

// Cylinder along Z.
function tube(r, len, mat, x = 0, y = 0, z = 0, seg = 14, r2 = r) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r, len, seg), mat);
    m.rotation.x = Math.PI / 2;
    m.position.set(x, y, z);
    return m;
}

function finish(group, muzzleZ, muzzleY, support) {
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, muzzleY, muzzleZ);
    group.add(muzzle);
    group.userData.muzzle = muzzle;
    group.userData.support = support;
    group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return group;
}

function scope(len, r, y, z, mat = MAT.metal) {
    const g = new THREE.Group();
    g.add(tube(r, len, mat, 0, y, z));
    g.add(tube(r * 1.35, len * 0.22, mat, 0, y, z + len * 0.45, 16, r * 1.1));   // objective bell
    g.add(tube(r * 1.15, len * 0.18, mat, 0, y, z - len * 0.45));                // eyepiece
    const lens = tube(r * 1.2, 0.004, MAT.lens, 0, y, z + len * 0.56);
    g.add(lens);
    g.add(box(0.02, 0.03, 0.02, mat, 0, y - r - 0.012, z - len * 0.2));          // rings
    g.add(box(0.02, 0.03, 0.02, mat, 0, y - r - 0.012, z + len * 0.2));
    g.add(tube(0.008, 0.03, mat, 0, y + r + 0.012, z).rotateX(Math.PI / 2));     // turret
    return g;
}

// ---------------- weapons ----------------

function assaultRifle(variant) {
    const g = new THREE.Group();
    const body = variant === "trishul" ? MAT.wood : variant === "garuda" ? MAT.tan : MAT.polymer;
    g.add(rbox(0.058, 0.085, 0.42, MAT.metal, 0, 0.035, 0.07));                 // receiver
    g.add(box(0.036, 0.014, 0.4, MAT.darkMetal, 0, 0.083, 0.09));               // top rail
    g.add(rbox(0.066, 0.072, 0.3, body, 0, 0.032, 0.42, 0.01));                 // handguard
    for (let i = 0; i < 4; i++) g.add(box(0.068, 0.012, 0.035, MAT.darkMetal, 0, 0.032, 0.32 + i * 0.065));
    g.add(tube(0.011, 0.26, MAT.darkMetal, 0, 0.04, 0.69));                     // barrel
    g.add(tube(0.017, 0.07, MAT.metal, 0, 0.04, 0.84, 8));                      // muzzle brake
    g.add(box(0.008, 0.055, 0.012, MAT.darkMetal, 0, 0.09, 0.55));              // front sight
    const grip = rbox(0.034, 0.11, 0.046, body, 0, -0.045, -0.005, 0.01);
    grip.rotation.x = 0.32;
    g.add(grip);
    g.add(box(0.008, 0.012, 0.07, MAT.metal, 0, -0.022, 0.05));                 // trigger guard
    // Curved magazine (two angled pieces).
    const mag1 = rbox(0.03, 0.1, 0.075, MAT.darkMetal, 0, -0.04, 0.15);
    mag1.rotation.x = -0.12;
    const mag2 = rbox(0.03, 0.09, 0.07, MAT.darkMetal, 0, -0.12, 0.175);
    mag2.rotation.x = -0.35;
    g.add(mag1, mag2);
    // Stock.
    g.add(tube(0.016, 0.16, MAT.metal, 0, 0.04, -0.2));
    const stock = rbox(0.048, 0.11, 0.2, body, 0, 0.01, -0.3, 0.012);
    g.add(stock);
    g.add(rbox(0.05, 0.13, 0.02, MAT.polymer, 0, 0.0, -0.405));                 // butt pad
    // Optic.
    if (variant === "garuda") g.add(scope(0.16, 0.017, 0.12, 0.08));
    else {
        g.add(rbox(0.04, 0.045, 0.06, MAT.darkMetal, 0, 0.11, 0.07, 0.008));    // red-dot housing
        g.add(tube(0.016, 0.004, MAT.lens, 0, 0.115, 0.1));
    }
    return finish(g, 0.88, 0.04, new THREE.Vector3(0, 0.0, 0.27));
}

function smg(variant) {
    const g = new THREE.Group();
    const body = variant === "nagini" ? MAT.olive : MAT.polymer;
    g.add(rbox(0.054, 0.08, 0.3, body, 0, 0.03, 0.08, 0.01));
    g.add(box(0.032, 0.012, 0.26, MAT.darkMetal, 0, 0.075, 0.08));
    g.add(tube(0.02, 0.12, MAT.darkMetal, 0, 0.035, 0.3));                      // shroud
    g.add(tube(0.01, 0.06, MAT.metal, 0, 0.035, 0.38));
    const grip = rbox(0.032, 0.1, 0.042, MAT.polymer, 0, -0.045, 0, 0.01);
    grip.rotation.x = 0.25;
    g.add(grip);
    g.add(rbox(0.026, 0.17, 0.04, MAT.darkMetal, 0, -0.08, 0.14));              // straight mag
    g.add(rbox(0.03, 0.06, 0.05, MAT.polymer, 0, -0.03, 0.26, 0.01));           // fore grip
    // Folding wire stock.
    g.add(box(0.006, 0.006, 0.22, MAT.metal, 0.02, 0.05, -0.15));
    g.add(box(0.006, 0.006, 0.22, MAT.metal, -0.02, 0.05, -0.15));
    g.add(box(0.05, 0.09, 0.012, MAT.metal, 0, 0.02, -0.26));
    g.add(rbox(0.034, 0.035, 0.05, MAT.darkMetal, 0, 0.1, 0.06, 0.006));
    return finish(g, 0.41, 0.035, new THREE.Vector3(0, -0.02, 0.22));
}

function sniper() {
    const g = new THREE.Group();
    g.add(rbox(0.06, 0.08, 0.3, MAT.metal, 0, 0.035, 0.08));
    g.add(rbox(0.07, 0.07, 0.38, MAT.olive, 0, 0.025, 0.42, 0.012));            // chassis fore-end
    g.add(tube(0.013, 0.62, MAT.darkMetal, 0, 0.04, 0.8, 14, 0.011));           // long barrel
    g.add(tube(0.02, 0.09, MAT.metal, 0, 0.04, 1.14, 8));                       // brake
    g.add(scope(0.36, 0.021, 0.125, 0.1, MAT.darkMetal));
    g.add(tube(0.006, 0.05, MAT.metal, 0.04, 0.05, 0.0).rotateZ(0.6));          // bolt
    const grip = rbox(0.034, 0.11, 0.046, MAT.olive, 0, -0.05, -0.02, 0.01);
    grip.rotation.x = 0.35;
    g.add(grip);
    g.add(rbox(0.04, 0.08, 0.1, MAT.darkMetal, 0, -0.03, 0.14));                // box mag
    g.add(rbox(0.055, 0.13, 0.32, MAT.olive, 0, 0.0, -0.27, 0.015));            // stock
    g.add(rbox(0.05, 0.035, 0.14, MAT.olive, 0, 0.08, -0.22, 0.01));            // cheek rest
    // Folded bipod.
    g.add(box(0.008, 0.008, 0.2, MAT.metal, 0.02, -0.02, 0.56));
    g.add(box(0.008, 0.008, 0.2, MAT.metal, -0.02, -0.02, 0.56));
    return finish(g, 1.19, 0.04, new THREE.Vector3(0, -0.01, 0.27));
}

function dmr() {
    const g = new THREE.Group();
    g.add(rbox(0.058, 0.085, 0.4, MAT.metal, 0, 0.035, 0.07));
    g.add(rbox(0.066, 0.07, 0.36, MAT.tan, 0, 0.03, 0.45, 0.01));
    g.add(tube(0.012, 0.36, MAT.darkMetal, 0, 0.04, 0.78));
    g.add(tube(0.02, 0.1, MAT.darkMetal, 0, 0.04, 0.99, 10));                   // suppressor-like brake
    g.add(scope(0.26, 0.018, 0.12, 0.08));
    const grip = rbox(0.034, 0.11, 0.046, MAT.tan, 0, -0.045, -0.005, 0.01);
    grip.rotation.x = 0.32;
    g.add(grip);
    g.add(rbox(0.032, 0.1, 0.08, MAT.darkMetal, 0, -0.06, 0.15));
    g.add(rbox(0.05, 0.11, 0.24, MAT.tan, 0, 0.01, -0.3, 0.012));
    return finish(g, 1.04, 0.04, new THREE.Vector3(0, 0.0, 0.28));
}

function shotgun() {
    const g = new THREE.Group();
    g.add(rbox(0.056, 0.085, 0.3, MAT.metal, 0, 0.03, 0.06));
    g.add(tube(0.014, 0.55, MAT.darkMetal, 0, 0.05, 0.48));                     // barrel
    g.add(tube(0.013, 0.46, MAT.darkMetal, 0, 0.015, 0.43));                    // tube magazine
    g.add(rbox(0.06, 0.06, 0.18, MAT.wood, 0, 0.018, 0.45, 0.012));             // pump
    for (let i = 0; i < 5; i++) g.add(box(0.062, 0.004, 0.006, MAT.darkMetal, 0, 0.018, 0.38 + i * 0.035));
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.006, 6, 6), MAT.brass).translateZ(0.75).translateY(0.068)); // bead sight
    const stock = rbox(0.05, 0.12, 0.34, MAT.wood, 0, -0.01, -0.24, 0.015);
    stock.rotation.x = 0.08;
    g.add(stock);
    g.add(box(0.008, 0.012, 0.06, MAT.metal, 0, -0.02, 0.03));
    return finish(g, 0.76, 0.05, new THREE.Vector3(0, -0.01, 0.38));
}

function pistol() {
    const g = new THREE.Group();
    g.add(rbox(0.03, 0.035, 0.19, MAT.darkMetal, 0, 0.045, 0.06, 0.005));       // slide
    for (let i = 0; i < 6; i++) g.add(box(0.032, 0.025, 0.003, MAT.metal, 0, 0.045, -0.02 + i * 0.008));
    g.add(rbox(0.028, 0.03, 0.15, MAT.polymer, 0, 0.018, 0.05));                // frame
    const grip = rbox(0.03, 0.11, 0.045, MAT.polymer, 0, -0.04, -0.01, 0.008);
    grip.rotation.x = 0.22;
    g.add(grip);
    g.add(box(0.006, 0.012, 0.045, MAT.polymer, 0, -0.005, 0.04));
    g.add(tube(0.006, 0.01, MAT.metal, 0, 0.045, 0.157));
    return finish(g, 0.16, 0.045, null);
}

const CATEGORY_OF = {
    vajra: "ar", trishul: "ar", garuda: "ar",
    agni: "smg", nagini: "smg",
    brahmastra: "sniper", drishti: "dmr",
    vajram: "shotgun", surya: "pistol"
};

export function weaponCategory(id = "", name = "") {
    if (CATEGORY_OF[id]) return CATEGORY_OF[id];
    const n = `${id} ${name}`.toLowerCase();
    if (n.includes("sniper")) return "sniper";
    if (n.includes("dmr")) return "dmr";
    if (n.includes("smg")) return "smg";
    if (n.includes("shotgun")) return "shotgun";
    if (n.includes("pistol")) return "pistol";
    return "ar";
}

// Cached prototypes; callers get clones (shared geometry/materials).
const protos = new Map();
export function buildWeapon(id = "vajra", name = "") {
    const key = CATEGORY_OF[id] ? id : weaponCategory(id, name);
    if (!protos.has(key)) {
        const cat = weaponCategory(id, name);
        const make = { ar: () => assaultRifle(id), smg: () => smg(id), sniper, dmr, shotgun, pistol }[cat];
        protos.set(key, make());
    }
    const proto = protos.get(key);
    const copy = proto.clone(true);
    copy.userData = {
        muzzle: copy.children[proto.children.indexOf(proto.userData.muzzle)],
        support: proto.userData.support,
        category: weaponCategory(id, name)
    };
    return copy;
}

// ---------------- loot models ----------------

const RARITY = {
    common: 0xd8d8d8, uncommon: 0x55d16a, rare: 0x3d9bff, epic: 0xb466ff, legendary: 0xffa82e
};
export const rarityColor = r => RARITY[r] ?? RARITY.common;

function helmet(level = 1) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: [0x5a6044, 0x4a5240, 0x2e3133][Math.min(2, (level || 1) - 1)], roughness: 0.6, metalness: 0.15 });
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.15, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    shell.scale.set(1, 0.95, 1.12);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.012, 6, 28), mat);
    rim.rotation.x = Math.PI / 2;
    rim.scale.set(1, 1.12, 1);
    g.add(shell, rim);
    if (level >= 2) g.add(rbox(0.12, 0.03, 0.04, MAT.darkMetal, 0, 0.08, 0.15));      // NVG mount
    if (level >= 3) g.add(box(0.31, 0.02, 0.2, MAT.olive, 0, 0.02, 0));                // rails
    return g;
}

function vest(level = 1) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: [0x6f6a4e, 0x4d5638, 0x2f3330][Math.min(2, (level || 1) - 1)], roughness: 0.85 });
    g.add(rbox(0.36, 0.42, 0.08, mat, 0, 0, 0.06, 0.03));
    g.add(rbox(0.36, 0.42, 0.06, mat, 0, 0, -0.07, 0.03));
    for (let i = 0; i < 3; i++) g.add(rbox(0.09, 0.12, 0.05, mat, -0.11 + i * 0.11, -0.1, 0.12, 0.012));
    g.add(box(0.06, 0.1, 0.16, mat, 0.15, 0.17, 0));
    g.add(box(0.06, 0.1, 0.16, mat, -0.15, 0.17, 0));
    return g;
}

function ammoCan() {
    const g = new THREE.Group();
    g.add(rbox(0.3, 0.19, 0.14, MAT.olive, 0, 0.095, 0, 0.01));
    g.add(box(0.31, 0.02, 0.15, MAT.olive, 0, 0.19, 0));
    g.add(box(0.12, 0.012, 0.02, MAT.darkMetal, 0, 0.215, 0));
    g.add(box(0.12, 0.04, 0.001, new THREE.MeshStandardMaterial({ color: 0xd8c35a }), 0, 0.1, 0.071));
    return g;
}

function grenade(type) {
    const g = new THREE.Group();
    if (type === "frag" || !type) {
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), MAT.olive);
        body.scale.y = 1.2;
        g.add(body);
        g.add(tube(0.018, 0.03, MAT.metal, 0, 0.07, 0).rotateX(Math.PI / 2));
        g.add(box(0.012, 0.09, 0.012, MAT.metal, 0.03, 0.03, 0).rotateZ(-0.25));
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.003, 6, 14), MAT.metal);
        ring.position.set(-0.03, 0.08, 0);
        g.add(ring);
    } else {
        const can = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.14, 16), type === "smoke" ? MAT.olive : MAT.darkMetal);
        g.add(can);
        g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.041, 0.041, 0.02, 16), type === "smoke" ? MAT.white : MAT.metal).translateY(0.04));
        g.add(box(0.012, 0.1, 0.012, MAT.metal, 0.042, 0.02, 0));
    }
    return g;
}

function medkit(id = "") {
    const g = new THREE.Group();
    if (id.includes("bandage")) {
        g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 18), MAT.cloth).rotateZ(Math.PI / 2));
        return g;
    }
    if (id.includes("energy") || id.includes("drink") || id.includes("boost")) {
        g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.16, 18), new THREE.MeshStandardMaterial({ color: 0x2c86d6, metalness: 0.8, roughness: 0.3 })).translateY(0.08));
        return g;
    }
    g.add(rbox(0.3, 0.12, 0.2, id.includes("first") ? MAT.red : MAT.white, 0, 0.06, 0, 0.02));
    const crossMat = id.includes("first") ? MAT.white : MAT.red;
    g.add(box(0.1, 0.002, 0.03, crossMat, 0, 0.121, 0));
    g.add(box(0.03, 0.002, 0.1, crossMat, 0, 0.121, 0));
    g.add(box(0.1, 0.02, 0.02, MAT.polymer, 0, 0.13, -0.06));
    return g;
}

function attachment(id = "") {
    if (id.includes("scope") || id.includes("dot")) return scope(id.includes("dot") ? 0.08 : 0.2, 0.02, 0.03, 0);
    const g = new THREE.Group();
    if (id.includes("mag")) g.add(rbox(0.03, 0.2, 0.07, MAT.darkMetal, 0, 0.1, 0));
    else if (id.includes("grip")) g.add(rbox(0.03, 0.1, 0.035, MAT.polymer, 0, 0.05, 0));
    else if (id.includes("suppressor")) g.add(tube(0.02, 0.18, MAT.darkMetal, 0, 0.02, 0));
    else g.add(tube(0.018, 0.07, MAT.metal, 0, 0.02, 0, 8));
    return g;
}

// Ground glow under loot, coloured by rarity.
let glowTex = null;
function lootGlow(color) {
    if (!glowTex) {
        const c = document.createElement("canvas");
        c.width = c.height = 64;
        const g = c.getContext("2d");
        const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        grd.addColorStop(0, "rgba(255,255,255,.9)");
        grd.addColorStop(0.5, "rgba(255,255,255,.35)");
        grd.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = grd;
        g.fillRect(0, 0, 64, 64);
        glowTex = new THREE.CanvasTexture(c);
    }
    const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1.4, 1.4),
        new THREE.MeshBasicMaterial({ map: glowTex, color, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.02;
    return m;
}

let beamTex = null;
function lootBeam(color) {
    if (!beamTex) {
        const c = document.createElement("canvas");
        c.width = 4; c.height = 64;
        const g = c.getContext("2d");
        const grd = g.createLinearGradient(0, 64, 0, 0);
        grd.addColorStop(0, "rgba(255,255,255,.8)");
        grd.addColorStop(0.3, "rgba(255,255,255,.25)");
        grd.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = grd;
        g.fillRect(0, 0, 4, 64);
        beamTex = new THREE.CanvasTexture(c);
    }
    const m = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.18, 6, 12, 1, true),
        new THREE.MeshBasicMaterial({ color, map: beamTex, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
    );
    m.position.y = 3;
    return m;
}

// Returns { group, spin } where spin is the part that slowly turns.
export function buildLoot(item) {
    const group = new THREE.Group();
    const spin = new THREE.Group();
    const id = String(item.itemId || "");
    let model;

    switch (item.itemType) {
        case "weapon":
            model = buildWeapon(id, item.name);
            model.rotation.z = Math.PI / 2;      // lying on its side
            model.position.y = 0.06;
            break;
        case "ammunition": model = ammoCan(); break;
        case "helmet": model = helmet(item.level); break;
        case "vest": model = vest(item.level); model.position.y = 0.21; break;
        case "throwable": model = grenade(id); model.position.y = 0.07; break;
        case "healing": model = medkit(id); break;
        case "attachment": model = attachment(id); model.position.y = 0.05; break;
        default: model = rbox(0.3, 0.3, 0.3, MAT.olive, 0, 0.15, 0);
    }
    model.traverse(o => { if (o.isMesh) o.castShadow = true; });
    // Slightly larger than life so loot reads from a distance.
    spin.scale.setScalar(1.6);
    spin.add(model);
    group.add(spin);

    const color = rarityColor(item.rarity);
    group.add(lootGlow(color));
    if (item.rarity === "epic" || item.rarity === "legendary") group.add(lootBeam(color));

    return { group, spin };
}

// Small brass casing for ejected shells.
export const CASING = { geometry: new THREE.CylinderGeometry(0.005, 0.005, 0.03, 6), material: MAT.brass };

// Thrown grenade in flight / on the ground.
export function buildThrowable(type) {
    const g = grenade(type);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    g.scale.setScalar(1.5);
    return g;
}
