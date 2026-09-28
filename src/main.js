import * as THREE from 'three';
import { TexGen, generateAll, TEX } from './textures.js';
import { SH, buildMaterials, MAT } from './materials.js';
import { buildLayout, buildObstacles, buildFlow, LAYOUT, S_MIN, LOOP_S, START_S, worldToSD, flowWorld, halfWidth, center } from './world.js';
import { buildTerrainData, buildTerrainMeshes } from './terrain.js';
import { buildVegMaterials, buildHeroVegetation, buildForest, buildBackgroundCherries, buildGroundCover, buildRocks, buildAzaleas } from './veg.js';
import { buildArchitecture, updateArch, ARCH } from './arch.js';
import { buildWater, WATER, hullHalf } from './water.js';
import { createSky, createMountains, SKYU, MTNU } from './sky.js';
import { buildBoat, updateBoat, resetBoat, BOAT } from './boat.js';
import { buildBoatman, updateBoatman, buildVillagers, updateVillagers, BM } from './characters.js';
import { initEffects, updateEffects, resetEffects, FX } from './effects.js';
import { Pipeline } from './post.js';
import { Soundscape } from './audio.js';
import { ChaseCam } from './camera.js';
import { updateEnv, ENV, hourFromLoop, loopFromHour, CYCLE_LEN } from './cycle.js';
import { RNG, clamp, lerp, smoothstep, fbm2 } from './noise.js';
import { heightAt } from './world.js';

const bar = document.getElementById('bar');
const loader = document.getElementById('loader');
const progress = (f) => { if (bar) bar.style.transform = `scaleX(${f})`; };
const frame = () => new Promise((r) => { let done = false; const f = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(() => setTimeout(f, 0)); setTimeout(f, 60); });

const S = { t: 0, loopT: 0, speed: 1, ff: false, fade: 0, fadeDir: 0, dprMax: 1.5, scale: 1, fpsAcc: 0, fpsN: 0, fpsT: 0, paused: false, manualStep: false };
let renderer, scene, camera, pipe, chase, key, hemi, sound, rng = new RNG(3);
const clock = { last: performance.now(), start() { this.last = performance.now(); }, getDelta() { const n = performance.now(); const d = (n - this.last) / 1000; this.last = n; return d; } };

