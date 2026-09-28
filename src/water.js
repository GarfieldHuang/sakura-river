// River water: planar reflection, depth-based refraction/absorption, flow-mapped ripples,
// baked foam collars/trails, dynamic boat wake (particle stamped height+foam field), petal rafts, rain rings.
import * as THREE from 'three';
import { S_MIN, S_MAX, sdToWorld, center, halfWidth, FLOW } from './world.js';
import { TEX } from './textures.js';
import { SH, GLSL_COMMON } from './materials.js';

export const WATER = { mesh: null, mat: null, reflRT: null, virtualCam: new THREE.PerspectiveCamera(), textureMatrix: new THREE.Matrix4(), wake: null };

// hull half-breadth (shared with boat geometry + water mask), x = local longitudinal (bow +)
export const HULL = { xs: -5.4, xb: 5.5 };
export function hullHalf(x) {
  if (x < HULL.xs || x > HULL.xb) return 0;
  const t = (x - HULL.xs) / (HULL.xb - HULL.xs);
  let b = 0.95;
  if (x > 1.2) b = 0.95 * Math.pow(Math.max(0, 1 - Math.pow((x - 1.2) / (HULL.xb - 1.2), 1.8)), 0.62) + 0.06 * (1 - (x - 1.2) / (HULL.xb - 1.2));
  if (x < -4.2) b = 0.95 - 0.12 * ((-4.2 - x) / 1.2);
  return Math.max(0.05, b);
}
const HULL_GLSL = `
float hullHalf(float x){
  if (x < ${HULL.xs.toFixed(2)} || x > ${HULL.xb.toFixed(2)}) return -1.0;
  float b = 0.95;
  if (x > 1.2) { float u = (x-1.2)/(${(HULL.xb - 1.2).toFixed(3)}); b = 0.95*pow(max(0.0, 1.0-pow(u,1.8)),0.62) + 0.06*(1.0-u); }
  if (x < -4.2) b = 0.95 - 0.12*((-4.2-x)/1.2);
  return max(0.05,b);
}
float yB(float x){ float s1 = smoothstep(1.3,5.5,x); return -0.24 + 0.62*s1*s1 + 0.14*(1.0-smoothstep(-5.4,-3.6,x)); }
float yG(float x){ float s = smoothstep(1.8,5.5,x); return 0.42 + 0.38*s*s + 0.1*(1.0-smoothstep(-5.4,-3.4,x)); }`;

