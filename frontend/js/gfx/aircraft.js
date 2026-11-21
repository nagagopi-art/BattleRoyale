// ==========================================
// Four-engine turboprop transport (drop aircraft)
// ==========================================
// Nose points +Z. ~30 m long, ~40 m wingspan.

import * as THREE from "three";
import * as T from "./textures.js";

export function createAircraft() {
    const plane = new THREE.Group();
    const skin = T.panels();
    const paint = new THREE.MeshStandardMaterial({
        color: 0x9ea6ab, map: skin.map, normalMap: skin.normalMap, normalScale: new THREE.Vector2(0.4, 0.4),
        metalness: 0.35, roughness: 0.5
    });
    const darkPaint = new THREE.MeshStandardMaterial({ color: 0x5b6267, metalness: 0.3, roughness: 0.6 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x0b1a26, metalness: 1, roughness: 0.04 });
    const black = new THREE.MeshStandardMaterial({ color: 0x151617, metalness: 0.4, roughness: 0.4 });
    const propMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1c, metalness: 0.5, roughness: 0.5 });
    const blur = new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });

    // ---------- fuselage (lathe, then tail upsweep) ----------
    const prof = [];
    const L = 30;
    for (let i = 0; i <= 40; i++) {
        const t = i / 40;                    // 0 tail .. 1 nose
        const z = -L / 2 + t * L;
        let r;
        if (t > 0.86) r = 2.25 * Math.sqrt(1 - Math.pow((t - 0.86) / 0.14, 2)) ;   // rounded nose
        else if (t > 0.3) r = 2.25;
        else r = 0.55 + (2.25 - 0.55) * Math.pow(t / 0.3, 0.8);                      // tail cone
        prof.push(new THREE.Vector2(Math.max(0.01, r), z));
    }
    const fuseGeo = new THREE.LatheGeometry(prof, 36);
    fuseGeo.rotateX(Math.PI / 2);   // lathe axis Y -> Z (profile z stays z)
    {
        const p = fuseGeo.attributes.position;
        for (let i = 0; i < p.count; i++) {
            const z = p.getZ(i), y = p.getY(i);
            // Flatter belly and upswept tail cone.
            let ny = y < 0 ? y * 0.88 : y;
            if (z < -4) ny += (-4 - z) * 0.17;
            p.setY(i, ny);
        }
        fuseGeo.computeVertexNormals();
    }
    const fuselage = new THREE.Mesh(fuseGeo, paint);
    plane.add(fuselage);

    // Cockpit glazing.
    for (let i = -2; i <= 2; i++) {
        const w = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.42, 0.06), glass);
        const a = i * 0.32;
        w.position.set(Math.sin(a) * 1.75, 1.3 - Math.abs(i) * 0.08, 13.15 - Math.abs(i) * 0.25);
        w.rotation.set(-0.75, a, 0);
        plane.add(w);
    }
    // Portholes.
    const porthole = new THREE.CylinderGeometry(0.17, 0.17, 0.08, 12);
    for (let i = 0; i < 9; i++) {
        for (const s of [-1, 1]) {
            const p = new THREE.Mesh(porthole, glass);
            p.rotation.z = Math.PI / 2;
            p.position.set(s * 2.2, 0.55, -3 + i * 1.3);
            plane.add(p);
        }
    }
    // Landing-gear sponsons.
    for (const s of [-1, 1]) {
        const sp = new THREE.Mesh(new THREE.CapsuleGeometry(0.75, 6, 6, 12), paint);
        sp.rotation.x = Math.PI / 2;
        sp.position.set(s * 2.05, -1.35, 0.5);
        plane.add(sp);
    }
    // Rear ramp seam.
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.04, 5), darkPaint);
    ramp.position.set(0, -0.7, -10.5);
    ramp.rotation.x = -0.32;
    plane.add(ramp);

    // ---------- wings ----------
    function wingShape(span, rootChord, tipChord, sweep) {
        const s = new THREE.Shape();
        s.moveTo(0, rootChord * 0.4);
        s.lineTo(span, tipChord * 0.4 - sweep);
        s.quadraticCurveTo(span + 0.6, -sweep, span, -tipChord * 0.6 - sweep);
        s.lineTo(0, -rootChord * 0.6);
        s.closePath();
        return s;
    }
    const extrude = (shape, depth) => {
        const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: depth * 0.4, bevelSize: 0.12, bevelSegments: 3, steps: 1 });
        g.translate(0, 0, -depth / 2);
        return g;
    };

    const wingGeo = extrude(wingShape(18.5, 4.4, 2.4, 0.5), 0.28);
    wingGeo.rotateX(Math.PI / 2);          // shape XY -> XZ, leading edge +Z
    for (const s of [-1, 1]) {
        const w = new THREE.Mesh(wingGeo, paint);
        w.scale.x = s;
        w.position.set(s * 1.4, 2.2, 2.2);
        w.rotation.z = s * -0.035;         // slight anhedral
        plane.add(w);
    }
    // Wing-root fairing on top of the fuselage.
    const fairing = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 4, 6, 12), paint);
    fairing.rotation.x = Math.PI / 2;
    fairing.scale.set(1.6, 1, 0.5);
    fairing.position.set(0, 2.05, 2.0);
    plane.add(fairing);

    // ---------- engines + propellers ----------
    const props = [];
    const nacelleGeo = new THREE.CapsuleGeometry(0.62, 4.2, 6, 16);
    const spinnerGeo = new THREE.ConeGeometry(0.42, 0.9, 16);
    const bladeGeo = new THREE.BoxGeometry(0.22, 2.0, 0.05).translate(0, 1.0, 0);
    for (const x of [-12.2, -6.4, 6.4, 12.2]) {
        const n = new THREE.Mesh(nacelleGeo, paint);
        n.rotation.x = Math.PI / 2;
        n.position.set(x, 1.55, 3.6);
        plane.add(n);
        const intake = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 1.2), black);
        intake.position.set(x, 0.95, 5.2);
        plane.add(intake);

        const hub = new THREE.Group();
        hub.position.set(x, 1.55, 6.35);
        const spinner = new THREE.Mesh(spinnerGeo, black);
        spinner.rotation.x = Math.PI / 2;
        spinner.position.z = 0.4;
        hub.add(spinner);
        const blades = new THREE.Group();
        for (let b = 0; b < 6; b++) {
            const blade = new THREE.Mesh(bladeGeo, propMat);
            blade.rotation.z = (b / 6) * Math.PI * 2;
            blade.rotation.y = 0.35;
            blades.add(blade);
        }
        hub.add(blades);
        const disc = new THREE.Mesh(new THREE.CircleGeometry(2.05, 32), blur);
        disc.position.z = 0.02;
        hub.add(disc);
        plane.add(hub);
        props.push(blades);
    }

    // ---------- tail ----------
    const fin = new THREE.Shape();
    fin.moveTo(0, 0);
    fin.lineTo(-5.2, 0);
    fin.lineTo(-6.6, 6.4);
    fin.lineTo(-4.6, 6.6);
    fin.lineTo(-1.6, 0.4);
    fin.closePath();
    const finGeo = extrude(fin, 0.26);
    finGeo.rotateY(-Math.PI / 2);
    const finMesh = new THREE.Mesh(finGeo, paint);
    finMesh.position.set(0, 2.5, -8.8);
    plane.add(finMesh);

    const stabGeo = extrude(wingShape(6.8, 3.2, 1.6, 1.0), 0.2);
    stabGeo.rotateX(Math.PI / 2);
    for (const s of [-1, 1]) {
        const st = new THREE.Mesh(stabGeo, paint);
        st.scale.x = s;
        st.position.set(s * 0.5, 2.4, -12.4);
        plane.add(st);
    }

    // ---------- lights ----------
    const lamp = (hex, strength, x, y, z) => {
        const c = new THREE.Color(hex).multiplyScalar(strength);
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: c, toneMapped: false }));
        m.position.set(x, y, z);
        plane.add(m);
        return m;
    };
    lamp(0xff2a1a, 6, 19.9, 1.45, 1.9);      // port (left) wing tip: red
    lamp(0x22ff55, 6, -19.9, 1.45, 1.9);     // starboard: green
    const tailStrobe = lamp(0xffffff, 10, 0, 3.3, -15.3);
    const beacon = lamp(0xff3322, 8, 0, 2.55, -1.5);
    const belly = lamp(0xff3322, 8, 0, -1.95, 1.0);

    plane.traverse(o => { if (o.isMesh && o.material !== blur) { o.castShadow = true; o.receiveShadow = true; } });

    plane.userData.update = (dt, t) => {
        for (const p of props) p.rotation.z += dt * 32;
        tailStrobe.visible = (t % 1.2) < 0.06;
        const on = (t % 1.0) < 0.12;
        beacon.visible = on;
        belly.visible = !on && (t % 1.0) < 0.24;
        // Gentle turbulence.
        plane.rotation.z = Math.sin(t * 0.6) * 0.012;
    };

    return plane;
}