async function init() {
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false;
  S.dprMax = Math.min(window.devicePixelRatio || 1, 1.75);
  S.scale = Math.min(window.devicePixelRatio || 1, 1.25);
  document.body.appendChild(renderer.domElement);
  renderer.domElement.style.opacity = '0';
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.3, 9000);
  progress(0.04); await frame();
  const tg = new TexGen(renderer);
  generateAll(tg, 1);
  SH.tNoise.value = TEX.noise;
  buildMaterials(); buildVegMaterials();
  progress(0.14); await frame();
  buildLayout(); buildObstacles();
  progress(0.18); await frame();
  buildFlow();
  progress(0.26); await frame();
  buildTerrainData();
  progress(0.38); await frame();
  buildHeroVegetation(scene);
  progress(0.46); await frame();
  buildForest(scene); buildBackgroundCherries(scene);
  progress(0.55); await frame();
  buildRocks(scene);
  buildArchitecture(scene);
  // azaleas along the approach, the terrace and the shrines
  const az = []; const r2 = new RNG(66);
  const P = LAYOUT.paths;
  for (const seg of [P.approach, P.walk]) for (let i = 0; i < seg.length - 1; i++) {
    const a = seg[i], b = seg[i + 1]; const L = Math.hypot(b.x - a.x, b.z - a.z);
    for (let d = 1.5; d < L; d += r2.range(2.5, 4.5)) { const t = d / L; const nx = -(b.z - a.z) / L, nz = (b.x - a.x) / L; const sg = r2.sign(); const off = sg * r2.range(3.4, 4.6); const x = a.x + (b.x - a.x) * t + nx * off, z = a.z + (b.z - a.z) * t + nz * off; az.push({ x, z, y: heightAt(x, z), sc: r2.range(0.5, 0.85), rot: r2.range(0, 6) }); }
  }
  for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 1.6 + 2.4; const x = LAYOUT.terrace.x + Math.sin(a) * 17.5, z = LAYOUT.terrace.z + Math.cos(a) * 17.5; az.push({ x, z, y: heightAt(x, z), sc: r2.range(0.6, 0.9), rot: a }); }
  buildAzaleas(scene, az);
  progress(0.64); await frame();
  buildGroundCover(scene);
  progress(0.72); await frame();
  buildTerrainMeshes(scene);
  buildWater(scene);
  createSky(scene);
  const cs = center(200, {}); createMountains(scene, cs.x, cs.z - 100);
  progress(0.8); await frame();
  buildBoat(scene); buildBoatman(); buildVillagers(scene);
  initEffects(scene);
  // lights
  key = new THREE.DirectionalLight(0xffffff, 3);
  key.castShadow = true;
  const q = 1;
  key.shadow.mapSize.set(4096, 4096);
  const sc = key.shadow.camera; sc.left = -75; sc.right = 75; sc.top = 75; sc.bottom = -75; sc.near = 1; sc.far = 900;
  key.shadow.bias = -0.00025; key.shadow.normalBias = 0.05; key.shadow.radius = 2.2;
  scene.add(key); scene.add(key.target);
  hemi = new THREE.HemisphereLight(0xbcd0ff, 0x4a4030, 1.0); scene.add(hemi);
  pipe = new Pipeline(renderer);
  // create the shadow map up front so shadow samplers are always bound to a real depth texture
  initShadow();
  FX.mist.mat.uniforms.tDepth.value = pipe.refr.texture;
  chase = new ChaseCam(camera, renderer.domElement);
  sound = new Soundscape();
  FX.bolt.onStrike = (d) => sound.thunder(d);
  resize(); addEventListener('resize', resize);
  setupInput();
  S.loopT = loopFromHour(7.6);
  progress(0.9); await frame();
  // warm up: compile shaders by rendering a few frames
  for (let i = 0; i < 3; i++) { step(1 / 30); await frame(); }
  // pick a quality tier from a short timed benchmark
  {
    const gl = renderer.getContext(); const px = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const tb = performance.now(); for (let i = 0; i < 6; i++) step(1 / 60); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const ms = (performance.now() - tb) / 6; S.benchMs = ms;
    if (ms > 30) { S.tier = 0; key.shadow.mapSize.set(2048, 2048); pipe.setQuality(0, 3); S.scale = Math.min(S.scale, 0.8); S.dprMax = 1.0; }
    else if (ms > 16) { S.tier = 1; key.shadow.mapSize.set(2048, 2048); pipe.setQuality(2, 2); S.scale = Math.min(S.scale, 1.0); S.dprMax = 1.25; }
    else S.tier = 2;
    if (key.shadow.map && S.tier < 2) { key.shadow.map.dispose(); key.shadow.map = null; initShadow(); }
    resize();
  }
  progress(1.0); await frame();
  renderer.domElement.style.transition = 'opacity 1.6s ease'; renderer.domElement.style.opacity = '1';
  loader.style.opacity = '0'; setTimeout(() => loader.remove(), 1800);
  clock.start();
  renderer.setAnimationLoop(loop);
}

function initShadow() {
  const tmp = new THREE.WebGLRenderTarget(4, 4); renderer.setRenderTarget(tmp); renderer.shadowMap.needsUpdate = true; camera.layers.set(0); renderer.render(scene, camera); renderer.setRenderTarget(null); tmp.dispose();
  WATER.mat.uniforms.tShadow.value = key.shadow.map.depthTexture; WATER.mat.uniforms.uHasShadow.value = 1; FX.motes.mat.uniforms.tShadow.value = key.shadow.map.depthTexture;
}
function resize() {
  const w = S.forceW || innerWidth, h = S.forceH || innerHeight;
  renderer.setPixelRatio(S.scale);
  renderer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  pipe.setSize(Math.floor(w * S.scale), Math.floor(h * S.scale));
  FX.motes.mat.uniforms.uPx.value = S.scale * h / 900;
  FX.ff.mat.uniforms.uPx.value = S.scale * h / 900;
}

