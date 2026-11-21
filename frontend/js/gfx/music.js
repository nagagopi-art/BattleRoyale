// ==========================================
// Original procedural soundtrack (Web Audio, no audio files)
// ==========================================
// Tracks: "login" (ambient strings), "lobby" (signature theme:
// tanpura drone, tabla-style percussion, electronic bass, brass,
// shehnai-like lead), "matchmaking" (tense percussion).
// Stings: intro logo reveal, login success, match found, countdown.
//
// Scale: D phrygian dominant (D Eb F# G A Bb C), which gives
// an Indian-classical colour over a modern cinematic beat.

import { audioContext } from "./audio.js";

const SCALE = [0, 1, 4, 5, 7, 8, 10];
const D = 50;                                   // MIDI D3
const hz = m => 440 * Math.pow(2, (m - 69) / 12);
const deg = (d, oct = 0) => D + SCALE[((d % 7) + 7) % 7] + 12 * (Math.floor(d / 7) + oct);

let ctx = null, out = null, musicBus = null, sfxBus = null, noise = null, verb = null;
let muted = false;
try { muted = localStorage.getItem("ibf.muted") === "1"; } catch {}

function init() {
    if (ctx) return ctx;
    ctx = audioContext();
    if (!ctx) return null;
    out = ctx.createGain();
    out.gain.value = muted ? 0 : 1;
    out.connect(ctx.destination);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.34;
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.6;

    // Simple reverb: decaying noise impulse.
    verb = ctx.createConvolver();
    const len = ctx.sampleRate * 2.4;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
        const d = ir.getChannelData(c);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    verb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.28;
    verb.connect(wet).connect(out);
    musicBus.connect(out);
    sfxBus.connect(out);
    musicBus.connect(verb);
    sfxBus.connect(verb);

    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    return ctx;
}

export function isMuted() { return muted; }
export function setMuted(v) {
    muted = v;
    try { localStorage.setItem("ibf.muted", v ? "1" : "0"); } catch {}
    if (out) out.gain.setTargetAtTime(v ? 0 : 1, ctx.currentTime, 0.05);
}

// ---------------- instruments ----------------

function env(g, t, a, peak, d, sustain = 0.0001, r = 0) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t + a + d);
    if (r) g.gain.exponentialRampToValueAtTime(0.0001, t + a + d + r);
}

function osc(type, f, t, dur, dest, { detune = 0 } = {}) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    o.detune.value = detune;
    o.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.1);
    return o;
}

function noiseSrc(t, dur, dest, rate = 1) {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.playbackRate.value = rate;
    s.connect(dest);
    s.start(t, Math.random() * Math.max(0, 1.9 - dur), dur + 0.05);
    return s;
}

function filter(type, f, q = 0.7) {
    const b = ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
}

// Tanpura-like pluck: buzzy saw with a long ring.
function tanpura(note, t, bus, vol = 0.12) {
    const g = ctx.createGain();
    const f = filter("bandpass", hz(note) * 4, 0.9);
    f.connect(g).connect(bus);
    env(g, t, 0.01, vol, 3.2);
    osc("sawtooth", hz(note), t, 3.4, f);
    osc("sawtooth", hz(note) * 1.003, t, 3.4, f);
}

// Tabla-like strokes: "dha" (low bayan + ring), "na" (sharp ring), "ti" (dry tap).
function tabla(kind, t, bus, vol = 0.5) {
    if (kind === "dha" || kind === "ge") {
        const g = ctx.createGain();
        g.connect(bus);
        env(g, t, 0.003, vol, 0.35);
        const o = osc("sine", 70, t, 0.4, g);
        o.frequency.setValueAtTime(95, t);
        o.frequency.exponentialRampToValueAtTime(kind === "ge" ? 140 : 62, t + 0.25);
    }
    if (kind === "dha" || kind === "na") {
        const g = ctx.createGain();
        g.connect(bus);
        env(g, t, 0.002, vol * 0.45, 0.25);
        osc("sine", hz(D + 24), t, 0.3, g);
        osc("triangle", hz(D + 31), t, 0.3, g);
    }
    if (kind === "ti" || kind === "na") {
        const g = ctx.createGain();
        const f = filter("bandpass", 3200, 1.5);
        f.connect(g).connect(bus);
        env(g, t, 0.001, vol * 0.35, 0.05);
        noiseSrc(t, 0.08, f);
    }
}

function kick(t, bus, vol = 0.8) {
    const g = ctx.createGain();
    g.connect(bus);
    env(g, t, 0.002, vol, 0.4);
    const o = osc("sine", 50, t, 0.45, g);
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
}

