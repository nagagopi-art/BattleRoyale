// ==========================================
// Combat and world effects
// ==========================================
// Muzzle flashes, tracers, shell casings, impacts (blood,
// sparks, dust), explosions (fireball, smoke column, debris,
// shockwave, scorch mark, light flash), smoke-grenade clouds,
// footstep and landing dust.

import * as THREE from "three";
import { ParticlePool } from "./particles.js";
import * as T from "./textures.js";
import { CASING } from "./weapons.js";
import * as Audio from "./audio.js";

const rnd = (a, b) => a + Math.random() * (b - a);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const randDir = () => V(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize();

export function createEffects(scene) {
    const add = new ParticlePool(scene, { max: 2500, additive: true, maps: [T.glow(), T.fireball()] });
    const alpha = new ParticlePool(scene, { max: 3000, additive: false, maps: [T.smokePuff(), T.glow()] });

    // A few always-present point lights (constant light count = no shader recompiles).
    const lights = [0, 1, 2, 3].map(() => {
        const l = new THREE.PointLight(0xffa64d, 0, 30, 2);
        scene.add(l);
        return { light: l, until: 0, peak: 0, dur: 1 };
    });
    let nextLight = 0;
    function flashLight(pos, color, intensity, range, ms) {
        const L = lights[nextLight++ % lights.length];
        L.light.position.copy(pos);
        L.light.color.setHex(color);
        L.light.distance = range;
        L.peak = intensity;
        L.dur = ms;
        L.until = performance.now() + ms;
    }

    // Tracers: stretched glowing boxes travelling along the shot.
    const tracerGeo = new THREE.BoxGeometry(0.035, 0.035, 1);
    const tracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 3.6, 1.4), toneMapped: false, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const tracers = [];

    // Muzzle flash: two crossed star cards + a front-facing star.
    const starMat = new THREE.MeshBasicMaterial({ map: T.muzzleStar(), color: new THREE.Color(5, 3.6, 2), toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const flashes = [];
    function makeFlash() {
        const g = new THREE.Group();
        const a = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.22), starMat);
        a.position.z = 0.15;
        a.rotation.y = Math.PI / 2;
        const b = a.clone(); b.rotation.set(0, Math.PI / 2, Math.PI / 2);
        const c = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), starMat);
        g.add(a, b, c);
        g.visible = false;
        scene.add(g);
        return { g, until: 0 };
    }
    for (let i = 0; i < 8; i++) flashes.push(makeFlash());
    let nextFlash = 0;

    // Shell casings (physical, bounce on the ground).
    const casings = [];
    const casingMesh = new THREE.InstancedMesh(CASING.geometry, CASING.material, 80);
    casingMesh.count = 0;
    casingMesh.frustumCulled = false;
    scene.add(casingMesh);

    // Scorch decals and shockwave rings.
    const scorchMat = new THREE.MeshBasicMaterial({ map: T.scorch(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const ringMat = new THREE.MeshBasicMaterial({ map: T.ring(), color: new THREE.Color(1.6, 1.4, 1.2), transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
    const decals = [];
    const rings = [];

    let shake = 0;

    // Bullet holes on walls and the ground.
    const holeMat = new THREE.MeshStandardMaterial({ map: T.bulletHole(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 1 });
    const holeGeo = new THREE.PlaneGeometry(0.16, 0.16);
    const holes = [];
    function bulletHole(point, normal) {
        const m = new THREE.Mesh(holeGeo, holeMat);
        m.position.copy(point).addScaledVector(normal, 0.012);
        m.lookAt(point.clone().add(normal));
        m.rotateZ(Math.random() * Math.PI * 2);
        m.scale.setScalar(rnd(0.8, 1.3));
        scene.add(m);
        holes.push(m);
        if (holes.length > 80) scene.remove(holes.shift());
    }

    // Gloo wall breaking: blue shards and a flash.
    function glooShatter(pos, size, rotY) {
        const right = V(Math.cos(rotY), 0, -Math.sin(rotY));
        for (let i = 0; i < 70; i++) {
            const p = pos.clone().addScaledVector(right, rnd(-size.width / 2, size.width / 2)).add(V(0, rnd(0.1, size.height), 0));
            add.spawn({ pos: p, vel: randDir().multiplyScalar(rnd(1.5, 5)).add(V(0, 1.5, 0)), life: rnd(0.4, 1.0), size: [0.12, 0.03], color: [0.6, 2.2, 4.5], alpha: [1, 0], gravity: 7, floor: GROUND_Y + 0.02 });
        }
        for (let i = 0; i < 12; i++) {
            const p = pos.clone().addScaledVector(right, rnd(-size.width / 2, size.width / 2)).add(V(0, rnd(0.3, size.height), 0));
            alpha.spawn({ pos: p, vel: randDir().multiplyScalar(0.6), life: rnd(0.8, 1.4), size: [0.4, 1.6], color: [0.75, 0.9, 1], alpha: [0.45, 0], drag: 2 });
        }
        flashLight(pos.clone().add(V(0, 1.5, 0)), 0x66ccff, 60, 10, 200);
        Audio.playImpact(pos, "spark");
    }

    // Gloo wall forming: rising blue energy.
    function glooForm(pos, size, rotY) {
        const right = V(Math.cos(rotY), 0, -Math.sin(rotY));
        for (let i = 0; i < 40; i++) {
            const p = pos.clone().addScaledVector(right, rnd(-size.width / 2, size.width / 2)).add(V(0, 0.05, 0));
            add.spawn({ pos: p, vel: V(rnd(-0.2, 0.2), rnd(2, 4.5), rnd(-0.2, 0.2)), life: rnd(0.3, 0.7), size: [0.1, 0.02], color: [0.5, 1.8, 4], alpha: [1, 0], drag: 1.5 });
        }
        flashLight(pos.clone().add(V(0, 1, 0)), 0x66ccff, 25, 8, 350);
    }

    // ---------------- emitters ----------------

    function muzzleFlash(pos, dir, { category = "ar", light = true } = {}) {
        const f = flashes[nextFlash++ % flashes.length];
        f.g.position.copy(pos);
        f.g.lookAt(pos.clone().add(dir));
        const s = category === "sniper" || category === "shotgun" ? 1.5 : category === "pistol" ? 0.6 : 1;
        f.g.scale.setScalar(s * rnd(0.8, 1.2));
        f.g.rotation.z = Math.random() * Math.PI;
        f.g.visible = true;
        f.until = performance.now() + 45;
        if (light) flashLight(pos, 0xffb057, 30 * s, 9, 60);
        // Muzzle smoke wisp.
        for (let i = 0; i < 3; i++) {
            alpha.spawn({
                pos: pos.clone().addScaledVector(dir, 0.1), vel: dir.clone().multiplyScalar(rnd(0.6, 1.5)).add(V(0, 0.4, 0)),
                life: rnd(0.6, 1.1), size: [0.08, 0.6 * s], color: [0.8, 0.8, 0.8], alpha: [0.35, 0], drag: 2
            });
        }
    }

    function tracer(from, to) {
        const dist = from.distanceTo(to);
        if (dist < 1) return;
        const m = new THREE.Mesh(tracerGeo, tracerMat);
        m.lookAt(to.clone().sub(from));
        m.position.copy(from);
        m.lookAt(to);
        scene.add(m);
        tracers.push({ m, from: from.clone(), to: to.clone(), dist, t: 0, speed: 600 });
    }

    function ejectCasing(pos, right) {
        const vel = right.clone().multiplyScalar(rnd(1.8, 2.6)).add(V(0, rnd(1.8, 2.6), 0)).add(randDir().multiplyScalar(0.3));
        if (casings.length >= 80) casings.shift();
        casings.push({ pos: pos.clone(), vel, rot: V(rnd(0, 6), rnd(0, 6), rnd(0, 6)), spin: randDir().multiplyScalar(20), age: 0, floor: GROUND_Y + 0.01 });
    }

    function impact(point, kind, normal = V(0, 1, 0)) {
        Audio.playImpact(point, kind);
        if (kind === "blood") {
            for (let i = 0; i < 14; i++) {
                alpha.spawn({
                    pos: point.clone(), vel: randDir().multiplyScalar(rnd(0.5, 2.5)).add(normal.clone().multiplyScalar(1.2)),
                    life: rnd(0.25, 0.6), size: [0.08, rnd(0.3, 0.55)], color: [0.35, 0.02, 0.02], alpha: [0.9, 0], drag: 4, gravity: 3, frame: 0
                });
            }
            return;
        }
        if (kind === "spark") {
            for (let i = 0; i < 16; i++) {
                add.spawn({
                    pos: point.clone(), vel: normal.clone().multiplyScalar(rnd(2, 5)).add(randDir().multiplyScalar(rnd(2, 6))),
                    life: rnd(0.15, 0.45), size: [0.06, 0.02], color: [4, 2.4, 0.9], alpha: [1, 0], gravity: 9.8, drag: 1, floor: GROUND_Y + 0.02
                });
            }
            flashLight(point, 0xffaa55, 4, 4, 50);
            bulletHole(point, normal);
        }
        if (kind === "wood") {
            for (let i = 0; i < 12; i++) {
                alpha.spawn({
                    pos: point.clone(), vel: normal.clone().multiplyScalar(rnd(1.5, 4)).add(randDir().multiplyScalar(rnd(1, 3))),
                    life: rnd(0.4, 0.9), size: [0.06, 0.04], color: [0.55, 0.38, 0.2], alpha: [1, 0.6], gravity: 9.8, floor: GROUND_Y + 0.02, spin: rnd(-8, 8)
                });
            }
            bulletHole(point, normal);
        }
        if (kind === "stone" || kind === "concrete") {
            for (let i = 0; i < (kind === "stone" ? 10 : 6); i++) {
                alpha.spawn({
                    pos: point.clone(), vel: normal.clone().multiplyScalar(rnd(2, 5)).add(randDir().multiplyScalar(rnd(1, 3))),
                    life: rnd(0.4, 0.8), size: [0.05, 0.03], color: kind === "stone" ? [0.45, 0.44, 0.42] : [0.75, 0.72, 0.66], alpha: [1, 0.5], gravity: 9.8, floor: GROUND_Y + 0.02
                });
            }
            for (let i = 0; i < 5; i++) {
                add.spawn({
                    pos: point.clone(), vel: normal.clone().multiplyScalar(rnd(2, 4)).add(randDir().multiplyScalar(rnd(2, 5))),
                    life: rnd(0.08, 0.2), size: [0.05, 0.02], color: [4, 2.6, 1.2], alpha: [1, 0], gravity: 9.8
                });
            }
            bulletHole(point, normal);
        }
        const dustColor = kind === "wood" ? [0.55, 0.45, 0.32] : kind === "stone" ? [0.55, 0.54, 0.52] : kind === "concrete" ? [0.78, 0.75, 0.7] : [0.62, 0.57, 0.5];
        // Dust / debris puff.
        for (let i = 0; i < 8; i++) {
            alpha.spawn({
                pos: point.clone(), vel: normal.clone().multiplyScalar(rnd(0.5, 2)).add(randDir().multiplyScalar(0.8)),
                life: rnd(0.6, 1.4), size: [0.15, rnd(0.6, 1.1)], color: dustColor, alpha: [0.55, 0], drag: 2.5, gravity: 0.4
            });
        }
    }

    function explosion(at, radius, type = "frag") {
        const pos = at.clone();
        Audio.playExplosion(pos, type);

        if (type === "flash") {
            add.spawn({ pos: pos.clone().add(V(0, 0.5, 0)), life: 0.35, size: [1, 9], color: [12, 12, 12], alpha: [1, 0], frame: 0, spin: 0 });
            for (let i = 0; i < 20; i++) {
                add.spawn({ pos: pos.clone().add(V(0, 0.3, 0)), vel: randDir().multiplyScalar(rnd(4, 10)), life: rnd(0.2, 0.5), size: [0.06, 0.02], color: [6, 6, 6], alpha: [1, 0], gravity: 6, floor: GROUND_Y + 0.02 });
            }
            for (let i = 0; i < 10; i++) {
                alpha.spawn({ pos: pos.clone().add(randDir().multiplyScalar(0.4)), vel: randDir().multiplyScalar(0.6).add(V(0, 0.5, 0)), life: rnd(2, 3.5), size: [0.4, 2.2], color: [0.85, 0.85, 0.85], alpha: [0.35, 0], drag: 1 });
            }
            flashLight(pos.clone().add(V(0, 1, 0)), 0xffffff, 400, 40, 250);
            return;
        }

        if (type === "smoke") {
            for (let i = 0; i < 12; i++) {
                alpha.spawn({ pos: pos.clone().add(V(0, 0.2, 0)), vel: randDir().multiplyScalar(rnd(1, 3)).add(V(0, 1, 0)), life: rnd(1.5, 3), size: [0.4, 2.5], color: [0.82, 0.82, 0.84], alpha: [0.6, 0], drag: 1.5 });
            }
            return;
        }

        // ----- frag -----
        const r = Math.max(2, radius || 6);
        shake = Math.max(shake, 1);
        flashLight(pos.clone().add(V(0, 1.2, 0)), 0xff9a3c, 900, r * 6, 450);

        // Core flash.
        add.spawn({ pos: pos.clone().add(V(0, 0.8, 0)), life: 0.18, size: [r * 0.6, r * 1.6], color: [10, 8, 5], alpha: [1, 0], frame: 0, spin: 0 });
        // Fireball.
        for (let i = 0; i < 26; i++) {
            const d = randDir(); d.y = Math.abs(d.y) * 0.8 + 0.2;
            add.spawn({
                pos: pos.clone().add(V(0, 0.5, 0)).addScaledVector(d, rnd(0, r * 0.15)),
                vel: d.multiplyScalar(rnd(r * 0.8, r * 2.2)), life: rnd(0.35, 0.8), size: [r * 0.25, r * rnd(0.5, 0.8)],
                colorFn: t => [6 - t * 4.5, 3.2 - t * 2.6, 1.2 - t * 1.1], alpha: t => (1 - t) * (1 - t), drag: 5, frame: 1
            });
        }
        // Rising black smoke.
        for (let i = 0; i < 26; i++) {
            const d = randDir(); d.y = Math.abs(d.y);
            alpha.spawn({
                pos: pos.clone().add(V(0, 0.8, 0)).addScaledVector(d, rnd(0, r * 0.3)),
                vel: d.multiplyScalar(rnd(1, r * 0.8)).add(V(0, rnd(1.5, 4), 0)), life: rnd(2.5, 5),
                size: [r * 0.3, r * rnd(0.8, 1.4)], colorFn: t => { const s = 0.12 + t * 0.25; return [s, s * 0.97, s * 0.94]; },
                alpha: t => (t < 0.1 ? t * 8 : 0.8) * (1 - t), drag: 1.8
            });
        }
        // Ground dust ring.
        for (let i = 0; i < 20; i++) {
            const a = (i / 20) * Math.PI * 2;
            alpha.spawn({
                pos: pos.clone().add(V(0, 0.3, 0)), vel: V(Math.cos(a), 0.1, Math.sin(a)).multiplyScalar(rnd(r * 1.2, r * 2)),
                life: rnd(1.2, 2.2), size: [0.5, r * 0.7], color: [0.55, 0.5, 0.42], alpha: [0.6, 0], drag: 2.5
            });
        }
        // Sparks and debris.
        for (let i = 0; i < 45; i++) {
            const d = randDir(); d.y = Math.abs(d.y) + 0.3;
            add.spawn({
                pos: pos.clone().add(V(0, 0.4, 0)), vel: d.normalize().multiplyScalar(rnd(6, 18)), life: rnd(0.5, 1.4),
                size: [0.09, 0.03], color: [5, 2.6, 0.8], alpha: [1, 0], gravity: 9.8, drag: 0.6, floor: GROUND_Y + 0.02
            });
        }
        for (let i = 0; i < 18; i++) {
            const d = randDir(); d.y = Math.abs(d.y) + 0.5;
            alpha.spawn({
                pos: pos.clone().add(V(0, 0.3, 0)), vel: d.normalize().multiplyScalar(rnd(4, 11)), life: rnd(0.8, 1.6),
                size: [0.12, 0.1], color: [0.12, 0.1, 0.08], alpha: [1, 0.6], gravity: 9.8, floor: GROUND_Y + 0.02, frame: 0
            });
        }
        // Shockwave and scorch mark.
        const ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), ringMat.clone());
        ring.rotation.x = -Math.PI / 2;
        ring.position.copy(pos).setY(GROUND_Y + 0.15);
        scene.add(ring);
        rings.push({ m: ring, t: 0, r });

        const sc = new THREE.Mesh(new THREE.PlaneGeometry(r * 1.3, r * 1.3), scorchMat.clone());
        sc.rotation.set(-Math.PI / 2, 0, Math.random() * 6);
        sc.position.copy(pos).setY(GROUND_Y + 0.04);
        scene.add(sc);
        decals.push({ m: sc, born: performance.now() });
        if (decals.length > 25) { const old = decals.shift(); scene.remove(old.m); old.m.material.dispose(); old.m.geometry.dispose(); }
    }

    // Keep a smoke grenade cloud thick: emit puffs while it exists.
    const smokeEmit = new Map();
    function smokeCloud(id, s, dt) {
        const radius = s.radius || 8;
        let acc = (smokeEmit.get(id) || 0) + dt * (QUALITY_LOW ? 6 : 10);
        while (acc >= 1) {
            acc -= 1;
            const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * radius * 0.75;
            const shade = rnd(0.72, 0.9);
            alpha.spawn({
                pos: V(s.position.x + Math.cos(a) * d, (s.position.y ?? GROUND_Y) + rnd(0.3, radius * 0.55), s.position.z + Math.sin(a) * d),
                vel: V(rnd(-0.3, 0.3), rnd(0.05, 0.35), rnd(-0.3, 0.3)), life: rnd(5, 7),
                size: [radius * 0.5, radius * rnd(0.9, 1.3)], color: [shade, shade, shade * 1.02],
                alpha: t => Math.min(1, t * 5) * (1 - t * t) * 0.92, spin: rnd(-0.1, 0.1)
            });
        }
        smokeEmit.set(id, acc);
    }
    function smokeGone(id) { smokeEmit.delete(id); }

    function footDust(pos, run) {
        alpha.spawn({
            pos: V(pos.x + rnd(-0.1, 0.1), GROUND_Y + 0.08, pos.z + rnd(-0.1, 0.1)), vel: V(rnd(-0.3, 0.3), rnd(0.2, 0.5), rnd(-0.3, 0.3)),
            life: rnd(0.6, 1), size: [0.1, 0.45 + run * 0.3], color: [0.6, 0.55, 0.45], alpha: [0.25 + run * 0.15, 0], drag: 2
        });
    }

    function landingDust(pos) {
        for (let i = 0; i < 24; i++) {
            const a = (i / 24) * Math.PI * 2;
            alpha.spawn({
                pos: V(pos.x, GROUND_Y + 0.15, pos.z), vel: V(Math.cos(a) * rnd(2, 4), rnd(0.2, 0.8), Math.sin(a) * rnd(2, 4)),
                life: rnd(0.9, 1.6), size: [0.3, 1.6], color: [0.58, 0.53, 0.44], alpha: [0.5, 0], drag: 2.5
            });
        }
    }

    // Wind streaks while free-falling.
    function fallStreaks(camPos, dir) {
        for (let i = 0; i < 2; i++) {
            add.spawn({
                pos: camPos.clone().add(V(rnd(-6, 6), rnd(-10, -4), rnd(-6, 6))), vel: V(0, rnd(30, 50), 0),
                life: 0.35, size: [0.08, 0.05], color: [0.6, 0.65, 0.7], alpha: [0.5, 0], frame: 0
            });
        }
    }

    // Burning fuse on a thrown frag.
    function fuse(pos) {
        add.spawn({
            pos: pos.clone().add(V(0, 0.15, 0)), vel: V(rnd(-0.5, 0.5), rnd(0.5, 1.5), rnd(-0.5, 0.5)),
            life: rnd(0.15, 0.3), size: [0.05, 0.02], color: [5, 2.5, 0.8], alpha: [1, 0], gravity: 4
        });
    }

    let QUALITY_LOW = false;

    // ---------------- per frame ----------------

    const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = V(1, 1, 1);
    function update(dt) {
        const now = performance.now();

        for (const L of lights) {
            const left = L.until - now;
            L.light.intensity = left > 0 ? L.peak * Math.pow(left / L.dur, 2) : 0;
        }
        for (const f of flashes) if (f.g.visible && now > f.until) f.g.visible = false;

        for (let i = tracers.length - 1; i >= 0; i--) {
            const tr = tracers[i];
            tr.t += dt * tr.speed;
            const head = Math.min(tr.dist, tr.t);
            const tail = Math.max(0, head - Math.min(14, tr.dist * 0.4));
            if (tail >= tr.dist - 0.01) {
                scene.remove(tr.m);
                tracers.splice(i, 1);
                continue;
            }
            const a = tr.from.clone().lerp(tr.to, tail / tr.dist);
            const b = tr.from.clone().lerp(tr.to, head / tr.dist);
            tr.m.position.copy(a).add(b).multiplyScalar(0.5);
            tr.m.scale.set(1, 1, Math.max(0.01, a.distanceTo(b)));
        }

        let n = 0;
        for (let i = casings.length - 1; i >= 0; i--) {
            const c = casings[i];
            c.age += dt;
            if (c.age > 6) { casings.splice(i, 1); continue; }
            if (c.pos.y > c.floor || c.vel.lengthSq() > 0.01) {
                c.vel.y -= 9.8 * dt;
                c.pos.addScaledVector(c.vel, dt);
                c.rot.addScaledVector(c.spin, dt);
                if (c.pos.y < c.floor) {
                    c.pos.y = c.floor;
                    c.vel.y = -c.vel.y * 0.35;
                    c.vel.x *= 0.5; c.vel.z *= 0.5;
                    c.spin.multiplyScalar(0.5);
                    if (Math.abs(c.vel.y) < 0.3) { c.vel.set(0, 0, 0); c.rot.x = Math.PI / 2; }
                }
            }
            _m.compose(c.pos, _q.setFromEuler(_e.set(c.rot.x, c.rot.y, c.rot.z)), _s);
            casingMesh.setMatrixAt(n++, _m);
        }
        casingMesh.count = n;
        casingMesh.instanceMatrix.needsUpdate = true;

        for (let i = rings.length - 1; i >= 0; i--) {
            const r = rings[i];
            r.t += dt / 0.45;
            if (r.t >= 1) { scene.remove(r.m); r.m.material.dispose(); r.m.geometry.dispose(); rings.splice(i, 1); continue; }
            const s = r.r * 2.6 * Math.sqrt(r.t) * 2;
            r.m.scale.set(s, s, 1);
            r.m.material.opacity = (1 - r.t) * 0.8;
        }

        for (const d of decals) {
            const age = (now - d.born) / 1000;
            d.m.material.opacity = age < 25 ? 1 : Math.max(0, 1 - (age - 25) / 10);
        }

        add.update(dt);
        alpha.update(dt);
        shake = Math.max(0, shake - dt * 2.5);
    }

    return {
        muzzleFlash, tracer, ejectCasing, impact, explosion, smokeCloud, smokeGone,
        footDust, landingDust, fallStreaks, fuse, bulletHole, glooShatter, glooForm, update,
        addShake(v) { shake = Math.max(shake, v); },
        // Raw particle access for scene-specific emitters (menu smoke, dust, sparks).
        spawn(pool, p) { return (pool === "add" ? add : alpha).spawn(p); },
        stats: () => ({ additive: add.list.length, alpha: alpha.list.length, drawnA: add.geo.instanceCount, drawnB: alpha.geo.instanceCount, tracers: tracers.length }),
        get shake() { return shake; },
        setLowQuality(v) { QUALITY_LOW = v; }
    };
}
