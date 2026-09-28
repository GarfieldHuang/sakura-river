// Vegetation: procedural branching trees (hero cherries, weeping cherry, maples, cloud-pruned pines),
// instanced forest, grass, reeds, wildflowers, ferns, azaleas, boulders and exposed roots.
import * as THREE from 'three';
import { RNG, simplex2, fbm2, clamp, lerp, smoothstep } from './noise.js';
import { TEX } from './textures.js';
import { patch, depthMat, MAT } from './materials.js';
import { S_MIN, S_MAX, sdToWorld, heightFull, halfWidth, bankType, isFree, rocks, LAYOUT, lastPath, center, BRIDGE_S, worldToSD, heightAt, pathOffset } from './world.js';
import { stamp } from './terrain.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
const ico = (d) => { const g = new THREE.IcosahedronGeometry(1, d); g.deleteAttribute('normal'); g.deleteAttribute('uv'); return mergeVertices(g); };

export const CANOPIES = [];     // {x,y,z,r} for camera avoidance
export const PETAL_SOURCES = []; // world positions inside cherry canopies
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();

// ---------------------------------------------------------------- geometry accumulator
class Acc {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.wind = []; this.idx = []; }
  get n() { return this.pos.length / 3; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.wind.length) g.setAttribute('aWind', new THREE.Float32BufferAttribute(this.wind, 2));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// parallel-transport tube along a polyline
export function tube(A, pts, rads, seg, o = {}) {
  const n = pts.length; const base = A.n;
  const T = [], N = [], B = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    T.push(new THREE.Vector3().subVectors(b, a).normalize());
  }
  let nn = Math.abs(T[0].y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  nn = new THREE.Vector3().crossVectors(T[0], nn).normalize();
  for (let i = 0; i < n; i++) {
    if (i > 0) { const ax = new THREE.Vector3().crossVectors(T[i - 1], T[i]); const l = ax.length(); if (l > 1e-6) { ax.divideScalar(l); nn.applyAxisAngle(ax, Math.asin(Math.min(1, l))); } }
    N.push(nn.clone()); B.push(new THREE.Vector3().crossVectors(T[i], nn).normalize());
  }
  let arc = 0; const urep = o.urep ?? Math.max(1, Math.round((2 * Math.PI * rads[0]) / 0.7));
  for (let i = 0; i < n; i++) {
    if (i > 0) arc += pts[i].distanceTo(pts[i - 1]);
    for (let j = 0; j <= seg; j++) {
      const th = (j / seg) * Math.PI * 2;
      const cx = Math.cos(th), sx = Math.sin(th);
      let r = rads[i];
      if (o.gnarl) r *= 1 + o.gnarl * simplex2(th * 1.2 + i * 0.37 + (o.seed || 0), arc * 0.9) + (o.lobes ? o.lobes(i / (n - 1), th) : 0);
      const nx = N[i].x * cx + B[i].x * sx, ny = N[i].y * cx + B[i].y * sx, nz = N[i].z * cx + B[i].z * sx;
      A.pos.push(pts[i].x + nx * r, pts[i].y + ny * r, pts[i].z + nz * r);
      A.nor.push(nx, ny, nz);
      A.uv.push((j / seg) * urep, arc / (o.vscale ?? 1.1));
      const ao = o.ao ? o.ao(pts[i], i / (n - 1)) : 1;
      A.col.push(ao, ao, ao);
      A.wind.push(o.wind ? o.wind(pts[i]) : 0, 0);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) {
    const a = base + i * (seg + 1) + j, b = a + seg + 1;
    A.idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
}
// quad card
function card(A, c, ax, ay, w, h, nrm, ao, wind, flex, uvr = [0, 0, 1, 1], anchorBottom = false) {
  const base = A.n;
  const oy = anchorBottom ? 0 : -0.5;
  const corners = [[-0.5, oy], [0.5, oy], [0.5, oy + 1], [-0.5, oy + 1]];
  const uvs = [[uvr[0], uvr[1]], [uvr[2], uvr[1]], [uvr[2], uvr[3]], [uvr[0], uvr[3]]];
  for (let k = 0; k < 4; k++) {
    const [u, v] = corners[k];
    const p = new THREE.Vector3().copy(c).addScaledVector(ax, u * w).addScaledVector(ay, v * h);
    A.pos.push(p.x, p.y, p.z); A.nor.push(nrm.x, nrm.y, nrm.z); A.uv.push(uvs[k][0], uvs[k][1]);
    const a = typeof ao === 'function' ? ao(p) : ao; A.col.push(a, a, a);
    A.wind.push(typeof wind === 'function' ? wind(p) : wind, flex);
  }
  A.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
function randUnit(rng) { const u = rng.range(-1, 1), t = rng.range(0, Math.PI * 2), r = Math.sqrt(1 - u * u); return new THREE.Vector3(r * Math.cos(t), u, r * Math.sin(t)); }
function perp(v) { const a = Math.abs(v.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0); return new THREE.Vector3().crossVectors(v, a).normalize(); }

// ---------------------------------------------------------------- branching tree generator
function grow(rng, P, base) {
  const branches = [], tips = [];
  function branch(start, dir, len, rad, depth) {
    const n = Math.max(3, Math.ceil(len / (depth === 0 ? 0.45 : P.seg || 0.5)));
    const pts = [start.clone()], rads = [rad];
    let d = dir.clone(), p = start.clone();
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      d.addScaledVector(randUnit(rng), P.gnarl * (depth === 0 ? 0.6 : 1));
      d.y += (P.up || 0) * (depth > 0 ? 1 : 0.3) - (P.droop || 0) * t * depth * 0.5;
      if (depth > 0 && P.spread) { _v.set(p.x - base.x, 0, p.z - base.z); if (_v.lengthSq() > 1e-4) d.addScaledVector(_v.normalize(), P.spread * 0.15); }
      d.normalize();
      p = p.clone().addScaledVector(d, len / n);
      pts.push(p); rads.push(rad * Math.pow(1 - t * 0.72, 1.1));
    }
    branches.push({ pts, rads, depth });
    if (depth < P.levels) {
      const kids = rng.int(P.kids[depth][0], P.kids[depth][1]);
      for (let k = 0; k < kids; k++) {
        const t = depth === 0 ? rng.range(P.trunkStart || 0.45, 0.98) : rng.range(0.25, 0.97);
        const fi = t * (pts.length - 1), i0 = Math.floor(fi), i1 = Math.min(pts.length - 1, i0 + 1);
        const sp = pts[i0].clone().lerp(pts[i1], fi - i0);
        const pd = new THREE.Vector3().subVectors(pts[i1], pts[i0]).normalize();
        const ang = rng.range(P.angle[0], P.angle[1]);
        const ax = perp(pd).applyAxisAngle(pd, rng.range(0, Math.PI * 2) + k * 2.4);
        const cd = pd.clone().applyAxisAngle(ax, ang);
        const clen = len * rng.range(P.ratio[0], P.ratio[1]) * (1 - t * 0.35);
        const crad = rads[i0] * rng.range(0.5, 0.72);
        if (crad < 0.008 || clen < 0.2) continue;
        branch(sp, cd, clen, crad, depth + 1);
      }
      if (depth >= P.levels - 1) tips.push({ p: pts[pts.length - 1], d, depth });
    } else tips.push({ p: pts[pts.length - 1], d, depth });
    // extra tips along the last two levels
    if (depth >= P.levels - 1) for (let i = 1; i < pts.length - 1; i += 2) tips.push({ p: pts[i], d, depth: depth + 0.5 });
  }
  const tl = P.trunkLen, tr = P.trunkRad;
  const td = new THREE.Vector3(P.lean.x, 1, P.lean.z).normalize();
  branch(base.clone(), td, tl, tr, 0);
  return { branches, tips };
}

function woodWind(base, H) { return (p) => 0.38 * Math.pow(clamp((p.y - base.y) / H, 0, 1.4), 1.8) + 0.03 * Math.hypot(p.x - base.x, p.z - base.z); }

function buildTree(rng, P, base, kind) {
  const { branches, tips } = grow(rng, P, base);
  const wood = new Acc(), leaves = new Acc();
  let H = 0; for (const b of branches) for (const p of b.pts) H = Math.max(H, p.y - base.y);
  const ww = woodWind(base, H);
  for (const b of branches) {
    const seg = b.depth === 0 ? 11 : b.depth === 1 ? 8 : b.depth === 2 ? 6 : 4;
    tube(wood, b.pts, b.rads, seg, {
      gnarl: b.depth === 0 ? 0.13 : 0.06, seed: rng.range(0, 99), wind: ww,
      lobes: b.depth === 0 ? (t, th) => (t < 0.18 ? Math.pow(1 - t / 0.18, 2) * (0.55 + 0.3 * Math.sin(th * 4 + 1)) : 0) : null,
      ao: (p, t) => lerp(0.62, 1.0, clamp((p.y - base.y) / 2.5, 0, 1)),
    });
  }
  // crown centre
  const cc = new THREE.Vector3(); for (const t of tips) cc.add(t.p); cc.divideScalar(Math.max(1, tips.length));
  let cr = 0; for (const t of tips) cr = Math.max(cr, t.p.distanceTo(cc));
  if (kind === 'cherry' || kind === 'maple') {
    const per = kind === 'cherry' ? P.cards || 4 : 3;
    for (const t of tips) {
      for (let k = 0; k < per; k++) {
        const c = t.p.clone().addScaledVector(randUnit(rng), rng.range(0.05, 0.45));
        c.y += rng.range(-0.1, 0.25);
        const nrm = new THREE.Vector3().subVectors(c, cc).normalize();
        nrm.y += 0.35; nrm.normalize();
        const ax = randUnit(rng); const ay = new THREE.Vector3().crossVectors(nrm, ax).normalize(); ax.crossVectors(ay, nrm).normalize();
        const tilt = randUnit(rng).multiplyScalar(0.6); ax.add(tilt).normalize(); ay.crossVectors(nrm, ax).normalize();
        const s = rng.range(P.cardSize[0], P.cardSize[1]);
        const ao = lerp(0.55, 1.0, clamp(c.distanceTo(cc) / (cr + 0.01), 0, 1)) * (0.9 + 0.1 * clamp((c.y - base.y) / H, 0, 1));
        card(leaves, c, ax, ay, s, s, nrm, ao, ww(c), 1);
        if (kind === 'cherry' && rng.next() < 0.35) PETAL_SOURCES.push(c.clone());
      }
    }
  }
  CANOPIES.push({ x: cc.x, y: cc.y, z: cc.z, r: cr + 1.2 });
  return { wood, leaves, cc, cr, H };
}

function buildWeeping(rng, base) {
  const wood = new Acc(), leaves = new Acc();
  const H = 7.5; const ww = (p) => 0.45 * Math.pow(clamp((p.y - base.y) / H, 0, 1.3), 1.4) + 0.08 * Math.hypot(p.x - base.x, p.z - base.z) * (p.y < base.y + 5 ? 1.4 : 1);
  // trunk
  const tp = [], tr = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12; tp.push(new THREE.Vector3(base.x + Math.sin(t * 2.3) * 0.35, base.y + t * 4.6, base.z + Math.cos(t * 1.7) * 0.25 - 0.2)); tr.push(0.42 * (1 - t * 0.45)); }
  tube(wood, tp, tr, 12, { gnarl: 0.16, seed: 3, wind: ww, lobes: (t, th) => (t < 0.2 ? Math.pow(1 - t / 0.2, 2) * (0.6 + 0.3 * Math.sin(th * 5)) : 0), ao: (p) => lerp(0.6, 1, clamp((p.y - base.y) / 2, 0, 1)) });
  const top = tp[tp.length - 1];
  const nMain = 9;
  for (let k = 0; k < nMain; k++) {
    const a = (k / nMain) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const pts = [], rads = [];
    const L = rng.range(3.2, 4.6);
    const start = tp[rng.int(8, 12)].clone();
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const p = start.clone().addScaledVector(dir, t * L);
      p.y += Math.sin(t * Math.PI * 0.8) * 1.9 - t * t * 1.2 + 0.4 * t;
      pts.push(p); rads.push(0.16 * (1 - t * 0.7));
    }
    tube(wood, pts, rads, 6, { gnarl: 0.08, seed: k, wind: ww });
    // pendulous strands from along the arch
    for (let i = 2; i <= 10; i++) {
      const nS = i > 6 ? 3 : 2;
      for (let q = 0; q < nS; q++) {
        const p0 = pts[i].clone().add(new THREE.Vector3(rng.range(-0.3, 0.3), 0, rng.range(-0.3, 0.3)));
        const hang = rng.range(2.2, Math.max(2.4, p0.y - base.y - 0.45));
        const sp = [], sr = [];
        const out = new THREE.Vector3(p0.x - base.x, 0, p0.z - base.z).normalize();
        for (let j = 0; j <= 6; j++) { const t = j / 6; sp.push(new THREE.Vector3(p0.x + out.x * t * 0.35, p0.y - t * hang, p0.z + out.z * t * 0.35)); sr.push(0.018 * (1 - t * 0.6)); }
        tube(wood, sp, sr, 3, { wind: ww, urep: 1 });
        for (let j = 0; j < 6; j++) {
          const t = (j + rng.range(0, 1)) / 6;
          const c = sp[0].clone().lerp(sp[6], t); c.addScaledVector(out, 0.1);
          const nrm = out.clone().add(new THREE.Vector3(0, 0.2, 0)).normalize();
          const ax = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), out).normalize().applyAxisAngle(out, rng.range(-0.4, 0.4));
          const ay = new THREE.Vector3(0, 1, 0).applyAxisAngle(ax, rng.range(-0.25, 0.25));
          const s = rng.range(0.5, 0.8);
          card(leaves, c, ax, ay, s * 0.9, s * 1.25, nrm, lerp(0.7, 1, t), ww(c), 1);
          if (rng.next() < 0.3) PETAL_SOURCES.push(c.clone());
        }
      }
    }
    // blossom along the arch tops
    for (let i = 1; i <= 10; i++) for (let q = 0; q < 2; q++) {
      const c = pts[i].clone().addScaledVector(randUnit(rng), 0.3);
      const nrm = new THREE.Vector3(c.x - base.x, 1.2, c.z - base.z).normalize();
      const ax = perp(nrm); const ay = new THREE.Vector3().crossVectors(nrm, ax);
      card(leaves, c, ax, ay, 0.9, 0.9, nrm, 0.95, ww(c), 1);
    }
  }
  CANOPIES.push({ x: base.x, y: base.y + 5, z: base.z, r: 6.5 });
  return { wood, leaves };
}

