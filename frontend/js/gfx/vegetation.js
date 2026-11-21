// ==========================================
// Trees, bushes, rocks and grass
// ==========================================
// Decor is visual only (the server has no collision for it),
// seeded so every player sees the same forest. It is split
// into chunks so off-screen chunks are culled (also from the
// shadow pass).

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { seeded, hash2, noise3, fbm } from "./noise.js";
import * as T from "./textures.js";
import { worldMapped, windSway } from "./materials.js";
import { QUALITY } from "./environment.js";

// ---------------- geometry helpers ----------------

function colored(geom, fn) {
    const g = geom.index ? geom.toNonIndexed() : geom;
    const p = g.attributes.position, n = g.attributes.normal;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
        const c = fn(p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i));
        col.set(c, i * 3);
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(p.count * 2), 2));
    return g;
}

function displace(geom, amount, scale, seed) {
    const p = geom.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        const n = noise3(v.x * scale + 11, v.y * scale, v.z * scale - 5, seed) - 0.5;
        v.multiplyScalar(1 + n * amount);
        p.setXYZ(i, v.x, v.y, v.z);
    }
    geom.computeVertexNormals();
    return geom;
}

// A flat card (leaf cluster / needle branch) with normals bent
// outward from `center`, which makes a canopy shade like a volume.
function card(w, h, matrix, center, shade) {
    const g = new THREE.PlaneGeometry(w, h).toNonIndexed();
    g.applyMatrix4(matrix);
    const p = g.attributes.position, n = g.attributes.normal;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).sub(center).normalize();
        v.y += 0.35;
        v.normalize();
        n.setXYZ(i, v.x, v.y, v.z);
    }
    return colored(g, () => shade);
}

function leafTexture(kind) {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d");
    const rand = seeded(kind === "pine" ? 31 : 17);

    if (kind === "pine") {
        // A drooping branch covered in needles, twig along the middle.
        g.lineCap = "round";
        for (let k = 0; k < 2; k++) {
            const y0 = 128 + (k ? 40 : -10);
            g.strokeStyle = "#4a3624";
            g.lineWidth = 4;
            g.beginPath(); g.moveTo(4, y0); g.quadraticCurveTo(128, y0 - 14, 252, y0 + 18); g.stroke();
            for (let i = 0; i < 260; i++) {
                const t = rand();
                const x = 4 + t * 248;
                const y = y0 - 14 * Math.sin(t * Math.PI) + t * 18;
                const len = 18 + rand() * 26 * (1 - t * 0.5);
                const ang = (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 0.7) + 0.3;
                const s = 0.6 + rand() * 0.4;
                g.strokeStyle = `rgb(${30 * s | 0},${(70 + rand() * 40) * s | 0},${35 * s | 0})`;
                g.lineWidth = 1.6;
                g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(ang) * len * 0.5, y + Math.sin(ang) * len); g.stroke();
            }
        }
    } else {
        // Overlapping leaves on a few twigs.
        g.strokeStyle = "#4b3a26";
        g.lineWidth = 3;
        for (let k = 0; k < 4; k++) {
            g.beginPath(); g.moveTo(128, 250); g.lineTo(30 + rand() * 196, 20 + rand() * 120); g.stroke();
        }
        for (let i = 0; i < 230; i++) {
            const a = rand() * Math.PI * 2;
            const r = Math.sqrt(rand()) * 110;
            const x = 128 + Math.cos(a) * r, y = 120 + Math.sin(a) * r * 0.95;
            const s = 0.55 + rand() * 0.45;
            const hue = rand();
            g.save();
            g.translate(x, y);
            g.rotate(rand() * Math.PI * 2);
            g.fillStyle = `rgb(${(50 + hue * 40) * s | 0},${(105 + hue * 50) * s | 0},${(30 + hue * 15) * s | 0})`;
            g.beginPath(); g.ellipse(0, 0, 13 + rand() * 6, 6 + rand() * 3, 0, 0, Math.PI * 2); g.fill();
            g.strokeStyle = `rgba(20,40,10,.35)`;
            g.lineWidth = 1;
            g.beginPath(); g.moveTo(-12, 0); g.lineTo(12, 0); g.stroke();
            g.restore();
        }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
}

