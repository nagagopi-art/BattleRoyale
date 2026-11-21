// ==========================================
// Seeded random numbers and tileable noise
// ==========================================

// Small fast PRNG (mulberry32). Same seed = same sequence.
export function seeded(seed) {
    return () => {
        seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Integer hash -> 0..1 (stable per cell, used for grass and decor).
export function hash2(x, y, seed = 0) {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

const smooth = t => t * t * (3 - 2 * t);

// Value noise that wraps every `period` cells (for tileable textures).
export function valueNoise(x, y, period, seed, periodY = period) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = smooth(x - xi), yf = smooth(y - yi);
    const wx = v => ((v % period) + period) % period;
    const wy = v => ((v % periodY) + periodY) % periodY;
    const a = hash2(wx(xi), wy(yi), seed);
    const b = hash2(wx(xi + 1), wy(yi), seed);
    const c = hash2(wx(xi), wy(yi + 1), seed);
    const d = hash2(wx(xi + 1), wy(yi + 1), seed);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}

// Fractal noise in 0..1. u, v in 0..1 tile seamlessly.
export function fbm(u, v, { octaves = 5, base = 4, seed = 1, gain = 0.5 } = {}) {
    let sum = 0, amp = 1, norm = 0, f = base;
    for (let o = 0; o < octaves; o++) {
        sum += valueNoise(u * f, v * f, f, seed + o * 17) * amp;
        norm += amp;
        amp *= gain;
        f *= 2;
    }
    return sum / norm;
}

// Non-tiling 3D-ish noise for vertex displacement (rocks, mountains).
export function noise3(x, y, z, seed = 0) {
    return (valueNoise(x + z * 0.71, y - z * 0.37, 1e6, seed) +
        valueNoise(y + 31.7, z + x * 0.53, 1e6, seed + 7)) * 0.5;
}
