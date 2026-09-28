// Characters: the boatman (IK-driven poling with a planted pole, straw cape, hat),
// the woman with a red umbrella on the bridge, and the old monk sweeping petals.
import * as THREE from 'three';
import { lathe, box, cyl, tubeGeo } from './archkit.js';
import { MAT, patch, SH } from './materials.js';
import { TEX } from './textures.js';
import { BOAT, PLATFORM, yGunwale } from './boat.js';
import { hullHalf, HULL } from './water.js';
import { groundFast, heightAt, LAYOUT, overheadLimit } from './world.js';
import { ARCH } from './arch.js';
import { clamp, lerp, smoothstep } from './noise.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const ease = (t) => t * t * (3 - 2 * t);

function mesh(geo, mat, parent, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function bone(parent, x, y, z) { const b = new THREE.Group(); b.position.set(x, y, z); parent.add(b); return b; }

// orient bone so its -Y points along dir (world) with +X towards hint (world)
function aim(b, dir, hint) {
  const y = _v.copy(dir).normalize().negate();
  const x = _v2.copy(hint).addScaledVector(y, -hint.dot(y)); if (x.lengthSq() < 1e-8) x.set(1, 0, 0).addScaledVector(y, -y.x); x.normalize();
  const z = _v3.crossVectors(x, y);
  _m.makeBasis(x, y, z); _q.setFromRotationMatrix(_m);
  b.parent.getWorldQuaternion(_q2); _q2.invert();
  b.quaternion.copy(_q2.multiply(_q));
  b.updateMatrixWorld(true);
}
// orient bone so its +Z = zdir and -Y ~ ydir
function aimZ(b, zdir, ydir) {
  const z = _v.copy(zdir).normalize();
  const y = _v2.copy(ydir).negate(); y.addScaledVector(z, -y.dot(z)).normalize();
  const x = _v3.crossVectors(y, z);
  _m.makeBasis(x, y, z); _q.setFromRotationMatrix(_m);
  b.parent.getWorldQuaternion(_q2); _q2.invert();
  b.quaternion.copy(_q2.multiply(_q)); b.updateMatrixWorld(true);
}
function ik2(upper, lower, a, b, target, pole) {
  const S = upper.getWorldPosition(new THREE.Vector3());
  const d0 = target.clone().sub(S); let d = d0.length();
  const dir = d0.divideScalar(Math.max(d, 1e-5));
  d = clamp(d, Math.abs(a - b) + 0.01, a + b - 0.002);
  const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  const perp = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
  const E = S.clone().addScaledVector(dir, a * cosA).addScaledVector(perp, a * sinA);
  aim(upper, E.clone().sub(S), perp);
  const T = S.clone().addScaledVector(dir, d);
  aim(lower, T.clone().sub(E), perp);
  return T;
}

// ---------------------------------------------------------------- figure
function makeFigure(o) {
  const root = new THREE.Group();
  const pelvis = bone(root, 0, o.hip, 0);
  const spine = bone(pelvis, 0, 0.12, 0);
  const chest = bone(spine, 0, 0.24, 0);
  const neck = bone(chest, 0, 0.2, 0);
  const head = bone(neck, 0, 0.09, 0);
  const sh = [bone(chest, 0, 0.13, -0.19), bone(chest, 0, 0.13, 0.19)];
  const fore = [], hand = [], thigh = [], shin = [], foot = [];
  for (let k = 0; k < 2; k++) { fore.push(bone(sh[k], 0, -0.29, 0)); hand.push(bone(fore[k], 0, -0.26, 0)); }
  const hips = [bone(pelvis, 0, -0.03, -0.1), bone(pelvis, 0, -0.03, 0.1)];
  for (let k = 0; k < 2; k++) { thigh.push(hips[k]); shin.push(bone(hips[k], 0, -0.43, 0)); foot.push(bone(shin[k], 0, -0.42, 0)); }
  const skin = MAT.skin;
  // head
  const hg = lathe([[0.001, -0.11], [0.055, -0.105], [0.08, -0.065], [0.092, -0.01], [0.09, 0.045], [0.072, 0.088], [0.035, 0.11], [0.001, 0.115]], 18);
  mesh(hg, skin, head, 0, 0.1, 0, 1.0, 1, 0.9);
  mesh(new THREE.ConeGeometry(0.018, 0.045, 8), skin, head, 0.092, 0.09, 0).rotation.z = -Math.PI / 2;
  for (const s of [-1, 1]) { mesh(new THREE.SphereGeometry(0.02, 8, 6), skin, head, 0.0, 0.1, s * 0.083, 0.6, 1.2, 0.5); mesh(new THREE.SphereGeometry(0.009, 6, 4), MAT.hair, head, 0.082, 0.115, s * 0.03); mesh(box(0.035, 0.006, 0.012, 'x', 1), MAT.hair, head, 0.083, 0.132, s * 0.031); }
  mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.12, 12), skin, neck, 0, 0.03, 0);
  // torso + skirt
  const clo = o.cloth;
  mesh(lathe([[0.001, -0.31], [0.15, -0.31], [0.155, -0.16], [0.168, 0.0], [0.188, 0.11], [0.175, 0.17], [0.09, 0.215], [0.001, 0.225]], 20, 0.6), clo, chest, 0, 0, 0, 1, 1, 0.72);
  if (o.collar) mesh(new THREE.TorusGeometry(0.075, 0.02, 6, 16), o.collar, chest, 0.02, 0.2, 0, 1, 1, 0.9).rotation.x = Math.PI / 2;
  mesh(lathe(o.skirt || [[0.001, 0.12], [0.16, 0.12], [0.175, -0.04], [0.195, -0.24], [0.205, -0.3], [0.001, -0.28]], 20, 0.6), o.skirtMat || clo, pelvis, 0, 0, 0, 1, 1, 0.78);
  if (o.belt) mesh(new THREE.CylinderGeometry(0.162, 0.162, 0.07, 18), o.belt, pelvis, 0, 0.1, 0, 1, 1, 0.76);
  // arms
  for (let k = 0; k < 2; k++) {
    mesh(lathe(o.sleeve || [[0.001, 0.03], [0.07, 0.01], [0.075, -0.1], [0.066, -0.28], [0.001, -0.3]], 12, 0.5), o.sleeveMat || clo, sh[k]);
    mesh(lathe([[0.001, 0.01], [0.048, -0.02], [0.044, -0.14], [0.034, -0.25], [0.001, -0.27]], 12), skin, fore[k]);
    if (o.cuff) mesh(new THREE.TorusGeometry(0.047, 0.012, 6, 12), o.cuff, fore[k], 0, -0.03, 0).rotation.x = Math.PI / 2;
    // fist wrapped around local Z (grip axis)
    const fist = mesh(new THREE.TorusGeometry(0.036, 0.021, 8, 14), skin, hand[k], 0, -0.065, 0);
    mesh(new THREE.SphereGeometry(0.03, 8, 6), skin, hand[k], 0.0, -0.02, 0, 1, 1.1, 0.9);
    mesh(new THREE.SphereGeometry(0.014, 6, 4), skin, hand[k], 0.03, -0.055, k ? -0.03 : 0.03, 1.4, 1, 1);
  }
  // legs
  for (let k = 0; k < 2; k++) {
    mesh(lathe([[0.001, 0.03], [0.085, 0.0], [0.08, -0.2], [0.062, -0.42], [0.001, -0.44]], 14, 0.5), o.legMat || clo, thigh[k]);
    mesh(lathe([[0.001, 0.01], [0.056, -0.02], [0.05, -0.2], [0.04, -0.41], [0.001, -0.42]], 14, 0.5), o.shinMat || MAT.clothGrey, shin[k]);
    mesh(box(0.22, 0.065, 0.095, 'x', 0.4), o.footMat || MAT.clothGrey, foot[k], 0.055, -0.035, 0);
    mesh(box(0.25, 0.02, 0.105, 'x', 0.3), MAT.straw, foot[k], 0.06, -0.075, 0);
  }
  return { root, pelvis, spine, chest, neck, head, sh, fore, hand, thigh, shin, foot, hip: o.hip };
}

