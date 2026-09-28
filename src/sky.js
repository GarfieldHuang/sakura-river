// Sky dome (gradient, sun, moon, stars, milky way, painted clouds with linings, lightning glow)
// and layered distant mountain ranges fading into haze.
import * as THREE from 'three';
import { TEX } from './textures.js';
import { SH, GLSL_COMMON } from './materials.js';
import { fbm2, ridge2, RNG } from './noise.js';

export const SKYU = {
  uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() },
  uMoonDir: { value: new THREE.Vector3() }, uSunI: { value: 1 }, uMoonI: { value: 0 },
  uStars: { value: 0 }, uClouds: { value: 0.3 }, uStorm: { value: 0 }, uGolden: { value: 0 },
  uFlashDir: { value: new THREE.Vector3(0, 1, 0) }, tMoon: { value: null }, uExpo: { value: 1 }, uSunReal: { value: new THREE.Vector3(0, 1, 0) },
};

const SKY_VS = `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position = p.xyww; }`;
const SKY_FS = /* glsl */`
${GLSL_COMMON}
uniform sampler2D tNoise; uniform sampler2D tMoon;
uniform vec3 uZen, uHor, uMoonDir, uFlashDir, uSunReal; uniform float uSunI, uMoonI, uStars, uClouds, uStorm, uGolden;
varying vec3 vDir;
float h13(vec3 p){ p=fract(p*0.1031); p+=dot(p,p.zyx+31.32); return fract((p.x+p.y)*p.z); }
float cloudD(vec2 p){
  float n = texture2D(tNoise, p*0.9).r*0.55 + texture2D(tNoise, p*2.3+0.17).g*0.3 + texture2D(tNoise, p*5.1-0.33).a*0.15;
  float cov = mix(0.56, 0.28, uClouds);
  return smoothstep(cov, cov+0.28 - uStorm*0.1, n);
}
void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  float t = pow(clamp(y,0.,1.), 0.42);
  vec3 col = mix(uHor, uZen, t);
  col = mix(col, uHor*0.9, smoothstep(0.02,-0.08,y));
  float cs = dot(d, uSunReal);
  vec3 sunC = uSunCol/max(0.001, max(uSunCol.r, max(uSunCol.g, uSunCol.b)));
  float sunUp = smoothstep(-0.12, 0.05, uSunReal.y);
  // atmospheric glow around the sun + horizon warm band
  col += sunC * sunUp * (pow(max(cs,0.),6.)*(0.25+0.9*uGolden) + pow(max(cs,0.),48.)*0.9) * (1.0-uStorm*0.85);
  col += sunC * sunUp * uGolden * 0.6 * pow(max(dot(normalize(vec3(d.x,0.,d.z)), normalize(vec3(uSunReal.x,0.,uSunReal.z))),0.),3.) * smoothstep(0.35,0.0,y);
  // stars + milky way
  if (uStars > 0.001) {
    vec3 p = d*170.; vec3 c = floor(p); float h = h13(c);
    vec3 f = fract(p)-0.5; vec3 jit = vec3(h13(c+7.1),h13(c+3.3),h13(c+9.7))-0.5;
    float dd = length(f-jit*0.6);
    float star = step(0.985, h) * smoothstep(0.2, 0.02, dd) * (0.35+1.2*pow(h13(c+1.7),3.0));
    star *= 0.7+0.3*sin(uTime*(2.0+h*5.0)+h*40.);
    vec3 mwN = normalize(vec3(0.35, 0.55, -0.76));
    float band = exp(-pow(dot(d,mwN)/0.16,2.));
    vec2 mp = vec2(atan(d.x,d.z), d.y)*0.6;
    float mw = band*(texture2D(tNoise, mp*0.7).r*0.7 + texture2D(tNoise, mp*2.1).g*0.5 - 0.35);
    float dust = band*smoothstep(0.55,0.75,texture2D(tNoise, mp*1.3+0.4).b);
    vec3 sc = mix(vec3(0.8,0.85,1.0), vec3(1.0,0.9,0.75), h13(c+5.));
    col += (sc*star*1.6 + vec3(0.5,0.55,0.75)*max(mw,0.)*0.05 - dust*0.004) * uStars * smoothstep(0.0,0.15,y);
  }
  // moon
  if (uMoonI > 0.0 || uMoonDir.y > -0.1) {
    vec3 mr = normalize(cross(vec3(0,1,0), uMoonDir)); vec3 mu = cross(uMoonDir, mr);
    float mrad = 0.036;
    vec2 muv = vec2(dot(d,mr), dot(d,mu))/mrad;
    if (dot(d,uMoonDir) > 0.0 && dot(muv,muv) < 1.0) {
      vec4 m = texture2D(tMoon, muv*0.5+0.5);
      col = mix(col, m.rgb*vec3(1.0,0.97,0.9)*0.55 + col*0.2, m.a*smoothstep(-0.02,0.04,uMoonDir.y)*(1.0-uStorm*0.9));
    }
    float mg = pow(max(dot(d,uMoonDir),0.), 300.)*0.05 + pow(max(dot(d,uMoonDir),0.), 16.)*0.008;
    col += vec3(0.6,0.7,0.9)*mg*uMoonI*(1.0-uStorm);
  }
  // sun disk
  float disk = smoothstep(0.99955, 0.99975, cs);
  col += sunC * disk * 60.0 * sunUp * (1.0-uStorm) * smoothstep(-0.02,0.01,y);
  // clouds (painted layer)
  if (y > -0.02) {
    float tt = 1.0/max(y+0.06, 0.02);
    vec2 cp = d.xz*tt*0.045 + vec2(uTime*0.0022, uTime*0.0011);
    float dens = cloudD(cp);
    dens = mix(dens, 0.75 + 0.25*dens, uStorm);
    vec2 toSun = normalize(uSunReal.xz+1e-4)*0.03;
    float dens2 = cloudD(cp + toSun);
    float thick = clamp(dens2*1.2 - dens*0.2, 0.0, 1.0);
    vec3 skyAmb = mix(uHor, uZen, 0.5);
    vec3 lit = mix(vec3(1.0), sunC, 0.65) * (0.35+0.75*uSunI) ;
    vec3 base = skyAmb*0.9 + vec3(0.04);
    vec3 cc = mix(lit*(1.0-thick*0.55), base*(0.78 - 0.12*thick), uStorm*0.85);
    cc = mix(cc, base*0.55, thick*0.45*(1.0-uStorm*0.7));
    // silver-gold lining where clouds are thin near the sun
    float lining = pow(max(cs,0.), 5.0) * (1.0 - dens) * dens * 4.0;
    cc += sunC * lining * 3.0 * uSunI * (1.0 - uStorm*0.7);
    // moonlit clouds at night
    cc += vec3(0.25,0.3,0.45)*uMoonI*0.08*(1.0-thick);
    // lightning glow inside clouds
    float fl = pow(max(dot(d,uFlashDir),0.), 3.0);
    cc += uFlashCol * uFlash * (0.35 + 2.5*fl) * (0.5+0.5*dens);
    float fade = smoothstep(-0.02, 0.18, y);
    col = mix(col, cc, dens*fade*(0.92));
    col += uFlashCol*uFlash*0.15*fl;
  }
  // horizon haze matching terrain fog
  vec3 fc = uFogCol + uFogSun*pow(max(dot(d,uTrueSun),0.), uFogP.w);
  float hzr = 0.2 + uFogP.x*150.0; col = mix(col, fc, smoothstep(hzr, 0.0, abs(y))*(0.85 + uStorm*0.1));
  gl_FragColor = vec4(col, 1.0);
}`;

