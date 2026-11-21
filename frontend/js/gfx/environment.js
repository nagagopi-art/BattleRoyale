// ==========================================
// Renderer, sky, sun, haze, clouds, mountains, post-processing
// ==========================================

import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { fbm, noise3, seeded } from "./noise.js";
import * as T from "./textures.js";
import { worldMapped } from "./materials.js";

// ---------------- quality ----------------
// ?gfx=low|high overrides; phones/tablets default to low.

export const QUALITY = (() => {
    const param = new URLSearchParams(location.search).get("gfx");
    const touch = matchMedia?.("(pointer: coarse)").matches;
    const low = param ? param === "low" : touch;
    return low
        ? { name: "low", pixelRatio: 1, shadowMap: 1024, bloom: false, msaa: 0, grass: 3500, grassRadius: 32, trees: 600, bushes: 500, clouds: 30 }
        : { name: "high", pixelRatio: Math.min(window.devicePixelRatio, 2), shadowMap: 4096, bloom: true, msaa: 4, grass: 16000, grassRadius: 55, trees: 1400, bushes: 1400, clouds: 60 };
})();

export const HAZE = new THREE.Color(0xb8c8d6);

// Sun direction (elevation 38°, from the south-east).
export const SUN_DIR = new THREE.Vector3().setFromSphericalCoords(
    1, THREE.MathUtils.degToRad(90 - 38), THREE.MathUtils.degToRad(140)
);

export function createRenderer(canvas) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: !QUALITY.bloom, powerPreference: "high-performance" });
    renderer.setPixelRatio(QUALITY.pixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.75;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    return renderer;
}

// ---------------- sky + lights ----------------

// opts: { sunDir, sunColor, sunIntensity, turbidity } (menu scene uses a low golden sun).
export function createSky(scene, renderer, opts = {}) {
    const sunDir = opts.sunDir || SUN_DIR;
    const turbidity = opts.turbidity ?? 3;
    const sky = new Sky();
    sky.scale.setScalar(9000);
    const u = sky.material.uniforms;
    u.turbidity.value = turbidity;
    u.rayleigh.value = 2;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    u.sunPosition.value.copy(sunDir);
    scene.add(sky);

    // Image-based lighting from the same sky, so metal, glass
    // and paint reflect the real surroundings.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envSky = new Sky();
    envSky.scale.setScalar(100);
    envSky.material.uniforms.turbidity.value = turbidity;
    envSky.material.uniforms.rayleigh.value = 2;
    envSky.material.uniforms.mieCoefficient.value = 0.004;
    envSky.material.uniforms.mieDirectionalG.value = 0.82;
    envSky.material.uniforms.sunPosition.value.copy(sunDir);
    envScene.add(envSky);
    // A dark green "ground" half so lower reflections are not sky blue.
    const floor = new THREE.Mesh(
        new THREE.SphereGeometry(50, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x3a4a2c, side: THREE.BackSide })
    );
    envScene.add(floor);
    scene.environment = pmrem.fromScene(envScene, 0.02).texture;
    scene.environmentIntensity = 0.9;   // used from r163+, harmless before
    pmrem.dispose();

    scene.fog = new THREE.FogExp2(HAZE, 0.0002);

    const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x4d5a3a, 0.55);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(opts.sunColor ?? 0xfff0d8, opts.sunIntensity ?? 3.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(QUALITY.shadowMap, QUALITY.shadowMap);
    const s = QUALITY.name === "high" ? 70 : 50;
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 600 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);

    return { sky, sun, hemi };
}

// Keep the shadow area centred on what the camera looks at.
export function followSun(sun, point) {
    sun.position.copy(point).addScaledVector(SUN_DIR, 300);
    sun.target.position.copy(point);
}

// ---------------- ground ----------------

export function createGround(scene) {
    const grass = T.grass();
    const mat = worldMapped(new THREE.MeshStandardMaterial({
        map: grass.map,
        normalMap: grass.normalMap,
        normalScale: new THREE.Vector2(0.8, 0.8),
        roughness: 0.95,
        metalness: 0,
        envMapIntensity: 0.4
    }), { uvScale: 1 / 4, ground: { dirt: T.dirt().map, macro: T.macro() } });

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000, 1, 1), mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = GROUND_Y;
    ground.receiveShadow = true;
    scene.add(ground);
    return ground;
}

// ---------------- distant mountains ----------------