// ---------------------------------------------------------------- boatman
export const BM = { fig: null, pole: null, state: 'recover', t: 0, tipW: new THREE.Vector3(), tipL: new THREE.Vector3(), relL: new THREE.Vector3(), thrust: 0, lean: 0.2, drop: 0.03, twist: 0.3, capeU: null, splash: [] };
const POLE_L = 6.6;
const ROOT = { x: 3.3, z: 0.3, yaw: 0.36 };
const PLANT_OFF = { x: 0.35, z: 1.78 };
let capeMat;
export function buildBoatman() {
  const fig = makeFigure({ hip: 0.93, cloth: MAT.clothIndigo, legMat: MAT.clothIndigo, shinMat: MAT.clothGrey, collar: MAT.clothGrey, cuff: MAT.clothGrey, belt: MAT.clothBrown });
  BM.fig = fig;
  fig.root.position.set(ROOT.x, PLATFORM.y, ROOT.z);
  fig.root.rotation.y = -ROOT.yaw;
  BOAT.group.add(fig.root);
  // hat (sugegasa)
  const hat = new THREE.Mesh(lathe([[0.001, 0.2], [0.05, 0.18], [0.2, 0.08], [0.32, 0.005], [0.33, -0.01], [0.3, -0.004], [0.18, 0.06], [0.03, 0.12], [0.001, 0.13]], 28, 0.5), new THREE.MeshStandardMaterial({ map: TEX.straw.map, normalMap: TEX.straw.nrm, color: 0xe0cfa0, roughness: 0.9, side: THREE.DoubleSide }));
  patch(hat.material, { key: 'hat' });
  hat.position.set(0.01, 0.2, 0); hat.castShadow = true; fig.head.add(hat);
  mesh(new THREE.TorusGeometry(0.085, 0.01, 5, 16), MAT.rope, fig.head, 0, 0.16, 0).rotation.x = Math.PI / 2;
  // straw cape (mino): layered fringes hanging from the shoulders
  capeMat = new THREE.MeshStandardMaterial({ map: TEX.straw.map, normalMap: TEX.straw.nrm, color: 0xcbb483, roughness: 0.95, side: THREE.DoubleSide });
  BM.capeU = { uCapeOff: { value: new THREE.Vector3() }, uCapeT: { value: 0 } };
  patch(capeMat, { key: 'cape', uniforms: BM.capeU, vertHead: 'attribute float aHang; uniform vec3 uCapeOff; uniform float uCapeT;',
    vertBegin: `{ float hh = aHang*aHang; float fl = sin(uTime*7.0 + position.x*31.0 + position.z*17.0)*0.012 + sin(uTime*3.1 + position.x*9.0)*0.01;
      transformed += uCapeOff*hh + vec3(fl, 0.0, fl*0.8)*aHang*(0.5+uWind.z); }` });
  const pos = [], nor = [], uv = [], hang = [], idx = [];
  const layers = [[0.2, -0.02, 0.21, 0.36], [0.07, -0.2, 0.235, 0.44], [-0.1, -0.42, 0.26, 0.5]];
  for (const [yTop, yBot0, rTop, rBot] of layers) {
    const nS = 26;
    for (let i = 0; i < nS; i++) {
      const a0 = -Math.PI * 0.82 + (i / nS) * Math.PI * 1.64, a1 = a0 + (1.64 * Math.PI) / nS * 1.15;
      const len = 0.05 + (Math.sin(i * 12.9898) * 43758.5453 % 1 + 1) % 1 * 0.08;
      const base = pos.length / 3;
      for (let j = 0; j <= 3; j++) {
        const t = j / 3; const y = lerp(yTop, yBot0 - len, t); const r = lerp(rTop, rBot, t);
        for (const a of [a0, a1]) {
          const x = -Math.cos(a) * r * 0.85, z = Math.sin(a) * r;
          pos.push(x, y, z); nor.push(-Math.cos(a), 0.2, Math.sin(a)); uv.push(a * 0.6, t * 0.6); hang.push(clamp((0.22 - y) / 0.9, 0, 1));
        }
      }
      for (let j = 0; j < 3; j++) { const q = base + j * 2; idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
    }
  }
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); cg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  cg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); cg.setAttribute('aHang', new THREE.Float32BufferAttribute(hang, 1)); cg.setIndex(idx);
  const cape = new THREE.Mesh(cg, capeMat); cape.castShadow = true; cape.frustumCulled = false; fig.chest.add(cape);
  // bamboo pole (local +Y from the tip)
  const pg = cyl(0.019, 0.025, POLE_L, 10, 0.8); pg.translate(0, POLE_L / 2, 0);
  const pole = new THREE.Group(); const pm = new THREE.Mesh(pg, MAT.bamboo); pm.castShadow = true; pole.add(pm);
  for (let y = 0.3; y < POLE_L; y += 0.42) { const n = new THREE.Mesh(new THREE.TorusGeometry(0.024 - y * 0.0008, 0.006, 5, 10), MAT.bamboo); n.position.y = y; n.rotation.x = Math.PI / 2; pole.add(n); }
  BOAT.group.add(pole); BM.pole = pole;
  BM.state = 'recover'; BM.t = 0.5;
  BM.relL.set(ROOT.x - 1.5, -1.2, PLANT_OFF.z);
}

