// Shared uniforms + shader patching for three's built-in materials:
// world-space wind, height fog with sun in-scatter, wetness, translucency, local glow lights, lightning.
import * as THREE from 'three';
import { TEX } from './textures.js';

export const MAX_GLOW = 16;
export const SH = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector3(0.8, 0.6, 1.0) },
  uGust: { value: 0.5 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },   // direction TO the key light
  uSunCol: { value: new THREE.Color(1, 1, 1) },
  uTrueSun: { value: new THREE.Vector3(0, 1, 0) },
  uFogCol: { value: new THREE.Color(0.6, 0.7, 0.8) },
  uFogSun: { value: new THREE.Color(0.3, 0.25, 0.2) },
  uFogP: { value: new THREE.Vector4(0.0018, 0.012, 0, 8) },
  uWet: { value: 0 },
  uRain: { value: 0 },
  uFlash: { value: 0 },
  uFlashCol: { value: new THREE.Color(0.75, 0.8, 1.0) },
  uGlowP: { value: Array.from({ length: MAX_GLOW }, () => new THREE.Vector4(0, -999, 0, 1)) },
  uGlowC: { value: Array.from({ length: MAX_GLOW }, () => new THREE.Vector4(0, 0, 0, 0)) },
  uGlowN: { value: 0 },
  uNight: { value: 0 },
  uLamp: { value: 0 },
  tNoise: { value: null },
};

export const GLSL_COMMON = /* glsl */`
uniform float uTime; uniform vec3 uWind; uniform float uGust;
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uTrueSun;
uniform vec3 uFogCol; uniform vec3 uFogSun; uniform vec4 uFogP;
uniform float uWet; uniform float uRain; uniform float uFlash; uniform vec3 uFlashCol; uniform float uNight; uniform float uLamp;
uniform vec4 uGlowP[${MAX_GLOW}]; uniform vec4 uGlowC[${MAX_GLOW}]; uniform int uGlowN;
vec3 applyFog(vec3 col, vec3 wp){
  vec3 v = wp - cameraPosition; float dist = length(v); vec3 dir = v/max(dist,1e-3);
  float fall = uFogP.y; float h0 = cameraPosition.y - uFogP.z; float k = fall*v.y;
  float integ = abs(k) > 1e-4 ? (1.0-exp(-k))/k : 1.0;
  float amt = uFogP.x * exp(-fall*h0) * integ * dist;
  float f = 1.0 - exp(-max(amt,0.0));
  float sun = pow(max(dot(dir, uTrueSun), 0.0), uFogP.w);
  return mix(col, uFogCol + uFogSun*sun, clamp(f,0.0,1.0));
}
vec3 glowLight(vec3 wp, vec3 n){
  vec3 acc = vec3(0.);
  for(int i=0;i<${MAX_GLOW};i++){
    if(i>=uGlowN) break;
    vec3 L = uGlowP[i].xyz - wp; float d2 = dot(L,L); float r = uGlowP[i].w;
    float fall = clamp(1.0 - d2/(r*r), 0.0, 1.0); fall*=fall;
    float att = fall / (1.0 + d2*0.6);
    float ndl = max(dot(n, L*inversesqrt(max(d2,1e-4))), 0.0)*0.8 + 0.2;
    acc += uGlowC[i].rgb * att * ndl;
  }
  return acc;
}
`;
export const GLSL_WIND = /* glsl */`
uniform float uWindAmp;
vec3 windOffset(vec3 wp, float w, float flex){
  vec2 dir = uWind.xy; float str = uWind.z;
  float ph = dot(wp.xz, vec2(0.071, 0.053));
  float front = 0.5 + 0.5*sin(uTime*0.6 - dot(wp.xz, dir)*0.05);
  float front2 = 0.5 + 0.5*sin(uTime*0.23 - dot(wp.xz, dir)*0.018 + 1.7);
  float g = str * (0.35 + 1.1*front*front2*uGust + 0.25*front);
  float sway = sin(uTime*1.35 + ph)*0.4 + sin(uTime*2.3 + ph*1.9)*0.2;
  float fl = sin(uTime*8.0 + wp.x*1.9 + wp.y*2.7 + wp.z*1.3);
  vec3 off = vec3(0.);
  off.xz = dir*(g*(0.75 + sway))*w + vec2(-dir.y, dir.x)*sway*0.35*g*w;
  off.y = -0.18*g*w*w*0.3;
  off += vec3(fl*0.6, fl*0.5, fl*0.55) * g * 0.07 * flex;
  return off;
}
`;

const INST = `
#ifdef USE_INSTANCING
  mm = modelMatrix * instanceMatrix;
#endif
`;