function buildPine(rng, base, lean) {
  const wood = new Acc(), pads = new Acc();
  const H = rng.range(5.5, 7.5);
  const ww = (p) => 0.14 * Math.pow(clamp((p.y - base.y) / H, 0, 1.3), 1.6);
  const tp = [], tr = [];
  const ph = rng.range(0, 6);
  for (let i = 0; i <= 16; i++) { const t = i / 16; tp.push(new THREE.Vector3(base.x + lean.x * t * H * 0.6 + Math.sin(t * 5 + ph) * 0.45 * t, base.y + t * H, base.z + lean.z * t * H * 0.6 + Math.cos(t * 4 + ph) * 0.4 * t)); tr.push(0.34 * (1 - t * 0.75)); }
  tube(wood, tp, tr, 10, { gnarl: 0.14, seed: ph, wind: ww, ao: (p) => lerp(0.6, 1, clamp((p.y - base.y) / 2, 0, 1)), lobes: (t, th) => (t < 0.12 ? (1 - t / 0.12) * 0.4 * (1 + Math.sin(th * 3)) : 0) });
  const padCenters = [];
  const nb = rng.int(5, 7);
  for (let k = 0; k < nb; k++) {
    const t = 0.35 + (k / nb) * 0.62;
    const i = Math.round(t * 16); const sp = tp[i];
    const a = k * 2.4 + rng.range(-0.4, 0.4);
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const L = (1 - t) * 3.2 + 0.9;
    const pts = [], rads = [];
    for (let j = 0; j <= 6; j++) { const u = j / 6; const p = sp.clone().addScaledVector(dir, u * L); p.y += Math.sin(u * 3) * 0.25 - u * 0.15; p.x += Math.sin(u * 7 + k) * 0.12; pts.push(p); rads.push(tr[i] * 0.45 * (1 - u * 0.6)); }
    tube(wood, pts, rads, 5, { gnarl: 0.1, seed: k, wind: ww });
    padCenters.push({ c: pts[6].clone().add(new THREE.Vector3(0, 0.25, 0)), r: 0.9 + (1 - t) * 0.9 });
  }
  padCenters.push({ c: tp[16].clone().add(new THREE.Vector3(0, 0.2, 0)), r: 1.0 });
  for (const pc of padCenters) {
    const nCards = Math.round(pc.r * 26);
    for (let q = 0; q < nCards; q++) {
      const a = rng.range(0, Math.PI * 2), rr = Math.sqrt(rng.next()) * pc.r;
      const c = pc.c.clone().add(new THREE.Vector3(Math.cos(a) * rr, (1 - (rr / pc.r) ** 2) * 0.38 * pc.r + rng.range(-0.08, 0.08), Math.sin(a) * rr * 0.85));
      const nrm = new THREE.Vector3((c.x - pc.c.x) * 0.5, 1.0, (c.z - pc.c.z) * 0.5).normalize();
      const ax = randUnit(rng); ax.addScaledVector(nrm, -ax.dot(nrm)).normalize(); const ay = new THREE.Vector3().crossVectors(nrm, ax);
      ay.addScaledVector(nrm, rng.range(-0.6, 0.6)).normalize();
      const s = rng.range(0.45, 0.75);
      card(pads, c, ax, ay, s, s, nrm, lerp(0.6, 1.0, (c.y - pc.c.y) / (0.4 * pc.r) * 0.5 + 0.5), ww(c), 0.5);
    }
    CANOPIES.push({ x: pc.c.x, y: pc.c.y, z: pc.c.z, r: pc.r + 0.8 });
  }
  return { wood, pads };
}

