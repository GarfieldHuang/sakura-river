// Takasebune-style river cargo boat: planked hull with thickness, ribs, thwarts, floorboards, iron clamps,
// reed-mat canopy on bamboo hoops, cargo, bow lantern, stowed sculling oar. Plus boat physics + autopilot.
import * as THREE from 'three';
import { Builder, M, box, cyl, lathe, sweep, tubeGeo, surface } from './archkit.js';
import { MAT, patch } from './materials.js';
import { TEX } from './textures.js';
import { hullHalf, HULL } from './water.js';
import { smoothstep, clamp, lerp, RNG } from './noise.js';
import { worldToSD, sdToWorld, center, flowWorld, groundFast, obstacles, pathOffset, halfWidth, START_S, LAYOUT } from './world.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const yBottom = (x) => -0.24 + 0.62 * Math.pow(smoothstep(1.3, 5.5, x), 2) + 0.14 * smoothstep(-3.6, -5.4, x);
export const yGunwale = (x) => 0.42 + 0.38 * Math.pow(smoothstep(1.8, 5.5, x), 2) + 0.1 * smoothstep(-3.4, -5.4, x);
const bBottom = (x) => hullHalf(x) * 0.84;
export const PLATFORM = { x0: 2.55, x1: 4.35, y: 0.64 };

export const BOAT = {
  group: null, x: 0, z: 0, psi: 0, vx: 0, vz: 0, r: 0, heel: 0, heelV: 0, pitch: 0, pitchV: 0, bob: 0,
  s: START_S, d: 0, auto: true, idle: 99, steer: 0, power: 1, thrustAcc: 0, relSpeed: 0, speed: 0,
  lantern: null, lanternLight: null, lanternMat: null, input: { f: 0, b: 0, l: 0, r: 0 },
};

