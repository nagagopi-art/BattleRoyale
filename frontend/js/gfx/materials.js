// ==========================================
// Material shader patches
// ==========================================
// worldMapped: textures follow world space, so a stretched
//   box (a 20 m wall) keeps bricks/tiles at real-world size.
// windSway:    grass and leaves move in the wind.

import * as THREE from "three";

// Shared time uniform for every animated material.
export const timeUniform = { value: 0 };

const WORLD_VERTEX = /* glsl */`
    vec4 gfxWorld = vec4( transformed, 1.0 );
    #ifdef USE_INSTANCING
        gfxWorld = instanceMatrix * gfxWorld;
    #endif
    gfxWorld = modelMatrix * gfxWorld;
    vec3 gfxN = objectNormal;
    #ifdef USE_INSTANCING
        gfxN = mat3( instanceMatrix ) * gfxN;
    #endif
    gfxN = normalize( mat3( modelMatrix ) * gfxN );
    vGfxWorld = gfxWorld.xyz;
    vec2 gfxUv = abs( gfxN.y ) > 0.6 ? gfxWorld.xz
        : ( abs( gfxN.x ) > 0.6 ? vec2( gfxWorld.z * sign( gfxN.x ), gfxWorld.y )
                                : vec2( -gfxWorld.x * sign( gfxN.z ), gfxWorld.y ) );
    gfxUv *= gfxUvScale;
    #ifdef USE_MAP
        vMapUv = gfxUv;
    #endif
    #ifdef USE_NORMALMAP
        vNormalMapUv = gfxUv;
    #endif
    #ifdef USE_ROUGHNESSMAP
        vRoughnessMapUv = gfxUv;
    #endif
`;

const GROUND_FRAGMENT = /* glsl */`
    vec4 gfxM = texture2D( gfxMacro, vGfxWorld.xz / 900.0 );
    vec4 gfxM2 = texture2D( gfxMacro, vGfxWorld.xz / 130.0 + 0.37 );
    vec3 gfxG1 = texture2D( map, vMapUv ).rgb;
    vec3 gfxG2 = texture2D( map, vMapUv * 0.23 + 0.11 ).rgb;
    vec3 gfxGrass = mix( gfxG1, gfxG2, 0.35 + gfxM2.b * 0.4 );
    vec3 gfxDirtC = texture2D( gfxDirt, vGfxWorld.xz / 3.5 ).rgb;
    float gfxDirtAmt = smoothstep( 0.6, 0.74, gfxM.r * 0.65 + gfxM2.g * 0.35 );
    vec3 gfxCol = mix( gfxGrass, gfxDirtC, gfxDirtAmt );
    gfxCol *= 0.82 + gfxM.g * 0.36;
    gfxCol = mix( gfxCol, gfxCol * vec3( 1.15, 1.04, 0.78 ), smoothstep( 0.45, 0.75, gfxM2.r ) * ( 1.0 - gfxDirtAmt ) );
    diffuseColor.rgb *= gfxCol;
`;

// options: { uvScale, grime, ground: { dirt, macro } }
export function worldMapped(material, { uvScale = 0.5, grime = false, ground = null } = {}) {
    material.onBeforeCompile = shader => {
        shader.uniforms.gfxUvScale = { value: uvScale };
        shader.uniforms.gfxGroundY = { value: typeof GROUND_Y === "number" ? GROUND_Y : 0 };
        if (ground) {
            shader.uniforms.gfxDirt = { value: ground.dirt };
            shader.uniforms.gfxMacro = { value: ground.macro };
        }

        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nvarying vec3 vGfxWorld;\nuniform float gfxUvScale;")
            .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\n" + WORLD_VERTEX);

        let frag = shader.fragmentShader
            .replace("#include <common>",
                "#include <common>\nvarying vec3 vGfxWorld;\nuniform float gfxGroundY;\n" +
                (ground ? "uniform sampler2D gfxDirt;\nuniform sampler2D gfxMacro;\n" : ""));

        if (ground) {
            frag = frag.replace("#include <map_fragment>", GROUND_FRAGMENT);
        } else if (grime) {
            // Darker, dirtier band near the ground, like real walls.
            frag = frag.replace("#include <map_fragment>", `#include <map_fragment>
                float gfxBase = smoothstep( gfxGroundY, gfxGroundY + 1.6, vGfxWorld.y );
                diffuseColor.rgb *= mix( 0.55, 1.0, gfxBase );`);
        }
        shader.fragmentShader = frag;
    };
    material.customProgramCacheKey = () => `world:${grime ? 1 : 0}:${ground ? 1 : 0}`;
    return material;
}

// Bend vertices sideways by height (local y / height). Works for
// instanced grass/foliage: each instance gets its own phase.
export function windSway(material, { height = 1, strength = 0.15, speed = 1.6 } = {}) {
    material.onBeforeCompile = shader => {
        shader.uniforms.gfxTime = timeUniform;
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nuniform float gfxTime;")
            .replace("#include <begin_vertex>", `#include <begin_vertex>
                float gfxH = clamp( position.y / ${height.toFixed(3)}, 0.0, 1.0 );
                vec3 gfxO = vec3( 0.0 );
                #ifdef USE_INSTANCING
                    gfxO = ( instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
                #endif
                float gfxPh = gfxTime * ${speed.toFixed(3)} + gfxO.x * 0.21 + gfxO.z * 0.17;
                float gfxSway = sin( gfxPh ) * 0.7 + sin( gfxPh * 2.7 + 1.3 ) * 0.3;
                float gfxK = gfxH * gfxH * ${strength.toFixed(3)};
                transformed.x += gfxSway * gfxK;
                transformed.z += cos( gfxPh * 0.83 ) * gfxK * 0.6;`);
    };
    material.customProgramCacheKey = () => `wind:${height}:${strength}:${speed}`;
    return material;
}