// ---------------- species ----------------
// Each species returns { wood, leaves } geometries (leaves = cards).

function pineGeometry(seed) {
    const rand = seeded(seed);
    const H = 11 + rand() * 4;
    const wood = [];
    const leaves = [];
    const trunkC = [0.24, 0.17, 0.11];

    wood.push(colored(new THREE.CylinderGeometry(0.12, 0.34, H, 7).translate(0, H / 2, 0), (x, y) => {
        const k = 0.7 + y / H * 0.4; return [trunkC[0] * k, trunkC[1] * k, trunkC[2] * k];
    }));

    const tiers = 8;
    const center = new THREE.Vector3(0, H * 0.5, 0);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = 0; i < tiers; i++) {
        const t = i / tiers;
        const y = 2.6 + t * (H - 3.2);
        const r = 3.0 * (1 - t) + 0.5;
        // Dark inner cone gives the canopy body.
        wood.push(colored(
            displace(new THREE.ConeGeometry(r * 0.72, 2.6, 9, 2, true).translate(0, y + 0.6, 0), 0.25, 0.6, seed + i),
            (x, yy, z, nx, ny) => { const k = 0.6 + ny * 0.25 + t * 0.2; return [0.05 * k, 0.12 * k, 0.06 * k]; }
        ));
        // Needle branches radiating out and drooping.
        const n = Math.max(5, Math.round(9 - t * 4));
        for (let k = 0; k < n; k++) {
            const a = (k / n) * Math.PI * 2 + rand() * 0.6 + i;
            const len = r * (0.9 + rand() * 0.3);
            const droop = 0.3 + rand() * 0.3;
            // Card X runs outward (drooping), Y across the branch, Z up.
            const out = new THREE.Vector3(Math.sin(a), -droop, Math.cos(a)).normalize();
            const side = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)).applyAxisAngle(out, (rand() - 0.5) * 0.7);
            const nrm = new THREE.Vector3().crossVectors(out, side).normalize();
            const pos = out.clone().multiplyScalar(len * 0.5).add(new THREE.Vector3(0, y, 0));
            m.makeBasis(out, side, nrm).setPosition(pos);
            const k2 = 0.75 + t * 0.35 + rand() * 0.1;
            leaves.push(card(len * 1.05, 1.5 + r * 0.25, m, center, [k2, k2, k2]));
        }
    }
    return { wood: mergeGeometries(wood), leaves: mergeGeometries(leaves), height: H };
}

