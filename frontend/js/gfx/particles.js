// ==========================================
// Particle system (camera-facing instanced quads)
// ==========================================
// Two pools: additive (fire, flashes, sparks) and alpha
// (smoke, dust, blood). Simulated on the CPU, drawn in one
// call per pool.

import * as THREE from "three";

const VERT = /* glsl */`
    attribute vec3 iPos;
    attribute vec4 iColor;
    attribute vec3 iMisc;      // size, rotation, texture frame (0 = sheet 0, 1 = sheet 1)
    varying vec2 vUv;
    varying vec4 vColor;
    varying float vFrame;
    #include <fog_pars_vertex>
    void main() {
        vec4 mvPosition = modelViewMatrix * vec4( iPos, 1.0 );
        float c = cos( iMisc.y ), s = sin( iMisc.y );
        vec2 p = mat2( c, -s, s, c ) * position.xy * iMisc.x;
        mvPosition.xy += p;
        gl_Position = projectionMatrix * mvPosition;
        vUv = uv;
        vColor = iColor;
        vFrame = iMisc.z;
        #include <fog_vertex>
    }
`;

const FRAG = /* glsl */`
    uniform sampler2D map0;
    uniform sampler2D map1;
    varying vec2 vUv;
    varying vec4 vColor;
    varying float vFrame;
    #include <fog_pars_fragment>
    void main() {
        vec4 t = vFrame < 0.5 ? texture2D( map0, vUv ) : texture2D( map1, vUv );
        gl_FragColor = vec4( t.rgb * vColor.rgb, t.a * vColor.a );
        if ( gl_FragColor.a < 0.003 ) discard;
        #include <fog_fragment>
    }
`;

export class ParticlePool {
    constructor(scene, { max = 2000, additive = false, maps }) {
        this.max = max;
        this.list = [];
        const geo = new THREE.InstancedBufferGeometry();
        const quad = new THREE.PlaneGeometry(1, 1);
        geo.index = quad.index;
        geo.attributes.position = quad.attributes.position;
        geo.attributes.uv = quad.attributes.uv;
        this.pos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
        this.col = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
        this.misc = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute("iPos", this.pos);
        geo.setAttribute("iColor", this.col);
        geo.setAttribute("iMisc", this.misc);
        geo.instanceCount = 0;

        const mat = new THREE.ShaderMaterial({
            uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map0: { value: null }, map1: { value: null } }]),
            vertexShader: VERT,
            fragmentShader: FRAG,
            transparent: true,
            depthWrite: false,
            fog: true,
            blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
        });
        mat.uniforms.map0.value = maps[0];
        mat.uniforms.map1.value = maps[1] || maps[0];
        // Additive particles are HDR-bright so bloom picks them up.
        if (additive) mat.toneMapped = false;

        this.mesh = new THREE.Mesh(geo, mat);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = additive ? 6 : 5;
        this.geo = geo;
        scene.add(this.mesh);
    }

    // p: { pos:Vector3, vel:Vector3, life, size:[a,b], color:[r,g,b],
    //      alpha:[a,b] | fn, drag, gravity, spin, frame, rise }
    spawn(p) {
        if (this.list.length >= this.max) this.list.shift();
        p.age = 0;
        p.rot = p.rot ?? Math.random() * Math.PI * 2;
        p.spin = p.spin ?? (Math.random() - 0.5) * 0.6;
        p.drag = p.drag ?? 0;
        p.gravity = p.gravity ?? 0;
        p.frame = p.frame ?? 0;
        p.vel = p.vel || new THREE.Vector3();
        this.list.push(p);
        return p;
    }

    update(dt) {
        const L = this.list;
        let n = 0;
        for (let i = 0; i < L.length; i++) {
            const p = L[i];
            p.age += dt;
            if (p.age >= p.life) continue;
            const t = p.age / p.life;
            if (p.drag) p.vel.multiplyScalar(Math.exp(-p.drag * dt));
            p.vel.y -= p.gravity * dt;
            p.pos.addScaledVector(p.vel, dt);
            if (p.floor !== undefined && p.pos.y < p.floor) { p.pos.y = p.floor; p.vel.y *= -0.3; p.vel.x *= 0.6; p.vel.z *= 0.6; }
            p.rot += p.spin * dt;

            const size = p.size[0] + (p.size[1] - p.size[0]) * (p.sizeEase ? p.sizeEase(t) : Math.sqrt(t));
            const a = typeof p.alpha === "function" ? p.alpha(t) : p.alpha[0] + (p.alpha[1] - p.alpha[0]) * t;
            const c = p.colorFn ? p.colorFn(t) : p.color;

            this.pos.setXYZ(n, p.pos.x, p.pos.y, p.pos.z);
            this.col.setXYZW(n, c[0], c[1], c[2], Math.max(0, a));
            this.misc.setXYZ(n, size, p.rot, p.frame);
            L[n] = p;
            n++;
        }
        L.length = n;
        this.geo.instanceCount = n;
        this.pos.needsUpdate = this.col.needsUpdate = this.misc.needsUpdate = true;
    }
}