function clap(t, bus, vol = 0.25) {
    const g = ctx.createGain();
    const f = filter("bandpass", 1600, 0.8);
    f.connect(g).connect(bus);
    env(g, t, 0.002, vol, 0.18);
    noiseSrc(t, 0.2, f);
}

function hat(t, bus, vol = 0.07) {
    const g = ctx.createGain();
    const f = filter("highpass", 7000);
    f.connect(g).connect(bus);
    env(g, t, 0.001, vol, 0.04);
    noiseSrc(t, 0.05, f);
}

function bass(note, t, dur, bus, vol = 0.22) {
    const g = ctx.createGain();
    const f = filter("lowpass", 380, 4);
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(220, t + dur * 0.8);
    f.connect(g).connect(bus);
    env(g, t, 0.01, vol, dur, 0.0001);
    osc("sawtooth", hz(note), t, dur, f);
    osc("square", hz(note - 12), t, dur, f);
}

// Warm string pad: detuned saws through a slow filter.
function pad(notes, t, dur, bus, vol = 0.05) {
    const g = ctx.createGain();
    const f = filter("lowpass", 900, 0.5);
    f.connect(g).connect(bus);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const n of notes) {
        for (const det of [-8, 0, 7]) osc("sawtooth", hz(n), t, dur, f, { detune: det });
    }
}

// Brass stab / swell.
function brass(notes, t, dur, bus, vol = 0.09, swell = false) {
    const g = ctx.createGain();
    const f = filter("lowpass", 400, 1.2);
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(swell ? 2600 : 2200, t + (swell ? dur * 0.6 : 0.08));
    f.frequency.exponentialRampToValueAtTime(600, t + dur);
    f.connect(g).connect(bus);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (swell ? dur * 0.5 : 0.04));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const n of notes) {
        osc("sawtooth", hz(n), t, dur, f, { detune: -5 });
        osc("sawtooth", hz(n), t, dur, f, { detune: 6 });
    }
}

// Shehnai-like reed lead with vibrato and a nasal band-pass.
function lead(note, t, dur, bus, vol = 0.07, slideFrom = null) {
    const g = ctx.createGain();
    const f = filter("bandpass", 1300, 1.4);
    const f2 = filter("lowpass", 3200);
    f.connect(f2).connect(g).connect(bus);
    env(g, t, 0.05, vol, dur, vol * 0.6, 0.15);
    const o = osc("sawtooth", hz(note), t, dur + 0.2, f);
    const o2 = osc("square", hz(note), t, dur + 0.2, f, { detune: 4 });
    if (slideFrom !== null) {
        for (const x of [o, o2]) {
            x.frequency.setValueAtTime(hz(slideFrom), t);
            x.frequency.exponentialRampToValueAtTime(hz(note), t + 0.12);
        }
    }
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.frequency.value = 5.5;
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(hz(note) * 0.012, t + dur * 0.5);
    lfo.connect(lg);
    lg.connect(o.frequency);
    lg.connect(o2.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.3);
}

function boom(t, bus, vol = 1) {
    const g = ctx.createGain();
    g.connect(bus);
    env(g, t, 0.005, vol, 2.2);
    const o = osc("sine", 40, t, 2.3, g);
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 1.5);
    const ng = ctx.createGain();
    const f = filter("lowpass", 300);
    f.connect(ng).connect(bus);
    env(ng, t, 0.005, vol * 0.5, 1.4);
    noiseSrc(t, 1.5, f, 0.5);
}

function clang(t, bus, vol = 0.35) {
    // Metallic: inharmonic partials with fast decay.
    for (const [ratio, v] of [[1, 1], [2.76, 0.6], [5.4, 0.4], [8.93, 0.25]]) {
        const g = ctx.createGain();
        g.connect(bus);
        env(g, t, 0.001, vol * v, 1.6 / ratio + 0.3);
        osc("sine", 220 * ratio, t, 2, g);
    }
    const g = ctx.createGain();
    const f = filter("highpass", 2500);
    f.connect(g).connect(bus);
    env(g, t, 0.001, vol * 0.5, 0.12);
    noiseSrc(t, 0.15, f);
}

function riser(t, dur, bus, vol = 0.12) {
    const g = ctx.createGain();
    const f = filter("bandpass", 300, 2);
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(5000, t + dur);
    f.connect(g).connect(bus);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
    noiseSrc(t, dur, f);
}