// pole must stay outside the hull, canopy and lantern pole
function poleClear(tip, top) {
  for (let i = 0; i <= 28; i++) {
    const p = _v.copy(tip).lerp(top, i / 28);
    if (p.x > HULL.xs - 0.05 && p.x < HULL.xb + 0.1) {
      const hb = hullHalf(Math.min(HULL.xb, Math.max(HULL.xs, p.x)));
      if (Math.abs(p.z) < hb + 0.07 && p.y < yGunwale(p.x) + 0.1 && p.y > -0.6) return false;
      if (p.x < 1.3 && p.x > -3.7 && Math.abs(p.z) < hb + 0.08 && p.y < yGunwale(p.x) + 1.45) return false;
    }
    if (p.x > 5.0 && p.x < 6.8 && Math.abs(p.z + 0.3) < 0.25 && p.y > 1.4 && p.y < 2.5) return false;
  }
  return true;
}
function toLocal(w, out) { return out.copy(w).applyMatrix4(_m.copy(BOAT.group.matrixWorld).invert()); }
function toWorld(l, out) { return out.copy(l).applyMatrix4(BOAT.group.matrixWorld); }

export function updateBoatman(dt, t, emitRing) {
  const f = BM.fig; const pw = BOAT.power ?? 1;
  const tipL = BM.tipL;
  let G = new THREE.Vector3();
  const xb = ROOT.x;
  const Gs = V(xb + 0.27, PLATFORM.y + 1.5, 0.73), Ge = V(xb - 0.12, PLATFORM.y + 1.03, 0.8);
  let thrust = 0;
  BM.t += dt;
  const plantLocal = (out) => {
    const w = toWorld(V(xb + PLANT_OFF.x, 0, PLANT_OFF.z), new THREE.Vector3());
    const bed = groundFast(w.x, w.z);
    return out.set(xb + PLANT_OFF.x, Math.max(bed, -3.4) - (BOAT.bob || 0) + 0.02, PLANT_OFF.z);
  };
  let pushP = 0;
  if (BM.state === 'plant') {
    const dur = 0.26;
    const u = Math.min(1, BM.t / dur);
    const target = plantLocal(new THREE.Vector3());
    tipL.set(target.x, lerp(0.25, target.y, ease(u)), target.z);
    G.copy(Gs).add(V(0, 0.08 * (1 - u), 0));
    BM.lean = lerp(BM.lean, 0.22, 0.2); BM.drop = lerp(BM.drop, 0.04, 0.2);
    if (u >= 1) { BM.state = 'push'; BM.t = 0; toWorld(tipL, BM.tipW); emitRing(BM.tipW.x, BM.tipW.z, 1.3, 0.09); }
  } else if (BM.state === 'push') {
    toLocal(BM.tipW, tipL);
    const dur = 1.55 / Math.sqrt(Math.max(0.3, pw));
    pushP = Math.min(1, BM.t / dur);
    const e = ease(pushP);
    G.copy(Gs).lerp(Ge, e);
    BM.lean = lerp(0.3, 0.85, e); BM.drop = lerp(0.05, 0.19, Math.sin(Math.min(1, pushP * 1.2) * Math.PI * 0.5)); BM.twist = lerp(0.25, 0.5, e);
    thrust = 1.45 * pw * Math.pow(Math.sin(Math.PI * clamp(pushP * 1.05, 0, 1)), 0.7);
    if (BOAT.brake) thrust = -0.4;
    const len = G.distanceTo(tipL);
    const top = G.clone().add(G.clone().sub(tipL).normalize().multiplyScalar(POLE_L - len));
    const bad = !poleClear(tipL, top);
    if (pushP >= 1 || len > POLE_L - 0.3 || tipL.x < xb - 3.0 || bad || (pw < 0.05 && !BOAT.brake)) { BM.state = 'recover'; BM.t = 0; BM.relL.copy(tipL); }
  } else {
    const dur = 0.95 / Math.sqrt(Math.max(0.5, pw));
    const u = Math.min(1, BM.t / dur); const e = ease(u);
    const pl = plantLocal(new THREE.Vector3());
    const r = BM.relL;
    const p1 = V(r.x, 0.7, 1.95), p2 = V(pl.x, 0.9, 1.95), p3 = V(pl.x, 0.25, PLANT_OFF.z);
    const s = e, is = 1 - s;
    tipL.set(0, 0, 0).addScaledVector(r, is * is * is).addScaledVector(p1, 3 * is * is * s).addScaledVector(p2, 3 * is * s * s).addScaledVector(p3, s * s * s);
    G.copy(Ge).lerp(Gs, ease(Math.min(1, u * 1.3)));
    G.y += Math.sin(u * Math.PI) * 0.12;
    BM.lean = lerp(BM.lean, 0.2, 1 - Math.exp(-dt * 5)); BM.drop = lerp(BM.drop, 0.03, 1 - Math.exp(-dt * 5)); BM.twist = lerp(BM.twist, 0.28, 1 - Math.exp(-dt * 5));
    if (u >= 1 && (pw > 0.05 || BOAT.brake)) { BM.state = 'plant'; BM.t = 0; }
  }
  // keep the pole top under the bridge deck: slide the pole deeper instead
  if (BM.state !== 'push') {
    for (let it = 0; it < 3; it++) {
      const ax3 = G.clone().sub(tipL); const l3 = ax3.length(); const topL = G.clone().addScaledVector(ax3.normalize(), POLE_L - l3);
      const tw = toWorld(topL, new THREE.Vector3()); const lim = overheadLimit(tw.x, tw.z);
      if (tw.y <= lim) break;
      tipL.y -= (tw.y - lim) * 1.3 + 0.05;
      const tipW2 = toWorld(tipL, new THREE.Vector3()); const bedW = groundFast(tipW2.x, tipW2.z) + 0.05;
      if (tipW2.y < bedW) tipL.y += bedW - tipW2.y;
    }
  }
  { const ax4 = G.clone().sub(tipL); const l4 = ax4.length(); const tw4 = toWorld(G.clone().addScaledVector(ax4.normalize(), POLE_L - l4), new THREE.Vector3());
    if (tw4.y > overheadLimit(tw4.x, tw4.z) + 0.5) BM.bridgeViol = (BM.bridgeViol || 0) + 1;
    const tw5 = toWorld(tipL, new THREE.Vector3()); if (tw5.y < groundFast(tw5.x, tw5.z) - 0.15) BM.bedViol = (BM.bedViol || 0) + 1; }
  BM.thrust = thrust;
  { const ax2 = G.clone().sub(tipL); const len2 = ax2.length(); const top2 = G.clone().addScaledVector(ax2.normalize(), POLE_L - len2);
    if (!poleClear(tipL, top2)) BM.viol = (BM.viol || 0) + 1; BM.frames = (BM.frames || 0) + 1; }
  BOAT.poleRoll = BM.state === 'push' ? 0.012 * Math.sin(pushP * Math.PI) : 0;
  // --- body FK
  const breathe = Math.sin(t * 1.7) * 0.006;
  f.pelvis.position.set(BM.lean * 0.12, f.hip - BM.drop, 0.0);
  f.pelvis.rotation.set(0, 0, -BM.lean * 0.35);
  f.spine.rotation.set(0, -BM.twist * 0.4, -BM.lean * 0.35);
  f.chest.rotation.set(0, -BM.twist * 0.6, -BM.lean * 0.4);
  f.chest.scale.set(1, 1 + breathe, 1 + breathe * 1.5);
  f.neck.rotation.set(0, BM.twist * 0.5, BM.lean * 0.45);
  f.head.rotation.set(0, BM.twist * 0.3 + Math.sin(t * 0.3) * 0.1, BM.lean * 0.35);
  f.root.updateMatrixWorld(true);
  // --- legs: feet planted on the platform
  const feet = [V(xb + 0.34, PLATFORM.y + 0.08, 0.12), V(xb - 0.36, PLATFORM.y + 0.08, 0.46)];
  const kneeHint = toWorld(V(1, 0, 0.25), new THREE.Vector3()).sub(toWorld(V(0, 0, 0), new THREE.Vector3())).normalize();
  const fwdW = kneeHint.clone();
  for (let k = 0; k < 2; k++) {
    const tw = toWorld(feet[k], new THREE.Vector3());
    ik2(f.thigh[k], f.shin[k], 0.43, 0.42, tw, fwdW);
    const fd = toWorld(V(1, -0.03, k ? 0.25 : 0.05), new THREE.Vector3()).sub(toWorld(V(0, 0, 0), new THREE.Vector3()));
    aim(f.foot[k], toWorld(V(0, -1, 0), new THREE.Vector3()).sub(toWorld(V(0, 0, 0), new THREE.Vector3())), fd);
  }
  // --- pole
  const tipW = toWorld(tipL, new THREE.Vector3());
  const GW = toWorld(G, new THREE.Vector3());
  const axis = GW.clone().sub(tipW).normalize();
  BM.pole.position.copy(tipL);
  const axL = G.clone().sub(tipL).normalize();
  BM.pole.quaternion.setFromUnitVectors(V(0, 1, 0), axL);
  // --- arms: upper (right) hand at G, lower (left) hand on the pole nearest the left shoulder
  const shL = f.sh[0].getWorldPosition(new THREE.Vector3());
  let sLow = clamp(GW.clone().sub(shL).dot(axis), 0.36, 0.78);
  const lowW = GW.clone().addScaledVector(axis, -sLow);
  const elbowOut = toWorld(V(-0.2, -1, 0.9), new THREE.Vector3()).sub(toWorld(V(0, 0, 0), new THREE.Vector3())).normalize();
  const elbowIn = toWorld(V(0.2, -1, -0.6), new THREE.Vector3()).sub(toWorld(V(0, 0, 0), new THREE.Vector3())).normalize();
  const grips = [lowW, GW];
  for (let k = 0; k < 2; k++) {
    const shW = f.sh[k].getWorldPosition(new THREE.Vector3());
    const tgt = grips[k].clone();
    const fdir = tgt.clone().sub(shW).normalize();
    const wrist = tgt.clone().addScaledVector(fdir, -0.065);
    ik2(f.sh[k], f.fore[k], 0.29, 0.26, wrist, k ? elbowOut : elbowIn);
    const hw = f.hand[k].getWorldPosition(new THREE.Vector3());
    aimZ(f.hand[k], axis, tgt.clone().sub(hw));
  }
  // cape follows gravity, wind and the strokes (offset in chest space)
  const inv = f.chest.getWorldQuaternion(new THREE.Quaternion()).invert();
  const gl = V(0, -1, 0).applyQuaternion(inv);
  const wind = SH.uWind.value; const wl = V(wind.x, 0, wind.y).multiplyScalar(0.1 * wind.z * (0.6 + 0.4 * Math.sin(t * 1.3))).applyQuaternion(inv);
  const acc = V(-(BOAT.thrustAcc || 0) * 0.03, 0, 0).applyQuaternion(inv);
  const off = gl.clone().sub(V(0, -1, 0)).multiplyScalar(0.75).add(wl).add(acc);
  BM.capeU.uCapeOff.value.lerp(off, 1 - Math.exp(-dt * 6));
  // ripple where the pole pierces the water during the push
  if (BM.state === 'push' || BM.state === 'plant') {
    if (tipW.y < 0 && GW.y > 0) {
      const u = -tipW.y / (GW.y - tipW.y); const px = lerp(tipW.x, GW.x, u), pz = lerp(tipW.z, GW.z, u);
      BM.splashT = (BM.splashT || 0) + dt; if (BM.splashT > 0.22) { BM.splashT = 0; emitRing(px, pz, 0.7, 0.035); }
    }
  }
  return thrust;
}

