// ==========================================
// Procedural textures (generated once at start-up)
// ==========================================
// Every surface texture is painted in code: colour + a height
// field that becomes a normal map, so surfaces catch light.

import * as THREE from "three";
import { fbm, seeded, valueNoise } from "./noise.js";

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;

// fn(u, v, x, y) -> [r, g, b, height] with r,g,b,height in 0..1.
function paint(size, fn) {
    const color = new Uint8ClampedArray(size * size * 4);
    const height = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = y * size + x;
            const [r, g, b, h] = fn(x / size, y / size, x, y);
            color[i * 4] = clamp01(r) * 255;
            color[i * 4 + 1] = clamp01(g) * 255;
            color[i * 4 + 2] = clamp01(b) * 255;
            color[i * 4 + 3] = 255;
            height[i] = h;
        }
    }
    return { size, color, height };
}

function toCanvas(size, rgba) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    c.getContext("2d").putImageData(new ImageData(rgba, size, size), 0, 0);
    return c;
}

function normalFromHeight({ size, height }, strength) {
    const out = new Uint8ClampedArray(size * size * 4);
    const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = (at(x - 1, y) - at(x + 1, y)) * strength;
            const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
            const len = Math.hypot(dx, dy, 1);
            const i = (y * size + x) * 4;
            out[i] = (dx / len * 0.5 + 0.5) * 255;
            out[i + 1] = (dy / len * 0.5 + 0.5) * 255;
            out[i + 2] = (1 / len * 0.5 + 0.5) * 255;
            out[i + 3] = 255;
        }
    }
    return out;
}