// o: { wind, transl, wet, glow, fog, terrain, rock, caustic, uniforms, defines, frag:{}, vert:{} }
export function patch(mat, o = {}) {
  const key = Object.keys(o).sort().map((k) => k + ':' + (typeof o[k] === 'object' ? (o[k] && o[k].key) || 'o' : o[k])).join('|') + '|' + (o.key || '');
  mat.customProgramCacheKey = () => key;
  const localU = {};
  if (o.wind) localU.uWindAmp = { value: o.windAmp ?? 1 };
  if (o.transl) localU.uTransl = { value: o.transl.isColor ? o.transl : new THREE.Color(o.transl) };
  mat.userData.u = localU;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, SH, localU, o.uniforms || {});
    let v = sh.vertexShader, f = sh.fragmentShader;
    v = v.replace('#include <common>', '#include <common>\n' + GLSL_COMMON + (o.wind ? GLSL_WIND + '\nattribute vec2 aWind;\n' : '') + '\nvarying vec3 vWP;\nvarying vec3 vWN;\n' + (o.vertHead || ''));
    if (o.wind) {
      v = v.replace('#include <begin_vertex>', `#include <begin_vertex>
      { mat4 mm = modelMatrix; ${INST}
        vec3 wp0 = (mm*vec4(transformed,1.0)).xyz;
        vec3 off = windOffset(wp0, aWind.x*uWindAmp, aWind.y);
        transformed += inverse(mat3(mm))*off; }`);
    }
    if (o.vertBegin) v = v.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + o.vertBegin);
    v = v.replace('#include <fog_vertex>', `{ mat4 mm = modelMatrix; ${INST}
      vWP = (mm*vec4(transformed,1.0)).xyz; vWN = normalize(mat3(mm)*objectNormal); }
      ${o.vertEnd || ''}`);
    f = f.replace('#include <common>', '#include <common>\n' + GLSL_COMMON + '\nvarying vec3 vWP;\nvarying vec3 vWN;\n' + (o.transl ? 'uniform vec3 uTransl;\n' : '') + (o.fragHead || ''));
    if (o.mapFrag) f = f.replace('#include <map_fragment>', o.mapFrag);
    if (o.roughFrag) f = f.replace('#include <roughnessmap_fragment>', o.roughFrag);
    if (o.normalFrag) f = f.replace('#include <normal_fragment_maps>', o.normalFrag);
    if (o.wet !== false) {
      f = f.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      { vec3 wnW = normalize((vec4(normal,0.0)*viewMatrix).xyz);
        float wet = uWet * smoothstep(-0.3, 0.7, wnW.y) ${o.wetExtra || ''};
        wet = clamp(wet,0.0,1.0);
        diffuseColor.rgb *= mix(1.0, ${o.wetDark ?? '0.55'}, wet);
        roughnessFactor = mix(roughnessFactor, 0.1, wet*0.85); }`);
    }
    f = f.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
    { vec3 wnW = normalize((vec4(normal,0.0)*viewMatrix).xyz);
      ${o.transl ? `vec3 Vv = normalize(cameraPosition - vWP);
        float bl = pow(max(dot(-Vv, uSunDir), 0.0), 3.5);
        float thin = max(dot(-wnW, uSunDir), 0.0);
        reflectedLight.directDiffuse += directLight.color * diffuseColor.rgb * uTransl * (bl*2.6 + thin*0.45 + 0.08);` : ''}
      reflectedLight.directDiffuse += diffuseColor.rgb * glowLight(vWP, wnW);
      reflectedLight.indirectDiffuse += diffuseColor.rgb * uFlashCol * uFlash * (0.55 + 0.45*wnW.y);
      ${o.afterLights || ''}
    }`);
    f = f.replace('#include <fog_fragment>', 'gl_FragColor.rgb = applyFog(gl_FragColor.rgb, vWP);');
    sh.vertexShader = v; sh.fragmentShader = f;
    if (o.onShader) o.onShader(sh);
  };
  return mat;
}

// depth material for shadow casting of wind-animated / alpha-tested meshes
export function depthMat(o = {}) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.BasicDepthPacking, map: o.map || null, alphaTest: o.map ? (o.alphaTest ?? 0.5) : 0, side: o.side ?? THREE.FrontSide });
  const localU = { uWindAmp: { value: o.windAmp ?? 1 } };
  m.customProgramCacheKey = () => 'depth' + (o.wind ? 'w' : '') + (o.map ? 'm' : '') + (o.key || '');
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, SH, localU);
    let v = sh.vertexShader;
    v = v.replace('#include <common>', '#include <common>\n' + GLSL_COMMON + (o.wind ? GLSL_WIND + '\nattribute vec2 aWind;\n' : '') + (o.vertHead || ''));
    if (o.wind) v = v.replace('#include <begin_vertex>', `#include <begin_vertex>
      { mat4 mm = modelMatrix; ${INST}
        vec3 wp0 = (mm*vec4(transformed,1.0)).xyz;
        vec3 off = windOffset(wp0, aWind.x*uWindAmp, aWind.y);
        transformed += inverse(mat3(mm))*off; }`);
    if (o.vertBegin) v = v.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + o.vertBegin);
    sh.vertexShader = v;
  };
  if (o.wind) m.userData.u = localU;
  return m;
}

