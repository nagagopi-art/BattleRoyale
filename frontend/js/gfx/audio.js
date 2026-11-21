// ==========================================
// Procedural 3D sound (Web Audio, no sound files)
// ==========================================
// Gunshots, explosions, flashbangs, smoke hiss, footsteps.
// Volume, muffling and left/right pan follow the camera.

let ctx = null;
let master = null;
let noiseBuf = null;
let volNode = null;
let sfxMuted = false;
try { sfxMuted = localStorage.getItem("ibf.muted") === "1"; } catch {}

// Mute switch shared with the music player.
export function setSfxMuted(v) {
    sfxMuted = v;
    if (volNode) volNode.gain.setTargetAtTime(v ? 0 : 0.8, ctx.currentTime, 0.05);
}
const listener = { pos: { x: 0, y: 0, z: 0 }, yaw: 0 };

function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createDynamicsCompressor();
    master.threshold.value = -14;
    master.ratio.value = 6;
    const vol = ctx.createGain();
    vol.gain.value = sfxMuted ? 0 : 0.8;
    volNode = vol;
    master.connect(vol).connect(ctx.destination);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
}

// Browsers only allow sound after a user gesture.
export function unlockAudio() {
    const c = ensure();
    if (c && c.state === "suspended") c.resume();
}
["pointerdown", "keydown", "touchstart"].forEach(e => window.addEventListener(e, unlockAudio, { passive: true }));

export function setListener(pos, yaw) {
    listener.pos = pos;
    listener.yaw = yaw;
}

// Gain, pan and muffling for a sound at `pos`.
function spatial(pos, ref = 15) {
    if (!pos) return { gain: 1, pan: 0, cutoff: 18000, dist: 0 };
    const dx = pos.x - listener.pos.x, dy = (pos.y ?? 0) - listener.pos.y, dz = pos.z - listener.pos.z;
    const dist = Math.hypot(dx, dy, dz);
    // Camera right vector from yaw (matches render3d's camera).
    const rx = Math.cos(listener.yaw), rz = -Math.sin(listener.yaw);
    const pan = dist > 0.5 ? Math.max(-1, Math.min(1, (dx * rx + dz * rz) / dist)) : 0;
    return {
        gain: ref / (ref + dist),
        pan: pan * 0.85,
        cutoff: Math.max(500, 18000 / (1 + dist / 40)),
        dist
    };
}

function chain(sp, gain) {
    const g = ctx.createGain();
    g.gain.value = gain * sp.gain;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = sp.cutoff;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) pan.pan.value = sp.pan;
    lp.connect(g);
    if (pan) g.connect(pan).connect(master); else g.connect(master);
    return lp;
}

function noise(dest, t0, dur, { type = "lowpass", freq = 2000, q = 0.7, attack = 0.002, decay = dur, peak = 1, sweepTo = null }) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    f.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
    src.connect(f).connect(env).connect(dest);
    src.start(t0, Math.random() * Math.max(0, 2.9 - dur), dur + 0.05);
}

function tone(dest, t0, dur, { freq = 60, to = 30, peak = 1, type = "sine" }) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(peak, t0 + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(env).connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
}

const LOUD = { sniper: 1.4, dmr: 1.15, shotgun: 1.3, ar: 1, smg: 0.75, pistol: 0.7 };

export function playGunshot(pos, category = "ar", suppressed = false) {
    if (!ensure() || ctx.state !== "running") return;
    const sp = spatial(pos, 25);
    const t = ctx.currentTime + Math.min(1.5, sp.dist / 343);   // speed of sound
    const loud = (LOUD[category] ?? 1) * (suppressed ? 0.25 : 1);
    const out = chain(sp, 0.9 * loud);
    noise(out, t, 0.12, { type: "bandpass", freq: suppressed ? 900 : 2400, q: 0.6, peak: 1.0, decay: 0.09 });
    noise(out, t, 0.45, { type: "lowpass", freq: 1400, peak: 0.6, decay: 0.4, sweepTo: 200 });
    tone(out, t, 0.18, { freq: category === "sniper" ? 90 : 130, to: 40, peak: 0.9 });
    // Distant echo tail.
    if (!suppressed) noise(out, t + 0.08, 0.9, { type: "lowpass", freq: 700, peak: 0.12 + Math.min(0.2, sp.dist / 600), attack: 0.05, decay: 0.85 });
}

