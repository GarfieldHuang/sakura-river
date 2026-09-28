// Life & particles: petals (air / river / settled), dust motes in sunbeams, river mist banks, birds, herons,
// fireflies, rain + splash crowns, branching lightning, floating paper lanterns, spirit wisps, glow-light manager.
import * as THREE from 'three';
import { RNG, clamp, lerp, smoothstep, simplex2 } from './noise.js';
import { TEX } from './textures.js';
import { SH, GLSL_COMMON, MAX_GLOW, patch, MAT } from './materials.js';
import { PETAL_SOURCES } from './veg.js';
import { surfaceFast, groundFast, worldToSD, flowWorld, halfWidth, sdToWorld, obstacles, LAYOUT, bridgeDeckAt, center, S_MAX } from './world.js';
import { BOAT } from './boat.js';
import { hullHalf } from './water.js';
import { ARCH } from './arch.js';
import { ENV } from './cycle.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const rng = new RNG(9001);
export const FX = {};

// ---------------------------------------------------------------- petals
function petalGeo() {
  const g = new THREE.PlaneGeometry(0.05, 0.06, 2, 2);
  const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, (x * x) * 10 + y * y * 3); }
  g.computeVertexNormals(); return g;
}
function initPetals(scene) {
  const N = 2600;
  const mat = new THREE.MeshStandardMaterial({ map: TEX.petal, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.6, color: 0xffffff });
  patch(mat, { key: 'petal', transl: new THREE.Color(1.0, 0.55, 0.6), wet: false });
  const im = new THREE.InstancedMesh(petalGeo(), mat, N);
  im.frustumCulled = false; im.castShadow = false; im.receiveShadow = true;
  scene.add(im);
  const P = [];
  for (let i = 0; i < N; i++) P.push({ st: 3, x: 0, y: -99, z: 0, vx: 0, vy: 0, vz: 0, rx: rng.range(0, 6), ry: rng.range(0, 6), rz: 0, wx: rng.range(-4, 4), wy: rng.range(-4, 4), ph: rng.range(0, 6), age: 0, life: 0, s: null, sc: rng.range(0.8, 1.25), delay: rng.range(0, 8) });
  FX.petals = { im, P };
  // settled petals (static) on banks near cherries, the stairs, bridge deck and terrace walk
  const S = [];
  for (const src of PETAL_SOURCES) {
    if (rng.next() > 0.55) continue;
    for (let k = 0; k < 8; k++) {
      const x = src.x + rng.gauss() * 2.6, z = src.z + rng.gauss() * 2.6;
      const g = surfaceFast(x, z); if (g < 0.02) continue;
      S.push([x, g + 0.012, z]);
    }
  }
  const B = LAYOUT.bridge;
  for (let k = 0; k < 900; k++) { const al = rng.range(-B.half, B.half), ac = rng.range(-1.3, 1.3); const x = B.cx + B.ax * al + B.tx * ac, z = B.cz + B.az * al + B.tz * ac; S.push([x, bridgeDeckAt(x, z) + 0.004, z]); }
  const st = LAYOUT.stairs; const n = Math.ceil((st.hb - st.ha) / 0.22);
  for (let k = 0; k < 500; k++) {
    const i = rng.int(0, n - 1); const t = (i + rng.range(0.1, 0.9)) / n; const lat = rng.range(-1.4, 1.4);
    const dx = st.bx - st.ax, dz = st.bz - st.az, L = Math.hypot(dx, dz);
    const x = st.ax + dx * t + dz / L * lat, z = st.az + dz * t - dx / L * lat;
    S.push([x, st.ha + (i + 1) * (st.hb - st.ha) / n + 0.006, z]);
  }
  for (const seg of [LAYOUT.paths.walk, LAYOUT.paths.approach]) for (let k = 0; k < 500; k++) {
    const i = rng.int(0, seg.length - 2); const t = rng.next(); const a = seg[i], b = seg[i + 1];
    const x = lerp(a.x, b.x, t) + rng.range(-2.5, 2.5), z = lerp(a.z, b.z, t) + rng.range(-2.5, 2.5);
    S.push([x, surfaceFast(x, z) + 0.03, z]);
  }
  const sim = new THREE.InstancedMesh(petalGeo(), mat, S.length);
  S.forEach((p, i) => { _m.compose(_p.set(p[0], p[1], p[2]), _q.setFromEuler(_e.set(-Math.PI / 2 + rng.range(-0.3, 0.3), rng.range(0, 6.28), rng.range(-0.3, 0.3), 'YXZ')), _s.setScalar(rng.range(0.8, 1.3))); sim.setMatrixAt(i, _m); });
  sim.computeBoundingSphere(); sim.receiveShadow = true; scene.add(sim);
}
function spawnPetal(p, cam) {
  // choose a source within reach of the camera
  let src = null;
  for (let tries = 0; tries < 12; tries++) { const c = PETAL_SOURCES[rng.int(0, PETAL_SOURCES.length - 1)]; if (c && Math.hypot(c.x - cam.x, c.z - cam.z) < 95) { src = c; break; } }
  if (src) { p.x = src.x + rng.range(-1.5, 1.5); p.y = src.y + rng.range(-1, 1); p.z = src.z + rng.range(-1.5, 1.5); }
  else { const a = rng.range(0, 6.28), r = rng.range(5, 60); p.x = cam.x + Math.cos(a) * r; p.z = cam.z + Math.sin(a) * r; p.y = surfaceFast(p.x, p.z) + rng.range(6, 16); }
  p.vx = 0; p.vy = -0.5; p.vz = 0; p.st = 0; p.age = 0; p.life = rng.range(30, 60); p.s = null;
}
function updatePetals(dt, t, cam) {
  const { im, P } = FX.petals;
  const w = SH.uWind.value;
  const gust = SH.uGust.value;
  const fwd = { x: Math.cos(BOAT.psi), z: -Math.sin(BOAT.psi) };
  const rainKill = ENV.rain;
  for (let i = 0; i < P.length; i++) {
    const p = P[i];
    if (p.st === 3) { p.delay -= dt; if (p.delay <= 0) spawnPetal(p, cam); else { _m.makeScale(0, 0, 0); im.setMatrixAt(i, _m); continue; } }
    p.age += dt;
    if (p.st === 0) {
      const front = 0.6 + 0.8 * gust * (0.5 + 0.5 * Math.sin(t * 0.6 - (p.x * w.x + p.z * w.y) * 0.05));
      const tx = w.x * w.z * 1.6 * front + Math.sin(t * 2.3 + p.ph) * 0.5, tz = w.y * w.z * 1.6 * front + Math.cos(t * 1.9 + p.ph) * 0.5;
      const ty = -0.62 - rainKill * 2.5 + Math.sin(t * 3.1 + p.ph) * 0.35;
      const k = 1 - Math.exp(-dt * 2.2);
      p.vx += (tx - p.vx) * k; p.vy += (ty - p.vy) * k; p.vz += (tz - p.vz) * k;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rx += p.wx * dt; p.ry += p.wy * dt;
      const g = surfaceFast(p.x, p.z);
      if (p.y <= Math.max(g, 0.012)) {
        if (g < 0.0) { p.st = 1; p.y = 0.012; p.age = 0; p.life = rng.range(40, 80); }
        else { p.st = 2; p.y = g + 0.012; p.age = 0; p.life = rng.range(15, 35); p.rx = -Math.PI / 2 + rng.range(-0.3, 0.3); }
      }
      if (p.age > 40) p.st = 3;
    } else if (p.st === 1) {
      const q = worldToSD(p.x, p.z, p.s); p.s = q.s;
      const f = flowWorld(q.s, q.d);
      let vx = f.x + Math.sin(t * 0.7 + p.ph) * 0.04, vz = f.z + Math.cos(t * 0.6 + p.ph) * 0.04;
      // part around the boat hull
      const rx = p.x - BOAT.x, rz = p.z - BOAT.z; const lx = rx * fwd.x + rz * fwd.z, lz = -rx * fwd.z * -1 * -1 + 0;
      const lz2 = rx * Math.sin(BOAT.psi) + rz * Math.cos(BOAT.psi);
      const hb = hullHalf(lx);
      if (hb > 0 && Math.abs(lz2) < hb + 0.9) { const push = (hb + 0.9 - Math.abs(lz2)) * 2.5 * Math.sign(lz2 || 1); vx += Math.sin(BOAT.psi) * push; vz += Math.cos(BOAT.psi) * push; }
      p.x += vx * dt; p.z += vz * dt; p.y = 0.012;
      p.ry += dt * 0.2 * Math.sin(p.ph); p.rx = -Math.PI / 2;
      if (groundFast(p.x, p.z) > 0.0) { p.st = 2; p.y = groundFast(p.x, p.z) + 0.012; p.age = 0; p.life = rng.range(10, 25); }
      if (p.age > p.life || Math.hypot(p.x - cam.x, p.z - cam.z) > 150) p.st = 3;
    } else if (p.st === 2) {
      if (p.age > p.life) { p.st = 3; p.delay = rng.range(0, 3); }
    }
    let sc = p.sc;
    if (p.st === 2) sc *= clamp((p.life - p.age) / 3, 0, 1);
    if (p.st === 1) sc *= clamp((p.life - p.age) / 3, 0, 1);
    _m.compose(_p.set(p.x, p.y, p.z), _q.setFromEuler(_e.set(p.rx, p.ry, p.rz)), _s.setScalar(sc));
    im.setMatrixAt(i, _m);
  }
  im.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- dust motes (only inside sunbeams)
function initMotes(scene) {
  const N = 2200; const pos = new Float32Array(N * 3), rnd = new Float32Array(N);
  for (let i = 0; i < N; i++) { pos[i * 3] = rng.range(0, 1); pos[i * 3 + 1] = rng.range(0, 1); pos[i * 3 + 2] = rng.range(0, 1); rnd[i] = rng.next(); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aR', new THREE.BufferAttribute(rnd, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, SH, { uBox: { value: V(46, 18, 46) }, uCenter: { value: V() }, tShadow: { value: null }, uShadowMat: { value: new THREE.Matrix4() }, uAmt: { value: 0 }, uPx: { value: 1 } }),
    vertexShader: `${GLSL_COMMON}
      uniform vec3 uBox; uniform vec3 uCenter; uniform sampler2DShadow tShadow; uniform mat4 uShadowMat; uniform float uAmt; uniform float uPx;
      attribute float aR; varying float vA;
      void main(){
        vec3 drift = vec3(sin(uTime*0.13+aR*40.)*2.0, sin(uTime*0.07+aR*23.)*1.2 + uTime*0.05, cos(uTime*0.11+aR*31.)*2.0) + vec3(uWind.x, 0.0, uWind.y)*uTime*0.25;
        vec3 p = mod(position*uBox + drift - (uCenter - uBox*0.5), uBox) + (uCenter - uBox*0.5);
        vec4 sc = uShadowMat*vec4(p,1.0); sc.xyz/=sc.w;
        float lit = 0.0;
        if (sc.x>0.0 && sc.x<1.0 && sc.y>0.0 && sc.y<1.0 && sc.z<1.0) lit = texture(tShadow, vec3(sc.xy, sc.z-0.001));
        vec3 dir = normalize(p - cameraPosition);
        float fwd = pow(max(dot(dir, uTrueSun),0.0), 4.0);
        vA = lit*uAmt*(0.15 + 1.6*fwd)*(0.5+0.5*sin(uTime*2.0+aR*50.));
        vec4 mv = viewMatrix*vec4(p,1.0);
        gl_Position = projectionMatrix*mv;
        gl_PointSize = (1.2 + aR*1.6) * uPx * 26.0 / max(1.0, -mv.z) ;
        if (-mv.z < 0.6) vA = 0.0;
      }`,
    fragmentShader: `uniform vec3 uSunCol; varying float vA; void main(){ vec2 d = gl_PointCoord-0.5; float a = smoothstep(0.5,0.0,length(d)); gl_FragColor = vec4(uSunCol*vA*a*0.35, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.layers.set(3); scene.add(pts);
  FX.motes = { pts, mat };
}

// ---------------------------------------------------------------- mist banks
function initMist(scene) {
  const N = 70;
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2)); g.setIndex([0, 1, 2, 0, 2, 3]);
  const aP = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4); aP.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aP', aP); g.instanceCount = N;
  const mat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, SH, { tDepth: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uAmt: { value: 0.5 }, uHemi: { value: new THREE.Color() }, uFade: { value: 0 } }),
    vertexShader: `attribute vec4 aP; varying vec2 vUv; varying vec3 vWPm; varying float vSeed; varying vec4 vClip;
      void main(){ vUv = uv; vSeed = fract(aP.w*7.13);
        vec3 c = aP.xyz; float sz = 14.0 + fract(aP.w*3.7)*26.0;
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(0.0,1.0,0.0);
        vec3 p = c + right*position.x*sz + up*position.y*sz*0.32;
        vWPm = p; vec4 cp = projectionMatrix*viewMatrix*vec4(p,1.0); vClip = cp; gl_Position = cp; }`,
    fragmentShader: `${GLSL_COMMON}
      uniform sampler2D tDepth; uniform sampler2D tNoise; uniform float uAmt; uniform vec3 uHemi; uniform float uFade;
      varying vec2 vUv; varying vec3 vWPm; varying float vSeed; varying vec4 vClip;
      void main(){
        vec2 q = vUv*2.0-1.0;
        float n = texture2D(tNoise, vUv*vec2(0.9,0.35) + vec2(uTime*0.004 + vSeed, vSeed*3.1)).r*0.65 + texture2D(tNoise, vUv*vec2(2.1,0.8) - vec2(uTime*0.006, 0.0) + vSeed).g*0.45;
        float shape = smoothstep(1.0, 0.25, length(q*vec2(1.0,1.15))) * smoothstep(0.35, 0.75, n);
        vec2 suv = (vClip.xy/vClip.w)*0.5+0.5;
        float sceneD = texture2D(tDepth, suv).a; float myD = vClip.w;
        float soft = clamp((sceneD - myD)/3.0, 0.0, 1.0);
        float camFade = smoothstep(4.0, 16.0, myD) * (1.0 - smoothstep(260.0, 420.0, myD));
        float a = shape*soft*camFade*uAmt*0.26*smoothstep(0.0, 1.4, vWPm.y);
        vec3 dir = normalize(vWPm - cameraPosition);
        float fs = pow(max(dot(dir, uTrueSun), 0.0), 5.0);
        vec3 col = uFogCol*0.55 + uHemi*0.5 + uSunCol*(0.12 + fs*0.9)*0.5 + glowLight(vWPm, vec3(0.,1.,0.))*1.4 + uFlashCol*uFlash*0.4;
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true, depthWrite: false,
  });
  mat.uniforms.tNoise = { value: TEX.noise };
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.layers.set(3); scene.add(mesh);
  const M = [];
  for (let i = 0; i < N; i++) M.push({ s: 0, d: 0, y: 0, seed: rng.next(), init: false });
  FX.mist = { mesh, mat, aP, M };
}
function updateMist(dt, t) {
  const { aP, M, mat } = FX.mist;
  for (let i = 0; i < M.length; i++) {
    const m = M[i];
    const rel = m.s - BOAT.s;
    if (!m.init || rel < -120 || rel > 260) {
      m.s = BOAT.s + (m.init ? (rel < -120 ? rng.range(200, 260) : rng.range(-110, -60)) : rng.range(-100, 250));
      const w = halfWidth(m.s); m.d = rng.range(-w - 4, w + 4); m.y = rng.range(0.6, 3.2); m.init = true;
    }
    m.s -= dt * 0.35;
    const p = sdToWorld(m.s, m.d, _p);
    aP.array[i * 4] = p.x; aP.array[i * 4 + 1] = m.y + Math.sin(t * 0.1 + m.seed * 6) * 0.3; aP.array[i * 4 + 2] = p.z; aP.array[i * 4 + 3] = m.seed;
  }
  aP.needsUpdate = true;
}

// ---------------------------------------------------------------- birds + herons
function birdGeo(span, body) {
  const pos = [], flap = [], idx = [];
  const add = (x, y, z, f) => { pos.push(x, y, z); flap.push(f); return pos.length / 3 - 1; };
  const b0 = add(body * 0.6, 0, 0, 0), b1 = add(-body * 0.5, 0, 0, 0), b2 = add(0, 0.03 * body, 0.05 * body, 0), b3 = add(0, 0.03 * body, -0.05 * body, 0);
  idx.push(b0, b2, b1, b0, b1, b3);
  for (const s of [-1, 1]) {
    const r0 = add(body * 0.18, 0, s * 0.04 * body, 0), r1 = add(-body * 0.14, 0, s * 0.04 * body, 0);
    const m0 = add(body * 0.08, 0, s * span * 0.25, 0.5), m1 = add(-body * 0.18, 0, s * span * 0.25, 0.5);
    const t0 = add(-body * 0.12, 0, s * span * 0.5, 1);
    idx.push(r0, m0, r1, r1, m0, m1, m0, t0, m1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aFlap', new THREE.Float32BufferAttribute(flap, 1)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function birdMat(color, key) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, side: THREE.DoubleSide });
  patch(m, { key, vertHead: 'attribute float aFlap; attribute vec2 aPh;', vertBegin: 'transformed.y += aFlap*sin(uTime*aPh.y + aPh.x)*0.9*abs(transformed.z)*0.9; transformed.x -= aFlap*0.05*cos(uTime*aPh.y+aPh.x)*abs(transformed.z);' });
  return m;
}
function initBirds(scene) {
  const flocks = 3, per = 16;
  const g = birdGeo(0.62, 0.32);
  const ph = new Float32Array(flocks * per * 2);
  for (let i = 0; i < flocks * per; i++) { ph[i * 2] = rng.range(0, 6.28); ph[i * 2 + 1] = rng.range(9, 12); }
  g.setAttribute('aPh', new THREE.InstancedBufferAttribute(ph, 2));
  const im = new THREE.InstancedMesh(g, birdMat(0x2a2624, 'bird'), flocks * per); im.frustumCulled = false; im.castShadow = true; scene.add(im);
  const B = [];
  for (let f = 0; f < flocks; f++) for (let k = 0; k < per; k++) B.push({ f, off: V(rng.gauss() * 7, rng.gauss() * 2.5, rng.gauss() * 7), ph: rng.range(0, 6) });
  FX.birds = { im, B, flocks: Array.from({ length: flocks }, (_, i) => ({ ph: i * 2.1, r: 60 + i * 25, h: 55 + i * 18, sp: 0.05 + i * 0.012, ahead: 60 + i * 70 })) };
  // herons: larger grey birds with trailing legs
  const hg = birdGeo(1.8, 0.95);
  const hph = new Float32Array(4); hph[0] = 0; hph[1] = 5.2; hph[2] = 1.3; hph[3] = 5.0;
  hg.setAttribute('aPh', new THREE.InstancedBufferAttribute(hph, 2));
  const hm = new THREE.InstancedMesh(hg, birdMat(0x8a8d90, 'heron'), 2); hm.castShadow = true; hm.frustumCulled = false; scene.add(hm);
  const neck = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.05, 0.5, 6), MAT.clothGrey, 2); neck.frustumCulled = false; scene.add(neck);
  const legs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012, 0.012, 0.75, 4), MAT.black, 2); legs.frustumCulled = false; scene.add(legs);
  FX.herons = { hm, neck, legs, t: -20, active: false, a: V(), b: V(), dur: 10 };
}
function updateBirds(dt, t) {
  const { im, B, flocks } = FX.birds;
  const vis = smoothstep(-0.02, 0.1, ENV.sunDir.y) * (1 - ENV.storm * 0.9);
  const c = center(Math.min(S_MAX - 50, BOAT.s + 80), {});
  for (let i = 0; i < B.length; i++) {
    const b = B[i]; const F = flocks[b.f];
    const cs = center(Math.min(S_MAX - 40, BOAT.s + F.ahead), {});
    const a = t * F.sp + F.ph;
    const cx = cs.x + Math.cos(a) * F.r, cz = cs.z + Math.sin(a) * F.r * 0.6, cy = F.h + Math.sin(a * 2.3) * 8;
    const x = cx + b.off.x + Math.sin(t * 0.4 + b.ph) * 2, y = cy + b.off.y + Math.sin(t * 0.7 + b.ph) * 1, z = cz + b.off.z + Math.cos(t * 0.5 + b.ph) * 2;
    const heading = Math.atan2(-(Math.cos(a) * F.r * 0.6), -Math.sin(a) * F.r);
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(0, heading, Math.sin(t + b.ph) * 0.2, 'YXZ')), _s.setScalar(vis > 0.01 ? 1 : 0));
    im.setMatrixAt(i, _m);
  }
  im.instanceMatrix.needsUpdate = true;
  // herons cross the river ahead of the boat now and then
  const H = FX.herons;
  H.t += dt;
  if (!H.active && H.t > 38 && vis > 0.5 && ENV.rain < 0.1) {
    const s = Math.min(S_MAX - 60, BOAT.s + 55); const w = halfWidth(s);
    const side = rng.sign();
    const a = sdToWorld(s - 8, side * (w + 30), {}), b = sdToWorld(s + 10, -side * (w + 35), {});
    H.a.set(a.x, 9, a.z); H.b.set(b.x, 13, b.z); H.dur = H.a.distanceTo(H.b) / 6.5; H.t = 0; H.active = true;
  }
  const show = H.active ? 1 : 0;
  const u = H.active ? H.t / H.dur : 0;
  if (H.active && u > 1) { H.active = false; H.t = 0; }
  for (let k = 0; k < 2; k++) {
    const uu = clamp(u - k * 0.06, 0, 1);
    const p = H.a.clone().lerp(H.b, uu); p.y += Math.sin(uu * Math.PI) * 3 + k * 1.2; p.x += k * 2.2; p.z += k * 1.5;
    const dir = H.b.clone().sub(H.a); const hd = Math.atan2(-dir.z, dir.x);
    const sc = show && uu > 0 && uu < 1 ? 1 : 0;
    _q.setFromEuler(_e.set(0, hd, 0, 'YXZ'));
    _m.compose(p, _q, _s.setScalar(sc)); H.hm.setMatrixAt(k, _m);
    const fwd = V(Math.cos(hd), 0, -Math.sin(hd));
    const np = p.clone().addScaledVector(fwd, 0.55).add(V(0, 0.08, 0));
    _m.compose(np, new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), fwd.clone().add(V(0, 0.4, 0)).normalize()), _s.setScalar(sc)); H.neck.setMatrixAt(k, _m);
    const lp = p.clone().addScaledVector(fwd, -0.75);
    _m.compose(lp, new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), fwd.clone().negate().add(V(0, 0.15, 0)).normalize()), _s.setScalar(sc)); H.legs.setMatrixAt(k, _m);
  }
  H.hm.instanceMatrix.needsUpdate = true; H.neck.instanceMatrix.needsUpdate = true; H.legs.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- fireflies