// ---------------------------------------------------------------- library of common materials
export const MAT = {};
function std(params, o) { return patch(new THREE.MeshStandardMaterial(params), o || {}); }
export function buildMaterials() {
  const T = TEX;
  const rep = (t, x, y) => { const c = t.clone(); c.repeat.set(x, y); c.needsUpdate = true; return c; };
  MAT.wood = std({ map: T.wood.map, normalMap: T.wood.nrm, roughness: 0.85, color: 0xffffff });
  MAT.woodDark = std({ map: T.wood.map, normalMap: T.wood.nrm, roughness: 0.8, color: 0x6a5446 });
  MAT.paint = std({ map: T.paint.map, normalMap: T.paint.nrm, roughness: 0.7, color: 0xffffff });
  MAT.black = std({ map: T.paint.map, normalMap: T.paint.nrm, roughness: 0.55, color: 0x1f1b1a });
  MAT.tile = std({ map: T.tile.map, normalMap: T.tile.nrm, roughness: 0.5, color: 0xffffff, metalness: 0.0 });
  MAT.tileDark = std({ color: 0x3a3d42, roughness: 0.45, map: T.granite.map, normalMap: T.granite.nrm });
  MAT.plaster = std({ map: T.plaster.map, normalMap: T.plaster.nrm, roughness: 0.92, color: 0xffffff });
  MAT.stone = std({ map: T.granite.map, normalMap: T.granite.nrm, roughness: 0.85, color: 0xffffff });
  MAT.stonewall = std({ map: T.stonewall.map, normalMap: T.stonewall.nrm, roughness: 0.9, color: 0xffffff, normalScale: new THREE.Vector2(1.4, 1.4) });
  MAT.bronze = std({ color: 0x5f7a62, roughness: 0.45, metalness: 0.75, map: T.granite.map });
  MAT.gold = std({ color: 0xc9a14a, roughness: 0.35, metalness: 1.0 });
  MAT.iron = std({ color: 0x2b2826, roughness: 0.6, metalness: 0.7 });
  MAT.reed = std({ map: T.reed.map, normalMap: T.reed.nrm, roughness: 0.95, color: 0xffffff, side: THREE.DoubleSide });
  MAT.straw = std({ map: T.straw.map, normalMap: T.straw.nrm, roughness: 0.95, color: 0xffffff });
  MAT.bamboo = std({ color: 0xb9a36a, roughness: 0.45, map: T.straw.map, normalMap: T.straw.nrm, normalScale: new THREE.Vector2(0.3, 0.3) });
  MAT.rope = std({ color: 0xc8b48a, roughness: 0.95, map: T.straw.map, normalMap: T.straw.nrm });
  MAT.paper = std({ color: 0xf3ead8, roughness: 0.9, emissive: 0xffb060, emissiveIntensity: 0, side: THREE.DoubleSide, map: T.plaster.map }, { transl: new THREE.Color(0.9, 0.8, 0.6) });
  MAT.shoji = std({ color: 0xf1e8d6, roughness: 0.9, emissive: 0xffa24a, emissiveIntensity: 0, map: T.plaster.map });
  MAT.glaze = new THREE.MeshPhysicalMaterial({ color: 0x3d2a1c, roughness: 0.18, clearcoat: 1.0, clearcoatRoughness: 0.08, map: T.granite.map });
  patch(MAT.glaze, {});
  MAT.bark = std({ map: T.barkCherry.map, normalMap: T.barkCherry.nrm, roughness: 0.95, color: 0xffffff, normalScale: new THREE.Vector2(1.6, 1.6) });
  MAT.clothIndigo = std({ map: T.cloth.map, normalMap: T.cloth.nrm, color: 0x2e3a5a, roughness: 0.95 });
  MAT.clothGrey = std({ map: T.cloth.map, normalMap: T.cloth.nrm, color: 0x6b6660, roughness: 0.95 });
  MAT.clothBrown = std({ map: T.cloth.map, normalMap: T.cloth.nrm, color: 0x5a3b28, roughness: 0.95 });
  MAT.clothSaffron = std({ map: T.cloth.map, normalMap: T.cloth.nrm, color: 0x9a5a22, roughness: 0.95 });
  MAT.clothBlack = std({ map: T.cloth.map, normalMap: T.cloth.nrm, color: 0x26221f, roughness: 0.95 });
  MAT.kimono = std({ map: T.cloth.map, normalMap: T.cloth.nrm, color: 0x7b4d7a, roughness: 0.9 });
  MAT.obi = std({ map: T.cloth.map, normalMap: T.cloth.nrm, color: 0xd9b25a, roughness: 0.7 });
  MAT.skin = std({ color: 0xd9a888, roughness: 0.7 }, { transl: new THREE.Color(0.35, 0.12, 0.08) });
  MAT.hair = std({ color: 0x141112, roughness: 0.45 });
  MAT.umbrella = std({ color: 0xb2201a, roughness: 0.6, side: THREE.DoubleSide, map: T.plaster.map }, { transl: new THREE.Color(1.0, 0.25, 0.12) });
}
