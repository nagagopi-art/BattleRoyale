// ==========================================
// Indian national flag on a pole, waving in the wind
// ==========================================
// Saffron, white and India green with the navy Ashoka Chakra
// (24 spokes), 3:2 proportion. Cloth motion is a vertex wave
// pinned at the hoist (pole) side.

import * as THREE from "three";
import { timeUniform } from "./materials.js";

function flagTexture() {
    const W = 600, H = 400;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    g.fillStyle = "#FF9933"; g.fillRect(0, 0, W, H / 3);
    g.fillStyle = "#FFFFFF"; g.fillRect(0, H / 3, W, H / 3);
    g.fillStyle = "#138808"; g.fillRect(0, (2 * H) / 3, W, H / 3);

    // Ashoka Chakra: diameter about 3/4 of the white band.
    const cx = W / 2, cy = H / 2, R = (H / 3) * 0.42;
    g.strokeStyle = g.fillStyle = "#000080";
    g.lineWidth = R * 0.09;
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(cx, cy, R * 0.16, 0, Math.PI * 2); g.fill();
    g.lineWidth = R * 0.035;
    for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * R * 0.16, cy + Math.sin(a) * R * 0.16);
        g.lineTo(cx + Math.cos(a) * R * 0.95, cy + Math.sin(a) * R * 0.95);
        g.stroke();
        // Small semicircles between spokes on the rim.
        const b = a + Math.PI / 24;
        g.beginPath(); g.arc(cx + Math.cos(b) * R * 0.92, cy + Math.sin(b) * R * 0.92, R * 0.035, 0, Math.PI * 2); g.fill();
    }
    // Subtle cloth weave.
    const img = g.getImageData(0, 0, W, H);
    for (let i = 0; i < img.data.length; i += 4) {
        const k = 0.93 + Math.random() * 0.07;
        img.data[i] *= k; img.data[i + 1] *= k; img.data[i + 2] *= k;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
}

export function createFlag({ poleHeight = 11, width = 3.6 } = {}) {
    const group = new THREE.Group();
    const height = width * (2 / 3);

    const metal = new THREE.MeshStandardMaterial({ color: 0xd8dade, metalness: 0.9, roughness: 0.25 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, poleHeight, 12), metal);
    pole.position.y = poleHeight / 2;
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), new THREE.MeshStandardMaterial({ color: 0xd9b34a, metalness: 1, roughness: 0.25 }));
    finial.position.y = poleHeight + 0.1;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.4, 16), new THREE.MeshStandardMaterial({ color: 0x9a968e, roughness: 0.9 }));
    base.position.y = 0.2;
    group.add(pole, finial, base);

    const geo = new THREE.PlaneGeometry(width, height, 36, 18).translate(width / 2, 0, 0);
    const mat = new THREE.MeshStandardMaterial({ map: flagTexture(), side: THREE.DoubleSide, roughness: 0.85 });
    mat.onBeforeCompile = shader => {
        shader.uniforms.gfxTime = timeUniform;
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nuniform float gfxTime;")
            .replace("#include <beginnormal_vertex>", `
                float fx = position.x / ${width.toFixed(2)};
                float ph = position.x * 1.7 - gfxTime * 5.0;
                float amp = 0.32 * fx;
                // Analytic normal of the wave for correct shading.
                float dzdx = amp * 1.7 * cos(ph) + 0.32 / ${width.toFixed(2)} * sin(ph);
                vec3 objectNormal = normalize(vec3(-dzdx, 0.0, 1.0));
                #ifdef USE_TANGENT
                    vec3 objectTangent = vec3( tangent.xyz );
                #endif`)
            .replace("#include <begin_vertex>", `#include <begin_vertex>
                transformed.z += sin(ph) * amp + sin(position.y * 2.2 - gfxTime * 3.1) * 0.06 * fx;
                transformed.y -= fx * fx * 0.25;              // slight droop at the fly end
                transformed.x -= fx * 0.04 * (1.0 + sin(ph));`);
    };
    mat.customProgramCacheKey = () => "flag";
    const cloth = new THREE.Mesh(geo, mat);
    cloth.position.set(0.08, poleHeight - height / 2 - 0.15, 0);
    cloth.castShadow = true;
    group.add(cloth);

    group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return group;
}