function texture(canvas, { srgb = true, repeat = 1 } = {}) {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

// Returns { map, normalMap } built from one painting.
function textureSet(size, fn, normalStrength = 2) {
    const p = paint(size, fn);
    return {
        map: texture(toCanvas(size, p.color)),
        normalMap: texture(toCanvas(size, normalFromHeight(p, normalStrength)), { srgb: false })
    };
}

const cache = new Map();
function cached(key, make) {
    if (!cache.has(key)) cache.set(key, make());
    return cache.get(key);
}

// ---------------- surfaces ----------------

export const grass = (size = 512) => cached("grass" + size, () => textureSet(size, (u, v) => {
    const n = fbm(u, v, { base: 8, octaves: 5, seed: 3 });
    const fine = fbm(u, v, { base: 64, octaves: 2, seed: 9 });
    const blades = valueNoise(u * 256, v * 64, 256, 4, 64) * valueNoise(u * 64, v * 256, 64, 5, 256);
    const dry = clamp01((fbm(u, v, { base: 3, octaves: 3, seed: 11 }) - 0.5) * 3);
    const g = 0.55 + n * 0.35 + fine * 0.2 + blades * 0.25;
    const r = mix(0.24, 0.42, dry) * g;
    const gr = mix(0.38, 0.40, dry) * g;
    const b = mix(0.13, 0.17, dry) * g;
    return [r, gr, b, n * 0.4 + fine * 0.3 + blades * 0.6];
}, 3));

export const dirt = (size = 512) => cached("dirt" + size, () => textureSet(size, (u, v) => {
    const n = fbm(u, v, { base: 6, octaves: 6, seed: 21 });
    const pebbles = Math.pow(valueNoise(u * 96, v * 96, 96, 22), 6) * 1.6;
    const s = 0.75 + n * 0.4;
    return [0.42 * s + pebbles * 0.2, 0.34 * s + pebbles * 0.18, 0.24 * s + pebbles * 0.15, n + pebbles];
}, 3));

export const asphalt = (size = 512) => cached("asphalt" + size, () => textureSet(size, (u, v) => {
    const n = fbm(u, v, { base: 16, octaves: 4, seed: 31 });
    const grain = valueNoise(u * 300, v * 300, 300, 32);
    const stones = Math.pow(valueNoise(u * 120, v * 120, 120, 33), 5);
    const patch = clamp01((fbm(u, v, { base: 2, octaves: 3, seed: 34 }) - 0.55) * 4) * 0.08;
    const s = 0.2 + n * 0.08 + grain * 0.07 + stones * 0.25 - patch;
    return [s, s * 1.0, s * 1.03, grain * 0.5 + stones];
}, 1.5));

export const plaster = (size = 512) => cached("plaster" + size, () => textureSet(size, (u, v) => {
    const n = fbm(u, v, { base: 8, octaves: 6, seed: 41 });
    const stain = clamp01((fbm(u, v, { base: 2, octaves: 4, seed: 42 }) - 0.45) * 2.5);
    const s = 0.82 + n * 0.16 - stain * 0.12;
    return [0.93 * s, 0.86 * s, 0.74 * s, n];
}, 2.5));

export const blockWall = (size = 512) => cached("block" + size, () => textureSet(size, (u, v) => {
    const rows = 8, cols = 4;
    const row = Math.floor(v * rows);
    const uu = u * cols + (row % 2) * 0.5;
    const fx = uu - Math.floor(uu), fy = v * rows - row;
    const mortar = fx < 0.03 || fy < 0.06;
    const n = fbm(u, v, { base: 16, octaves: 4, seed: 51 });
    const tone = 0.85 + valueNoise(Math.floor(uu), row, 64, 52) * 0.2;
    if (mortar) return [0.55, 0.53, 0.5, 0.0];
    const s = (0.6 + n * 0.25) * tone;
    return [s * 1.0, s * 0.97, s * 0.92, 0.6 + n * 0.4];
}, 4));

export const roofTiles = (size = 512) => cached("roof" + size, () => textureSet(size, (u, v) => {
    const rows = 12, cols = 10;
    const row = Math.floor(v * rows);
    const uu = u * cols + (row % 2) * 0.5;
    const fx = uu - Math.floor(uu), fy = v * rows - row;
    const curve = Math.sin(fx * Math.PI);           // rounded clay tile
    const lip = fy > 0.85 ? (1 - fy) * 4 : 1;       // shadow under the next row
    const tone = 0.8 + valueNoise(Math.floor(uu), row, 128, 61) * 0.35;
    const n = fbm(u, v, { base: 32, octaves: 3, seed: 62 });
    const s = (0.45 + curve * 0.35 + n * 0.15) * tone * Math.min(1, 0.4 + lip);
    return [0.66 * s, 0.30 * s, 0.20 * s, curve * 0.8 + n * 0.2 + fy * 0.3];
}, 3));

export const planks = (size = 256) => cached("planks" + size, () => textureSet(size, (u, v) => {
    const boards = 5;
    const b = Math.floor(v * boards);
    const fy = v * boards - b;
    const grain = fbm(u * 0.25 + b * 0.37, fy * 2, { base: 8, octaves: 4, seed: 71 + b });
    const rings = Math.sin((u * 18 + grain * 6) * Math.PI) * 0.5 + 0.5;
    const gap = fy < 0.05 ? 0.35 : 1;
    const s = (0.55 + grain * 0.3 + rings * 0.12) * gap;
    return [0.62 * s, 0.45 * s, 0.28 * s, gap < 1 ? 0 : 0.5 + rings * 0.3];
}, 3));

export const bark = (size = 256) => cached("bark" + size, () => textureSet(size, (u, v) => {
    const n = fbm(u * 4, v * 0.5, { base: 4, octaves: 5, seed: 81 });
    const ridges = Math.abs(Math.sin((u * 14 + n * 3) * Math.PI));
    const s = 0.3 + ridges * 0.35 + n * 0.25;
    return [0.42 * s, 0.33 * s, 0.25 * s, ridges];
}, 4));

export const rock = (size = 512) => cached("rock" + size, () => textureSet(size, (u, v) => {
    const n = fbm(u, v, { base: 6, octaves: 6, seed: 91 });
    const cracks = 1 - Math.pow(Math.abs(fbm(u, v, { base: 5, octaves: 4, seed: 92 }) - 0.5) * 2, 0.2);
    const lichen = clamp01((fbm(u, v, { base: 10, octaves: 3, seed: 93 }) - 0.62) * 5);
    const s = 0.48 + n * 0.35 - cracks * 0.25;
    return [mix(s, 0.5, lichen * 0.4), mix(s, 0.55, lichen * 0.4), mix(s * 0.95, 0.3, lichen * 0.4), n - cracks * 0.5];
}, 4));

// Woodland camouflage (neutral, so a team tint can colour it).
export const camo = (size = 512) => cached("camo" + size, () => textureSet(size, (u, v) => {
    const a = fbm(u, v, { base: 3, octaves: 4, seed: 101 });
    const b = fbm(u, v, { base: 4, octaves: 4, seed: 102 });
    const weave = (Math.sin(u * size * 1.6) * Math.sin(v * size * 1.6)) * 0.03;
    let c;
    if (a > 0.6) c = [0.18, 0.17, 0.14];
    else if (b > 0.55) c = [0.36, 0.30, 0.22];
    else if (a > 0.45) c = [0.46, 0.48, 0.36];
    else c = [0.72, 0.68, 0.56];
    return [c[0] + weave, c[1] + weave, c[2] + weave, 0.5 + weave * 8];
}, 1));

export const fabric = (size = 256) => cached("fabric" + size, () => textureSet(size, (u, v) => {
    const weave = Math.sin(u * size * 1.2) * Math.sin(v * size * 1.2);
    const n = fbm(u, v, { base: 8, octaves: 3, seed: 111 });
    const s = 0.85 + n * 0.15 + weave * 0.04;
    return [s, s, s, 0.5 + weave * 0.5];
}, 1.5));

// Aircraft skin: light grey panels with seams and rivets.
export const panels = (size = 512) => cached("panels" + size, () => textureSet(size, (u, v) => {
    const pu = u * 8, pv = v * 4;
    const fx = pu - Math.floor(pu), fy = pv - Math.floor(pv);
    const seam = fx < 0.01 || fy < 0.015 ? 1 : 0;
    const rivet = ((fx < 0.04 || fx > 0.96) && Math.abs(Math.sin(fy * Math.PI * 24)) > 0.92) ? 1 : 0;
    const tone = 0.9 + valueNoise(Math.floor(pu), Math.floor(pv), 32, 121) * 0.08;
    const grime = fbm(u, v, { base: 4, octaves: 4, seed: 122 }) * 0.12;
    const s = (0.78 - seam * 0.25 - grime) * tone + rivet * 0.06;
    return [s * 0.96, s * 0.98, s, 0.5 - seam * 0.5 + rivet * 0.4];
}, 1.2));

// Large-scale ground variation sampled in world space (not tiled per metre).
export const macro = (size = 256) => cached("macro" + size, () => {
    const p = paint(size, (u, v) => {
        const a = fbm(u, v, { base: 3, octaves: 6, seed: 131 });
        const b = fbm(u, v, { base: 7, octaves: 4, seed: 132 });
        return [a, b, fbm(u, v, { base: 20, octaves: 3, seed: 133 }), 0];
    });
    return texture(toCanvas(size, p.color), { srgb: false });
});

// ---------------- sprites for particles and decals ----------------

function sprite(size, fn) {
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const u = x / size * 2 - 1, v = y / size * 2 - 1;
            const [r, g, b, a] = fn(u, v, Math.hypot(u, v), x / size, y / size);
            const i = (y * size + x) * 4;
            data[i] = clamp01(r) * 255;
            data[i + 1] = clamp01(g) * 255;
            data[i + 2] = clamp01(b) * 255;
            data[i + 3] = clamp01(a) * 255;
        }
    }
    const t = new THREE.CanvasTexture(toCanvas(size, data));
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