export function buildBoat(scene) {
  const g = new THREE.Group();
  const b = new Builder();
  const X0 = HULL.xs + 0.001, X1 = HULL.xb - 0.02, NX = 90;
  // hull side strakes (outer + inner skins, lapped seam at mid-height)
  for (const side of [-1, 1]) {
    for (const [t0, t1, lap] of [[0, 0.53, 0], [0.47, 1, 0.014]]) {
      const outer = surface(NX, 3, (u, v) => {
        const x = lerp(X0, X1, u); const t = lerp(t0, t1, v);
        const y = lerp(yBottom(x), yGunwale(x), t); const z = side * (lerp(bBottom(x), hullHalf(x), t) + lap);
        return V(x, y, z);
      }, true, (u, v, p) => [p.x / 1.4, p.y / 1.4 + side * 3]);
      // make outer normals point outward
      fixSide(outer, side);
      b.add(t1 === 1 ? 'hull' : 'hullLow', outer);
      const inner = surface(NX, 3, (u, v) => {
        const x = lerp(X0, X1, u); const t = lerp(t0, t1, v);
        const y = lerp(yBottom(x), yGunwale(x), t); const z = side * Math.max(0.01, lerp(bBottom(x), hullHalf(x), t) - 0.04 + lap);
        return V(x, y, z);
      }, true, (u, v, p) => [p.x / 1.4, p.y / 1.4]);
      fixSide(inner, -side);
      b.add('wood', inner);
    }
    // gunwale rail
    const gp = []; for (let i = 0; i <= 60; i++) { const x = lerp(X0 + 0.05, X1 - 0.05, i / 60); gp.push(V(x, yGunwale(x) + 0.02, side * (hullHalf(x) - 0.005))); }
    b.add('woodDark', sweep(gp, 0.075, 0.065, V(0, 1, 0), 1.2));
    // iron clamps across the strake seam and along the gunwale
    for (let x = -5.0; x < 5.0; x += 0.55) {
      const t = 0.5; const y = lerp(yBottom(x), yGunwale(x), t); const z = side * (lerp(bBottom(x), hullHalf(x), t) + 0.018);
      const ang = Math.atan2(yGunwale(x) - yBottom(x), (hullHalf(x) - bBottom(x)) * side);
      b.add('iron', box(0.03, 0.12, 0.012, 'y', 0.3), M(x, y, z, 0, 0, side * (Math.PI / 2 - Math.abs(ang)) * 0.3));
      b.add('iron', box(0.1, 0.012, 0.035, 'x', 0.3), M(x + 0.27, yGunwale(x + 0.27) + 0.058, side * (hullHalf(x + 0.27) - 0.005)));
    }
  }
  // flat bottom (outer + inner) in four planks
  for (let k = 0; k < 4; k++) {
    const z0 = -1 + k * 0.5 + 0.004, z1 = -1 + (k + 1) * 0.5 - 0.004;
    const bot = surface(NX, 1, (u, v) => { const x = lerp(X0, X1, u); const bb = bBottom(x); return V(x, yBottom(x), lerp(z0, z1, v) * bb); }, false, (u, v, p) => [p.x / 1.4, p.z / 1.4]);
    b.add('hullLow', bot);
    const top = surface(NX, 1, (u, v) => { const x = lerp(X0, X1, u); const bb = bBottom(x) - 0.035; return V(x, yBottom(x) + 0.04, lerp(z0, z1, v) * bb); }, true, (u, v, p) => [p.x / 1.4, p.z / 1.4 + k * 0.3]);
    b.add('wood', top);
  }
  // stem post at the bow and transom at the stern
  const stem = []; for (let i = 0; i <= 8; i++) { const t = i / 8; stem.push(V(X1 + 0.03 - t * 0.02, lerp(yBottom(X1) - 0.02, yGunwale(X1) + 0.12, t), 0)); }
  b.add('woodDark', sweep(stem, 0.13, 0.12, V(1, 0, 0), 1.0));
  {
    const x = X0; const shape = new THREE.Shape();
    shape.moveTo(-bBottom(x), yBottom(x)); shape.lineTo(bBottom(x), yBottom(x)); shape.lineTo(hullHalf(x), yGunwale(x)); shape.lineTo(-hullHalf(x), yGunwale(x)); shape.closePath();
    const tg = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false });
    tg.applyMatrix4(M(x + 0.03, 0, 0, Math.PI / 2)); b.add('woodDark', tg);
    for (const zz of [-0.5, 0, 0.5]) b.add('iron', box(0.012, 0.3, 0.05, 'y', 0.3), M(x - 0.005, (yBottom(x) + yGunwale(x)) / 2, zz));
  }
  // ribs
  for (let x = -4.6; x <= 4.8; x += 0.72) {
    const hb = hullHalf(x), bb = bBottom(x), yb = yBottom(x), yg = yGunwale(x);
    const pts = [V(x, yg - 0.05, -(hb - 0.07)), V(x, lerp(yb, yg, 0.5), -(lerp(bb, hb, 0.5) - 0.07)), V(x, yb + 0.08, -(bb - 0.08)), V(x, yb + 0.08, bb - 0.08), V(x, lerp(yb, yg, 0.5), lerp(bb, hb, 0.5) - 0.07), V(x, yg - 0.05, hb - 0.07)];
    b.add('woodDark', sweep(pts, 0.06, 0.07, V(1, 0, 0), 0.8));
  }
  // floorboards across the ribs
  for (let x = -4.35; x <= 2.35; x += 0.27) {
    const w = 2 * (bBottom(x) - 0.1);
    b.add('wood', box(0.24, 0.03, w, 'z', 1.0, x), M(x, yBottom(x) + 0.135, 0));
  }
  // thwarts
  for (const x of [-4.1, -1.25, 1.55, 2.4]) { const hb = hullHalf(x); b.add('woodDark', box(0.16, 0.07, 2 * hb - 0.06, 'z', 1.0), M(x, yGunwale(x) - 0.07, 0)); }
  // raised bow platform for the boatman
  for (let x = PLATFORM.x0; x <= PLATFORM.x1; x += 0.2) { const w = 2 * (hullHalf(x) - 0.06); b.add('wood', box(0.185, 0.045, w, 'z', 1.0, x * 2), M(x, PLATFORM.y - 0.022, 0)); }
  for (const zz of [-0.35, 0.35]) b.add('woodDark', box(PLATFORM.x1 - PLATFORM.x0 + 0.1, 0.12, 0.08, 'x', 1), M((PLATFORM.x0 + PLATFORM.x1) / 2, PLATFORM.y - 0.1, zz));
  for (const x of [PLATFORM.x0 + 0.1, PLATFORM.x1 - 0.1]) b.add('woodDark', box(0.08, PLATFORM.y - yBottom(x) - 0.15, 0.08, 'y', 1), M(x, (PLATFORM.y + yBottom(x)) / 2 - 0.05, 0));
  // canopy: bamboo hoops + reed mat
  const cx0 = -3.65, cx1 = 1.25, apex = 1.32;
  const hoopX = [-3.55, -2.35, -1.15, 0.05, 1.15];
  const hoop = (x, off) => { const pts = []; const hb = hullHalf(x) - 0.03, yg = yGunwale(x); for (let i = 0; i <= 16; i++) { const th = (i / 16) * Math.PI; pts.push(V(x, yg + (apex + off) * Math.sin(th), -(hb + off * 0.5) * Math.cos(th))); } return pts; };
  for (const x of hoopX) {
    const pts = hoop(x, 0);
    b.add('bamboo', tubeGeo(pts, 0.028, 8, 0.6));
    for (let i = 1; i < pts.length - 1; i += 2) b.add('bamboo', new THREE.TorusGeometry(0.031, 0.008, 5, 10), (() => { const t = pts[i + 1].clone().sub(pts[i - 1]).normalize(); const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), t); return new THREE.Matrix4().compose(pts[i], q, V(1, 1, 1)); })());
    const lash = hoop(x, 0.045).map((p) => p); b.add('rope', tubeGeo(lash, 0.012, 5, 0.2));
  }
  const mat = surface(40, 24, (u, v) => {
    const x = lerp(cx0, cx1, u); const th = v * Math.PI;
    const hb = hullHalf(x) - 0.03 + 0.03, yg = yGunwale(x);
    let sag = 0; for (const hx of hoopX) sag = Math.max(sag, Math.exp(-((x - hx) ** 2) / 0.02));
    const off = 0.035 - 0.035 * (1 - sag) * Math.sin(th);
    return V(x, yg + (apex + off) * Math.sin(th) + 0.01, -(hb + off * 0.5) * Math.cos(th));
  }, true, (u, v, p) => [p.x / 1.1, v * 3.3]);
  b.add('reed', mat);
  // cargo: rice bales (tawara), crates, glazed jar
  const bale = lathe([[0.001, -0.37], [0.2, -0.37], [0.25, -0.3], [0.27, -0.12], [0.275, 0], [0.27, 0.12], [0.25, 0.3], [0.2, 0.37], [0.001, 0.37]], 18, 0.6);
  const band = new THREE.TorusGeometry(0.272, 0.018, 6, 22);
  const balePos = [];
  for (let i = 0; i < 4; i++) for (const zz of [-0.4, 0.4]) balePos.push([-3.15 + i * 0.58, 0, zz]);
  for (let i = 0; i < 3; i++) balePos.push([-2.86 + i * 0.58, 1, 0]);
  for (const [x, layer, zz] of balePos) {
    const y = yBottom(x) + 0.15 + 0.26 + layer * 0.46;
    const m = M(x, y, zz, 0, Math.PI / 2, 0);
    b.add('straw', bale, M(x, y, zz, 0, Math.PI / 2));
    for (const o of [-0.22, 0, 0.22]) b.add('rope', band, M(x, y, zz + o, 0, 0, 0));
  }
  for (const [x, zz, s] of [[1.72, -0.32, 0.5], [1.72, 0.3, 0.44], [1.72, 0.0, 0.34]]) {
    const y0 = yBottom(x) + 0.15;
    const yy = zz === 0.0 ? y0 + 0.5 : y0;
    b.add('wood', box(s, s * 0.8, s, 'x', 0.8, x + zz), M(x, yy + s * 0.4, zz, 0.1 * zz));
    b.add('rope', box(s + 0.01, 0.02, 0.03, 'x', 0.3), M(x, yy + s * 0.8 + 0.005, zz, 0.1 * zz));
    b.add('rope', box(0.03, 0.02, s + 0.01, 'z', 0.3), M(x, yy + s * 0.8 + 0.005, zz, 0.1 * zz));
  }
  b.add('glaze', lathe([[0.001, 0], [0.12, 0], [0.19, 0.08], [0.23, 0.22], [0.21, 0.36], [0.12, 0.45], [0.09, 0.5], [0.11, 0.53], [0.001, 0.53]], 22), M(-4.35, yBottom(-4.35) + 0.15, 0.25));
  b.add('wood', cyl(0.12, 0.12, 0.04, 16), M(-4.35, yBottom(-4.35) + 0.15 + 0.55, 0.25));
  // coiled rope on the bow platform
  { const pts = []; for (let i = 0; i <= 90; i++) { const a = i * 0.42; const r = 0.08 + i * 0.0021; pts.push(V(4.12 + Math.cos(a) * r, PLATFORM.y + 0.02 + (i > 70 ? (i - 70) * 0.004 : 0), -0.3 + Math.sin(a) * r)); } b.add('rope', tubeGeo(pts, 0.017, 5, 0.2)); }
  // sculling oar stowed along the port quarter, resting on a peg
  {
    const y = yGunwale(-3) + 0.085;
    const pts = [V(-1.2, y + 0.05, -0.85), V(-3.0, y, -0.9), V(-4.8, y - 0.02, -0.93)];
    b.add('wood', sweep(pts, 0.07, 0.06, V(0, 1, 0), 1.2));
    const blade = [V(-4.7, y - 0.02, -0.93), V(-5.9, y - 0.12, -0.96)];
    b.add('wood', sweep(blade, 0.2, 0.035, V(0, 1, 0), 1.0));
    b.add('woodDark', cyl(0.025, 0.03, 0.2, 8), M(-4.4, y - 0.1, -0.93));
    b.add('rope', new THREE.TorusGeometry(0.05, 0.012, 5, 10), M(-2.2, y, -0.9, 0, 0, Math.PI / 2));
    b.add('rope', new THREE.TorusGeometry(0.05, 0.012, 5, 10), M(-3.6, y - 0.01, -0.92, 0, 0, Math.PI / 2));
  }
  // bow lantern on an arching bamboo pole (port side of the stem)
  const lp = [V(5.05, yGunwale(5.05) - 0.3, -0.12), V(5.25, yGunwale(5.2) + 0.4, -0.2), V(5.65, 1.95, -0.3), V(6.15, 2.3, -0.34), V(6.55, 2.2, -0.35)];
  b.add('bamboo', tubeGeo(lp, 0.024, 8, 0.5));
  for (let i = 1; i < 12; i++) { const c = new THREE.CatmullRomCurve3(lp).getPoint(i / 12); b.add('bamboo', new THREE.TorusGeometry(0.027, 0.007, 5, 10), M(c.x, c.y, c.z, 0, Math.PI / 2 * 0.3, 0.8)); }
  b.add('rope', tubeGeo([V(5.0, yGunwale(5.0) - 0.05, -0.1), V(5.12, yGunwale(5.0) + 0.02, -0.19), V(5.2, yGunwale(5.1) - 0.06, -0.25)], 0.015, 5, 0.2));
  b.add('rope', box(0.006, 0.28, 0.006, 'y', 0.2), M(6.55, 2.07, -0.35));
  const lantern = lathe([[0.001, 0], [0.09, 0.005], [0.15, 0.05], [0.17, 0.13], [0.165, 0.2], [0.14, 0.27], [0.09, 0.31], [0.001, 0.315]], 18, 0.4);
  const lmat = new THREE.MeshStandardMaterial({ color: 0xf1e2c2, roughness: 0.85, emissive: new THREE.Color(1.0, 0.52, 0.2), emissiveIntensity: 0, side: THREE.DoubleSide });
  patch(lmat, { key: 'boatlantern', transl: new THREE.Color(1.0, 0.7, 0.4) });
  b.add('lantern', lantern, M(6.55, 1.6, -0.35));
  for (let k = 0; k < 6; k++) b.add('black', new THREE.TorusGeometry(0.165 - Math.abs(k - 2.5) * 0.02, 0.004, 4, 20), M(6.55, 1.62 + k * 0.05, -0.35, 0, Math.PI / 2));
  b.add('black', cyl(0.085, 0.09, 0.05, 14), M(6.55, 1.93, -0.35));
  b.add('black', cyl(0.09, 0.085, 0.04, 14), M(6.55, 1.595, -0.35));
  const mats = {
    hull: MAT.wood, hullLow: MAT.woodDark, wood: MAT.wood, woodDark: MAT.woodDark, iron: MAT.iron, reed: MAT.reed, bamboo: MAT.bamboo,
    rope: MAT.rope, straw: MAT.straw, glaze: MAT.glaze, black: MAT.black, lantern: lmat,
  };
  b.build(g, mats);
  BOAT.lanternMat = lmat;
  BOAT.lanternPos = V(6.55, 1.75, -0.35);
  BOAT.group = g;
  scene.add(g);
  resetBoat();
  return g;
}
function fixSide(geo, side) {
  const n = geo.attributes.normal; let sum = 0;
  for (let i = 0; i < n.count; i += 7) sum += n.getZ(i);
  if (Math.sign(sum) !== side) { const idx = geo.index.array; for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } geo.computeVertexNormals(); }
}