export function createMountains(scene) {
    const SEG_A = 320, SEG_R = 48;
    const R0 = 1500, R1 = 5200;
    const pos = [], col = [], idx = [];
    const c = new THREE.Color();

    for (let j = 0; j <= SEG_R; j++) {
        const t = j / SEG_R;
        const r = R0 + (R1 - R0) * Math.pow(t, 1.4);
        for (let i = 0; i <= SEG_A; i++) {
            const a = (i / SEG_A) * Math.PI * 2;
            const x = Math.cos(a) * r, z = Math.sin(a) * r;
            // Ridged noise, rising away from the play area.
            const ridge = 1 - Math.abs(fbm(i / SEG_A, t * 0.6, { base: 6, octaves: 6, seed: 501 }) * 2 - 1);
            const big = fbm(i / SEG_A, 0.3, { base: 3, octaves: 3, seed: 502 });
            const rise = THREE.MathUtils.smoothstep(t, 0.0, 0.55);
            const h = (Math.pow(ridge, 2.2) * 420 + big * 220) * rise + noise3(x / 90, 0, z / 90, 7) * 25 * rise;
            pos.push(x, GROUND_Y - 2 + h, z);

            // Grass low, forest mid, bare rock high, snow on peaks.
            const n = noise3(x / 60, h / 40, z / 60, 3);
            if (h > 480 + n * 60) c.setRGB(0.92, 0.94, 0.97);
            else if (h > 300 + n * 80) c.setRGB(0.36 + n * 0.08, 0.34 + n * 0.07, 0.31 + n * 0.06);
            else if (h > 90) c.setRGB(0.13 + n * 0.05, 0.2 + n * 0.06, 0.1);
            else c.setRGB(0.28 + n * 0.05, 0.36 + n * 0.05, 0.17);
            col.push(c.r, c.g, c.b);
        }
    }
    const row = SEG_A + 1;
    for (let j = 0; j < SEG_R; j++) {
        for (let i = 0; i < SEG_A; i++) {
            const a = j * row + i, b = a + 1, d = a + row, e = d + 1;
            idx.push(a, d, b, b, d, e);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();

    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, envMapIntensity: 0.3 }));
    scene.add(mesh);
    return mesh;
}

// ---------------- clouds ----------------

export function createClouds(scene) {
    const group = new THREE.Group();
    const tex = T.smokePuff();
    const rand = seeded(9090);
    const mats = [0.95, 0.88, 0.8].map(s => new THREE.SpriteMaterial({
        map: tex, color: new THREE.Color(s, s, s * 1.02), transparent: true,
        opacity: 0.85, depthWrite: false, fog: true
    }));

    for (let i = 0; i < QUALITY.clouds; i++) {
        const cx = (rand() * 2 - 1) * 3500, cz = (rand() * 2 - 1) * 3500;
        const cy = 750 + rand() * 650;
        const puffs = 5 + Math.floor(rand() * 6);
        const w = 120 + rand() * 220;
        for (let k = 0; k < puffs; k++) {
            const sp = new THREE.Sprite(mats[k < 2 ? 2 : Math.floor(rand() * 2)]);
            const s = w * (0.5 + rand() * 0.6);
            sp.scale.set(s * 1.5, s * 0.8, 1);
            sp.position.set(cx + (rand() - 0.5) * w * 1.6, cy + (rand() - 0.3) * w * 0.3, cz + (rand() - 0.5) * w);
            group.add(sp);
        }
    }
    scene.add(group);
    return group;
}

// ---------------- post-processing ----------------

const VignetteShader = {
    uniforms: { tDiffuse: { value: null }, strength: { value: 0.32 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
        uniform sampler2D tDiffuse; uniform float strength; varying vec2 vUv;
        void main(){
            vec4 c = texture2D(tDiffuse, vUv);
            vec2 d = vUv - 0.5;
            float v = smoothstep(0.85, 0.2, length(d * vec2(1.1, 1.0)));
            c.rgb *= mix(1.0 - strength, 1.0, v);
            gl_FragColor = c;
        }`
};

export function createPost(renderer, scene, camera) {
    if (!QUALITY.bloom) {
        // Low quality: draw straight to screen (tone mapping in the renderer).
        return {
            render: () => renderer.render(scene, camera),
            setSize: () => {}
        };
    }

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
        type: THREE.HalfFloatType,
        samples: QUALITY.msaa
    });
    const composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.35, 0.5, 0.92);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    const vignette = new ShaderPass(VignetteShader);
    composer.addPass(vignette);

    return {
        render: () => composer.render(),
        setSize: (w, h) => {
            composer.setPixelRatio(renderer.getPixelRatio());
            composer.setSize(w, h);
        }
    };
}