function wind(t, dur, bus, vol = 0.05) {
    const g = ctx.createGain();
    const f = filter("bandpass", 450, 0.5);
    f.connect(g).connect(bus);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    noiseSrc(t, Math.min(dur, 1.9), f, 0.6);
}

function engineDrone(t, dur, bus, vol = 0.03) {
    const g = ctx.createGain();
    const f = filter("lowpass", 220);
    f.connect(g).connect(bus);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc("sawtooth", 62, t, dur, f);
    osc("sawtooth", 63.4, t, dur, f);
}

// ---------------- tracks ----------------
// Each track schedules one bar at a time: bar(barIndex, startTime, beat).

const TRACKS = {
    login: {
        bpm: 60, bars: 16,
        bar(i, t, beat, bus) {
            const prog = [[0, 4], [5, 2], [3, 0], [4, 1]];
            const [a, b] = prog[Math.floor(i / 2) % 4];
            if (i % 2 === 0) pad([deg(a, -1), deg(a + 2, -1), deg(b + 4, -1)], t, beat * 8.2, bus, 0.045);
            if (i % 4 === 0) tanpura(D - 12, t, bus, 0.05);
            if (i % 4 === 2) tanpura(D - 5, t, bus, 0.04);
            if (i % 3 === 0) wind(t + beat, beat * 3, bus, 0.035);
            if (i % 8 === 4) engineDrone(t, beat * 7, bus, 0.022);
            if (i % 8 === 6) lead(deg(4, 1), t + beat * 2, beat * 1.8, bus, 0.025, deg(3, 1));
        }
    },

    lobby: {
        bpm: 92, bars: 32,
        bar(i, t, beat, bus) {
            const section = Math.floor(i / 8);           // 0 intro, 1 groove, 2 lead, 3 build
            const roots = [0, 0, 5, 6];                     // D D Bb C
            const r = roots[Math.floor(i / 2) % 4];
            const s16 = beat / 4;

            // Tanpura drone: Pa Sa Sa Sa (low).
            [D - 5, D, D, D - 12].forEach((n, k) => tanpura(n, t + k * beat, bus, 0.045));

            // Tabla groove (16 steps).
            const theka = ["dha", "", "ti", "na", "dha", "", "ti", "na", "ge", "na", "dha", "", "ti", "na", "dha", "na"];
            if (section >= 0) theka.forEach((k, s) => { if (k) tabla(k, t + s * s16, bus, section === 0 ? 0.28 : 0.42); });

            if (section >= 1) {
                kick(t, bus); kick(t + beat * 2.5, bus, 0.6);
                clap(t + beat, bus); clap(t + beat * 3, bus);
                for (let h = 0; h < 8; h++) hat(t + h * beat / 2 + beat / 4, bus);
                for (let k = 0; k < 4; k++) bass(deg(r, -2) + (k === 3 ? 7 : 0), t + k * beat, beat * 0.9, bus);
            }
            if (i % 4 === 0) pad([deg(r, -1), deg(r + 2, -1), deg(r + 4, -1)], t, beat * 16, bus, 0.035);
            if (section >= 1 && i % 4 === 0) brass([deg(r, 0), deg(r + 2, 0), deg(r + 4, 0)], t, beat * 0.9, bus, 0.07);
            if (section === 3 && i % 2 === 1) brass([deg(r, 0), deg(r + 4, 0)], t + beat * 3.5, beat * 0.5, bus, 0.06);

            // Shehnai-like melody (section 2 and 3).
            if (section >= 2) {
                const phrases = [
                    [[4, 1, 0], [5, 0.5], [4, 0.5], [2, 1], [1, 1, 0]],
                    [[0, 1.5], [1, 0.5], [2, 1], [4, 1, 3]],
                    [[7, 1, 6], [5, 0.5], [4, 0.5], [5, 1], [4, 1]],
                    [[2, 1], [1, 0.5], [0, 0.5], [1, 1], [0, 1, -1]]
                ];
                let x = 0;
                for (const [d, len, slide] of phrases[i % 4]) {
                    lead(deg(d, 1), t + x * beat, len * beat * 0.95, bus, 0.055, slide !== undefined ? deg(slide, 1) : null);
                    x += len;
                }
            }
            if (i % 8 === 7) riser(t + beat * 2, beat * 2, bus, 0.06);
        }
    },

    matchmaking: {
        bpm: 118, bars: 8,
        bar(i, t, beat, bus) {
            const s16 = beat / 4;
            kick(t, bus, 0.7); kick(t + beat * 2, bus, 0.7);
            for (let h = 0; h < 16; h++) hat(t + h * s16, bus, h % 4 === 2 ? 0.09 : 0.04);
            ["dha", "ti", "ti", "na", "", "ti", "dha", "na"].forEach((k, s) => { if (k) tabla(k, t + s * beat / 2, bus, 0.3); });
            for (let k = 0; k < 8; k++) bass(deg(i % 4 === 3 ? 1 : 0, -2), t + k * beat / 2, beat * 0.4, bus, 0.16);
            if (i % 4 === 0) pad([deg(0, -1), deg(1, -1), deg(4, -1)], t, beat * 16, bus, 0.03);
            if (i % 2 === 1) riser(t + beat * 2, beat * 2, bus, 0.04);
        }
    }
};