function setupInput() {
  const map = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r' };
  addEventListener('keydown', (e) => {
    sound.start();
    if (map[e.code]) { BOAT.input[map[e.code]] = 1; e.preventDefault(); }
    if (e.code === 'KeyM') sound.toggle();
    if (e.code === 'Space' || e.code === 'KeyT') { S.ff = true; e.preventDefault(); }
  });
  addEventListener('keyup', (e) => { if (map[e.code]) BOAT.input[map[e.code]] = 0; if (e.code === 'Space' || e.code === 'KeyT') S.ff = false; });
  addEventListener('pointerdown', () => sound.start());
  addEventListener('wheel', () => sound.start(), { passive: true });
  addEventListener('blur', () => { for (const k in BOAT.input) BOAT.input[k] = 0; S.ff = false; });
}

const _v = new THREE.Vector3();
let wakeT = { k: 0, h: 0, s: 0, b: 0 };
function emitWake(dt) {
  const W = WATER.wake; const B = BOAT;
  const fx = Math.cos(B.psi), fz = -Math.sin(B.psi), rx = Math.sin(B.psi), rz = Math.cos(B.psi);
  const vf = Math.max(0, B.relSpeed);
  const k = Math.min(1, vf / 2.2);
  if (vf > 0.25) {
    wakeT.k += dt; wakeT.h += dt; wakeT.s += dt; wakeT.b += dt;
    while (wakeT.k > 0.06) { wakeT.k -= 0.06;
      for (const sd of [-1, 1]) {
        const ax = -fx + rx * sd * 0.36, az = -fz + rz * sd * 0.36; const al = Math.hypot(ax, az);
        W.emit({ x: B.x + fx * 5.0 + rx * sd * 0.28, z: B.z + fz * 5.0 + rz * sd * 0.28, vx: rx * sd * vf * 0.36, vz: rz * sd * vf * 0.36, dx: ax / al, dz: az / al, len: 1.1, wid: 0.6, grow: 0.3, growW: 0.1, amp: 0.055 * k, foam: 0.16 * k, life: 8, type: 0, damp: 0.02 });
      }
    }
    while (wakeT.h > 0.045) { wakeT.h -= 0.045;
      const hx = rng.range(-4.8, 3.8), sd = rng.sign(); const hb = hullHalf(hx) + 0.08;
      W.emit({ x: B.x + fx * hx + rx * sd * hb, z: B.z + fz * hx + rz * sd * hb, vx: rx * sd * 0.3, vz: rz * sd * 0.3, dx: fx, dz: fz, len: 1.3, wid: 0.8, grow: 0.5, growW: 0.35, amp: 0.02 * k, foam: 0.12 * k, life: 3.2, type: 1, damp: 0.6 });
    }
    while (wakeT.s > 0.07) { wakeT.s -= 0.07;
      W.emit({ x: B.x - fx * 5.3 + rx * rng.range(-0.5, 0.5), z: B.z - fz * 5.3 + rz * rng.range(-0.5, 0.5), vx: -fx * 0.25, vz: -fz * 0.25, dx: fx, dz: fz, len: 1.6, wid: 1.2, grow: 0.55, growW: 0.4, amp: 0.03 * k, foam: 0.12 * k, life: 4.5, type: 1, damp: 0.4 });
    }
    while (wakeT.b > 0.04) { wakeT.b -= 0.04;
      W.emit({ x: B.x + fx * 5.45, z: B.z + fz * 5.45, vx: 0, vz: 0, dx: fx, dz: fz, len: 1.0, wid: 0.75, grow: 0.3, growW: 0.4, amp: 0.05 * k, foam: 0.3 * k, life: 0.8, type: 1, damp: 0 });
    }
  }
}
function emitRing(x, z, size, amp) {
  WATER.wake.emit({ x, z, vx: 0, vz: 0, dx: 1, dz: 0, len: size, wid: size, grow: 2.4, growW: 2.4, amp, foam: 0.35, life: 2.2, type: 2, damp: 0 });
  if (size > 1) sound.splash(0.8);
}