const WATER_VS = /* glsl */`
attribute vec2 aSD; attribute vec2 aT;
uniform mat4 uTexMat;
varying vec3 vWPw; varying vec2 vSD; varying vec2 vT; varying vec4 vClip; varying vec4 vRefl; varying float vViewZ;
void main(){
  vec4 wp = modelMatrix*vec4(position,1.0); vWPw = wp.xyz; vSD = aSD; vT = aT;
  vec4 vp = viewMatrix*wp; vViewZ = -vp.z;
  vClip = projectionMatrix*vp; vRefl = uTexMat*vec4(position,1.0);
  gl_Position = vClip;
}`;
const WATER_FS = /* glsl */`
${GLSL_COMMON}
${HULL_GLSL}
uniform sampler2D tRefl, tRefr, tFlow, tWaterN, tNoise, tWake;
uniform sampler2DShadow tShadow; uniform mat4 uShadowMat; uniform float uHasShadow;
uniform vec2 uRes; uniform vec3 uCamFwd; uniform vec3 uFlowP; // dRange, sMin, sMax
uniform vec3 uWakeP; // cx, cz, size
uniform vec4 uBoat; // x, z, fwdx, fwdz
uniform vec3 uHemiS, uHemiG; uniform vec3 uAbsorb; uniform vec3 uDeep;
varying vec3 vWPw; varying vec2 vSD; varying vec2 vT; varying vec4 vClip; varying vec4 vRefl; varying float vViewZ;
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2 rainRipple(vec2 p){
  vec2 acc = vec2(0.);
  for (int k=0;k<3;k++){
    float sc = 1.1 + float(k)*0.9; vec2 q = p*sc + float(k)*17.3; vec2 i = floor(q), f = fract(q);
    float h = h12(i + float(k)*3.1); float t = fract(uTime*(0.8+h*0.4) + h);
    vec2 c = vec2(h12(i+1.7), h12(i+4.3))*0.6+0.2; vec2 d = f - c; float r = length(d);
    float ring = t*0.42; float w = sin((r-ring)*70.0)*exp(-pow((r-ring)*16.0,2.0))*(1.0-t)*(1.0-t);
    acc += d/(r+1e-3)*w;
  }
  return acc*0.5;
}
float petals(vec2 p, float dens){
  vec2 i = floor(p), f = fract(p); float m = 0.;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec2 c = i+vec2(float(x),float(y)); float h = h12(c); if(h > dens) continue;
    vec2 o = vec2(h12(c+1.3), h12(c+2.7)); vec2 d = vec2(float(x),float(y))+o-f; float a = h12(c+5.1)*6.283;
    d = mat2(cos(a),-sin(a),sin(a),cos(a))*d;
    float e = length(d*vec2(1.0,1.55)); m = max(m, smoothstep(0.3,0.24,e)*(0.75+0.25*h12(c+9.)));
  }
  return m;
}
void main(){
  vec3 wp = vWPw;
  // mask out the inside of the hull
  { vec2 rel = wp.xz - uBoat.xy; float lx = dot(rel, uBoat.zw); float lz = dot(rel, vec2(-uBoat.w, uBoat.z));
    float hb = hullHalf(lx);
    if (hb > 0.0) { float yb = yB(lx); if (yb < -0.03) { float tt = (0.0 - yb)/(yG(lx) - yb); float wl = mix(hb*0.84, hb, tt); if (abs(lz) < wl - 0.035) discard; } } }
  vec2 fuv = vec2((vSD.y + uFlowP.x)/(2.0*uFlowP.x), (vSD.x - uFlowP.y)/(uFlowP.z-uFlowP.y));
  vec4 F = texture2D(tFlow, fuv);
  vec2 fsd = (F.rg - 0.5)*4.0;
  vec2 T = normalize(vT); vec2 N = vec2(-T.y, T.x);
  vec2 flow = fsd.x*T + fsd.y*N;
  float speed = length(flow);
  float foamMap = F.b, turb = F.a;
  float ph = uTime*0.32; float p0 = fract(ph), p1 = fract(ph+0.5); float wgt = abs(p0*2.0-1.0);
  vec3 nA = texture2D(tWaterN, wp.xz*0.15 - flow*p0*0.95).xyz*2.0-1.0;
  vec3 nB = texture2D(tWaterN, wp.xz*0.15 - flow*p1*0.95 + 0.37).xyz*2.0-1.0;
  vec3 nC = texture2D(tWaterN, wp.xz*0.43 - flow*p0*2.3 + 0.11).xyz*2.0-1.0;
  vec3 nD = texture2D(tWaterN, wp.xz*0.43 - flow*p1*2.3 + 0.61).xyz*2.0-1.0;
  vec2 nf = mix(nA.xy, nB.xy, wgt)*0.6 + mix(nC.xy, nD.xy, wgt)*0.42;
  float amp = 0.09 + 0.26*clamp(speed,0.0,1.6) + turb*0.7 + uWind.z*0.06;
  vec2 nxy = nf*amp;
  nxy += (texture2D(tWaterN, wp.xz*0.025 + vec2(uTime*0.006, -uTime*0.004)).xy*2.0-1.0)*0.08;
  // boat wake field
  vec2 wuv = (wp.xz - uWakeP.xy)/uWakeP.z + 0.5;
  float fade = smoothstep(0.0,0.08,wuv.x)*smoothstep(1.0,0.92,wuv.x)*smoothstep(0.0,0.08,wuv.y)*smoothstep(1.0,0.92,wuv.y);
  float wakeFoam = 0.0;
  if (fade > 0.0) {
    float e = 1.0/256.0; float tm = uWakeP.z/256.0;
    vec4 wk = texture2D(tWake, wuv);
    float hL = texture2D(tWake, wuv-vec2(e,0.)).r, hR = texture2D(tWake, wuv+vec2(e,0.)).r;
    float hD = texture2D(tWake, wuv-vec2(0.,e)).r, hU = texture2D(tWake, wuv+vec2(0.,e)).r;
    vec2 g = vec2(hR-hL, hU-hD)/(2.0*tm);
    nxy -= g*fade*1.15;
    wakeFoam = clamp(wk.g,0.0,1.4)*fade;
  }
  if (uRain > 0.01) nxy += rainRipple(wp.xz*1.2)*uRain;
  vec3 n = normalize(vec3(nxy.x, 1.0, nxy.y));
  vec3 viewDir = normalize(wp - cameraPosition);
  float dist = length(wp - cameraPosition);
  // screen uv
  vec2 suv = (vClip.xy/vClip.w)*0.5+0.5;
  // refraction with depth
  vec2 dOff = n.xz*0.022*clamp(8.0/dist,0.3,1.0);
  vec4 rs = texture2D(tRefr, suv + dOff);
  if (rs.a < vViewZ) rs = texture2D(tRefr, suv);
  float cosA = max(dot(viewDir, uCamFwd), 0.05);
  float thick = max(0.0, (rs.a - vViewZ)/cosA);
  float vd = thick*max(-viewDir.y, 0.08);
  // sun / shadow
  float shadow = 1.0;
  if (uHasShadow > 0.5) {
    vec4 sc = uShadowMat*vec4(wp,1.0); sc.xyz /= sc.w;
    if (sc.x>0.0 && sc.x<1.0 && sc.y>0.0 && sc.y<1.0 && sc.z<1.0) {
      shadow = 0.0; for (int i=0;i<4;i++){ vec2 o = vec2(float(i/2)-0.5, float(i-2*(i/2))-0.5)*0.0012; shadow += texture(tShadow, vec3(sc.xy+o, sc.z-0.0008)); } shadow *= 0.25;
    }
  }
  vec3 amb = mix(uHemiG, uHemiS, 0.7);
  vec3 sunLit = uSunCol*max(uSunDir.y,0.0)*shadow;
  vec3 scatter = uDeep*(amb*0.9 + sunLit*0.35) + glowLight(wp - vec3(0.0,0.6,0.0), vec3(0.,1.,0.))*uDeep*2.0;
  vec3 tr = exp(-uAbsorb*(thick + vd*0.6));
  vec3 under = rs.rgb*tr + scatter*(1.0-tr);
  // reflection
  vec2 ruv = vRefl.xy/vRefl.w + n.xz*0.05*clamp(10.0/dist,0.25,1.0);
  vec3 refl = texture2D(tRefl, ruv).rgb;
  float cosT = max(dot(-viewDir, n), 0.0);
  float fres = 0.02 + 0.98*pow(1.0-cosT, 5.0);
  fres = mix(fres, fres*0.6, uRain*0.5);
  vec3 col = mix(under, refl, fres);
  // specular glints of the key light
  vec3 Hh = normalize(uSunDir - viewDir);
  float nh = max(dot(n,Hh),0.0);
  col += uSunCol*shadow*(pow(nh, 900.0)*6.0 + pow(nh, 90.0)*0.25)*(1.0-uRain*0.6);
  // foam
  vec2 fa = wp.xz*0.32 - flow*uTime*0.55; vec2 fb = wp.xz*0.95 - flow*uTime*0.95 + 0.3;
  float fn = texture2D(tNoise, fa).a*texture2D(tNoise, fb).r*1.6;
  float foam = smoothstep(0.18, 0.75, foamMap*(0.55 + fn*1.1));
  foam += smoothstep(0.1, 0.0, vd)*smoothstep(0.35, 0.65, fn)*0.55*(0.4+speed);
  foam += smoothstep(0.35, 1.0, turb*fn)*0.35;
  foam += smoothstep(0.25, 1.4, wakeFoam*(0.35 + fn*1.3))*0.85;
  foam = clamp(foam, 0.0, 1.0);
  vec3 foamCol = vec3(0.92,0.94,0.95)*(amb*0.9 + sunLit*0.75 + glowLight(wp, vec3(0.,1.,0.)));
  col = mix(col, foamCol, foam*0.88);
  // petal rafts in slack water near the banks
  float slack = 1.0 - smoothstep(0.08, 0.32, speed);
  float raftN = texture2D(tNoise, wp.xz*0.045 - flow*uTime*0.04).g;
  float raft = slack*smoothstep(0.9, 0.15, vd)*smoothstep(0.45, 0.7, raftN);
  if (raft > 0.01) {
    float pt = petals(wp.xz*7.0 - flow*uTime*0.6*7.0, raft*0.9);
    vec3 pc = mix(vec3(0.98,0.78,0.84), vec3(1.0,0.92,0.93), h12(floor(wp.xz*7.0)));
    vec3 pl = pc*(amb*1.05 + sunLit*0.85 + glowLight(wp, vec3(0.,1.,0.)))*0.95;
    col = mix(col, pl, pt*0.95);
  }
  col += uFlashCol*uFlash*(0.25*fres + 0.3*foam);
  col = applyFog(col, wp);
  gl_FragColor = vec4(col, 1.0);
}`;