// ---------------------------------------------------------------- materials
export const VMAT = {};
function foliageMat(map, color, transl, windAmp = 1, key = '') {
  const m = new THREE.MeshStandardMaterial({ map, color, roughness: 0.75, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.5, alphaToCoverage: true, vertexColors: true });
  patch(m, { wind: true, windAmp, transl, key: 'fol' + key, fragHead: '', wetDark: '0.75',
    onShader: (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n#ifdef DOUBLE_SIDED\n normal *= faceDirection;\n#endif'); } });
  return m;
}
function barkMat(tex, color = 0xffffff) {
  const m = new THREE.MeshStandardMaterial({ map: tex.map, normalMap: tex.nrm, normalScale: new THREE.Vector2(1.6, 1.6), color, roughness: 0.95, vertexColors: true });
  patch(m, { wind: true, key: 'bark' });
  return m;
}
export function buildVegMaterials() {
  VMAT.barkCherry = barkMat(TEX.barkCherry);
  VMAT.barkPine = barkMat(TEX.barkPine);
  VMAT.barkDark = barkMat(TEX.barkPine, 0x9a8a80);
  VMAT.blossom = foliageMat(TEX.blossom, 0xffffff, new THREE.Color(1.0, 0.62, 0.66), 1, 'b');
  VMAT.mapleRed = foliageMat(TEX.leafMaple, new THREE.Color(0.62, 0.1, 0.06), new THREE.Color(1.0, 0.28, 0.1), 1, 'mr');
  VMAT.mapleGreen = foliageMat(TEX.leafMaple, new THREE.Color(0.42, 0.62, 0.16), new THREE.Color(0.7, 0.9, 0.2), 1, 'mg');
  VMAT.pine = foliageMat(TEX.needles, new THREE.Color(0.17, 0.27, 0.12), new THREE.Color(0.2, 0.35, 0.1), 1, 'p');
  VMAT.forestNeedle = foliageMat(TEX.needles, 0xffffff, new THREE.Color(0.08, 0.14, 0.05), 1, 'fn');
  VMAT.forestLeaf = foliageMat(TEX.leafBroad, 0xffffff, new THREE.Color(0.1, 0.14, 0.04), 1, 'fl');
  VMAT.forestBlossom = foliageMat(TEX.blossom, 0xffffff, new THREE.Color(1.0, 0.62, 0.66), 1, 'fb');
  VMAT.depthLeaf = (map, amp = 1) => depthMat({ wind: true, map, windAmp: amp, side: THREE.DoubleSide, key: map.uuid });
  VMAT.depthWood = depthMat({ wind: true, key: 'wood' });
}

function addTreeMeshes(scene, wood, leaves, woodMat, leafMat, leafMap) {
  const out = [];
  if (wood && wood.n) { const m = new THREE.Mesh(wood.build(), woodMat); m.castShadow = true; m.receiveShadow = true; m.customDepthMaterial = VMAT.depthWood; scene.add(m); out.push(m); }
  if (leaves && leaves.n) { const m = new THREE.Mesh(leaves.build(), leafMat); m.castShadow = true; m.receiveShadow = true; m.customDepthMaterial = VMAT.depthLeaf(leafMap); scene.add(m); out.push(m); }
  return out;
}

const CHERRY_P = { trunkLen: 4.0, trunkRad: 0.42, gnarl: 0.26, levels: 3, kids: [[5, 7], [3, 5], [3, 4]], angle: [0.6, 1.1], ratio: [0.72, 0.95], spread: 1.5, up: 0.04, droop: 0.3, seg: 0.45, trunkStart: 0.45, cardSize: [1.0, 1.55], cards: 5 };
const MAPLE_P = { trunkLen: 2.6, trunkRad: 0.2, gnarl: 0.3, levels: 3, kids: [[4, 6], [3, 5], [3, 4]], angle: [0.5, 0.95], ratio: [0.55, 0.75], spread: 0.9, up: 0.08, droop: 0.1, seg: 0.45, trunkStart: 0.35, cardSize: [0.6, 1.0] };

// place a tree base at (s,d) with ground height
function baseAt(s, d) { const p = sdToWorld(s, d, {}); return new THREE.Vector3(p.x, heightFull(s, d, p.x, p.z) - 0.15, p.z); }
function sdOf(x, z) { return worldToSD(x, z); }

export function buildHeroVegetation(scene) {
  const rng = new RNG(2024);
  const cherries = [
    [18, -1, 1.8], [42, 1, 1.6], [96, -1, 2.2], [113, 1, 2.0], [148, 1, 2.8], [168, -1, 2.4], [188, -1, 1.7], [242, 1, 1.9], [268, -1, 2.0],
    [300, 1, 1.8], [348, 1, 9.0], [382, -1, 1.8], [421, 1, 1.7], [455, -1, 1.6], [498, 1, 1.9], [532, -1, 1.6], [566, 1, 2.2], [612, -1, 1.8], [652, 1, 1.9], [700, -1, 1.7], [742, 1, 1.8], [-40, 1, 2.0], [-80, -1, 2.3],
  ];
  const woodAll = new Acc(), bloomAll = new Acc();
  const woodAll2 = new Acc(), bloomAll2 = new Acc();
  let count = 0;
  for (const [s, side, off] of cherries) {
    const w = halfWidth(s);
    const d = side * (w + off);
    const b = baseAt(s, d);
    const c = center(s, {});
    // lean towards the water
    const lean = new THREE.Vector3(-side * c.nx, 0, -side * c.nz).multiplyScalar(rng.range(0.35, 0.75));
    lean.x += rng.range(-0.15, 0.15); lean.z += rng.range(-0.15, 0.15);
    const P = { ...CHERRY_P, lean, trunkLen: rng.range(3.4, 4.6), trunkRad: rng.range(0.36, 0.5) };
    const t = buildTree(rng, P, b, 'cherry');
    // merge into two big accumulators (split in halves for culling)
    const tgtW = s < 330 ? woodAll : woodAll2, tgtL = s < 330 ? bloomAll : bloomAll2;
    mergeAcc(tgtW, t.wood); mergeAcc(tgtL, t.leaves);
    stamp(s, d, 4.5, 0.35, 0.3);
    // exposed roots down the bank into the water
    if (off < 3) roots(rng, woodAll, b, side, c, s);
    count++;
  }
  // weeping cherries: temple terrace + wayside shrine
  const tc = LAYOUT.terrace; const hall = LAYOUT.hall;
  const wpos = sdOf(tc.x, tc.z);
  const wb1 = baseAt(wpos.s - 8, wpos.d + 7.5);
  const wt1 = buildWeeping(rng, wb1); mergeAcc(woodAll, wt1.wood); mergeAcc(bloomAll, wt1.leaves);
  const ws = LAYOUT.wayside; const wsd = sdOf(ws.x, ws.z);
  const wb2 = baseAt(wsd.s + 5.5, wsd.d + 3.5);
  const wt2 = buildWeeping(new RNG(99), wb2); mergeAcc(woodAll2, wt2.wood); mergeAcc(bloomAll2, wt2.leaves);
  stamp(wpos.s - 8, wpos.d + 7.5, 5, 0.3); stamp(wsd.s + 5.5, wsd.d + 3.5, 5, 0.3);
  addTreeMeshes(scene, woodAll, bloomAll, VMAT.barkCherry, VMAT.blossom, TEX.blossom);
  addTreeMeshes(scene, woodAll2, bloomAll2, VMAT.barkCherry, VMAT.blossom, TEX.blossom);

  // maples
  const maples = [[60, -1, 6, 'r'], [127, 1, 7, 'g'], [205, -1, 13, 'r'], [322, 1, 4, 'g'], [470, -1, 3, 'r'], [592, 1, 3, 'r'], [680, -1, 2.5, 'g'], [-20, -1, 5, 'r']];
  const mw = new Acc(), mr = new Acc(), mg = new Acc();
  for (const [s, side, off, col] of maples) {
    const w = halfWidth(s); const d = side * (w + off); const b = baseAt(s, d);
    const P = { ...MAPLE_P, lean: new THREE.Vector3(rng.range(-0.2, 0.2), 0, rng.range(-0.2, 0.2)), trunkLen: rng.range(2.0, 2.8) };
    const t = buildTree(rng, P, b, 'maple');
    mergeAcc(mw, t.wood); mergeAcc(col === 'r' ? mr : mg, t.leaves); stamp(s, d, 3.5, 0.3, 0.2);
  }
  // maple on the temple terrace
  { const b = baseAt(wpos.s + 9, wpos.d + 9); const t = buildTree(rng, { ...MAPLE_P, lean: new THREE.Vector3(0.1, 0, 0.1) }, b, 'maple'); mergeAcc(mw, t.wood); mergeAcc(mr, t.leaves); }
  addTreeMeshes(scene, mw, null, VMAT.barkDark, null);
  addTreeMeshes(scene, null, mr, null, VMAT.mapleRed, TEX.leafMaple);
  addTreeMeshes(scene, null, mg, null, VMAT.mapleGreen, TEX.leafMaple);

  // cloud-pruned pines
  const pw = new Acc(), pp = new Acc();
  const pinesSD = [[101, -1, 11], [233, -1, 12], [338, 1, 12], [522, -1, 1.2], [724, 1, 1.5], [60, 1, 9]];
  for (const [s, side, off] of pinesSD) {
    const w = halfWidth(s); const d = side * (w + off); const b = baseAt(s, d); const c = center(s, {});
    const lean = new THREE.Vector3(-side * c.nx, 0, -side * c.nz).multiplyScalar(off < 3 ? 0.5 : 0.15);
    const t = buildPine(rng, b, lean); mergeAcc(pw, t.wood); mergeAcc(pp, t.pads); stamp(s, d, 3.5, 0.3, 0.4);
  }
  // pines on terrace edge + near pagoda
  for (const [ds, dd] of [[-12, 12], [14, -3]]) { const b = baseAt(wpos.s + ds, wpos.d + dd); const t = buildPine(rng, b, new THREE.Vector3(0.2, 0, 0.1)); mergeAcc(pw, t.wood); mergeAcc(pp, t.pads); }
  { const pk = LAYOUT.pagoda; const pd = sdOf(pk.x, pk.z); const b = baseAt(pd.s + 6.5, pd.d + 4); const t = buildPine(rng, b, new THREE.Vector3(0.3, 0, 0)); mergeAcc(pw, t.wood); mergeAcc(pp, t.pads); }
  addTreeMeshes(scene, pw, pp, VMAT.barkPine, VMAT.pine, TEX.needles);
}

function mergeAcc(dst, src) {
  const off = dst.n;
  for (const k of ['pos', 'nor', 'uv', 'col', 'wind']) { const a = dst[k], b = src[k]; for (let i = 0; i < b.length; i++) a.push(b[i]); }
  for (const i of src.idx) dst.idx.push(i + off);
}

function roots(rng, acc, b, side, c, s) {
  const n = rng.int(3, 5);
  for (let k = 0; k < n; k++) {
    const a = rng.range(-0.9, 0.9);
    const toW = new THREE.Vector3(-side * c.nx, 0, -side * c.nz);
    const dir = toW.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
    const pts = [], rads = [];
    const L = rng.range(1.6, 2.8);
    let p = b.clone().add(new THREE.Vector3(0, 0.35, 0));
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const q = b.clone().addScaledVector(dir, 0.25 + t * L);
      q.x += Math.sin(t * 6 + k) * 0.12; q.z += Math.cos(t * 5 + k) * 0.12;
      const g = heightAt(q.x, q.z, s);
      q.y = Math.max(g + 0.04 + 0.1 * Math.sin(t * Math.PI), -0.3) + (1 - t) * 0.25;
      pts.push(q); rads.push(lerp(0.13, 0.03, t));
    }
    tube(acc, pts, rads, 5, { gnarl: 0.15, seed: k, ao: () => 0.7 });
  }
}

// ---------------------------------------------------------------- instanced forest
function cedarTemplate(rng) {
  const wood = new Acc(), fol = new Acc();
  const H = 20; const base = new THREE.Vector3();
  const ww = (p) => 0.35 * Math.pow(clamp(p.y / H, 0, 1), 2);
  const tp = [], tr = []; for (let i = 0; i <= 6; i++) { const t = i / 6; tp.push(new THREE.Vector3(0, t * H * 0.97, 0)); tr.push(0.38 * (1 - t * 0.85)); }
  tube(wood, tp, tr, 6, { wind: ww, urep: 2, vscale: 2.5 });
  const tiers = 20;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const y = H * (0.2 + 0.78 * t);
    const R = 3.0 * Math.pow(1 - t, 0.9) + 0.35;
    const nc = Math.max(4, Math.round(R * 3.6));
    for (let k = 0; k < nc; k++) {
      const a = (k / nc) * Math.PI * 2 + rng.range(-0.35, 0.35) + i * 0.9;
      const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const rr = R * rng.range(0.4, 0.7);
      const c = out.clone().multiplyScalar(rr).setY(y - R * 0.18 + rng.range(-0.3, 0.3));
      const nrm = out.clone().setY(0.45).normalize();
      const ay = out.clone().setY(-0.55 - rng.range(0, 0.3)).normalize(); const ax = new THREE.Vector3(-out.z, 0, out.x).applyAxisAngle(out, rng.range(-0.3, 0.3));
      const sz = R * rng.range(1.0, 1.35) + 0.6;
      card(fol, c, ax, ay, sz, sz * 0.95, nrm, lerp(0.5, 1, t * 0.5 + 0.5 * (rr / (R + 0.01))), ww(c), 0.3);
    }
  }
  const cap = new THREE.Vector3(0, H * 0.99, 0);
  card(fol, cap, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), 1.4, 2.4, new THREE.Vector3(0, 1, 0), 1, ww(cap), 0.3);
  card(fol, cap, new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), 1.4, 2.4, new THREE.Vector3(0, 1, 0), 1, ww(cap), 0.3);
  return { wood: wood.build(), fol: fol.build(), H, R: 3.4 };
}
function broadTemplate(rng, H = 12, R = 4.4) {
  const wood = new Acc(), fol = new Acc();
  const ww = (p) => 0.3 * Math.pow(clamp(p.y / H, 0, 1), 1.8);
  const tp = [], tr = []; for (let i = 0; i <= 6; i++) { const t = i / 6; tp.push(new THREE.Vector3(Math.sin(t * 3) * 0.25, t * H * 0.6, Math.cos(t * 2) * 0.2)); tr.push(0.34 * (1 - t * 0.5)); }
  tube(wood, tp, tr, 7, { wind: ww, urep: 2, gnarl: 0.08 });
  const lobes = [];
  const nl = rng.int(4, 6);
  for (let k = 0; k < nl; k++) {
    const a = (k / nl) * Math.PI * 2 + rng.range(-0.4, 0.4);
    const rr = R * rng.range(0.35, 0.6);
    const c = new THREE.Vector3(Math.cos(a) * rr, H * rng.range(0.6, 0.78), Math.sin(a) * rr);
    lobes.push({ c, r: R * rng.range(0.42, 0.58) });
    const pts = [], rads = [];
    for (let i = 0; i <= 5; i++) { const t = i / 5; pts.push(new THREE.Vector3(c.x * t, H * 0.42 + (c.y - H * 0.42) * t, c.z * t)); rads.push(0.17 * (1 - t * 0.7)); }
    tube(wood, pts, rads, 5, { wind: ww, urep: 1, gnarl: 0.1 });
  }
  lobes.push({ c: new THREE.Vector3(0, H * 0.86, 0), r: R * 0.5 });
  const cc = new THREE.Vector3(0, H * 0.7, 0);
  for (const L of lobes) {
    const n = Math.round(22 * L.r / (R * 0.5));
    for (let k = 0; k < n; k++) {
      const u = randUnit(rng); u.y = u.y * 0.8 + 0.15;
      const c = L.c.clone().addScaledVector(u, L.r * (0.55 + 0.45 * rng.next()));
      const nrm = new THREE.Vector3().subVectors(c, cc).normalize().lerp(u, 0.5).normalize();
      nrm.y += 0.25; nrm.normalize();
      const ax = perp(nrm).applyAxisAngle(nrm, rng.range(0, 6.28)); const ay = new THREE.Vector3().crossVectors(nrm, ax);
      const s = rng.range(2.2, 3.2);
      const ao = lerp(0.5, 1, clamp((c.y - H * 0.45) / (H * 0.55), 0, 1)) * lerp(0.75, 1, clamp(c.distanceTo(L.c) / L.r, 0, 1));
      card(fol, c, ax, ay, s, s, nrm, ao, ww(c), 0.6);
    }
  }
  return { wood: wood.build(), fol: fol.build(), H, R };
}
export function buildForest(scene) {
  const rng = new RNG(555);
  const tpl = { cedar: cedarTemplate(rng), broad: broadTemplate(rng), broad2: broadTemplate(rng, 10, 3.6), wild: broadTemplate(rng, 9, 3.6) };
  const CH = 12, chunkLen = (S_MAX - S_MIN) / CH;
  const lists = {}; for (const k in tpl) lists[k] = Array.from({ length: CH }, () => []);
  const greens = [[0.36, 0.5, 0.16], [0.28, 0.42, 0.14], [0.46, 0.52, 0.2], [0.18, 0.3, 0.13], [0.44, 0.32, 0.18], [0.3, 0.44, 0.2], [0.5, 0.52, 0.24]];
  let tries = 0, placed = 0;
  while (placed < 8200 && tries < 120000) {
    tries++;
    const s = rng.range(S_MIN + 5, S_MAX - 5);
    const w = halfWidth(s);
    const side = rng.sign();
    const dd = side * (w + 12 + Math.pow(rng.next(), 1.6) * 420);
    const p = sdToWorld(s, dd, {});
    const h = heightFull(s, dd, p.x, p.z);
    if (h > 360 || h < 1.2) continue;
    if (lastPath > 0.2) continue;
    const dens = 0.55 + 0.45 * fbm2(p.x * 0.006, p.z * 0.006, 3) + smoothstep(w + 20, w + 60, Math.abs(dd)) * 0.3;
    if (rng.next() > dens) continue;
    // slope check
    const h2 = heightFull(s + 2, dd, p.x, p.z), h3 = heightFull(s, dd + 2 * side, p.x, p.z);
    const slope = Math.hypot(h2 - h, h3 - h) / 2;
    if (slope > (s > 450 ? 2.8 : 1.9)) continue;
    if (!isFree(p.x, p.z, 4)) continue;
    const r = rng.next();
    const elev = smoothstep(40, 160, h);
    let kind = r < 0.36 + elev * 0.3 ? 'cedar' : r < 0.9 ? (rng.next() < 0.5 ? 'broad' : 'broad2') : 'wild';
    const sc = rng.range(0.75, 1.3) * (kind === 'cedar' ? 1.1 : 1);
    const ci = clamp(Math.floor((s - S_MIN) / chunkLen), 0, CH - 1);
    let col;
    if (kind === 'cedar') col = [rng.range(0.15, 0.22), rng.range(0.23, 0.3), rng.range(0.12, 0.16)];
    else if (kind === 'wild') col = [1.0, rng.range(0.9, 1.0), rng.range(0.92, 1.0)];
    else col = rng.pick(greens).map((v) => v * rng.range(0.85, 1.1));
    lists[kind][ci].push({ x: p.x, y: h - 0.3, z: p.z, sc, rot: rng.range(0, 6.28), col });
    stamp(s, dd, 5.5 * sc, 0.2, 1.0);
    if (Math.abs(dd) < w + 60) CANOPIES.push({ x: p.x, y: h + tpl[kind].H * sc * 0.62, z: p.z, r: tpl[kind].R * sc + 1.5 });
    placed++;
  }
  const mats = { cedar: [VMAT.barkPine, VMAT.forestNeedle, TEX.needles], broad: [VMAT.barkDark, VMAT.forestLeaf, TEX.leafBroad], broad2: [VMAT.barkDark, VMAT.forestLeaf, TEX.leafBroad], wild: [VMAT.barkCherry, VMAT.forestBlossom, TEX.blossom] };
  const depthLeaf = {};
  for (const kind in lists) {
    for (let ci = 0; ci < CH; ci++) {
      const L = lists[kind][ci]; if (!L.length) continue;
      const [wm, fm, fmap] = mats[kind];
      depthLeaf[kind] = depthLeaf[kind] || VMAT.depthLeaf(fmap);
      const iw = new THREE.InstancedMesh(tpl[kind].wood, wm, L.length);
      const ifo = new THREE.InstancedMesh(tpl[kind].fol, fm, L.length);
      const c = new THREE.Color();
      L.forEach((t, i) => {
        _m.compose(_v.set(t.x, t.y, t.z), _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot), new THREE.Vector3(t.sc, t.sc, t.sc));
        iw.setMatrixAt(i, _m); ifo.setMatrixAt(i, _m);
        ifo.setColorAt(i, c.setRGB(...t.col));
      });
      for (const m of [iw, ifo]) { m.castShadow = true; m.receiveShadow = true; m.computeBoundingSphere(); scene.add(m); }
      iw.customDepthMaterial = VMAT.depthWood; ifo.customDepthMaterial = depthLeaf[kind];
    }
  }
}