let lastPlantState = '';
const sunUV = new THREE.Vector2(), raysTint = new THREE.Color();
function step(dt) {
  const ffMul = S.ff ? 14 : 1;
  S.t += dt;
  S.loopT += dt * ffMul;
  const hour = hourFromLoop(S.loopT);
  const E = updateEnv(hour, dt * ffMul);
  const t = S.t;
  // wind: slow direction drift + gusts
  const wa = 0.9 + 0.6 * Math.sin(t * 0.013) + 0.3 * fbm2(t * 0.01, 3.3, 2);
  const wstr = 0.55 + 0.35 * fbm2(t * 0.05, 1.7, 2) + E.storm * 0.9 + E.golden * 0.1;
  SH.uWind.value.set(Math.cos(wa), Math.sin(wa), Math.max(0.2, wstr));
  SH.uGust.value = clamp(0.5 + 0.8 * fbm2(t * 0.11, 9.1, 2), 0, 1.3);
  SH.uTime.value = t;
  // lighting uniforms
  SH.uSunDir.value.copy(E.keyDir); SH.uSunCol.value.copy(E.keyCol); SH.uTrueSun.value.copy(E.sunDir.y > -0.2 ? E.sunDir : E.moonDir);
  SH.uFogCol.value.copy(E.fog); SH.uFogSun.value.copy(E.fogS);
  SH.uFogP.value.set(E.fogDensity, lerp(0.009, 0.0012, E.storm), 0, 7);
  SH.uWet.value = E.wet; SH.uRain.value = E.rain; SH.uNight.value = E.night; SH.uLamp.value = E.lanterns;
  SH.uFlash.value = FX.bolt.flash * 1.6;
  key.color.copy(E.keyCol); key.intensity = 1;
  hemi.color.copy(E.hemiS); hemi.groundColor.copy(E.hemiG); hemi.intensity = 2.3 + FX.bolt.flash * 3;
  SKYU.uSunReal.value.copy(E.sunDir); SKYU.uZen.value.copy(E.zen); SKYU.uHor.value.copy(E.hor); SKYU.uMoonDir.value.copy(E.moonDir); SKYU.uSunI.value = E.sunI; SKYU.uMoonI.value = E.moonI;
  SKYU.uStars.value = E.stars; SKYU.uClouds.value = E.clouds; SKYU.uStorm.value = E.storm; SKYU.uGolden.value = E.golden; SKYU.uFlashDir.value.copy(FX.bolt.dir);
  MTNU.uHemiS.value.copy(E.hemiS); MTNU.uHemiG.value.copy(E.hemiG);
  for (const m of ARCH.lampMats) m.emissiveIntensity = 2.2 * E.lanterns;
  if (BOAT.lanternMat) BOAT.lanternMat.emissiveIntensity = 3.0 * E.lanterns;
  // simulation
  const thrust = updateBoatman(dt, t, emitRing);
  BOAT.thrustAcc = thrust;
  updateBoat(dt, t, thrust);
  if (BOAT.hit > 0.001) { S.hits = (S.hits || 0) + 1; S.hitMax = Math.max(S.hitMax || 0, BOAT.hit); S.hitS = BOAT.s; }
  if (BM.state === 'push' && lastPlantState !== 'push') sound.splash(0.5);
  lastPlantState = BM.state;
  updateVillagers(dt, t);
  updateArch(dt, t, SH.uWind.value);
  emitWake(dt);
  WATER.wake.update(dt, (x, z) => { const q = worldToSD(x, z, BOAT.s); return flowWorld(q.s, q.d); });
  // loop the journey at the head of the gorge
  if (BOAT.s > LOOP_S && S.fadeDir === 0) S.fadeDir = 1;
  if (S.fadeDir !== 0) {
    S.fade = clamp(S.fade + S.fadeDir * dt / 2.2, 0, 1);
    if (S.fade >= 1 && S.fadeDir > 0) { resetBoat(); BM.state = 'recover'; BM.t = 0.6; BM.relL.set(1.8, -1.0, 1.78); BOAT.group.updateMatrixWorld(true); resetEffects(); WATER.wake.p.length = 0; chase.snap = true; S.fadeDir = -1; }
    if (S.fade <= 0 && S.fadeDir < 0) S.fadeDir = 0;
  }
  chase.update(dt, BOAT, t);
  if (S.freeCam) { camera.position.fromArray(S.freeCam[0]); camera.lookAt(new THREE.Vector3().fromArray(S.freeCam[1])); camera.updateMatrixWorld(); }
  const camDir = _v.set(0, 0, -1).applyQuaternion(camera.quaternion);
  updateEffects(dt, t, camera, camDir);
  // shadow frustum follows the view focus (texel snapped)
  const focus = new THREE.Vector3(BOAT.x, 0, BOAT.z).addScaledVector(camDir.clone().setY(0).normalize(), 30);
  const texel = 150 / 4096;
  const kd = E.keyDir;
  const lightRot = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), kd.clone().negate(), new THREE.Vector3(0, 1, 0));
  const inv = lightRot.clone().invert();
  const fl = focus.clone().applyMatrix4(inv); fl.x = Math.round(fl.x / texel) * texel; fl.y = Math.round(fl.y / texel) * texel; focus.copy(fl.applyMatrix4(lightRot));
  key.target.position.copy(focus); key.position.copy(focus).addScaledVector(kd, 400);
  key.target.updateMatrixWorld(); key.updateMatrixWorld();
  // water uniforms
  const wu = WATER.mat.uniforms;
  wu.uCamFwd.value.copy(camDir);
  wu.uHemiS.value.copy(E.hemiS).multiplyScalar(0.9); wu.uHemiG.value.copy(E.hemiG);
  wu.uWakeP.value.copy(WATER.wake.uWakeP.value);
  wu.uBoat.value.set(BOAT.x, BOAT.z, Math.cos(BOAT.psi), -Math.sin(BOAT.psi));
  if (key.shadow.map && key.shadow.map.depthTexture) { wu.tShadow.value = key.shadow.map.depthTexture; wu.uHasShadow.value = 1; FX.motes.mat.uniforms.tShadow.value = key.shadow.map.depthTexture; }
  wu.uShadowMat.value.copy(key.shadow.matrix);
  FX.motes.mat.uniforms.uShadowMat.value.copy(key.shadow.matrix);
  FX.motes.mat.uniforms.uCenter.value.copy(camera.position).addScaledVector(camDir, 14);
  FX.motes.mat.uniforms.uAmt.value = E.sunI * (1 - E.rain) * (0.5 + E.golden);
  FX.motes.pts.visible = FX.motes.mat.uniforms.uAmt.value > 0.01 && !!FX.motes.mat.uniforms.tShadow.value;
  FX.mist.mat.uniforms.uAmt.value = E.mist; FX.mist.mat.uniforms.uHemi.value.copy(E.hemiS);
  FX.rain.mat.uniforms.uHemi.value.copy(E.hemiS);
  // god rays: sun on screen
  const sp = camera.position.clone().addScaledVector(E.sunDir, 4000).project(camera);
  const behind = E.sunDir.dot(camDir) < 0;
  sunUV.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
  const off = Math.max(Math.abs(sp.x), Math.abs(sp.y));
  const rays = behind ? 0 : E.godrays * (1 - smoothstep(0.9, 1.9, off)) * 0.9;
  raysTint.setRGB(1.0, lerp(0.92, 0.72, E.golden), lerp(0.85, 0.5, E.golden));
  sound.update(dt, Object.assign(E, { gorge: smoothstep(450, 700, BOAT.s) }), BOAT.speed, SH.uWind.value.z, t);
  // WebGL + post
  WATER.wake.render(renderer, BOAT.x - Math.cos(BOAT.psi) * 12, BOAT.z + Math.sin(BOAT.psi) * 12);
  pipe.render(scene, camera, {
    sunUV, rays, raysTint, exposure: E.exposure * (1 + FX.bolt.flash * 0.35), sat: E.sat, warm: E.warm, bloom: 0.55 + E.night * 0.35, bloomThr: 1.1,
    fade: S.fade, fadeCol: new THREE.Color().copy(E.fog).multiplyScalar(1.1).lerp(new THREE.Color(0.8, 0.82, 0.84), 0.4 * E.dayF), time: t, vig: 0.55,
  });
}