// ---------------- player ----------------

let current = null;       // { name, gain, bar, next, timer }

export function play(name) {
    if (!init() || ctx.state !== "running") { pendingTrack = name; return; }
    pendingTrack = null;
    if (current?.name === name) return;
    stop(1.5);
    const track = TRACKS[name];
    if (!track) return;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 2);
    gain.connect(musicBus);
    const beat = 60 / track.bpm;
    const me = { name, gain, bar: 0, next: ctx.currentTime + 0.1 };
    me.timer = setInterval(() => {
        while (me.next < ctx.currentTime + 0.6) {
            track.bar(me.bar % track.bars, me.next, beat, gain);
            me.bar++;
            me.next += beat * 4;
        }
    }, 120);
    current = me;
}

export function stop(fade = 1) {
    if (!current || !ctx) return;
    const c = current;
    current = null;
    c.gain.gain.cancelScheduledValues(ctx.currentTime);
    c.gain.gain.setValueAtTime(Math.max(0.0001, c.gain.gain.value), ctx.currentTime);
    c.gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + fade);
    setTimeout(() => { clearInterval(c.timer); c.gain.disconnect(); }, fade * 1000 + 800);
}

let pendingTrack = null;
// Start whatever was requested before the first user gesture.
export function resume() {
    if (!init()) return;
    if (ctx.state === "suspended") ctx.resume().then(() => { if (pendingTrack) play(pendingTrack); });
    else if (pendingTrack) play(pendingTrack);
}

// ---------------- stings ----------------

export function sting(name) {
    if (!init() || ctx.state !== "running") return;
    const t = ctx.currentTime + 0.02;
    const bus = sfxBus;
    switch (name) {
        case "intro":
            // 0s rumble, 0.4 drum, 2.2 metallic logo hit + brass, 4.5 tail.
            engineDrone(t, 4, bus, 0.05);
            boom(t + 0.35, bus, 0.8);
            tabla("dha", t + 0.35, bus, 0.6);
            riser(t + 0.6, 1.6, bus, 0.1);
            boom(t + 2.2, bus, 1);
            clang(t + 2.2, bus, 0.4);
            kick(t + 2.2, bus, 1);
            brass([deg(0, -1), deg(4, -1), deg(0, 0), deg(2, 0)], t + 2.25, 3.2, bus, 0.11, true);
            lead(deg(4, 1), t + 3.0, 0.5, bus, 0.05, deg(3, 1));
            lead(deg(5, 1), t + 3.5, 0.3, bus, 0.05);
            lead(deg(4, 1), t + 3.8, 1.2, bus, 0.05);
            tabla("dha", t + 3.0, bus, 0.4); tabla("na", t + 3.25, bus, 0.3); tabla("dha", t + 3.5, bus, 0.45);
            break;
        case "success":
            riser(t, 0.35, bus, 0.08);
            brass([deg(0, 0), deg(4, 0)], t + 0.3, 0.6, bus, 0.07);
            tabla("dha", t + 0.3, bus, 0.4);
            break;
        case "found":
            boom(t, bus, 0.9);
            clang(t, bus, 0.25);
            brass([deg(0, -1), deg(4, -1), deg(0, 0)], t, 1.4, bus, 0.1);
            break;
        case "beep":
            { const g = ctx.createGain(); g.connect(bus); env(g, t, 0.002, 0.12, 0.12); osc("square", 880, t, 0.15, g); }
            break;
        case "click":
            { const g = ctx.createGain(); g.connect(bus); env(g, t, 0.001, 0.08, 0.05); osc("triangle", 1400, t, 0.06, g); }
            break;
        case "whoosh":
            riser(t, 0.4, bus, 0.06);
            break;
    }
}