// background cherries along the floodplain (instanced from templates)
export function buildBackgroundCherries(scene) {
  const rng = new RNG(808);
  const tpls = [];
  for (let k = 0; k < 3; k++) {
    const base = new THREE.Vector3(0, 0, 0);
    const P = { ...CHERRY_P, lean: new THREE.Vector3(rng.range(-0.2, 0.2), 0, rng.range(-0.2, 0.2)), trunkLen: rng.range(3.0, 3.8), cards: 3, ratio: [0.62, 0.85] };
    const nSrc = PETAL_SOURCES.length, nCan = CANOPIES.length;
    const t = buildTree(rng, P, base, 'cherry');
    PETAL_SOURCES.length = nSrc; CANOPIES.length = nCan;
    tpls.push({ wood: t.wood.build(), leaves: t.leaves.build(), cc: t.cc, cr: t.cr });
  }
  const inst = tpls.map(() => []);
  let placed = 0, tries = 0;
  while (placed < 150 && tries < 5000) {
    tries++;
    const s = rng.range(-300, 780); const w = halfWidth(s); const side = rng.sign();
    const dd = side * (w + rng.range(6, 45));
    const p = sdToWorld(s, dd, {}); const h = heightFull(s, dd, p.x, p.z);
    if (lastPath > 0.1 || h < 0.6 || h > 30) continue;
    if (!isFree(p.x, p.z, 3)) continue;
    let near = false; for (const c of CANOPIES) if (Math.hypot(c.x - p.x, c.z - p.z) < c.r + 2.5 && c.y < h + 14) { near = true; break; }
    if (near) continue;
    const k = rng.int(0, 2); const sc = rng.range(0.8, 1.2);
    inst[k].push({ x: p.x, y: h - 0.15, z: p.z, sc, rot: rng.range(0, 6.28) });
    const tp = tpls[k];
    const cc = tp.cc.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0).multiplyScalar(sc);
    CANOPIES.push({ x: p.x + cc.x, y: h + cc.y, z: p.z + cc.z, r: tp.cr * sc + 1.2 });
    for (let q = 0; q < 6; q++) PETAL_SOURCES.push(new THREE.Vector3(p.x + rng.range(-2, 2) * sc, h + cc.y + rng.range(-1, 1.5), p.z + rng.range(-2, 2) * sc));
    stamp(s, dd, 4 * sc, 0.3, 0.2);
    placed++;
  }
  tpls.forEach((tp, k) => {
    const L = inst[k]; if (!L.length) return;
    const iw = new THREE.InstancedMesh(tp.wood, VMAT.barkCherry, L.length), il = new THREE.InstancedMesh(tp.leaves, VMAT.blossom, L.length);
    L.forEach((t, i) => { _m.compose(_v.set(t.x, t.y, t.z), _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot), new THREE.Vector3(t.sc, t.sc, t.sc)); iw.setMatrixAt(i, _m); il.setMatrixAt(i, _m); });
    for (const m of [iw, il]) { m.castShadow = true; m.receiveShadow = true; m.computeBoundingSphere(); scene.add(m); }
    iw.customDepthMaterial = VMAT.depthWood; il.customDepthMaterial = VMAT.depthLeaf(TEX.blossom);
  });
}