export const smokePuff = () => cached("smoke", () => sprite(128, (u, v, d, x, y) => {
    const n = fbm(x, y, { base: 4, octaves: 5, seed: 141 });
    const a = clamp01(1 - d * (1.1 - n * 0.5)) ;
    const shade = 0.75 + n * 0.35 - Math.max(0, v) * 0.15;
    return [shade, shade, shade, Math.pow(a, 1.4) * (0.6 + n * 0.6)];
}));

export const glow = () => cached("glow", () => sprite(64, (u, v, d) => {
    const a = Math.pow(clamp01(1 - d), 2.2);
    return [1, 1, 1, a];
}));

export const fireball = () => cached("fire", () => sprite(128, (u, v, d, x, y) => {
    const n = fbm(x, y, { base: 5, octaves: 4, seed: 151 });
    const a = clamp01(1 - d * (1.15 - n * 0.6));
    return [1, 0.6 + n * 0.4, 0.25 + n * 0.3, Math.pow(a, 1.2)];
}));

export const muzzleStar = () => cached("muzzle", () => sprite(128, (u, v, d) => {
    const ang = Math.atan2(v, u);
    const spikes = Math.pow(Math.abs(Math.cos(ang * 3)), 8) * 0.8 + 0.2;
    const a = clamp01(1 - d / spikes) ** 1.5 + Math.pow(clamp01(1 - d * 2.5), 2);
    return [1, 0.85, 0.55, clamp01(a)];
}));