function broadleafGeometry(seed, scale = 1) {
    const rand = seeded(seed);
    const wood = [];
    const leaves = [];
    const trunkH = 4.6 * scale;
    const bark = [0.3, 0.24, 0.18];

    wood.push(colored(displace(new THREE.CylinderGeometry(0.2 * scale, 0.38 * scale, trunkH, 8, 4).translate(0, trunkH / 2, 0), 0.12, 2, seed),
        (x, y) => { const k = 0.7 + y / trunkH * 0.4; return [bark[0] * k, bark[1] * k, bark[2] * k]; }));

    // Branches.
    for (let b = 0; b < 4; b++) {
        const a = rand() * Math.PI * 2;
        const len = (2 + rand() * 1.4) * scale;
        const g = new THREE.CylinderGeometry(0.06 * scale, 0.13 * scale, len, 5).translate(0, len / 2, 0);
        g.rotateZ(0.7 + rand() * 0.4);
        g.rotateY(a);
        g.translate(0, trunkH * (0.6 + rand() * 0.3), 0);
        wood.push(colored(g, () => bark));
    }

    const center = new THREE.Vector3(0, trunkH + 1.6 * scale, 0);
    const R = new THREE.Vector3(3.1 * scale, 2.4 * scale, 3.1 * scale);

    // Dark inner mass.
    for (let b = 0; b < 6; b++) {
        const g = displace(new THREE.IcosahedronGeometry((1.3 + rand() * 0.7) * scale, 1), 0.35, 0.9, seed + b);
        g.translate(center.x + (rand() - 0.5) * 2.6 * scale, center.y + (rand() - 0.4) * 1.6 * scale, center.z + (rand() - 0.5) * 2.6 * scale);
        wood.push(colored(g, (x, y, z, nx, ny) => { const k = 0.55 + ny * 0.3; return [0.07 * k, 0.15 * k, 0.05 * k]; }));
    }

    // Leaf cards on an ellipsoid shell.
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    const cards = Math.round(70 * scale);
    for (let i = 0; i < cards; i++) {
        const u = rand() * 2 - 1, a = rand() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        const dir = new THREE.Vector3(s * Math.cos(a), u * 0.9 + 0.1, s * Math.sin(a));
        const pos = center.clone().add(dir.clone().multiply(R).multiplyScalar(0.7 + rand() * 0.35));
        q.setFromEuler(new THREE.Euler(rand() * Math.PI, rand() * Math.PI * 2, rand() * Math.PI));
        m.compose(pos, q, new THREE.Vector3(1, 1, 1));
        const k = 0.65 + Math.max(0, dir.y) * 0.4 + rand() * 0.12;
        leaves.push(card(2.1 * scale, 2.1 * scale, m, center, [k, k, k]));
    }
    return { wood: mergeGeometries(wood), leaves: mergeGeometries(leaves), height: trunkH + 4 * scale };
}