// ---------------------------------------------------------------- villagers
export const VIL = { woman: null, monk: null };
export function buildVillagers(scene) {
  // woman with a red oiled-paper umbrella at the bridge rail
  const W = makeFigure({ hip: 0.9, cloth: MAT.kimono, skirt: [[0.001, 0.12], [0.16, 0.12], [0.175, -0.1], [0.19, -0.5], [0.21, -0.86], [0.001, -0.86]], skirtMat: MAT.kimono, belt: MAT.obi, sleeve: [[0.001, 0.03], [0.08, 0.01], [0.09, -0.12], [0.1, -0.28], [0.001, -0.3]], collar: MAT.clothGrey });
  const wd = ARCH.woman;
  W.root.position.copy(wd.local); W.root.rotation.y = -Math.PI / 2;
  wd.group.add(W.root);
  for (const k of [0, 1]) { W.thigh[k].visible = true; }
  // obi bow and hair
  mesh(box(0.28, 0.2, 0.08, 'x', 0.3), MAT.obi, W.pelvis, -0.16, 0.12, 0);
  mesh(new THREE.SphereGeometry(0.075, 12, 8), MAT.hair, W.head, -0.02, 0.2, 0, 1.1, 0.8, 1.2);
  mesh(new THREE.SphereGeometry(0.1, 14, 10), MAT.hair, W.head, -0.01, 0.12, 0, 1.0, 1.05, 1.0).scale.set(1.02, 1.05, 1.0);
  mesh(cyl(0.004, 0.004, 0.22, 5), MAT.gold, W.head, -0.02, 0.21, 0).rotation.x = Math.PI / 2;
  // long hanging sleeves
  for (let k = 0; k < 2; k++) mesh(box(0.05, 0.36, 0.16, 'y', 0.5), MAT.kimono, W.fore[k], -0.06, -0.12, 0);
  // umbrella
  const umb = new THREE.Group();
  const shaft = new THREE.Mesh(cyl(0.012, 0.012, 1.15, 8), MAT.bamboo); shaft.position.y = 0.5; umb.add(shaft);
  const canopy = new THREE.Mesh(lathe([[0.001, 0.26], [0.06, 0.25], [0.3, 0.14], [0.56, 0.0], [0.57, -0.015]], 36, 0.6), MAT.umbrella); canopy.position.y = 1.0; canopy.castShadow = true; umb.add(canopy);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.565, 0.006, 4, 48), MAT.umbrella); ring.rotation.x = Math.PI / 2; ring.position.y = 0.99; umb.add(ring);
  for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2; const rib = new THREE.Mesh(box(0.52, 0.006, 0.006, 'x', 0.3), MAT.bamboo); rib.position.set(Math.cos(a) * 0.28, 1.0 + 0.12, Math.sin(a) * 0.28); rib.rotation.set(0, -a, -0.44); umb.add(rib); }
  for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2; const st = new THREE.Mesh(box(0.33, 0.005, 0.005, 'x', 0.3), MAT.bamboo); st.position.set(Math.cos(a) * 0.17, 0.87, Math.sin(a) * 0.17); st.rotation.set(0, -a, 0.55); umb.add(st); }
  const cap = new THREE.Mesh(cyl(0.035, 0.05, 0.05, 12), MAT.black); cap.position.y = 1.27; umb.add(cap);
  umb.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  W.root.add(umb);
  VIL.woman = { fig: W, umb };
  // monk sweeping the temple approach
  const Mk = makeFigure({ hip: 0.88, cloth: MAT.clothBlack, skirt: [[0.001, 0.12], [0.17, 0.12], [0.19, -0.1], [0.22, -0.5], [0.25, -0.84], [0.001, -0.84]], skirtMat: MAT.clothBlack, sleeve: [[0.001, 0.03], [0.085, 0.01], [0.1, -0.12], [0.11, -0.28], [0.001, -0.3]], collar: MAT.clothSaffron, belt: MAT.clothSaffron });
  const kesa = new THREE.Mesh(lathe([[0.001, -0.3], [0.158, -0.3], [0.163, -0.16], [0.176, 0.0], [0.196, 0.11], [0.183, 0.17], [0.095, 0.215], [0.001, 0.225]], 20, 0.6), MAT.clothSaffron); kesa.scale.set(1, 1, 0.74); kesa.castShadow = true; Mk.chest.add(kesa);
  const sash = new THREE.Mesh(box(0.36, 0.09, 0.3, 'x', 0.4), MAT.clothBrown); sash.position.set(0.0, 0.02, 0); sash.rotation.set(0, 0, 0.62); Mk.chest.add(sash);
  const broom = new THREE.Group();
  const handle = new THREE.Mesh(cyl(0.014, 0.016, 1.45, 8), MAT.bamboo); handle.position.y = 0.72; broom.add(handle);
  for (let k = 0; k < 26; k++) { const tw = new THREE.Mesh(box(0.006, 0.42, 0.006, 'y', 0.2), MAT.straw); const a = (k / 25 - 0.5) * 0.9; tw.position.set(Math.sin(a) * 0.12, -0.14, Math.cos(k * 2.1) * 0.03); tw.rotation.z = -a * 0.7; broom.add(tw); }
  const bind = new THREE.Mesh(cyl(0.03, 0.03, 0.08, 8), MAT.rope); bind.position.y = 0.02; broom.add(bind);
  broom.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  scene.add(Mk.root); scene.add(broom);
  const P = LAYOUT.paths.walk;
  VIL.monk = { fig: Mk, broom, a: P[0], b: P[1], u: 0.35, dir: 1 };
}