export const scorch = () => cached("scorch", () => sprite(256, (u, v, d, x, y) => {
    const n = fbm(x, y, { base: 6, octaves: 5, seed: 161 });
    const a = clamp01((1 - d * (1.2 - n * 0.6)) * 1.6);
    return [0.05, 0.045, 0.04, a * 0.85];
}));

export const ring = () => cached("ring", () => sprite(128, (u, v, d) => {
    const a = Math.exp(-Math.pow((d - 0.8) / 0.08, 2));
    return [1, 1, 1, a];
}));

// Random but repeatable colour jitter used by several builders.
export const jitter = seeded(777);

// Red clay bricks in running bond with recessed mortar.
export const brick = (size = 512) => cached("brick" + size, () => textureSet(size, (u, v) => {
    const rows = 16, cols = 4;
    const row = Math.floor(v * rows);
    const uu = u * cols + (row % 2) * 0.5;
    const col = Math.floor(uu);
    const fx = uu - col, fy = v * rows - row;
    const n = fbm(u, v, { base: 32, octaves: 3, seed: 171 });
    if (fx < 0.025 || fy < 0.09) return [0.62 + n * 0.1, 0.6 + n * 0.1, 0.55 + n * 0.1, 0];
    const tone = 0.75 + valueNoise(((col % (cols * 2)) + cols * 2) % (cols * 2), row, cols * 2, 172, rows) * 0.4;
    const burn = valueNoise(col * 3.1, row * 1.7, 64, 173) > 0.8 ? 0.65 : 1;
    const s = (0.75 + n * 0.3) * tone * burn;
    return [0.62 * s, 0.3 * s, 0.2 * s, 0.6 + n * 0.4];
}, 3));

// Bullet hole: dark puncture with a chipped, dusty rim.
export const bulletHole = () => cached("hole", () => sprite(64, (u, v, d, x, y) => {
    const n = fbm(x, y, { base: 6, octaves: 3, seed: 181 });
    const core = d < 0.18 ? 1 : 0;
    const chip = clamp01(1 - (d - 0.18) / (0.35 + n * 0.35));
    const ang = Math.atan2(v, u);
    const crack = Math.pow(Math.abs(Math.sin(ang * 5 + n * 4)), 30) * clamp01(1 - d);
    if (core) return [0.03, 0.03, 0.03, 1];
    return [0.35 + n * 0.2, 0.33 + n * 0.2, 0.3 + n * 0.2, clamp01(chip * 0.7 + crack * 0.8)];
}));