function bushGeometry(seed) {
    const rand = seeded(seed);
    const wood = [], leaves = [];
    const center = new THREE.Vector3(0, 0.75, 0);
    for (let b = 0; b < 3; b++) {
        const g = displace(new THREE.IcosahedronGeometry(0.55 + rand() * 0.25, 1), 0.3, 1.5, seed + b);
        g.translate((rand() - 0.5) * 0.9, 0.55 + rand() * 0.3, (rand() - 0.5) * 0.9);
        wood.push(colored(g, (x, y, z, nx, ny) => { const k = 0.55 + ny * 0.3; return [0.07 * k, 0.14 * k, 0.05 * k]; }));
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (let i = 0; i < 22; i++) {
        const a = rand() * Math.PI * 2, u = rand();
        const pos = new THREE.Vector3(Math.cos(a) * (0.5 + rand() * 0.6), 0.3 + u * 0.9, Math.sin(a) * (0.5 + rand() * 0.6));
        q.setFromEuler(new THREE.Euler(rand() * Math.PI, rand() * Math.PI * 2, rand() * Math.PI));
        m.compose(pos, q, new THREE.Vector3(1, 1, 1));
        const k = 0.7 + u * 0.35;
        leaves.push(card(1.1, 1.1, m, center, [k, k, k]));
    }
    return { wood: mergeGeometries(wood), leaves: mergeGeometries(leaves), height: 1.5 };
}

// Rock fitted to a unit box (-0.5..0.5), so it can stand in for
// the server's box-shaped rocks.
export function rockGeometry(seed) {
    const g = new THREE.IcosahedronGeometry(1, 3);
    const p = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        const n = (noise3(v.x * 1.3, v.y * 1.3, v.z * 1.3, seed) - 0.5) * 0.7 +
            (noise3(v.x * 4, v.y * 4, v.z * 4, seed + 1) - 0.5) * 0.18;
        v.multiplyScalar(1 + n);
        // Chunky facets: snap toward a few planes.
        if (v.y < -0.35) v.y = -0.35 - (v.y + 0.35) * 0.15;
        p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeBoundingBox();
    const b = g.boundingBox, size = new THREE.Vector3(), mid = new THREE.Vector3();
    b.getSize(size); b.getCenter(mid);
    g.translate(-mid.x, -mid.y, -mid.z);
    g.scale(1 / size.x, 1 / size.y, 1 / size.z);
    g.computeVertexNormals();
    return g;
}

let rockMaterialCache = null;
export function rockMaterial() {
    if (rockMaterialCache) return rockMaterialCache;
    const r = T.rock();
    rockMaterialCache = worldMapped(new THREE.MeshStandardMaterial({
        map: r.map, normalMap: r.normalMap, normalScale: new THREE.Vector2(1.2, 1.2),
        color: 0xc8c2b8, roughness: 0.92, envMapIntensity: 0.5
    }), { uvScale: 0.4 });
    return rockMaterialCache;
}

// ---------------- decor (chunked instancing) ----------------

const CHUNK = 750;
const RANGE = 1500;   // decor fills -1500..1500 (map is -1000..1000)

export function createDecor(scene) {
    const woodMat = windSway(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, envMapIntensity: 0.4 }), { height: 14, strength: 0.12, speed: 0.9 });
    const leafMats = {
        pine: windSway(new THREE.MeshStandardMaterial({ map: leafTexture("pine"), vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85, envMapIntensity: 0.4 }), { height: 14, strength: 0.18, speed: 0.9 }),
        broad: windSway(new THREE.MeshStandardMaterial({ map: leafTexture("broad"), vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8, envMapIntensity: 0.4 }), { height: 9, strength: 0.2, speed: 1.1 })
    };
    leafMats.bush = leafMats.broad;

    const species = {
        pine: pineGeometry(101),
        broad: broadleafGeometry(202),
        bush: bushGeometry(303)
    };
    const rockGeo = rockGeometry(404);

    const rand = seeded(20261120);
    const items = { pine: [], broad: [], bush: [], rock: [] };

    // Forest density from large-scale noise: woods and clearings.
    const forest = (x, z) => fbm((x + 4000) / 8000, (z + 4000) / 8000, { base: 6, octaves: 4, seed: 600 });

    const place = (kind, count, accept) => {
        let tries = 0;
        while (items[kind].length < count && tries++ < count * 20) {
            const x = (rand() * 2 - 1) * RANGE, z = (rand() * 2 - 1) * RANGE;
            if (!accept(x, z)) continue;
            items[kind].push({ x, z, s: 0.75 + rand() * 0.55, r: rand() * Math.PI * 2, tint: 0.85 + rand() * 0.25 });
        }
    };
    place("pine", Math.round(QUALITY.trees * 0.55), (x, z) => forest(x, z) > 0.55 + rand() * 0.15);
    place("broad", Math.round(QUALITY.trees * 0.45), (x, z) => forest(x, z) > 0.45 + rand() * 0.2);
    place("bush", QUALITY.bushes, (x, z) => forest(x, z) > 0.35 + rand() * 0.3);
    place("rock", 260, () => true);

    // Bucket into chunks and build instanced meshes.
    const chunks = new Map();
    const key = (x, z) => `${Math.floor((x + RANGE) / CHUNK)},${Math.floor((z + RANGE) / CHUNK)}`;
    for (const kind of Object.keys(items)) {
        for (const it of items[kind]) {
            const k = key(it.x, it.z);
            if (!chunks.has(k)) chunks.set(k, { pine: [], broad: [], bush: [], rock: [] });
            chunks.get(k)[kind].push(it);
        }
    }

    const group = new THREE.Group();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), color = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);

    const instanced = (geom, mat, list, shadow, matrixFor) => {
        const mesh = new THREE.InstancedMesh(geom, mat, list.length);
        list.forEach((it, i) => {
            mesh.setMatrixAt(i, matrixFor(it));
            color.setRGB(it.tint, it.tint * (0.95 + (it.tint - 0.85) * 0.3), it.tint * 0.9);
            mesh.setColorAt(i, color);
        });
        mesh.castShadow = shadow;
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        group.add(mesh);
        return mesh;
    };

    const treeMatrix = it => m.compose(new THREE.Vector3(it.x, GROUND_Y - 0.1, it.z), q.setFromAxisAngle(up, it.r), new THREE.Vector3(it.s, it.s, it.s)).clone();
    const rockMatrix = it => {
        const s = 0.6 + it.s * 1.6;
        return m.compose(new THREE.Vector3(it.x, GROUND_Y + s * 0.3, it.z),
            q.setFromEuler(new THREE.Euler(0, it.r, 0)), new THREE.Vector3(s * 1.4, s, s * 1.2)).clone();
    };

    for (const c of chunks.values()) {
        for (const kind of ["pine", "broad", "bush"]) {
            const list = c[kind];
            if (!list.length) continue;
            const sp = species[kind];
            const meshes = [
                instanced(sp.wood, woodMat, list, kind !== "bush", treeMatrix),
                instanced(sp.leaves, leafMats[kind], list, kind !== "bush", treeMatrix)
            ];
            list.forEach((it, i) => { it.meshes = meshes; it.index = i; });
        }
        if (c.rock.length) {
            const mesh = instanced(rockGeo, rockMaterial(), c.rock, true, rockMatrix);
            c.rock.forEach((it, i) => { it.meshes = [mesh]; it.index = i; });
        }
    }
    scene.add(group);

    const rockMeshes = group.children.filter(o => o.material === rockMaterial());

    return {
        group,
        items,
        setRocksVisible(v) { rockMeshes.forEach(r => { r.visible = v; }); },
        // Remove decor standing on buildings or roads.
        clearAround(isBlocked) {
            const zero = new THREE.Matrix4().makeScale(0, 0, 0);
            const touched = new Set();
            for (const kind of ["pine", "broad", "bush"]) {
                for (const it of items[kind]) {
                    const pad = kind === "bush" ? 1 : 3;
                    if (isBlocked(it.x, it.z, pad)) {
                        for (const mesh of it.meshes) { mesh.setMatrixAt(it.index, zero); touched.add(mesh); }
                    }
                }
            }
            touched.forEach(mesh => { mesh.instanceMatrix.needsUpdate = true; });
        },
        restore() {
            for (const kind of ["pine", "broad", "bush"]) {
                for (const it of items[kind]) {
                    for (const mesh of it.meshes) mesh.setMatrixAt(it.index, treeMatrix(it));
                }
            }
            group.children.forEach(mesh => { mesh.instanceMatrix.needsUpdate = true; });
        }
    };
}