export function resetBoat() {
  const s = START_S; const d = pathOffset(s);
  const p = sdToWorld(s, d, {}); const c = center(s, {});
  BOAT.x = p.x; BOAT.z = p.z; BOAT.psi = Math.atan2(-c.tz, c.tx);
  const f = flowWorld(s, d);
  BOAT.vx = c.tx * 1.4 + f.x; BOAT.vz = c.tz * 1.4 + f.z; BOAT.r = 0; BOAT.s = s; BOAT.d = d; BOAT.heel = 0; BOAT.pitch = 0;
}

// ---------------------------------------------------------------- physics + autopilot
const hullPts = [];
for (let x = -5.1; x <= 5.2; x += 0.85) hullPts.push(x);
export function updateBoat(dt, t, thrust) {
  const B = BOAT;
  const fwd = { x: Math.cos(B.psi), z: -Math.sin(B.psi) }, right = { x: Math.sin(B.psi), z: Math.cos(B.psi) };
  const q = worldToSD(B.x, B.z, B.s); B.s = q.s; B.d = q.d;
  const cur = flowWorld(B.s, B.d);
  // control
  const inp = B.input; const manual = inp.f || inp.b || inp.l || inp.r;
  if (manual) { B.idle = 0; B.auto = false; } else { B.idle += dt; if (B.idle > 6) B.auto = true; }
  let steer = 0, power = 1;
  if (B.auto) {
    const spd = Math.hypot(B.vx, B.vz);
    const look = 13 + spd * 3.5;
    const sT = B.s + look; const dT = pathOffset(sT);
    const tp = sdToWorld(sT, dT, {});
    let desired = Math.atan2(-(tp.z - B.z), tp.x - B.x);
    // local obstacle avoidance
    for (const o of obstacles) {
      const dx = o.x - B.x, dz = o.z - B.z; const along = dx * fwd.x + dz * fwd.z; if (along < -2 || along > 16) continue;
      const lat = dx * right.x + dz * right.z; const need = o.r + 1.1 + (lat > 0 ? 2.1 : 0.4);
      if (Math.abs(lat) < need) desired += (lat > 0 ? 1 : -1) * 0.25 * (1 - Math.abs(lat) / need) * (1 - along / 16);
    }
    let e = desired - B.psi; e = Math.atan2(Math.sin(e), Math.cos(e));
    steer = clamp(e * 2.4 - B.r * 1.1, -1, 1);
    power = 1;
  } else {
    steer = (inp.l ? 1 : 0) - (inp.r ? 1 : 0);
    power = inp.f ? 1.45 : inp.b ? 0 : 0.85;
  }
  B.steer = lerp(B.steer, steer, 1 - Math.exp(-dt * 5));
  B.power = power; B.brake = !B.auto && inp.b;
  // relative water velocity
  const rvx = B.vx - cur.x, rvz = B.vz - cur.z;
  const vf = rvx * fwd.x + rvz * fwd.z, vl = rvx * right.x + rvz * right.z;
  B.relSpeed = vf;
  let af = thrust - 0.055 * vf * Math.abs(vf) - 0.05 * vf;
  if (B.brake) af -= 0.35 * vf;
  let al = -1.1 * vl * Math.abs(vl) - 0.9 * vl;
  // current shear yaws the hull
  const bowP = { x: B.x + fwd.x * 4, z: B.z + fwd.z * 4 }, sternP = { x: B.x - fwd.x * 4, z: B.z - fwd.z * 4 };
  const qb = worldToSD(bowP.x, bowP.z, B.s), qs = worldToSD(sternP.x, sternP.z, B.s);
  const cb = flowWorld(qb.s, qb.d), cs = flowWorld(qs.s, qs.d);
  const shear = ((cb.x - cs.x) * right.x + (cb.z - cs.z) * right.z) / 8;
  let ar = B.steer * 0.42 * (0.35 + Math.min(1.5, Math.abs(vf))) - B.r * 1.35 - shear * 0.6;
  B.vx += (fwd.x * af + right.x * al) * dt; B.vz += (fwd.z * af + right.z * al) * dt;
  B.r += ar * dt;
  B.x += B.vx * dt; B.z += B.vz * dt; B.psi += B.r * dt;
  // collisions: rocks & piers
  let hit = 0;
  const f2 = { x: Math.cos(B.psi), z: -Math.sin(B.psi) };
  for (const hx of hullPts) {
    const px = B.x + f2.x * hx, pz = B.z + f2.z * hx; const rad = hullHalf(hx) + 0.06;
    for (const o of obstacles) {
      const dx = px - o.x, dz = pz - o.z; const dd = Math.hypot(dx, dz); const minD = o.r + rad;
      if (dd < minD && dd > 1e-4) {
        const nx = dx / dd, nz = dz / dd, pen = minD - dd;
        B.x += nx * pen; B.z += nz * pen;
        const vn = B.vx * nx + B.vz * nz; if (vn < 0) { B.vx -= vn * nx * 1.3; B.vz -= vn * nz * 1.3; }
        B.r += -hx * (nx * right.x + nz * right.z) * pen * 0.5;
        hit = Math.max(hit, pen);
      }
    }
  }
  // banks: keep enough depth under the hull
  for (const hx of [-5.0, -2.5, 0, 2.5, 4.8]) {
    for (const sz of [-1, 1]) {
      const lz = sz * hullHalf(hx) * 0.8;
      const px = B.x + f2.x * hx + Math.sin(B.psi) * lz, pz = B.z + f2.z * hx + Math.cos(B.psi) * lz;
      const gnd = groundFast(px, pz); const draft = -0.3;
      if (gnd > draft) {
        const e = 0.6;
        const gx = groundFast(px + e, pz) - groundFast(px - e, pz), gz = groundFast(px, pz + e) - groundFast(px, pz - e);
        let l = Math.hypot(gx, gz); let nx, nz;
        if (l < 1e-4) { const c = center(B.s, {}); nx = -Math.sign(B.d) * c.nx; nz = -Math.sign(B.d) * c.nz; } else { nx = -gx / l; nz = -gz / l; }
        const pen = Math.min(0.3, (gnd - draft) * 0.5);
        B.x += nx * pen; B.z += nz * pen;
        const vn = B.vx * nx + B.vz * nz; if (vn < 0) { B.vx -= vn * nx * 1.2; B.vz -= vn * nz * 1.2; }
        B.r += -hx * (nx * right.x + nz * right.z) * pen * 0.12;
        hit = Math.max(hit, pen);
      }
    }
  }
  B.hit = hit;
  // heel into turns, pitch with the strokes, gentle bob
  const heelT = clamp(-B.r * Math.abs(vf) * 0.09, -0.09, 0.09) + (B.poleRoll || 0);
  B.heelV += ((heelT - B.heel) * 14 - B.heelV * 4.5) * dt; B.heel += B.heelV * dt;
  const pitchT = -thrust * 0.012 + (B.brake ? 0.01 : 0);
  B.pitchV += ((pitchT - B.pitch) * 10 - B.pitchV * 4) * dt; B.pitch += B.pitchV * dt;
  B.bob = 0.018 * Math.sin(t * 1.3) + 0.01 * Math.sin(t * 2.7 + 1.1);
  B.speed = Math.hypot(B.vx, B.vz);
  const g = B.group;
  g.position.set(B.x, B.bob, B.z);
  g.rotation.set(0, 0, 0); g.rotateY(B.psi); g.rotateZ(B.pitch); g.rotateX(B.heel);
  g.updateMatrixWorld(true);
}