// ---------------------------------------------------------------- ground cover
function grassClump(rng, blades, hMin, hMax, spread, wBase) {
  const A = new Acc();
  for (let b = 0; b < blades; b++) {
    const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * spread;
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    const h = rng.range(hMin, hMax), lean = rng.range(0.1, 0.5), dir = rng.range(0, Math.PI * 2);
    const w = wBase * rng.range(0.7, 1.2);
    const face = rng.range(0, Math.PI * 2);
    const fx = Math.cos(face), fz = Math.sin(face);
    const base = A.n; const segs = 4;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const bend = lean * t * t * h;
      const cx = bx + Math.cos(dir) * bend, cz = bz + Math.sin(dir) * bend, cy = h * t * (1 - lean * t * 0.25);
      const ww = w * (1 - t * 0.92);
      for (const sgn of [-1, 1]) {
        A.pos.push(cx + fx * ww * 0.5 * sgn, cy, cz + fz * ww * 0.5 * sgn);
        A.nor.push(Math.cos(dir) * 0.4, 0.9, Math.sin(dir) * 0.4);
        A.uv.push(sgn < 0 ? 0 : 1, t);
        const c = lerp(0.25, 1.0, Math.pow(t, 0.8)); A.col.push(c, c, c);
        A.wind.push(0.32 * t * t * (h / 0.6), 0.7);
      }
    }
    for (let i = 0; i < segs; i++) { const a0 = base + i * 2; A.idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2); }
  }
  return A.build();
}
function reedClump(rng) {
  const A = new Acc();
  for (let b = 0; b < 14; b++) {
    const a = rng.range(0, 6.28), r = Math.sqrt(rng.next()) * 0.35;
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r, h = rng.range(1.1, 2.1), dir = rng.range(0, 6.28), lean = rng.range(0.05, 0.25);
    const face = rng.range(0, 6.28), fx = Math.cos(face), fz = Math.sin(face);
    const base = A.n; const segs = 5;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs; const bend = lean * t * t * h;
      const cx = bx + Math.cos(dir) * bend, cz = bz + Math.sin(dir) * bend, cy = h * t;
      const ww = 0.035 * (1 - t * 0.8);
      for (const sgn of [-1, 1]) {
        A.pos.push(cx + fx * ww * sgn, cy, cz + fz * ww * sgn); A.nor.push(0, 1, 0); A.uv.push(sgn < 0 ? 0 : 1, t);
        const c = lerp(0.35, 1.0, t); A.col.push(c, c, c); A.wind.push(0.5 * t * t, 0.4);
      }
    }
    for (let i = 0; i < segs; i++) { const a0 = base + i * 2; A.idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2); }
    // plume
    if (rng.next() < 0.5) {
      const top = new THREE.Vector3(bx + Math.cos(dir) * lean * h, h, bz + Math.sin(dir) * lean * h);
      const pb = A.n;
      for (let i = 0; i <= 3; i++) {
        const t = i / 3; const y = top.y + t * 0.35, ww = 0.05 * Math.sin(t * Math.PI) + 0.01;
        for (const sgn of [-1, 1]) { A.pos.push(top.x + fx * ww * sgn, y, top.z + fz * ww * sgn); A.nor.push(0, 1, 0); A.uv.push(0.5, 1); A.col.push(1.6, 1.3, 1.0); A.wind.push(0.5 + t * 0.1, 0.8); }
      }
      for (let i = 0; i < 3; i++) { const a0 = pb + i * 2; A.idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2); }
    }
  }
  return A.build();
}
function fernGeo(rng) {
  const A = new Acc();
  const n = 7;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * 6.28 + rng.range(-0.2, 0.2);
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)); const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const L = rng.range(0.6, 0.95); const base = A.n; const segs = 6;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const c = dir.clone().multiplyScalar(t * L * 0.85); c.y = Math.sin(t * 2.2) * L * 0.55 - t * t * 0.15;
      const hw = 0.18;
      for (const sgn of [-1, 1]) { const p = c.clone().addScaledVector(side, hw * sgn); A.pos.push(p.x, p.y, p.z); A.nor.push(0, 1, 0); A.uv.push(sgn < 0 ? 0.08 : 0.92, t); const col = lerp(0.5, 1, t); A.col.push(col, col, col); A.wind.push(0.12 * t, 0.8); }
    }
    for (let i = 0; i < segs; i++) { const a0 = base + i * 2; A.idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2); }
  }
  return A.build();
}
function flowerGeo() {
  const A = new Acc();
  for (let k = 0; k < 2; k++) {
    const a = k * Math.PI / 2; const ax = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    card(A, new THREE.Vector3(0, 0, 0), ax, new THREE.Vector3(0, 1, 0), 0.45, 0.45, new THREE.Vector3(0, 1, 0), 1, (p) => 0.18 * Math.pow(p.y / 0.45, 2), 0.6, [0, 0, 0.25, 1], true);
  }
  return A.build();
}