// ---------------- grass field around the player ----------------

function grassClumpGeometry() {
    const rand = seeded(55);
    const parts = [];
    const BLADES = 7;
    for (let b = 0; b < BLADES; b++) {
        const h = 0.35 + rand() * 0.4;
        const w = 0.035 + rand() * 0.025;
        const lean = (rand() - 0.5) * 0.5 + 0.15;
        const a = rand() * Math.PI * 2;
        const ox = (rand() - 0.5) * 0.35, oz = (rand() - 0.5) * 0.35;
        const pos = [], col = [], nor = [];
        const SEG = 3;
        const pt = (t, side) => {
            const ww = w * (1 - t) * side;
            const bend = lean * t * t;
            return [ww, t * h, bend];
        };
        const push = (p, t) => {
            const x = p[0] * Math.cos(a) + p[2] * Math.sin(a) + ox;
            const z = -p[0] * Math.sin(a) + p[2] * Math.cos(a) + oz;
            pos.push(x, p[1], z);
            nor.push(0, 1, 0);
            const k = 0.35 + t * 0.75;
            col.push(0.32 * k, 0.5 * k, 0.16 * k);
        };
        for (let s = 0; s < SEG; s++) {
            const t0 = s / SEG, t1 = (s + 1) / SEG;
            const a0 = pt(t0, -1), b0 = pt(t0, 1), a1 = pt(t1, -1), b1 = pt(t1, 1);
            if (s < SEG - 1) {
                push(a0, t0); push(b0, t0); push(a1, t1);
                push(b0, t0); push(b1, t1); push(a1, t1);
            } else {
                push(a0, t0); push(b0, t0); push([0, h, lean], 1);
            }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
        g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
        parts.push(g);
    }
    return mergeGeometries(parts);
}

export function createGrass(scene) {
    const mat = windSway(new THREE.MeshStandardMaterial({
        vertexColors: true, side: THREE.DoubleSide, roughness: 0.9, envMapIntensity: 0.3
    }), { height: 0.75, strength: 0.14, speed: 1.8 });

    const count = QUALITY.grass;
    const R = QUALITY.grassRadius;
    const mesh = new THREE.InstancedMesh(grassClumpGeometry(), mat, count);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.count = 0;
    scene.add(mesh);

    // Sample the same macro texture as the ground shader, so grass
    // thins out on dirt patches.
    const macroImg = T.macro().image;
    const macroData = macroImg.getContext("2d").getImageData(0, 0, macroImg.width, macroImg.height).data;
    const msz = macroImg.width;
    const sampleMacro = (u, v, ch) => {
        const x = ((Math.floor(u * msz) % msz) + msz) % msz, y = ((Math.floor(v * msz) % msz) + msz) % msz;
        return macroData[(y * msz + x) * 4 + ch] / 255;
    };
    const dirtAt = (x, z) => {
        const r = sampleMacro(x / 900, z / 900, 0);
        const g = sampleMacro(x / 130 + 0.37, z / 130 + 0.37, 1);
        const t = (r * 0.65 + g * 0.35 - 0.6) / 0.14;
        return Math.max(0, Math.min(1, t));
    };

    let blocked = () => false;
    let center = null;
    const step = Math.sqrt((Math.PI * R * R) / count) ;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), color = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);

    function rebuild(cx, cz) {
        center = { x: cx, z: cz };
        let n = 0;
        const i0 = Math.floor((cx - R) / step), i1 = Math.ceil((cx + R) / step);
        const j0 = Math.floor((cz - R) / step), j1 = Math.ceil((cz + R) / step);
        for (let i = i0; i <= i1 && n < count; i++) {
            for (let j = j0; j <= j1 && n < count; j++) {
                const x = (i + hash2(i, j, 1)) * step;
                const z = (j + hash2(i, j, 2)) * step;
                const d = Math.hypot(x - cx, z - cz);
                if (d > R) continue;
                if (Math.abs(x) > 1400 || Math.abs(z) > 1400) continue;
                if (hash2(i, j, 4) < dirtAt(x, z) * 1.1) continue;
                if (blocked(x, z, 0.4)) continue;
                const edge = Math.min(1, (R - d) / (R * 0.25));
                const s = (0.7 + hash2(i, j, 3) * 0.7) * edge;
                m.compose(new THREE.Vector3(x, GROUND_Y, z), q.setFromAxisAngle(up, hash2(i, j, 5) * 6.283), new THREE.Vector3(s, s * (0.8 + hash2(i, j, 6) * 0.5), s));
                mesh.setMatrixAt(n, m);
                const dry = hash2(i, j, 7) * 0.25;
                color.setRGB(1 + dry * 0.6, 1 + dry * 0.2, 1 - dry * 0.3);
                mesh.setColorAt(n, color);
                n++;
            }
        }
        mesh.count = n;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    return {
        mesh,
        setBlocked(fn) { blocked = fn; center = null; },
        update(focus, cameraY) {
            mesh.visible = cameraY < GROUND_Y + 120;
            if (!mesh.visible) return;
            if (!center || Math.hypot(focus.x - center.x, focus.z - center.z) > R * 0.12) {
                rebuild(focus.x, focus.z);
            }
        }
    };
}