export function buildWater(scene) {
  const pos = [], sd = [], tan = [], idx = [];
  const ds = 2, NA = 26;
  let rows = 0;
  const c = {};
  for (let s = S_MIN; s <= S_MAX; s += ds) {
    const w = halfWidth(s) + 7;
    center(s, c);
    for (let i = 0; i <= NA; i++) {
      const u = i / NA * 2 - 1; const d = Math.sign(u) * Math.pow(Math.abs(u), 0.8) * w;
      const p = sdToWorld(s, d, {});
      pos.push(p.x, 0, p.z); sd.push(s, d); tan.push(c.tx, c.tz);
    }
    rows++;
  }
  for (let r = 0; r < rows - 1; r++) for (let i = 0; i < NA; i++) {
    const a = r * (NA + 1) + i, b = a + 1, cc = a + NA + 1, d = cc + 1;
    idx.push(a, b, cc, b, d, cc);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSD', new THREE.Float32BufferAttribute(sd, 2));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(tan, 2));
  g.setIndex(idx); g.computeBoundingSphere();
  const flowTex = new THREE.DataTexture(FLOW.data, FLOW.W, FLOW.H, THREE.RGBAFormat, THREE.UnsignedByteType);
  flowTex.magFilter = THREE.LinearFilter; flowTex.minFilter = THREE.LinearFilter; flowTex.needsUpdate = true;
  WATER.wake = new WakeSim();
  const mat = new THREE.ShaderMaterial({
    vertexShader: WATER_VS, fragmentShader: WATER_FS,
    uniforms: Object.assign({}, SH, {
      tRefl: { value: null }, tRefr: { value: null }, tFlow: { value: flowTex }, tWaterN: { value: TEX.waterN }, tNoise: { value: TEX.noise },
      tWake: { value: WATER.wake.rt.texture }, tShadow: { value: null }, uShadowMat: { value: new THREE.Matrix4() }, uHasShadow: { value: 0 },
      uTexMat: { value: WATER.textureMatrix }, uRes: { value: new THREE.Vector2() }, uCamFwd: { value: new THREE.Vector3() },
      uFlowP: { value: new THREE.Vector3(FLOW.dRange, S_MIN, S_MIN + (FLOW.H - 1) * FLOW.ds) },
      uWakeP: { value: new THREE.Vector3(0, 0, 90) }, uBoat: { value: new THREE.Vector4(0, 0, 1, 0) },
      uHemiS: { value: new THREE.Color() }, uHemiG: { value: new THREE.Color() },
      uAbsorb: { value: new THREE.Vector3(1.15, 0.34, 0.55) }, uDeep: { value: new THREE.Color(0.016, 0.05, 0.034) },
    }),
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.layers.set(1);
  mesh.frustumCulled = false;
  scene.add(mesh);
  WATER.mesh = mesh; WATER.mat = mat;
  return mesh;
}

// ---------------------------------------------------------------- planar reflection
const _rp = new THREE.Plane(), _n = new THREE.Vector3(0, 1, 0), _rw = new THREE.Vector3(0, -0.02, 0), _cw = new THREE.Vector3(), _rot = new THREE.Matrix4(), _look = new THREE.Vector3(), _view = new THREE.Vector3(), _tgt = new THREE.Vector3(), _q = new THREE.Vector4(), _clip = new THREE.Vector4();
export function updateReflectionCamera(camera) {
  const vc = WATER.virtualCam;
  _cw.setFromMatrixPosition(camera.matrixWorld);
  _view.subVectors(_rw, _cw);
  if (_view.dot(_n) > 0) return false;
  _view.reflect(_n).negate(); _view.add(_rw);
  _rot.extractRotation(camera.matrixWorld);
  _look.set(0, 0, -1).applyMatrix4(_rot).add(_cw);
  _tgt.subVectors(_rw, _look); _tgt.reflect(_n).negate(); _tgt.add(_rw);
  vc.position.copy(_view);
  vc.up.set(0, 1, 0).applyMatrix4(_rot).reflect(_n);
  vc.lookAt(_tgt);
  vc.far = camera.far; vc.near = camera.near;
  vc.updateMatrixWorld();
  vc.projectionMatrix.copy(camera.projectionMatrix);
  vc.layers.mask = 0; vc.layers.enable(0); vc.layers.enable(2);
  WATER.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  WATER.textureMatrix.multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);
  _rp.setFromNormalAndCoplanarPoint(_n, _rw); _rp.applyMatrix4(vc.matrixWorldInverse);
  _clip.set(_rp.normal.x, _rp.normal.y, _rp.normal.z, _rp.constant);
  const P = vc.projectionMatrix;
  _q.x = (Math.sign(_clip.x) + P.elements[8]) / P.elements[0];
  _q.y = (Math.sign(_clip.y) + P.elements[9]) / P.elements[5];
  _q.z = -1; _q.w = (1 + P.elements[10]) / P.elements[14];
  _clip.multiplyScalar(2 / _clip.dot(_q));
  P.elements[2] = _clip.x; P.elements[6] = _clip.y; P.elements[10] = _clip.z + 1 - 0.0; P.elements[14] = _clip.w;
  vc.projectionMatrixInverse.copy(P).invert();
  return true;
}

// ---------------------------------------------------------------- wake simulation (stamped particles)
const WAKE_VS = `
attribute vec2 iPos; attribute vec2 iDir; attribute vec2 iSize; attribute vec4 iPar;
varying vec2 vL; varying vec4 vPar;
uniform vec3 uWakeP;
void main(){
  vL = position.xy*2.0; vPar = iPar;
  vec2 side = vec2(-iDir.y, iDir.x);
  vec2 w = iPos + iDir*position.x*iSize.x + side*position.y*iSize.y;
  vec2 c = (w - uWakeP.xy)/uWakeP.z*2.0;
  gl_Position = vec4(c.x, c.y, 0.0, 1.0);
}`;
const WAKE_FS = `
varying vec2 vL; varying vec4 vPar;
void main(){
  float amp = vPar.x, foam = vPar.y, t = vPar.z, type = vPar.w;
  vec2 l = vL; float h = 0.0, f = 0.0;
  if (type < 0.5) { // crest segment
    float along = 1.0 - l.x*l.x; float v = l.y;
    h = amp*cos(v*3.4)*exp(-v*v*2.2)*along;
    f = foam*exp(-v*v*5.0)*along;
  } else if (type < 1.5) { // turbulent blob
    float r2 = dot(l,l); float g = exp(-r2*3.0);
    h = amp*(g - exp(-r2*1.2)*0.6);
    float n = fract(sin(dot(floor(l*4.0+t*3.0), vec2(12.9898,78.233)))*43758.5453);
    f = foam*g*(0.55+0.45*n);
  } else { // ring ripple
    float r = length(l); float d = r-0.7;
    h = amp*sin(d*18.0)*exp(-d*d*40.0);
    f = foam*exp(-d*d*60.0)*0.5;
  }
  if (dot(l,l) > 1.0 && type > 0.5) { h *= 0.0; f *= 0.0; }
  gl_FragColor = vec4(h, f, 0.0, 1.0);
}`;
export class WakeSim {
  constructor() {
    this.size = 90; this.res = 256;
    this.rt = new THREE.WebGLRenderTarget(this.res, this.res, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.max = 1400;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 2), 2);
    this.aDir = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 2), 2);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 2), 2);
    this.aPar = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 4), 4);
    for (const a of [this.aPos, this.aDir, this.aSize, this.aPar]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iDir', this.aDir); g.setAttribute('iSize', this.aSize); g.setAttribute('iPar', this.aPar);
    g.instanceCount = 0;
    this.uWakeP = { value: new THREE.Vector3(0, 0, this.size) };
    this.mat = new THREE.ShaderMaterial({ vertexShader: WAKE_VS, fragmentShader: WAKE_FS, uniforms: { uWakeP: this.uWakeP }, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, depthTest: false, depthWrite: false, transparent: true });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.mesh);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
    this.p = [];
    this.center = new THREE.Vector2();
  }
  emit(o) { if (this.p.length < this.max) this.p.push(Object.assign({ age: 0, vx: 0, vz: 0, grow: 0, damp: 0 }, o)); }
  update(dt, flowAt) {
    const P = this.p;
    for (let i = P.length - 1; i >= 0; i--) {
      const q = P[i]; q.age += dt;
      if (q.age > q.life) { P[i] = P[P.length - 1]; P.pop(); continue; }
      const f = flowAt(q.x, q.z);
      q.x += (q.vx + f.x) * dt; q.z += (q.vz + f.z) * dt;
      const k = Math.exp(-q.damp * dt); q.vx *= k; q.vz *= k;
    }
    const n = Math.min(P.length, this.max);
    for (let i = 0; i < n; i++) {
      const q = P[i]; const t = q.age / q.life;
      this.aPos.array[i * 2] = q.x; this.aPos.array[i * 2 + 1] = q.z;
      this.aDir.array[i * 2] = q.dx; this.aDir.array[i * 2 + 1] = q.dz;
      this.aSize.array[i * 2] = q.len + q.grow * q.age; this.aSize.array[i * 2 + 1] = q.wid + q.growW * q.age;
      const env = Math.min(1, q.age / 0.15) * Math.pow(1 - t, 1.3);
      this.aPar.array[i * 4] = q.amp * env; this.aPar.array[i * 4 + 1] = q.foam * env * (1 - t * 0.5); this.aPar.array[i * 4 + 2] = q.age; this.aPar.array[i * 4 + 3] = q.type;
    }
    this.mesh.geometry.instanceCount = n;
    for (const a of [this.aPos, this.aDir, this.aSize, this.aPar]) a.needsUpdate = true;
  }
  render(renderer, cx, cz) {
    const tm = this.size / this.res;
    this.center.set(Math.round(cx / tm) * tm, Math.round(cz / tm) * tm);
    this.uWakeP.value.set(this.center.x, this.center.y, this.size);
    const old = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 0); renderer.clear(true, false, false);
    // world z maps to texture v: ortho camera uses clip directly
    renderer.render(this.scene, this.cam);
    renderer.setRenderTarget(old);
  }
}