export function updateVillagers(dt, t) {
  const W = VIL.woman;
  if (W) {
    const f = W.fig;
    const br = Math.sin(t * 1.5) * 0.012;
    f.chest.scale.set(1, 1 + br, 1 + br * 1.4);
    f.pelvis.position.x = Math.sin(t * 0.37) * 0.012;
    f.spine.rotation.set(0, 0, 0.04);
    // look towards the boat
    const hp = f.head.getWorldPosition(new THREE.Vector3());
    const to = new THREE.Vector3(BOAT.x - hp.x, 0, BOAT.z - hp.z);
    const inv = f.chest.getWorldQuaternion(new THREE.Quaternion()).invert();
    to.applyQuaternion(inv);
    const yaw = clamp(Math.atan2(-to.z, to.x), -1.0, 1.0);
    W.yaw = lerp(W.yaw || 0, yaw, 1 - Math.exp(-dt * 1.5));
    f.neck.rotation.set(0, W.yaw * 0.45, 0.08);
    f.head.rotation.set(0, W.yaw * 0.55, 0.12 + Math.sin(t * 0.5) * 0.03);
    f.root.updateMatrixWorld(true);
    // right hand holds the umbrella shaft, left hand rests on the rail
    const umb = W.umb;
    umb.position.set(0.2, 0.62, 0.12);
    umb.rotation.set(Math.sin(t * 0.7) * 0.04 - 0.12, t * 0.05 % 6.28 * 0, -0.2 + Math.sin(t * 0.9) * 0.03);
    umb.updateMatrixWorld(true);
    const grip = new THREE.Vector3(0, 0.47, 0).applyMatrix4(umb.matrixWorld);
    const shaftDir = new THREE.Vector3(0, 1, 0).applyQuaternion(umb.getWorldQuaternion(new THREE.Quaternion()));
    const down = new THREE.Vector3(0, -1, 0);
    const out = new THREE.Vector3(0, 0, 1).applyQuaternion(f.root.getWorldQuaternion(new THREE.Quaternion()));
    ik2(f.sh[1], f.fore[1], 0.29, 0.26, grip.clone().addScaledVector(shaftDir, 0).add(new THREE.Vector3(0, 0, 0)), down.clone().add(out));
    aimZ(f.hand[1], shaftDir, grip.clone().sub(f.hand[1].getWorldPosition(new THREE.Vector3())));
    const railL = new THREE.Vector3(0.43, 0.9, -0.05).applyMatrix4(f.root.matrixWorld);
    ik2(f.sh[0], f.fore[0], 0.29, 0.26, railL, down.clone().sub(out));
    const rq = new THREE.Vector3(0, 0, 1).applyQuaternion(f.root.getWorldQuaternion(new THREE.Quaternion()));
    aimZ(f.hand[0], rq, down);
    // legs straight, feet on the deck
    for (let k = 0; k < 2; k++) { f.thigh[k].rotation.set(0, 0, 0); f.shin[k].rotation.set(0, 0, 0); }
  }
  const Mk = VIL.monk;
  if (Mk) {
    const f = Mk.fig;
    // slow walk back and forth along the walkway
    Mk.u += Mk.dir * dt * 0.035;
    if (Mk.u > 0.85) Mk.dir = -1; if (Mk.u < 0.15) Mk.dir = 1;
    const x = lerp(Mk.a.x, Mk.b.x, Mk.u), z = lerp(Mk.a.z, Mk.b.z, Mk.u);
    const y = heightAt(x, z);
    const pathDir = Math.atan2(Mk.b.x - Mk.a.x, Mk.b.z - Mk.a.z);
    f.root.position.set(x, y, z);
    f.root.rotation.y = pathDir - Math.PI / 2 * Mk.dir + Math.PI / 2 * 0 + (Mk.dir > 0 ? 0 : Math.PI);
    const sw = Math.sin(t * 1.6);
    f.pelvis.position.set(0.02, f.hip - 0.06 + Math.abs(sw) * 0.01, 0);
    f.spine.rotation.set(0, sw * 0.12, -0.28);
    f.chest.rotation.set(0, sw * 0.2, -0.12);
    const br = Math.sin(t * 1.3) * 0.01; f.chest.scale.set(1, 1 + br, 1 + br);
    f.neck.rotation.set(0, -sw * 0.15, 0.2); f.head.rotation.set(0, 0, 0.1);
    for (let k = 0; k < 2; k++) { f.thigh[k].rotation.set(0, 0, (k ? 1 : -1) * Math.sin(t * 0.8) * 0.08); f.shin[k].rotation.set(0, 0, 0.12); f.foot[k].rotation.set(0, 0, -0.1); }
    f.root.updateMatrixWorld(true);
    // broom: sweeping arc in front, head on the ground
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(f.root.quaternion);
    const side = new THREE.Vector3(0, 0, 1).applyQuaternion(f.root.quaternion);
    const headP = new THREE.Vector3(x, y + 0.04, z).addScaledVector(fwd, 0.75).addScaledVector(side, sw * 0.42);
    const topP = new THREE.Vector3(x, y + 1.25, z).addScaledVector(fwd, 0.12).addScaledVector(side, 0.12 + sw * 0.08);
    const dir = topP.clone().sub(headP).normalize();
    Mk.broom.position.copy(headP).addScaledVector(dir, 0.3);
    Mk.broom.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    Mk.broom.updateMatrixWorld(true);
    const g1 = headP.clone().addScaledVector(dir, 1.1), g2 = headP.clone().addScaledVector(dir, 0.72);
    const out = side.clone();
    ik2(f.sh[1], f.fore[1], 0.29, 0.26, g2.clone().addScaledVector(dir, -0.06), new THREE.Vector3(0, -1, 0).add(out));
    aimZ(f.hand[1], dir, g2.clone().sub(f.hand[1].getWorldPosition(new THREE.Vector3())));
    ik2(f.sh[0], f.fore[0], 0.29, 0.26, g1.clone().addScaledVector(dir, -0.06), new THREE.Vector3(0, -1, 0).sub(out));
    aimZ(f.hand[0], dir, g1.clone().sub(f.hand[0].getWorldPosition(new THREE.Vector3())));
    Mk.sweepPos = headP; Mk.sweepV = sw;
  }
}