function loop() {
  if (S.manualStep) return;
  let dt = clock.getDelta(); dt = Math.min(dt, 1 / 20);
  step(dt);
  // adaptive resolution
  S.fpsAcc += dt; S.fpsN++;
  if (S.fpsAcc > 2.5) {
    const fps = S.fpsN / S.fpsAcc; S.fpsAcc = 0; S.fpsN = 0;
    let ns = S.scale;
    if (fps < 45) ns = Math.max(0.7, S.scale * 0.88); else if (fps > 58 && S.scale < S.dprMax) ns = Math.min(S.dprMax, S.scale * 1.06);
    if (Math.abs(ns - S.scale) > 0.03) { S.scale = ns; resize(); }
  }
}

// test hooks (no visual output)
window.__sk = {
  setHour(h) { S.loopT = loopFromHour(h); },
  hour() { return ENV.hour; },
  step(n = 1, dt = 1 / 30) { S.manualStep = true; for (let i = 0; i < n; i++) step(dt); },
  run() { S.manualStep = false; clock.getDelta(); },
  jump(s) { BOAT.s = s; const d = 0; const c = center(s, {}); BOAT.x = c.x; BOAT.z = c.z; BOAT.psi = Math.atan2(-c.tz, c.tx); chase.snap = true; },
  stats() { return { hits: S.hits || 0, hitMax: S.hitMax || 0, hitS: S.hitS, viol: BM.viol || 0, bridgeViol: BM.bridgeViol || 0, bedViol: BM.bedViol || 0, frames: BM.frames || 0, s: BOAT.s }; },
  info() { return { tier: S.tier, bench: S.benchMs, s: BOAT.s, d: BOAT.d, x: BOAT.x, z: BOAT.z, speed: BOAT.speed, rel: BOAT.relSpeed, hour: ENV.hour, scale: S.scale, state: BM.state, hit: BOAT.hit, cam: camera.position.toArray(), calls: renderer.info.render.calls, tris: renderer.info.render.triangles }; },
  cam(yaw, pitch, dist) { chase.yaw = yaw; chase.pitch = pitch; chase.tDist = dist; chase.dist = dist; chase.idle = 0; chase.snap = true; },
  bench(n = 30) { S.manualStep = true; const gl = renderer.getContext(); const px = new Uint8Array(4); step(1 / 60); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const t0 = performance.now(); for (let i = 0; i < n; i++) { step(1 / 60); } gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return (performance.now() - t0) / n; },
  free(p, t) { S.freeCam = p ? [p, t] : null; },
  layout() { return LAYOUT; },
  size(w, h) { S.forceW = w; S.forceH = h; resize(); },
  async shot(name, n = 1) {
    S.manualStep = true; for (let i = 0; i < n; i++) step(1 / 30);
    const url = renderer.domElement.toDataURL('image/jpeg', 0.88);
    await fetch('/save?name=' + encodeURIComponent(name), { method: 'POST', body: url });
    return url.length;
  },
  S, BOAT, ENV, get scene() { return scene; }, get FX() { return FX; }, get camera() { return camera; },
};

init().catch((e) => { console.error(e); });