export function buildGroundCover(scene) {
  const rng = new RNG(4242);
  // grass
  const gGeo = [grassClump(rng, 9, 0.3, 0.62, 0.38, 0.05), grassClump(rng, 12, 0.18, 0.4, 0.45, 0.04)];
  const grassMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
  patch(grassMat, { wind: true, transl: new THREE.Color(0.45, 0.65, 0.15), key: 'grass',
    vertBegin: `{ vec4 ip = modelMatrix * instanceMatrix * vec4(0.,0.,0.,1.); float cd = distance(ip.xyz, cameraPosition); transformed *= 1.0 - smoothstep(75.0, 100.0, cd); }`,
    onShader: (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n#ifdef DOUBLE_SIDED\n normal *= faceDirection;\n#endif'); } });
  const CH = 30, chunkLen = (S_MAX - S_MIN) / CH;
  const G = Array.from({ length: CH }, () => [[], []]);
  const R = Array.from({ length: CH }, () => []);
  const F = Array.from({ length: CH }, () => []);
  const FE = Array.from({ length: CH }, () => []);
  const greenTints = [[0.26, 0.36, 0.09], [0.32, 0.4, 0.12], [0.22, 0.31, 0.08], [0.38, 0.4, 0.14], [0.3, 0.38, 0.1]];
  for (let s = S_MIN + 20; s < S_MAX - 60; s += 0.9) {
    const w = halfWidth(s);
    const ci = clamp(Math.floor((s - S_MIN) / chunkLen), 0, CH - 1);
    for (let k = 0; k < 22; k++) {
      const side = rng.sign();
      const dd = side * (w + 0.4 + Math.pow(rng.next(), 1.4) * 48);
      const ss = s + rng.range(-0.45, 0.45);
      const p = sdToWorld(ss, dd, {}); const h = heightFull(ss, dd, p.x, p.z);
      if (h < 0.08) continue;
      if (lastPath > 0.35) continue;
      const patchy = fbm2(p.x * 0.05, p.z * 0.05, 3);
      const nearWater = Math.abs(dd) - w;
      if (patchy < -0.25 && nearWater > 3) continue;
      if (!isFree(p.x, p.z, 0.3)) { if (rng.next() < 0.85) continue; }
      const gravel = 1 - bankType(ss, side);
      if (nearWater < 8 && gravel > 0.55 && rng.next() < gravel) continue;
      const h2 = heightFull(ss + 1, dd, p.x, p.z); if (Math.abs(h2 - h) > 0.8) continue;
      const tint = rng.pick(greenTints).map((v) => v * rng.range(0.85, 1.15));
      const t = { x: p.x, y: h - 0.03, z: p.z, rot: rng.range(0, 6.28), sc: rng.range(0.75, 1.35), col: tint };
      G[ci][rng.next() < 0.6 ? 0 : 1].push(t);
      if (rng.next() < 0.1) F[ci].push({ x: p.x + rng.range(-0.5, 0.5), y: h - 0.02, z: p.z + rng.range(-0.5, 0.5), rot: rng.range(0, 6.28), sc: rng.range(0.6, 1.1), col: [1, 1, 1], u: rng.int(0, 3) });
      if (nearWater > 15 && rng.next() < 0.05 && patchy > 0.1) FE[ci].push({ x: p.x, y: h - 0.05, z: p.z, rot: rng.range(0, 6.28), sc: rng.range(0.8, 1.5), col: [0.28, 0.42, 0.12].map((v) => v * rng.range(0.8, 1.2)) });
    }
    // reeds at the water's edge (earthen banks & slack water)
    if (rng.next() < 0.55) {
      const side = rng.sign(); const k = bankType(s, side);
      const dd = side * (w + rng.range(-0.8, 1.2));
      const p = sdToWorld(s, dd, {}); const h = heightFull(s, dd, p.x, p.z);
      if (h > -0.35 && h < 1.2 && isFree(p.x, p.z, 1) && (k > 0.4 || rng.next() < 0.3)) {
        let clash = false; for (const r of rocks) if (Math.hypot(r.x - p.x, r.z - p.z) < r.r + 0.6) clash = true;
        if (!clash) R[ci].push({ x: p.x, y: Math.max(h, -0.35) - 0.05, z: p.z, rot: rng.range(0, 6.28), sc: rng.range(0.75, 1.2), col: [0.42, 0.48, 0.2].map((v) => v * rng.range(0.85, 1.15)) });
      }
    }
  }
  const rGeo = reedClump(rng);
  const reedMat = grassMat;
  const _fm = 0;
  const flowerMat = new THREE.MeshStandardMaterial({ map: TEX.flowers, vertexColors: true, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.8 });
  patch(flowerMat, { wind: true, transl: new THREE.Color(0.6, 0.6, 0.4), key: 'flower', vertHead: 'attribute float aU;',
    vertBegin: `{ vec4 ip = modelMatrix * instanceMatrix * vec4(0.,0.,0.,1.); transformed *= 1.0 - smoothstep(60.0, 80.0, distance(ip.xyz, cameraPosition)); }`,
    onShader: (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv.x += aU*0.25;\n#endif'); } });
  const fernMat = new THREE.MeshStandardMaterial({ map: TEX.fern, vertexColors: true, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.8 });
  patch(fernMat, { wind: true, transl: new THREE.Color(0.4, 0.6, 0.15), key: 'fern' });
  const fGeo = flowerGeo(), feGeo = fernGeo(rng);
  const c = new THREE.Color();
  const mk = (geo, mat, L, shadow, extra) => {
    if (!L.length) return;
    const m = new THREE.InstancedMesh(geo, mat, L.length);
    if (extra) geo = geo.clone();
    L.forEach((t, i) => { _m.compose(_v.set(t.x, t.y, t.z), _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot), new THREE.Vector3(t.sc, t.sc, t.sc)); m.setMatrixAt(i, _m); m.setColorAt(i, c.setRGB(...t.col)); });
    if (extra) { const a = new Float32Array(L.map((t) => t.u)); m.geometry = geo; geo.setAttribute('aU', new THREE.InstancedBufferAttribute(a, 1)); }
    m.castShadow = shadow; m.receiveShadow = true; m.computeBoundingSphere();
    m.layers.set(4);
    scene.add(m); return m;
  };
  for (let ci = 0; ci < CH; ci++) {
    mk(gGeo[0], grassMat, G[ci][0], false); mk(gGeo[1], grassMat, G[ci][1], false);
    const rm = mk(rGeo, reedMat, R[ci], true); if (rm) { rm.layers.set(0); rm.customDepthMaterial = VMAT.depthWood; }
    mk(fGeo, flowerMat, F[ci], false, true);
    mk(feGeo, fernMat, FE[ci], false);
  }
}

// azalea mounds (clipped shrubs) near the temple approach / shrines
export function buildAzaleas(scene, spots) {
  const geo = ico(4);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    const n = 1 + 0.06 * simplex2(_v.x * 3 + _v.z, _v.y * 3) + 0.03 * simplex2(_v.x * 9, _v.z * 9 + _v.y);
    _v.multiplyScalar(n); if (_v.y < 0) _v.y *= 0.25; else _v.y *= 0.72;
    pos.setXYZ(i, _v.x, _v.y, _v.z);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
  patch(mat, {
    key: 'azalea', uniforms: { tLeaf: { value: TEX.leafBroad }, tN: { value: TEX.noise } },
    fragHead: 'uniform sampler2D tLeaf; uniform sampler2D tN;',
    mapFrag: `{ vec3 bw = pow(abs(vWN), vec3(4.)); bw/= (bw.x+bw.y+bw.z);
      float l = texture2D(tLeaf, vWP.zy*1.3).r*bw.x + texture2D(tLeaf, vWP.xz*1.3).r*bw.y + texture2D(tLeaf, vWP.xy*1.3).r*bw.z;
      float fl = texture2D(tN, vWP.xz*0.35 + vWP.y*0.2).a; float fl2 = texture2D(tN, vWP.xz*1.7 + vWP.y*0.9).g;
      float flower = smoothstep(0.52, 0.6, fl*0.6 + fl2*0.5) * smoothstep(-0.2, 0.4, vWN.y);
      vec3 leaf = vec3(0.1, 0.2, 0.06) * (0.6 + 0.7*l);
      vec3 pink = mix(vec3(0.95, 0.25, 0.45), vec3(0.98, 0.55, 0.7), fl2);
      diffuseColor.rgb = mix(leaf, pink, flower) * vColorAO; }`,
    vertHead: 'attribute float aAO; varying float vColorAO;', vertEnd: 'vColorAO = 1.0;',
    onShader: (sh) => { sh.fragmentShader = sh.fragmentShader.replace('varying vec3 vWN;', 'varying vec3 vWN; varying float vColorAO;'); },
    transl: new THREE.Color(0.3, 0.2, 0.1),
  });
  const m = new THREE.InstancedMesh(geo, mat, spots.length);
  spots.forEach((s, i) => { _m.compose(_v.set(s.x, s.y + s.sc * 0.02, s.z), _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.rot || 0), new THREE.Vector3(s.sc * 1.3, s.sc, s.sc)); m.setMatrixAt(i, _m); });
  m.castShadow = true; m.receiveShadow = true; m.computeBoundingSphere();
  scene.add(m);
  for (const s of spots) { const q = worldToSD(s.x, s.z); stamp(q.s, q.d, s.sc * 1.8, 0.35); }
}

// ---------------------------------------------------------------- boulders
export const ROCKMAT = {};
export function buildRocks(scene) {
  const rng = new RNG(31);
  const shapes = [];
  for (let k = 0; k < 7; k++) {
    const g = ico(4);
    const pos = g.attributes.position; const seed = rng.range(0, 100);
    const sx = rng.range(0.8, 1.3), sz = rng.range(0.7, 1.2), sy = rng.range(0.55, 0.85);
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i);
      let n = 1 + 0.22 * fbm2(_v.x * 1.3 + seed, _v.z * 1.3 + _v.y * 1.7, 4) + 0.06 * simplex2(_v.x * 5 + seed, _v.y * 5 + _v.z * 3);
      // faceted planes
      n -= 0.12 * Math.max(0, Math.abs(simplex2(_v.x * 0.8 + seed * 2, _v.z * 0.8)) - 0.3);
      _v.multiplyScalar(n); _v.x *= sx; _v.y *= sy; _v.z *= sz;
      if (_v.y < -0.3) _v.y = -0.3 + (_v.y + 0.3) * 0.4;
      pos.setXYZ(i, _v.x, _v.y, _v.z);
    }
    g.computeVertexNormals(); g.computeBoundingBox();
    const bb = g.boundingBox; g.userData = { top: bb.max.y, bot: bb.min.y, rad: Math.max(bb.max.x, -bb.min.x, bb.max.z, -bb.min.z) };
    shapes.push(g);
  }
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
  patch(mat, {
    key: 'rock', uniforms: { tRA: { value: TEX.rock.map }, tRN: { value: TEX.rock.nrm }, tMA: { value: TEX.moss.map }, tNoiseT: { value: TEX.noise } },
    fragHead: `uniform sampler2D tRA, tRN, tMA, tNoiseT; vec3 rN; float rR;
      float causticR(vec2 p){ float a = texture2D(tNoiseT, p*0.11 + vec2(uTime*0.021, uTime*0.013)).b; float b = texture2D(tNoiseT, p*0.13 - vec2(uTime*0.017, -uTime*0.019)).b; return pow(a*b, 3.0)*9.0; }`,
    mapFrag: `{ vec3 N0=normalize(vWN); vec3 bw=pow(abs(N0),vec3(4.)); bw/=(bw.x+bw.y+bw.z); float rs=0.35; vec3 wp=vWP;
      vec4 a = texture2D(tRA, wp.zy*rs)*bw.x + texture2D(tRA, wp.xz*rs)*bw.y + texture2D(tRA, wp.xy*rs)*bw.z;
      vec4 nx=texture2D(tRN, wp.zy*rs), ny=texture2D(tRN, wp.xz*rs), nz=texture2D(tRN, wp.xy*rs);
      vec3 tn = vec3(0., (nx.y-0.5)*2., (nx.x-0.5)*2.)*bw.x + vec3((ny.x-0.5)*2., 0., (ny.y-0.5)*2.)*bw.y + vec3((nz.x-0.5)*2., (nz.y-0.5)*2., 0.)*bw.z;
      float ao = nx.w*bw.x+ny.w*bw.y+nz.w*bw.z;
      vec3 alb = a.rgb;
      float mossN = texture2D(tNoiseT, wp.xz*0.2).g;
      float moss = smoothstep(0.35, 0.8, N0.y + (mossN-0.5)*0.6) * smoothstep(0.3, 0.8, wp.y) ;
      alb = mix(alb, texture2D(tMA, wp.xz*0.5).rgb, moss*0.9);
      float damp = smoothstep(0.5, 0.0, wp.y); alb *= mix(1.0, 0.6, damp);
      float slime = smoothstep(0.05, -0.2, wp.y); alb = mix(alb, alb*vec3(0.55,0.6,0.35), slime*0.6);
      alb *= mix(0.55, 1.0, ao) * (0.8 + 0.3*texture2D(tNoiseT, wp.xz*0.05).r);
      diffuseColor.rgb *= alb; rR = mix(a.a, 0.95, moss); rR = mix(rR, 0.25, damp*0.8); rN = normalize(N0 + tn*1.3*(1.0-moss*0.5)); }`,
    roughFrag: 'float roughnessFactor = rR;',
    normalFrag: 'normal = normalize((viewMatrix*vec4(rN,0.0)).xyz);',
    afterLights: `if (vWP.y < 0.05) { float cz = causticR(vWP.xz) * smoothstep(0.05,-0.25,vWP.y); reflectedLight.directDiffuse += diffuseColor.rgb * directLight.color * cz * 0.5; }`,
  });
  ROCKMAT.mat = mat;
  const lists = shapes.map(() => []);
  // river boulders (collision obstacles)
  for (const r of rocks) {
    const bed = heightFull(r.s, r.d, r.x, r.z);
    const k = r.seed % shapes.length;
    const U = shapes[k].userData;
    const sc = r.r / U.rad;
    const topY = Math.max(0.15, r.h);
    const S = (topY - bed + 0.3) / (U.top - U.bot);
    lists[k].push({ x: r.x, y: topY - U.top * S, z: r.z, sx: sc, sy: S, sz: sc, rot: r.seed * 0.37 });
    stamp(r.s, r.d, r.r * 1.6, 0.4);
  }
  // decorative bank boulders
  for (let i = 0; i < 260; i++) {
    const s = rng.range(S_MIN + 40, S_MAX - 80); const w = halfWidth(s); const side = rng.sign();
    const dd = side * (w + rng.range(-0.5, 25) * (rng.next() < 0.7 ? 0.25 : 1));
    const p = sdToWorld(s, dd, {}); const h = heightFull(s, dd, p.x, p.z);
    if (lastPath > 0.1 || !isFree(p.x, p.z, 1.5)) continue;
    if (Math.abs(dd) < w - 0.5) continue;
    const sc = rng.range(0.35, 1.3) * (s > 520 ? 1.5 : 1);
    lists[rng.int(0, shapes.length - 1)].push({ x: p.x, y: h + sc * 0.08, z: p.z, sx: sc * rng.range(0.9, 1.3), sy: sc * rng.range(0.6, 1.0), sz: sc, rot: rng.range(0, 6.28) });
    stamp(s, dd, sc * 2.2, 0.35);
  }
  // small stones scattered on the gravel bars and the shallow margins
  {
    const sg = ico(1); const sp = sg.attributes.position;
    for (let i = 0; i < sp.count; i++) { _v.fromBufferAttribute(sp, i); _v.multiplyScalar(1 + 0.2 * simplex2(_v.x * 2.3, _v.z * 2.1 + _v.y)); _v.y *= 0.55; sp.setXYZ(i, _v.x, _v.y, _v.z); }
    sg.computeVertexNormals();
    const L = [];
    for (let s = S_MIN + 60; s < S_MAX - 100; s += 0.5) {
      const w = halfWidth(s);
      for (let k = 0; k < 3; k++) {
        const side = rng.sign(); const g = 1 - bankType(s, side); if (rng.next() > g * 0.9 + 0.08) continue;
        const dd = side * (w + rng.range(-1.2, 7));
        const p = sdToWorld(s + rng.range(-0.25, 0.25), dd, {}); const h = heightFull(s, dd, p.x, p.z);
        if (lastPath > 0.1 || h > 1.2 || h < -0.5 || !isFree(p.x, p.z, 0.5)) continue;
        const sc = rng.range(0.06, 0.26);
        L.push({ x: p.x, y: h + sc * 0.12, z: p.z, sc, rot: rng.range(0, 6.28) });
      }
    }
    const m = new THREE.InstancedMesh(sg, mat, L.length);
    const c = new THREE.Color();
    L.forEach((t, i) => { _m.compose(_v.set(t.x, t.y, t.z), _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot), new THREE.Vector3(t.sc * rng.range(0.9, 1.4), t.sc, t.sc)); m.setMatrixAt(i, _m); m.setColorAt(i, c.setScalar(rng.range(0.75, 1.15))); });
    m.castShadow = false; m.receiveShadow = true; m.computeBoundingSphere(); scene.add(m);
  }
  shapes.forEach((g, k) => {
    const L = lists[k]; if (!L.length) return;
    const m = new THREE.InstancedMesh(g, mat, L.length);
    L.forEach((t, i) => { _m.compose(_v.set(t.x, t.y, t.z), _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot), new THREE.Vector3(t.sx, t.sy, t.sz)); m.setMatrixAt(i, _m); });
    m.castShadow = true; m.receiveShadow = true; m.computeBoundingSphere(); scene.add(m);
  });
}