export function createSky(scene) {
  SKYU.tMoon.value = TEX.moon;
  const mat = new THREE.ShaderMaterial({
    vertexShader: SKY_VS, fragmentShader: SKY_FS,
    uniforms: Object.assign({}, SH, SKYU, { tNoise: { value: TEX.noise } }),
    side: THREE.BackSide, depthWrite: false, depthTest: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 48, 24), mat);
  sky.renderOrder = -1000; sky.frustumCulled = false;
  sky.onBeforeRender = (r, s, cam) => { sky.position.copy(cam.position); sky.updateMatrixWorld(); };
  scene.add(sky);
  return sky;
}

// distant ranges: rings of silhouettes
const MTN_VS = `
varying vec3 vWP; varying float vH; varying float vT;
attribute float aT;
void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vWP = wp.xyz; vH = position.y; vT = aT; gl_Position = projectionMatrix*viewMatrix*wp; }`;
const MTN_FS = /* glsl */`
${GLSL_COMMON}
uniform vec3 uHemiS; uniform vec3 uHemiG; uniform float uLayer; uniform sampler2D tNoise; uniform vec3 uBase;
varying vec3 vWP; varying float vH; varying float vT;
void main(){
  float n = texture2D(tNoise, vWP.xz*0.0006).r;
  float ridgeLight = clamp(vT,0.,1.);
  vec3 c = uBase*(0.7+0.5*n);
  vec3 amb = mix(uHemiG, uHemiS, 0.6)*0.35;
  vec3 lit = c*(amb + uSunCol*0.12*ridgeLight);
  vec3 v = vWP - cameraPosition; float dist = length(v); vec3 dir=v/dist;
  vec3 wpc = cameraPosition + dir*min(dist, 950.0);
  vec3 col = applyFog(lit, wpc);
  vec3 fc = uFogCol + uFogSun*pow(max(dot(dir,uTrueSun),0.), uFogP.w);
  float haze = clamp(0.1 + uLayer*0.13, 0.0, 0.9);
  float low = smoothstep(420., -40., vH);
  col = mix(col, fc, max(haze, low*0.5));
  col += uFlashCol*uFlash*0.25*(1.0-haze);
  gl_FragColor = vec4(col,1.0);
}`;
export const MTNU = { uHemiS: { value: new THREE.Color() }, uHemiG: { value: new THREE.Color() } };
export function createMountains(scene, cx, cz) {
  const rng = new RNG(5);
  const layers = [
    { r: 1500, hmin: 180, hmax: 470, base: [0.16, 0.22, 0.2] },
    { r: 2300, hmin: 240, hmax: 620, base: [0.17, 0.22, 0.26] },
    { r: 3300, hmin: 300, hmax: 780, base: [0.2, 0.25, 0.32] },
    { r: 4500, hmin: 380, hmax: 980, base: [0.24, 0.28, 0.36] },
  ];
  const group = new THREE.Group();
  layers.forEach((L, li) => {
    const N = 720; const pos = [], tt = [], idx = [];
    const off = rng.range(0, 100);
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const x = Math.cos(a), z = Math.sin(a);
      const u = i / N * 40;
      let h = ridge2(u * 0.35 + off, li * 3.1, 5);
      h = L.hmin + (L.hmax - L.hmin) * Math.pow(h, 1.6) * (0.75 + 0.35 * fbm2(u * 0.08, off, 2));
      const rr = L.r * (1 + 0.06 * fbm2(u * 0.2, off + 9, 2));
      pos.push(cx + x * rr, -120, cz + z * rr, cx + x * rr, h, cz + z * rr);
      const slope = ridge2((u + 0.02) * 0.35 + off, li * 3.1, 5) - ridge2(u * 0.35 + off, li * 3.1, 5);
      tt.push(0, 0.5 + slope * 25);
      if (i < N) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aT', new THREE.Float32BufferAttribute(tt, 1));
    g.setIndex(idx);
    const m = new THREE.ShaderMaterial({
      vertexShader: MTN_VS, fragmentShader: MTN_FS, side: THREE.DoubleSide,
      uniforms: Object.assign({}, SH, MTNU, { uLayer: { value: li }, tNoise: { value: TEX.noise }, uBase: { value: new THREE.Color(...L.base) } }),
    });
    const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = -900 + li * -1;
    group.add(mesh);
  });
  scene.add(group);
  return group;
}