function initFireflies(scene) {
  const N = 420; const pos = new Float32Array(N * 3), rnd = new Float32Array(N);
  const F = [];
  for (let i = 0; i < N; i++) { rnd[i] = rng.next(); F.push({ s: 0, d: 0, y: 0, init: false, ph: rng.range(0, 6) }); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aR', new THREE.BufferAttribute(rnd, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, SH, { uAmt: { value: 0 }, uPx: { value: 1 } }),
    vertexShader: `uniform float uTime; uniform float uAmt; uniform float uPx; attribute float aR; varying float vA;
      void main(){ vec4 mv = viewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv;
        float blink = pow(max(0.0, sin(uTime*(1.2+aR*1.5) + aR*60.0)), 6.0);
        vA = blink*uAmt; gl_PointSize = uPx*(3.0 + 90.0/max(2.0,-mv.z)); }`,
    fragmentShader: `varying float vA; void main(){ float r = length(gl_PointCoord-0.5); float a = exp(-r*r*40.0) + exp(-r*r*8.0)*0.25; gl_FragColor = vec4(vec3(0.75,1.0,0.35)*vA*a*4.0, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.layers.set(2); scene.add(pts);
  FX.ff = { pts, mat, F, pos };
}
function updateFireflies(dt, t) {
  const { F, pos, mat, pts } = FX.ff;
  mat.uniforms.uAmt.value = ENV.fireflies * (1 - ENV.rain);
  pts.visible = ENV.fireflies > 0.01;
  if (!pts.visible) return;
  for (let i = 0; i < F.length; i++) {
    const f = F[i];
    if (!f.init || f.s < BOAT.s - 50 || f.s > BOAT.s + 90) {
      f.s = BOAT.s + rng.range(-40, 85); const w = halfWidth(f.s); f.d = rng.sign() * (w + rng.range(-1, 14)); f.init = true;
      const p = sdToWorld(f.s, f.d, {}); f.g = Math.max(0.1, groundFast(p.x, p.z)); f.y = rng.range(0.3, 2.4);
    }
    f.s += Math.sin(t * 0.3 + f.ph) * dt * 0.4; f.d += Math.cos(t * 0.23 + f.ph) * dt * 0.35;
    const p = sdToWorld(f.s, f.d, _p);
    pos[i * 3] = p.x; pos[i * 3 + 1] = f.g + f.y + Math.sin(t * 0.7 + f.ph) * 0.3; pos[i * 3 + 2] = p.z;
  }
  pts.geometry.attributes.position.needsUpdate = true;
}

// ---------------------------------------------------------------- rain + splash crowns
function initRain(scene) {
  const N = 9000;
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3)); g.setIndex([0, 1, 2, 0, 2, 3]);
  const off = new Float32Array(N * 4); for (let i = 0; i < N; i++) { off[i * 4] = rng.range(0, 1); off[i * 4 + 1] = rng.range(0, 1); off[i * 4 + 2] = rng.range(0, 1); off[i * 4 + 3] = rng.next(); }
  g.setAttribute('aO', new THREE.InstancedBufferAttribute(off, 4)); g.instanceCount = N;
  const mat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, SH, { uCam: { value: V() }, uAmt: { value: 0 }, uHemi: { value: new THREE.Color() } }),
    vertexShader: `uniform float uTime; uniform vec3 uCam; uniform vec3 uWind; uniform float uAmt; attribute vec4 aO; varying float vA; varying float vV;
      void main(){
        vec3 box = vec3(60.0, 34.0, 60.0);
        float sp = 9.5 + aO.w*3.0;
        vec3 vel = vec3(uWind.x*uWind.z*2.5, -sp, uWind.y*uWind.z*2.5);
        vec3 p = aO.xyz*box + vel*uTime*1.0;
        p = mod(p - (uCam - box*0.5), box) + (uCam - box*0.5);
        vec3 dir = normalize(vel);
        vec3 toCam = normalize(cameraPosition - p);
        vec3 side = normalize(cross(dir, toCam));
        float len = 0.55 + aO.w*0.35;
        vec3 wp = p + side*position.x*0.012 + dir*position.y*len;
        vA = (aO.w < uAmt ? 1.0 : 0.0) * smoothstep(1.5, 5.0, distance(p, cameraPosition)); vV = position.y;
        gl_Position = projectionMatrix*viewMatrix*vec4(wp,1.0); }`,
    fragmentShader: `uniform vec3 uHemi; uniform vec3 uFlashCol; uniform float uFlash; varying float vA; varying float vV; void main(){ gl_FragColor = vec4((uHemi*0.9 + uFlashCol*uFlash*0.6 + 0.04), vA*0.22*smoothstep(0.0,0.4,vV)); }`,
    transparent: true, depthWrite: false,
  });
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.layers.set(2); scene.add(mesh);
  // splash crowns
  const cg = new THREE.CylinderGeometry(0.06, 0.02, 0.06, 10, 1, true);
  const cm = new THREE.MeshBasicMaterial({ color: 0xcfd8dc, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
  const NC = 500; const crowns = new THREE.InstancedMesh(cg, cm, NC); crowns.frustumCulled = false; crowns.layers.set(2); scene.add(crowns);
  const C = []; for (let i = 0; i < NC; i++) C.push({ x: 0, z: 0, t: rng.range(0, 0.35), live: false });
  FX.rain = { mesh, mat, crowns, C };
}
function updateRain(dt, t, cam) {
  const R = FX.rain; const amt = ENV.rain;
  R.mat.uniforms.uAmt.value = amt; R.mat.uniforms.uCam.value.copy(cam);
  R.mesh.visible = amt > 0.01; R.crowns.visible = amt > 0.01;
  if (!R.mesh.visible) return;
  for (let i = 0; i < R.C.length; i++) {
    const c = R.C[i]; c.t += dt;
    if (c.t > 0.32) {
      c.t = 0; c.live = rng.next() < amt;
      const a = rng.range(0, 6.28), r = Math.sqrt(rng.next()) * 32; c.x = cam.x + Math.cos(a) * r; c.z = cam.z + Math.sin(a) * r;
      if (groundFast(c.x, c.z) > -0.05) c.live = false;
    }
    const u = c.t / 0.32; const s = c.live ? (0.4 + u * 1.4) : 0;
    _m.compose(_p.set(c.x, 0.02 + u * 0.03, c.z), _q.identity(), _s.set(s, s * (1 - u) * 1.6 + 0.01, s)); R.crowns.setMatrixAt(i, _m);
  }
  R.crowns.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- lightning
function initLightning(scene) {
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 7, 10), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat); mesh.frustumCulled = false; mesh.layers.set(2); scene.add(mesh);
  FX.bolt = { mesh, mat, t: 99, next: 6, flash: 0, dir: V(0, 1, 0), onStrike: null };
}
function makeBolt(start, end) {
  const segs = [];
  const rec = (a, b, disp, depth, w) => {
    if (depth === 0) { segs.push([a, b, w]); return; }
    const m = a.clone().lerp(b, 0.5); const L = a.distanceTo(b);
    m.add(V(rng.gauss(), rng.gauss() * 0.3, rng.gauss()).multiplyScalar(disp * L * 0.18));
    rec(a, m, disp, depth - 1, w); rec(m, b, disp, depth - 1, w);
    if (depth > 3 && rng.next() < 0.35) { const dir = b.clone().sub(a); const e = m.clone().add(dir.multiplyScalar(0.6).add(V(rng.gauss() * L * 0.3, -L * 0.2, rng.gauss() * L * 0.3))); rec(m, e, disp, depth - 2, w * 0.45); }
  };
  rec(start, end, 1.0, 8, 1.0);
  return segs;
}
function boltGeometry(segs, camPos) {
  const pos = [], idx = [];
  for (const [a, b, w] of segs) {
    const dir = b.clone().sub(a).normalize(); const toC = camPos.clone().sub(a).normalize(); const side = dir.clone().cross(toC).normalize().multiplyScalar(1.6 * w);
    const k = pos.length / 3;
    pos.push(a.x - side.x, a.y - side.y, a.z - side.z, a.x + side.x, a.y + side.y, a.z + side.z, b.x + side.x, b.y + side.y, b.z + side.z, b.x - side.x, b.y - side.y, b.z - side.z);
    idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); return g;
}
function updateLightning(dt, t, cam, camDir) {
  const L = FX.bolt;
  L.t += dt;
  const heavy = ENV.rain > 0.6 && ENV.storm > 0.8;
  if (heavy) L.next -= dt;
  if (heavy && L.next <= 0) {
    L.next = rng.range(4, 10); L.t = 0;
    const ang = Math.atan2(camDir.z, camDir.x) + rng.range(-0.9, 0.9);
    const dist = rng.range(450, 1300);
    const end = V(cam.x + Math.cos(ang) * dist, 0, cam.z + Math.sin(ang) * dist); end.y = Math.max(20, groundFast(end.x, end.z) === 80 ? 120 : groundFast(end.x, end.z)) + rng.range(40, 120);
    const start = end.clone().add(V(rng.range(-150, 150), 520, rng.range(-150, 150)));
    L.mesh.geometry.dispose(); L.mesh.geometry = boltGeometry(makeBolt(start, end), cam);
    L.dir.copy(start).sub(cam).normalize();
    L.dist = dist;
    if (L.onStrike) L.onStrike(dist);
  }
  // flicker envelope: 2-3 pulses
  const u = L.t;
  let f = 0;
  if (u < 0.9) f = Math.exp(-u * 9) + 0.7 * Math.exp(-Math.pow((u - 0.18) * 25, 2)) + 0.5 * Math.exp(-Math.pow((u - 0.42) * 20, 2));
  L.flash = f;
  L.mat.opacity = clamp(f * 1.3, 0, 1);
  L.mesh.visible = f > 0.01;
}

// ---------------------------------------------------------------- floating paper lanterns (toro nagashi)
function initToro(scene) {
  const N = 30;
  const base = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.05, 0.34), MAT.woodDark, N);
  const paper = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 0.3, 0.26), null, N);
  const pm = new THREE.MeshStandardMaterial({ color: 0xf3e6c8, roughness: 0.9, emissive: new THREE.Color(1.0, 0.55, 0.22), emissiveIntensity: 2.5 });
  patch(pm, { key: 'toro', transl: new THREE.Color(1, 0.6, 0.3) });
  paper.material = pm;
  const frame = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.03, 0.3), MAT.black, N);
  for (const m of [base, paper, frame]) { m.frustumCulled = false; scene.add(m); }
  const T = []; for (let i = 0; i < N; i++) T.push({ s: 0, d: 0, x: 0, z: 0, init: false, ph: rng.range(0, 6), vis: 0, rot: rng.range(0, 6) });
  FX.toro = { base, paper, frame, T, pm };
}
function updateToro(dt, t) {
  const { base, paper, frame, T } = FX.toro;
  const on = ENV.lanterns;
  const fwd = { x: Math.cos(BOAT.psi), z: -Math.sin(BOAT.psi) };
  for (let i = 0; i < T.length; i++) {
    const L = T[i];
    if (!L.init || L.s < BOAT.s - 40) {
      L.s = BOAT.s + (L.init ? rng.range(90, 170) : rng.range(-20, 160)); const w = halfWidth(L.s); L.d = rng.range(-w + 2.2, w - 2.2);
      const p = sdToWorld(L.s, L.d, {}); L.x = p.x; L.z = p.z; L.init = true; L.vis = 0;
    }
    const q = worldToSD(L.x, L.z, L.s); L.s = q.s; L.d = q.d;
    const f = flowWorld(q.s, q.d);
    let vx = f.x * 0.9, vz = f.z * 0.9;
    // part around the boat
    const rx = L.x - BOAT.x, rz = L.z - BOAT.z; const lx = rx * fwd.x + rz * fwd.z; const lz = rx * Math.sin(BOAT.psi) + rz * Math.cos(BOAT.psi);
    const hb = hullHalf(clamp(lx, -5.3, 5.4));
    if (lx > -6.5 && lx < 7.5) { const need = hb + 1.1; if (Math.abs(lz) < need) { const push = (need - Math.abs(lz)) * 3.0 * Math.sign(lz || 0.1); vx += Math.sin(BOAT.psi) * push; vz += Math.cos(BOAT.psi) * push; } }
    for (const o of obstacles) { const dx = L.x - o.x, dz = L.z - o.z, dd = Math.hypot(dx, dz); if (dd < o.r + 0.6) { vx += dx / dd * 1.5; vz += dz / dd * 1.5; } }
    const w = halfWidth(L.s); if (Math.abs(L.d) > w - 1.2) { const c = center(L.s, {}); const sg = -Math.sign(L.d); vx += c.nx * sg * 0.4; vz += c.nz * sg * 0.4; }
    L.x += vx * dt; L.z += vz * dt; L.rot += dt * 0.15 * Math.sin(L.ph);
    L.vis = lerp(L.vis, on, 1 - Math.exp(-dt * 0.8));
    const sc = L.vis > 0.02 ? 1 : 0;
    const bob = Math.sin(t * 1.7 + L.ph) * 0.012;
    const qq = _q.setFromEuler(_e.set(Math.sin(t * 1.3 + L.ph) * 0.05, L.rot, Math.cos(t * 1.1 + L.ph) * 0.05));
    _m.compose(_p.set(L.x, 0.015 + bob, L.z), qq, _s.setScalar(sc)); base.setMatrixAt(i, _m);
    _m.compose(_p.set(L.x, 0.19 + bob, L.z), qq, _s.setScalar(sc)); paper.setMatrixAt(i, _m);
    _m.compose(_p.set(L.x, 0.35 + bob, L.z), qq, _s.setScalar(sc)); frame.setMatrixAt(i, _m);
  }
  base.instanceMatrix.needsUpdate = paper.instanceMatrix.needsUpdate = frame.instanceMatrix.needsUpdate = true;
  FX.toro.pm.emissiveIntensity = 2.6 * on;
}

// ---------------------------------------------------------------- spirit wisps
function initWisps(scene) {
  const N = 4, TR = 48;
  const W = [];
  const coreMat = new THREE.ShaderMaterial({
    uniforms: { uI: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; vec4 mv = modelViewMatrix*vec4(0.,0.,0.,1.); mv.xy += position.xy; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform float uI; varying vec2 vUv; void main(){ float r = length(vUv-0.5)*2.0; float a = exp(-r*r*18.0)*3.0 + exp(-r*r*4.0)*0.5; gl_FragColor = vec4(vec3(0.62,0.85,1.0)*a*uI*2.5, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const trailMat = new THREE.ShaderMaterial({
    uniforms: { uI: { value: 0 } },
    vertexShader: `attribute float aT; varying float vT; void main(){ vT = aT; gl_Position = projectionMatrix*viewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform float uI; varying float vT; void main(){ float a = pow(1.0-vT, 2.2); gl_FragColor = vec4(vec3(0.5,0.78,1.0)*a*uI*0.9, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  for (let i = 0; i < N; i++) {
    const core = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), coreMat); core.frustumCulled = false; core.layers.set(2); scene.add(core);
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(TR * 2 * 3), at = new Float32Array(TR * 2), idx = [];
    for (let k = 0; k < TR; k++) { at[k * 2] = at[k * 2 + 1] = k / (TR - 1); if (k < TR - 1) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aT', new THREE.BufferAttribute(at, 1)); g.setIndex(idx);
    const trail = new THREE.Mesh(g, trailMat); trail.frustumCulled = false; trail.layers.set(2); scene.add(trail);
    W.push({ core, trail, hist: [], ph: rng.range(0, 100), s: 0, d: 0, p: V() });
  }
  FX.wisps = { W, coreMat, trailMat, TR };
}
function updateWisps(dt, t, cam) {
  const { W, coreMat, trailMat, TR } = FX.wisps;
  const I = ENV.wisps * (1 - ENV.rain);
  coreMat.uniforms.uI.value = I; trailMat.uniforms.uI.value = I;
  for (let i = 0; i < W.length; i++) {
    const w = W[i];
    const vis = I > 0.01;
    w.core.visible = w.trail.visible = vis;
    const s = BOAT.s + 14 + i * 9 + Math.sin(t * 0.11 + w.ph) * 10;
    const hw = halfWidth(s);
    const d = Math.sin(t * 0.17 + w.ph * 1.7) * (hw - 2) * 0.85;
    const p = sdToWorld(s, d, {});
    const y = 1.3 + Math.sin(t * 0.5 + w.ph) * 0.9 + Math.sin(t * 1.3 + w.ph * 2) * 0.25;
    w.p.set(p.x + Math.sin(t * 0.9 + w.ph) * 1.2, y, p.z + Math.cos(t * 0.8 + w.ph) * 1.2);
    w.core.position.copy(w.p);
    w.hist.unshift(w.p.clone()); if (w.hist.length > TR) w.hist.pop();
    const pos = w.trail.geometry.attributes.position.array;
    for (let k = 0; k < TR; k++) {
      const h = w.hist[Math.min(k, w.hist.length - 1)];
      const n = w.hist[Math.min(k + 1, w.hist.length - 1)];
      const dir = h.clone().sub(n); if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0); dir.normalize();
      const toC = cam.clone().sub(h).normalize(); const side = dir.cross(toC).normalize().multiplyScalar(0.16 * (1 - k / TR));
      pos[k * 6] = h.x - side.x; pos[k * 6 + 1] = h.y - side.y + (k / TR) * 0.25; pos[k * 6 + 2] = h.z - side.z;
      pos[k * 6 + 3] = h.x + side.x; pos[k * 6 + 4] = h.y + side.y + (k / TR) * 0.25; pos[k * 6 + 5] = h.z + side.z;
    }
    w.trail.geometry.attributes.position.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- glow light manager
const cands = [];
function updateGlows(cam) {
  cands.length = 0;
  const lamp = ENV.lanterns;
  if (lamp > 0.01) {
    for (const g of ARCH.glows) cands.push({ p: g.p, c: g.c, r: g.r, i: g.i * lamp });
    const lp = BOAT.lanternPos.clone().applyMatrix4(BOAT.group.matrixWorld);
    cands.push({ p: lp, c: new THREE.Color(1, 0.55, 0.22), r: 9, i: 1.4 * lamp });
    for (const L of FX.toro.T) if (L.vis > 0.05) cands.push({ p: V(L.x, 0.3, L.z), c: new THREE.Color(1, 0.55, 0.25), r: 4.5, i: 0.5 * L.vis });
  }
  const wi = ENV.wisps * (1 - ENV.rain);
  if (wi > 0.01) for (const w of FX.wisps.W) cands.push({ p: w.p, c: new THREE.Color(0.45, 0.72, 1.0), r: 11, i: 1.6 * wi });
  for (const c of cands) { const d2 = c.p.distanceToSquared(cam); c.score = c.i / (1 + d2 / (c.r * c.r * 4)); }
  cands.sort((a, b) => b.score - a.score);
  const n = Math.min(MAX_GLOW, cands.length);
  for (let i = 0; i < MAX_GLOW; i++) {
    if (i < n) { const c = cands[i]; SH.uGlowP.value[i].set(c.p.x, c.p.y, c.p.z, c.r); SH.uGlowC.value[i].set(c.c.r * c.i, c.c.g * c.i, c.c.b * c.i, 0); }
  }
  SH.uGlowN.value = n;
}

export function initEffects(scene) {
  initPetals(scene); initMotes(scene); initMist(scene); initBirds(scene); initFireflies(scene); initRain(scene); initLightning(scene); initToro(scene); initWisps(scene);
}
export function resetEffects() {
  for (const p of FX.petals.P) { p.st = 3; p.delay = rng.range(0, 3); }
  for (const m of FX.mist.M) m.init = false;
  for (const f of FX.ff.F) f.init = false;
  for (const L of FX.toro.T) L.init = false;
  for (const w of FX.wisps.W) w.hist.length = 0;
}
export function updateEffects(dt, t, camera, camDir) {
  const cam = camera.position;
  updatePetals(dt, t, cam);
  updateMist(dt, t);
  updateBirds(dt, t);
  updateFireflies(dt, t);
  updateRain(dt, t, cam);
  updateLightning(dt, t, cam, camDir);
  updateToro(dt, t);
  updateWisps(dt, t, cam);
  updateGlows(cam);
}