export function playExplosion(pos, type = "frag") {
    if (!ensure() || ctx.state !== "running") return;
    const sp = spatial(pos, 40);
    const t = ctx.currentTime + Math.min(2, sp.dist / 343);
    if (type === "flash") {
        const out = chain(sp, 1.1);
        noise(out, t, 0.25, { type: "highpass", freq: 1500, peak: 1, decay: 0.2 });
        tone(out, t, 0.25, { freq: 110, to: 40, peak: 0.8 });
        // Ear-ringing when close.
        if (sp.dist < 18) tone(chain({ gain: 1, pan: 0, cutoff: 18000 }, 0.18 * (1 - sp.dist / 18)), t + 0.05, 3.5, { freq: 3800, to: 3700, peak: 1 });
        return;
    }
    if (type === "smoke") {
        const out = chain(sp, 0.6);
        tone(out, t, 0.1, { freq: 300, to: 120, peak: 0.4 });
        noise(out, t + 0.05, 3.5, { type: "highpass", freq: 3000, peak: 0.35, attack: 0.15, decay: 3.4 });
        return;
    }
    const out = chain(sp, 1.5);
    noise(out, t, 0.25, { type: "lowpass", freq: 5000, peak: 1, decay: 0.2 });
    noise(out, t, 2.6, { type: "lowpass", freq: 900, peak: 0.9, attack: 0.01, decay: 2.5, sweepTo: 80 });
    tone(out, t, 1.2, { freq: 70, to: 22, peak: 1 });
    // Debris rattle.
    noise(out, t + 0.15, 1.2, { type: "bandpass", freq: 3200, q: 1.5, peak: 0.08, attack: 0.05, decay: 1.1 });
}

export function playFootstep(pos, run) {
    if (!ensure() || ctx.state !== "running") return;
    const sp = spatial(pos, 4);
    if (sp.dist > 40) return;
    const out = chain(sp, 0.18 * (0.6 + run * 0.6));
    noise(out, ctx.currentTime, 0.08, { type: "bandpass", freq: 600 + Math.random() * 300, q: 1.2, peak: 1, decay: 0.07 });
}

export function playImpact(pos, kind) {
    if (!ensure() || ctx.state !== "running") return;
    const sp = spatial(pos, 8);
    const out = chain(sp, kind === "spark" ? 0.3 : 0.2);
    if (kind === "spark" || kind === "concrete") noise(out, ctx.currentTime, 0.12, { type: "bandpass", freq: kind === "spark" ? 4200 : 2600, q: 3, peak: 1, decay: 0.1 });
    else if (kind === "wood") noise(out, ctx.currentTime, 0.1, { type: "bandpass", freq: 1200, q: 2, peak: 1, decay: 0.08 });
    else if (kind === "stone") noise(out, ctx.currentTime, 0.1, { type: "bandpass", freq: 3200, q: 2.5, peak: 1, decay: 0.07 });
    else noise(out, ctx.currentTime, 0.1, { type: "lowpass", freq: 900, peak: 1, decay: 0.08 });
}

export function playWind(level = 0.15) {
    if (!ensure() || ctx.state !== "running") return;
    const out = chain({ gain: 1, pan: 0, cutoff: 1200 }, level);
    noise(out, ctx.currentTime, 2.8, { type: "bandpass", freq: 500, q: 0.4, peak: 1, attack: 0.8, decay: 2.7 });
}

// Shared context for the music player.
export function audioContext() {
    return ensure();
}
