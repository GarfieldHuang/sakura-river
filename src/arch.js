// Architecture: vermilion bridge, torii, stairs & retaining walls, main hall, five-storey pagoda,
// stone lanterns, wayside shrine, torii tunnel + hillside shrine, rope fences with shide, wind bells.
import * as THREE from 'three';
import { Builder, M, box, cyl, lathe, sweep, tubeGeo, roof, surface } from './archkit.js';
import { MAT, patch } from './materials.js';
import { TEX } from './textures.js';
import { LAYOUT, heightAt, worldToSD, footprints } from './world.js';
import { RNG, clamp, lerp, simplex2 } from './noise.js';
import { stamp } from './terrain.js';

export const ARCH = { bells: [], glows: [], lampMats: [], deckY: null, woman: null, monkPath: null, obstacleBoxes: [] };
const V = (x, y, z) => new THREE.Vector3(x, y, z);

let LAT, GLOW, SHIDE, BRONZEROOF;
function mats() {
  LAT = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
  patch(LAT, {
    key: 'lattice', vertHead: 'varying vec2 vUv2;', vertEnd: 'vUv2 = uv;', fragHead: 'varying vec2 vUv2; float paperM;',
    mapFrag: `{ vec2 g = fract(vUv2 / vec2(0.21, 0.26)); float line = max(step(g.x, 0.14), step(g.y, 0.12));
      vec3 paper = vec3(0.86,0.82,0.72); vec3 wood = vec3(0.22,0.11,0.06);
      diffuseColor.rgb = mix(paper, wood, line); paperM = 1.0 - line; }`,
    afterLights: `reflectedLight.directDiffuse += vec3(1.0, 0.58, 0.26) * uLamp * paperM * 1.8;`,
  });
  GLOW = new THREE.MeshStandardMaterial({ color: 0xf2e6cc, roughness: 0.9, emissive: new THREE.Color(1.0, 0.55, 0.22), emissiveIntensity: 0 });
  patch(GLOW, { key: 'glow' });
  ARCH.lampMats.push(GLOW);
  SHIDE = new THREE.MeshStandardMaterial({ color: 0xf4f0e6, roughness: 0.8, side: THREE.DoubleSide });
  patch(SHIDE, { wind: true, windAmp: 1, transl: new THREE.Color(0.6, 0.6, 0.55), key: 'shide' });
  BRONZEROOF = new THREE.MeshStandardMaterial({ color: 0x5d8a74, roughness: 0.55, metalness: 0.5, map: TEX.tile.map, normalMap: TEX.tile.nrm });
  patch(BRONZEROOF, { key: 'broof' });
}
function matSet() {
  return { paint: MAT.paint, black: MAT.black, wood: MAT.wood, woodDark: MAT.woodDark, tile: MAT.tile, ridge: MAT.tileDark, plaster: MAT.plaster, stone: MAT.stone, stonewall: MAT.stonewall, bronze: MAT.bronze, gold: MAT.gold, lattice: LAT, glow: GLOW, rope: MAT.rope, broof: BRONZEROOF, iron: MAT.iron };
}
function place(group, x, y, z, ry) { group.position.set(x, y, z); group.rotation.y = ry; group.updateMatrixWorld(true); }
function localToWorld(group, v) { return v.clone().applyMatrix4(group.matrixWorld); }

// ---------------------------------------------------------------- reusable parts
function giboshi(b, x, y, z, s = 1) {
  b.add('bronze', lathe([[0.09, 0], [0.1, 0.05], [0.07, 0.08], [0.11, 0.16], [0.12, 0.22], [0.08, 0.3], [0.03, 0.37], [0.001, 0.42]].map(([r, h]) => [r * s, h * s]), 14), M(x, y, z));
}
export function torii(b, o) {
  const { span = 4.2, H = 4.6, r = 0.22, ext = 1.1 } = o;
  const s = H / 4.6;
  for (const sx of [-1, 1]) {
    b.add('paint', cyl(r * 0.88, r, H, 16, 1.0), M(sx * span / 2, H / 2 + (o.base || 0), 0, 0, 0, sx * 0.025));
    b.add('black', lathe([[r * 1.45, 0], [r * 1.45, 0.25 * s], [r * 1.12, 0.36 * s], [r * 1.0, 0.4 * s]], 16), M(sx * span / 2, o.base || 0, 0));
  }
  const y0 = o.base || 0;
  b.add('paint', box(span + 2 * r + 0.9 * s, 0.3 * s, 0.17 * s, 'x', 1.0), M(0, y0 + H * 0.77, 0));
  const L = span + 2 * ext * s + 2 * r;
  const kas = [], shi = [];
  for (let i = 0; i <= 24; i++) { const u = i / 24 * 2 - 1; const x = u * L / 2; const up = 0.32 * s * Math.pow(Math.abs(u), 3.2); kas.push(V(x, y0 + H + 0.44 * s + up, 0)); shi.push(V(x * 0.94, y0 + H + 0.18 * s + up * 0.8, 0)); }
  b.add('black', sweep(kas, 0.42 * s, 0.26 * s, V(0, 1, 0), 1.0));
  b.add('paint', sweep(shi, 0.34 * s, 0.24 * s, V(0, 1, 0), 1.0));
  b.add('paint', box(0.24 * s, H * 0.17, 0.14 * s, 'y', 1.0), M(0, y0 + H * 0.77 + 0.15 * s + H * 0.085, 0));
}
function stoneLantern(b, x, y, z, ry = 0, s = 1) {
  const m = (px, py, pz) => M(x + px, y + py * s, z + pz, ry, 0, 0, s);
  b.add('stone', lathe([[0.36, 0], [0.36, 0.12], [0.3, 0.16], [0.22, 0.22], [0.14, 0.27]], 6, 0.8), m(0, 0, 0));
  b.add('stone', lathe([[0.12, 0.24], [0.125, 0.3], [0.11, 0.32], [0.11, 0.62], [0.13, 0.64], [0.13, 0.68], [0.11, 0.7], [0.1, 1.05]], 14, 0.8), m(0, 0, 0));
  b.add('stone', lathe([[0.14, 1.02], [0.3, 1.1], [0.34, 1.17], [0.34, 1.23], [0.2, 1.27]], 6, 0.8), m(0, 0, 0));
  b.add('stone', lathe([[0.001, 1.26], [0.22, 1.26], [0.22, 1.63], [0.001, 1.63]], 6, 0.8), m(0, 0, 0));
  b.add('stone', lathe([[0.2, 1.62], [0.44, 1.68], [0.47, 1.72], [0.3, 1.8], [0.12, 1.9], [0.06, 1.95]], 6, 0.8), m(0, 0, 0));
  b.add('stone', lathe([[0.001, 1.93], [0.07, 1.95], [0.1, 2.02], [0.09, 2.08], [0.03, 2.14], [0.001, 2.17]], 12, 0.8), m(0, 0, 0));
  for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; b.add('stone', new THREE.SphereGeometry(0.045, 6, 4), M(x + Math.sin(a + ry) * 0.47 * s, y + 1.76 * s, z + Math.cos(a + ry) * 0.47 * s)); }
  // glowing windows on two faces
  for (const k of [0, 3]) {
    const a = k * Math.PI / 3 + Math.PI / 6 + ry;
    const d = 0.22 * Math.cos(Math.PI / 6) * s + 0.004;
    b.add('glow', box(0.13 * s, 0.2 * s, 0.01, 'x', 1), M(x + Math.sin(a) * d, y + 1.45 * s, z + Math.cos(a) * d, a));
  }
  ARCH.glows.push({ p: V(x, y + 1.45 * s, z), c: new THREE.Color(1.0, 0.58, 0.26), r: 7, i: 1.1, kind: 'lamp' });
}
function steps(b, ax, az, ha, bx, bz, hb, width, rise = 0.2, key = 'stone') {
  const n = Math.max(1, Math.ceil((hb - ha) / rise));
  const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz), ry = Math.atan2(dx, dz);
  const tread = L / n;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const top = ha + (i + 1) * (hb - ha) / n;
    const bot = ha + i * (hb - ha) / n - 0.45;
    const h = top - bot;
    b.add(key, box(width * (0.96 + 0.08 * Math.sin(i * 7.3)), h, tread + 0.06, 'x', 0.9, i * 0.37), M(ax + dx * t, bot + h / 2, az + dz * t, ry + 0.02 * Math.sin(i * 3.1)));
  }
}
function rope(b, pts, r = 0.035) { b.add('rope', tubeGeo(pts, r, 6, 0.3)); }
function catenary(p0, p1, sag, n = 10) { const out = []; for (let i = 0; i <= n; i++) { const t = i / n; const p = p0.clone().lerp(p1, t); p.y -= sag * 4 * t * (1 - t); out.push(p); } return out; }
// zig-zag paper streamer geometry accumulated in world space
const shideAcc = { pos: [], nor: [], uv: [], wind: [], idx: [] };
function shide(p, facing, s = 1) {
  const A = shideAcc; const base = A.pos.length / 3;
  const side = new THREE.Vector3(Math.cos(facing), 0, -Math.sin(facing));
  const nrm = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing));
  const w = 0.07 * s, segH = 0.09 * s;
  const offs = [0, 0.06, -0.02, 0.05, -0.01].map((v) => v * s);
  for (let i = 0; i <= 4; i++) {
    const y = p.y - i * segH;
    for (const sg of [0, 1]) {
      const q = p.clone().addScaledVector(side, offs[i] + sg * w); q.y = y;
      A.pos.push(q.x, q.y, q.z); A.nor.push(nrm.x, nrm.y, nrm.z); A.uv.push(sg, i / 4); A.wind.push(0.12 * (i / 4) * s, 1.0);
    }
  }
  for (let i = 0; i < 4; i++) { const a = base + i * 2; A.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
}
function fenceAlong(b, pts, spacing = 3, h = 0.9, postKey = 'stone') {
  let acc = 0; const posts = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], c = pts[i + 1]; const L = a.distanceTo(c);
    for (let d = (i === 0 ? 0 : spacing - acc); d <= L; d += spacing) { const p = a.clone().lerp(c, d / L); posts.push(p); }
    acc = (acc + L) % spacing;
  }
  for (const p of posts) { const g = heightAt(p.x, p.z); p.y = g; b.add(postKey, postKey === 'stone' ? box(0.16, h + 0.3, 0.16, 'y', 0.8) : cyl(0.06, 0.07, h + 0.3, 8, 0.8), M(p.x, g + (h + 0.3) / 2 - 0.3, p.z)); }
  for (let i = 0; i < posts.length - 1; i++) {
    const p0 = posts[i].clone().setY(posts[i].y + h - 0.05), p1 = posts[i + 1].clone().setY(posts[i + 1].y + h - 0.05);
    const cat = catenary(p0, p1, 0.18);
    rope(b, cat, 0.03);
    const facing = Math.atan2(p1.x - p0.x, p1.z - p0.z) - Math.PI / 2;
    for (let k = 1; k < 3; k++) { const q = cat[Math.round(k * cat.length / 3)]; shide(q.clone().add(V(0, -0.02, 0)), facing, 1.3); }
  }
}
function bell(scene, pos, s = 1) {
  const pivot = new THREE.Group(); pivot.position.copy(pos);
  const g = new THREE.Group(); pivot.add(g);
  const bellG = lathe([[0.001, 0], [0.05, 0], [0.07, -0.03], [0.09, -0.18], [0.11, -0.3], [0.1, -0.32], [0.001, -0.3]].map(([r, h]) => [r * s, h * s]), 14);
  const m1 = new THREE.Mesh(bellG, MAT.bronze); m1.position.y = -0.1 * s; g.add(m1);
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.04 * s, 0.01 * s, 6, 12), MAT.iron); hook.position.y = -0.05 * s; g.add(hook);
  const clapper = new THREE.Group(); clapper.position.y = -0.3 * s; g.add(clapper);
  const rod = new THREE.Mesh(cyl(0.008 * s, 0.008 * s, 0.25 * s, 5), MAT.iron); rod.position.y = -0.12 * s; clapper.add(rod);
  const plate = new THREE.Mesh(box(0.14 * s, 0.16 * s, 0.01, 'y', 0.5), MAT.bronze); plate.position.y = -0.3 * s; clapper.add(plate);
  pivot.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(pivot);
  ARCH.bells.push({ pivot, clapper, ph: Math.random() * 6, vx: 0, vz: 0, ax: 0, az: 0, cax: 0, caz: 0 });
}

// ---------------------------------------------------------------- bridge
function buildBridge(scene) {
  const B = LAYOUT.bridge;
  const g = new THREE.Group(); place(g, B.cx, 0, B.cz, Math.atan2(-B.az, B.ax));
  const arc = (x) => B.base + B.rise * (1 - (x / B.half) ** 2);
  const slope = (x) => -2 * B.rise * x / (B.half * B.half);
  const b = new Builder();
  const W = B.width;
  // deck planks
  for (let x = -B.half + 0.1; x <= B.half - 0.1; x += 0.24) b.add('wood', box(0.21, 0.07, W, 'z', 1.0, x * 0.13), M(x, arc(x) + 0.035, 0, 0, 0, Math.atan(slope(x))));
  // curved girders
  for (const z of [-1.3, 1.3]) { const pts = []; for (let i = 0; i <= 40; i++) { const x = -B.half + 0.2 + (i / 40) * (2 * B.half - 0.4); pts.push(V(x, arc(x) - 0.19, z)); } b.add('paint', sweep(pts, 0.24, 0.34, V(0, 1, 0), 1.2)); }
  for (let x = -B.half + 1.2; x < B.half - 1; x += 1.6) b.add('paint', box(0.18, 0.18, W - 0.1, 'z', 1.0), M(x, arc(x) - 0.45, 0));
  // railings
  const mainX = [-B.half + 0.15, -6.2, 0, 6.2, B.half - 0.15];
  for (const z of [-W / 2 + 0.08, W / 2 - 0.08]) {
    for (let x = -B.half + 0.15; x <= B.half - 0.1; x += 1.72) { if (mainX.some((m) => Math.abs(m - x) < 0.6)) continue; b.add('paint', box(0.11, 0.95, 0.11, 'y', 1.0), M(x, arc(x) + 0.07 + 0.475, z)); }
    for (const x of mainX) { b.add('paint', box(0.17, 1.12, 0.17, 'y', 1.0), M(x, arc(x) + 0.07 + 0.56, z)); giboshi(b, x, arc(x) + 0.07 + 1.12, z, 1.1); }
    for (const [hh, w, h, key] of [[0.95, 0.12, 0.1, 'paint'], [0.52, 0.07, 0.07, 'paint'], [0.15, 0.08, 0.1, 'paint']]) {
      const pts = []; for (let i = 0; i <= 50; i++) { const x = -B.half + 0.15 + (i / 50) * (2 * B.half - 0.3); pts.push(V(x, arc(x) + 0.07 + hh, z)); }
      b.add(key, sweep(pts, w, h, V(0, 1, 0), 1.0));
    }
  }
  // pier bents standing in the water
  for (const px of B.piers) {
    const capY = arc(px) - 0.71;
    b.add('paint', box(0.34, 0.3, W + 0.9, 'z', 1.0), M(px, capY, 0));
    for (const pz of [-1.25, 0, 1.25]) {
      const wp = localToWorld(g, V(px, 0, pz));
      const bed = heightAt(wp.x, wp.z) - 0.5;
      const top = capY - 0.15;
      b.add('paint', cyl(0.19, 0.21, top - bed, 14, 1.0), M(px, (top + bed) / 2, pz));
    }
    for (const ny of [1.0, capY - 1.3]) b.add('paint', box(0.13, 0.24, W + 0.5, 'z', 1.0), M(px, ny, 0));
    // diagonal braces
    for (const pz of [-1.25, 1.25]) {
      const p0 = V(px, 1.2, pz), p1 = V(px + 0.001, capY - 0.25, -pz * 0.2);
      b.add('paint', sweep([p0, p1], 0.1, 0.12, V(1, 0, 0), 1.0));
    }
  }
  // stone abutments
  for (const sx of [-1, 1]) {
    b.add('stonewall', box(2.4, 3.6, W + 1.4, 'x', 1.4), M(sx * (B.half + 0.45), B.base - 1.85, 0));
    b.add('stone', box(2.6, 0.18, W + 1.6, 'x', 1.2), M(sx * (B.half + 0.45), B.base - 0.02, 0));
  }
  b.build(g, matSet());
  scene.add(g);
  ARCH.bridgeGroup = g; ARCH.arc = arc;
  ARCH.woman = { local: V(-3.8, arc(-3.8) + 0.07, W / 2 - 0.55), group: g };
  // bounding volumes for the camera
  ARCH.obstacleBoxes.push({ group: g, min: V(-B.half - 1.5, B.base - 1, -W / 2 - 0.3), max: V(B.half + 1.5, B.base + B.rise + 1.4, W / 2 + 0.3) });
}

// ---------------------------------------------------------------- main torii at bridge end (with shimenawa)
function buildMainTorii(scene) {
  const T = LAYOUT.torii;
  const g = new THREE.Group(); place(g, T.x, T.y - 0.3, T.z, T.rot);
  const b = new Builder();
  torii(b, { span: 4.0, H: 4.9, r: 0.23, base: 0 });
  // stone foundations
  for (const sx of [-1, 1]) b.add('stone', box(0.9, 0.5, 0.9, 'x', 0.8), M(sx * 2.0, 0.1, 0));
  const ropePts = catenary(V(-1.8, 3.55, 0.12), V(1.8, 3.55, 0.12), 0.25, 14);
  b.add('rope', tubeGeo(ropePts, 0.07, 8, 0.25));
  b.build(g, matSet());
  scene.add(g);
  for (let k = 1; k < 4; k++) { const q = localToWorld(g, ropePts[Math.round(k * 14 / 4)].clone().add(V(0, -0.06, 0.05))); shide(q, T.rot + Math.PI / 2 - Math.PI / 2, 1.6); }
  ARCH.obstacleBoxes.push({ group: g, min: V(-3.6, 0, -0.5), max: V(3.6, 5.8, 0.5) });
}

// ---------------------------------------------------------------- stairs, retaining wall, flagstones
function buildTempleGrounds(scene) {
  const b = new Builder();
  const S = LAYOUT.stairs;
  steps(b, S.ax, S.az, S.ha, S.bx, S.bz, S.hb, S.hw * 2 - 0.2, 0.22);
  // retaining wall around the terrace edge
  const T = LAYOUT.terrace;
  const Ntheta = 240; const Nt = 7;
  const stairAng = Math.atan2(S.bx - T.x, S.bz - T.z);
  const pos = [], uv = [], idx = [];
  let arcLen = 0; const cols = [];
  for (let i = 0; i <= Ntheta; i++) {
    const a = (i / Ntheta) * Math.PI * 2;
    const col = [];
    let ok = true;
    const da = Math.atan2(Math.sin(a - stairAng), Math.cos(a - stairAng));
    if (Math.abs(da) * T.r < S.hw + 0.25) ok = false;
    const outer = heightAt(T.x + Math.sin(a) * (T.r + T.fall + 1.2), T.z + Math.cos(a) * (T.r + T.fall + 1.2));
    if (T.h - outer < 0.45) ok = false;
    for (let j = 0; j <= Nt; j++) {
      const t = j / Nt * 1.12;
      const r = T.r + Math.min(t, 1.0) * T.fall;
      const x = T.x + Math.sin(a) * r, z = T.z + Math.cos(a) * r;
      let y = j === 0 ? T.h + 0.28 : heightAt(x, z);
      if (t > 1.0) y -= 0.6;
      const bulge = 0.12 * Math.abs(simplex2(a * 38, j * 1.3)) + 0.33;
      col.push(V(x + Math.sin(a) * bulge, y, z + Math.cos(a) * bulge));
    }
    cols.push({ col, ok, a });
  }
  const P = [];
  for (let i = 0; i <= Ntheta; i++) { const { col } = cols[i]; if (i > 0) arcLen += col[0].distanceTo(cols[i - 1].col[0]); for (let j = 0; j <= Nt; j++) { P.push(col[j]); pos.push(col[j].x, col[j].y, col[j].z); uv.push(arcLen / 2.4, col[j].y / 2.4); } }
  for (let i = 0; i < Ntheta; i++) {
    if (!cols[i].ok || !cols[i + 1].ok) continue;
    for (let j = 0; j < Nt; j++) { const a = i * (Nt + 1) + j, bb = a + 1, c = a + Nt + 1, d = c + 1; idx.push(a, c, bb, bb, c, d); }
  }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); wg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); wg.setIndex(idx); wg.computeVertexNormals();
  // ensure outward normals
  { const n = wg.attributes.normal; const k = idx[0]; const px = pos[k * 3] - T.x, pz = pos[k * 3 + 2] - T.z; if (n.getX(k) * px + n.getZ(k) * pz < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } wg.setIndex(idx); wg.computeVertexNormals(); } }
  b.add('stonewall', wg);
  // coping stones
  for (let i = 0; i < Ntheta; i += 2) {
    if (!cols[i].ok || !cols[Math.min(Ntheta, i + 2)].ok) continue;
    const a = cols[i].a + Math.PI / Ntheta * 1;
    const r = T.r + 0.05;
    b.add('stone', box(0.62, 0.22, (2 * Math.PI * r) / Ntheta * 2 + 0.02, 'z', 0.9, i * 0.1), M(T.x + Math.sin(a) * r, T.h + 0.2, T.z + Math.cos(a) * r, a));
  }
  // flagstones on the approach and terrace walkway
  const rng = new RNG(12);
  const slabs = [];
  const P0 = LAYOUT.paths;
  for (const seg of [[P0.approach[0], P0.approach[1]], [P0.approach[1], P0.approach[2]], [P0.walk[0], P0.walk[1]], [P0.pagoda[0], P0.pagoda[1]]]) {
    const [a, c] = seg; const L = Math.hypot(c.x - a.x, c.z - a.z);
    for (let d = 0.4; d < L; d += 0.85) {
      const t = d / L; const x = lerp(a.x, c.x, t) + rng.range(-0.25, 0.25), z = lerp(a.z, c.z, t) + rng.range(-0.25, 0.25);
      const y = heightAt(x, z);
      const sg = new THREE.CylinderGeometry(1, 0.94, 1, 14, 1);
      const pa = sg.attributes.position; for (let i = 0; i < pa.count; i++) { const px = pa.getX(i), pz = pa.getZ(i); const k = 1 + 0.2 * simplex2(px * 1.6 + d, pz * 1.6 + t * 9) + 0.06 * simplex2(px * 5 + d, pz * 5); pa.setX(i, px * k); pa.setZ(i, pz * k); }
      sg.computeVertexNormals();
      b.add('stone', sg, M(x, y + 0.02, z, rng.range(0, 6), 0, 0, rng.range(0.32, 0.45), 0.12, rng.range(0.28, 0.4)));
    }
  }
  const out = b.build(scene, matSet());
  for (const k in out) out[k].castShadow = k !== 'stonewall';
}

// ---------------------------------------------------------------- main hall
function buildHall(scene) {
  const H = LAYOUT.hall;
  const g = new THREE.Group(); place(g, H.x, H.y, H.z, H.rot);
  const b = new Builder();
  const W = 11, D = 8.8, bay = 2.2, floorY = 1.35, colTop = 4.65;
  // stone plinth + steps
  b.add('stone', box(W + 5.2, 0.72, D + 5.2, 'x', 1.4), M(0, 0.36 - 0.1, 0));
  for (let k = 0; k < 3; k++) b.add('stone', box(3.4, 0.24 * (k + 1), 0.4, 'x', 1.0), M(0, 0.12 * (k + 1) - 0.1, (D + 5.2) / 2 + 0.2 + (2 - k) * 0.4));
  // veranda floor + posts
  b.add('wood', box(W + 3.3, 0.14, D + 3.3, 'x', 1.2), M(0, floorY - 0.07, 0));
  for (let i = 0; i <= 7; i++) for (const sz of [-1, 1]) b.add('woodDark', box(0.18, floorY - 0.62, 0.18, 'y', 1), M(-(W + 3.1) / 2 + i * (W + 3.1) / 7, 0.62 + (floorY - 0.76) / 2, sz * (D + 3.1) / 2));
  for (let i = 1; i < 5; i++) for (const sx of [-1, 1]) b.add('woodDark', box(0.18, floorY - 0.62, 0.18, 'y', 1), M(sx * (W + 3.1) / 2, 0.62 + (floorY - 0.76) / 2, -(D + 3.1) / 2 + i * (D + 3.1) / 5));
  // veranda railing with a gap at the front steps
  const rH = 0.78;
  const railPts = (a, c) => [a, c];
  const rw = (W + 3.1) / 2, rd = (D + 3.1) / 2;
  const segs = [[V(-rw, 0, rd), V(-1.6, 0, rd)], [V(1.6, 0, rd), V(rw, 0, rd)], [V(rw, 0, rd), V(rw, 0, -rd)], [V(rw, 0, -rd), V(-rw, 0, -rd)], [V(-rw, 0, -rd), V(-rw, 0, rd)]];
  for (const [a, c] of segs) {
    const L = a.distanceTo(c); const n = Math.max(2, Math.round(L / 1.1));
    for (let i = 0; i <= n; i++) { const p = a.clone().lerp(c, i / n); b.add('paint', box(0.09, rH, 0.09, 'y', 1), M(p.x, floorY + rH / 2, p.z)); }
    b.add('black', sweep([a.clone().setY(floorY + rH), c.clone().setY(floorY + rH)], 0.1, 0.09, V(0, 1, 0), 1));
    b.add('paint', sweep([a.clone().setY(floorY + 0.3), c.clone().setY(floorY + 0.3)], 0.06, 0.06, V(0, 1, 0), 1));
    giboshi(b, a.x, floorY + rH + 0.04, a.z, 0.8); giboshi(b, c.x, floorY + rH + 0.04, c.z, 0.8);
  }
  // wooden steps up to the veranda
  for (let k = 0; k < 3; k++) b.add('wood', box(3.0, 0.08, 0.34, 'x', 1), M(0, 0.62 + (k + 1) * 0.18, rd + 0.9 - k * 0.32));
  for (const sx of [-1, 1]) b.add('woodDark', sweep([V(sx * 1.55, 0.6, rd + 1.1), V(sx * 1.55, floorY, rd - 0.05)], 0.1, 0.16, V(0, 1, 0), 1));
  // columns
  const colXs = [], colZs = [];
  for (let i = 0; i <= 5; i++) colXs.push(-W / 2 + i * bay);
  for (let j = 0; j <= 4; j++) colZs.push(-D / 2 + j * bay);
  const perim = [];
  for (const x of colXs) for (const z of colZs) if (Math.abs(Math.abs(x) - W / 2) < 0.01 || Math.abs(Math.abs(z) - D / 2) < 0.01) perim.push([x, z]);
  for (const [x, z] of perim) {
    b.add('paint', cyl(0.2, 0.215, colTop - floorY, 16, 1.0), M(x, (colTop + floorY) / 2, z));
    b.add('stone', lathe([[0.3, 0], [0.3, 0.06], [0.24, 0.1]], 16), M(x, floorY - 0.02, z));
  }
  // beams (nageshi etc.) around the perimeter
  for (const [y, h] of [[floorY + 0.14, 0.24], [3.95, 0.28], [colTop - 0.15, 0.3]]) {
    b.add('paint', box(W + 0.5, h, 0.16, 'x', 1), M(0, y, D / 2 + 0.05)); b.add('paint', box(W + 0.5, h, 0.16, 'x', 1), M(0, y, -D / 2 - 0.05));
    b.add('paint', box(0.16, h, D + 0.5, 'z', 1), M(W / 2 + 0.05, y, 0)); b.add('paint', box(0.16, h, D + 0.5, 'z', 1), M(-W / 2 - 0.05, y, 0));
  }
  // front: lattice doors; sides/back: wainscot + plaster; side windows with slats
  for (let i = 0; i < 5; i++) {
    const cx = -W / 2 + bay * (i + 0.5);
    const dh = 3.95 - floorY - 0.3, dy = floorY + 0.26 + dh / 2;
    b.add('lattice', box(bay - 0.42, dh, 0.05, 'x', 1), M(cx, dy, D / 2));
    b.add('woodDark', box(0.06, dh, 0.08, 'y', 1), M(cx, dy, D / 2 + 0.01));
    b.add('plaster', box(bay - 0.4, colTop - 4.1 - 0.15, 0.08, 'x', 1.5), M(cx, (4.1 + colTop - 0.3) / 2, D / 2 - 0.02));
    // back
    b.add('wood', box(bay - 0.4, 1.0, 0.1, 'x', 1), M(cx, floorY + 0.64, -D / 2));
    b.add('plaster', box(bay - 0.4, colTop - floorY - 1.3, 0.1, 'x', 1.5), M(cx, floorY + 1.14 + (colTop - floorY - 1.3) / 2, -D / 2));
  }
  for (let j = 0; j < 4; j++) {
    const cz = -D / 2 + bay * (j + 0.5);
    for (const sx of [-1, 1]) {
      b.add('wood', box(0.1, 1.0, bay - 0.4, 'z', 1), M(sx * W / 2, floorY + 0.64, cz));
      if (j === 1 || j === 2) {
        b.add('plaster', box(0.1, 0.5, bay - 0.4, 'z', 1.5), M(sx * W / 2, colTop - 0.55, cz));
        b.add('lattice', box(0.04, 1.6, bay - 0.4, 'z', 1), M(sx * (W / 2 - 0.02), floorY + 1.95, cz));
        for (let q = -3; q <= 3; q++) b.add('woodDark', box(0.07, 1.6, 0.06, 'y', 1), M(sx * W / 2, floorY + 1.95, cz + q * 0.24));
        b.add('woodDark', box(0.12, 0.1, bay - 0.4, 'z', 1), M(sx * W / 2, floorY + 1.1, cz));
        b.add('woodDark', box(0.12, 0.1, bay - 0.4, 'z', 1), M(sx * W / 2, floorY + 2.8, cz));
      } else b.add('plaster', box(0.1, colTop - floorY - 1.3, bay - 0.4, 'z', 1.5), M(sx * W / 2, floorY + 1.14 + (colTop - floorY - 1.3) / 2, cz));
    }
  }
  // bracket sets (tokyo) on every perimeter column
  for (const [x, z] of perim) {
    const outs = [];
    if (Math.abs(x - W / 2) < 0.01) outs.push([1, 0]); if (Math.abs(x + W / 2) < 0.01) outs.push([-1, 0]);
    if (Math.abs(z - D / 2) < 0.01) outs.push([0, 1]); if (Math.abs(z + D / 2) < 0.01) outs.push([0, -1]);
    let y = colTop;
    b.add('paint', box(0.48, 0.26, 0.48, 'x', 0.6), M(x, y + 0.13, z)); y += 0.26;
    b.add('paint', box(1.25, 0.17, 0.16, 'x', 0.6), M(x, y + 0.085, z)); b.add('paint', box(0.16, 0.17, 1.25, 'z', 0.6), M(x, y + 0.085, z)); y += 0.17;
    for (const o of [-0.5, 0, 0.5]) { b.add('paint', box(0.2, 0.14, 0.2, 'x', 0.5), M(x + o, y + 0.07, z)); b.add('paint', box(0.2, 0.14, 0.2, 'x', 0.5), M(x, y + 0.07, z + o)); }
    y += 0.14;
    for (const [ox, oz] of outs) {
      const len = 1.55;
      b.add('paint', box(ox ? len : 0.15, 0.19, oz ? len : 0.15, ox ? 'x' : 'z', 0.6), M(x + ox * len / 2, y + 0.095, z + oz * len / 2));
      b.add('paint', box(0.2, 0.14, 0.2, 'x', 0.5), M(x + ox * 1.05, y + 0.26, z + oz * 1.05));
    }
  }
  // eave purlins resting on the bracket arms
  const py = colTop + 0.26 + 0.17 + 0.14 + 0.19 + 0.14 + 0.1;
  b.add('paint', box(W + 2.3, 0.2, 0.2, 'x', 1), M(0, py, D / 2 + 1.05)); b.add('paint', box(W + 2.3, 0.2, 0.2, 'x', 1), M(0, py, -D / 2 - 1.05));
  b.add('paint', box(0.2, 0.2, D + 2.3, 'z', 1), M(W / 2 + 1.05, py, 0)); b.add('paint', box(0.2, 0.2, D + 2.3, 'z', 1), M(-W / 2 - 1.05, py, 0));
  // infill band at the wall line up to the soffit
  const R = roof({ A: W / 2 + 2.9, B: D / 2 + 2.9, eaveY: 5.05, rise: 5.3, Th: 3.2, gable: true, lift: 0.7, over: 3.1, thick: 0.34 });
  const bandTop = (x, z) => R.hHip(x, z) - 0.36;
  for (const [ax, az, bx, bz] of [[-W / 2, D / 2, W / 2, D / 2], [-W / 2, -D / 2, W / 2, -D / 2], [W / 2, -D / 2, W / 2, D / 2], [-W / 2, -D / 2, -W / 2, D / 2]]) {
    const gsurf = surface(20, 1, (u, v) => { const x = lerp(ax, bx, u), z = lerp(az, bz, u); const top = bandTop(x, z) + 0.1; return V(x * 0.995, lerp(colTop, top, v), z * 0.995); }, false, (u, v, p) => [(p.x + p.z) / 1.5, p.y / 1.5]);
    // orient outward
    const nrm = gsurf.attributes.normal; const ox = (ax + bx) / 2, oz = (az + bz) / 2;
    if (nrm.getX(0) * ox + nrm.getZ(0) * oz < 0) { const idx = gsurf.index.array; for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } gsurf.computeVertexNormals(); }
    b.add('plaster', gsurf);
  }
  // ceiling plate closing the roof void
  b.add('woodDark', box(W + 0.2, 0.1, D + 0.2, 'x', 1.5), M(0, colTop + 0.05, 0));
  for (const gg of R.tiles) b.add('tile', gg);
  for (const gg of R.wood) b.add('woodDark', gg);
  for (const gg of R.ridge) b.add('ridge', gg);
  for (const gg of R.plaster) b.add('plaster', gg);
  const meshes = b.build(g, matSet());
  if (meshes.plaster) meshes.plaster.material = MAT.plaster;
  scene.add(g);
  for (const c of R.corners) bell(scene, localToWorld(g, c), 1.2);
  ARCH.glows.push({ p: localToWorld(g, V(0, 2.6, D / 2 + 1.2)), c: new THREE.Color(1.0, 0.55, 0.24), r: 12, i: 2.2, kind: 'lamp' });
  ARCH.obstacleBoxes.push({ group: g, min: V(-W / 2 - 3.2, -2, -D / 2 - 3.2), max: V(W / 2 + 3.2, 12, D / 2 + 3.2) });
  // front of hall in world (monk sweeps between stairs top and hall)
  ARCH.hallFront = localToWorld(g, V(0, 0, D / 2 + 3.6));
}

// ---------------------------------------------------------------- pagoda
function buildPagoda(scene) {
  const P = LAYOUT.pagoda;
  const g = new THREE.Group(); place(g, P.x, P.y, P.z, P.rot);
  const b = new Builder();
  b.add('stone', box(8.4, 1.0, 8.4, 'x', 1.4), M(0, 0.3, 0));
  for (let k = 0; k < 3; k++) b.add('stone', box(2.6, 0.26 * (k + 1), 0.36, 'x', 1), M(0, 0.13 * (k + 1) - 0.2, 4.2 + 0.18 + (2 - k) * 0.36));
  let y0 = 0.8;
  const widths = [5.4, 4.95, 4.5, 4.05, 3.6];
  let lastRoof = null;
  for (let i = 0; i < 5; i++) {
    const w = widths[i], hw = w / 2, hs = i === 0 ? 3.0 : 2.25;
    // balcony on upper storeys, resting on the roof below
    if (i > 0 && lastRoof) {
      const rr = hw + 0.45;
      const pts = [V(-rr, 0, rr), V(rr, 0, rr), V(rr, 0, -rr), V(-rr, 0, -rr), V(-rr, 0, rr)];
      for (let k = 0; k < 4; k++) {
        const a = pts[k], c = pts[k + 1];
        for (let q = 0; q <= 4; q++) { const p = a.clone().lerp(c, q / 4); const ry = lastRoof.hHip(p.x, p.z); b.add('paint', box(0.07, y0 + 0.62 - ry + 0.05, 0.07, 'y', 1), M(p.x, (y0 + 0.62 + ry) / 2 - 0.02, p.z)); }
        b.add('black', sweep([a.clone().setY(y0 + 0.62), c.clone().setY(y0 + 0.62)], 0.07, 0.07, V(0, 1, 0), 1));
        b.add('wood', sweep([a.clone().setY(y0 + 0.05), c.clone().setY(y0 + 0.05)], 0.5, 0.08, V(0, 1, 0), 1));
      }
    }
    // columns
    const xs = [-hw, -hw / 3, hw / 3, hw];
    for (const x of xs) for (const z of xs) {
      if (!(Math.abs(Math.abs(x) - hw) < 0.01 || Math.abs(Math.abs(z) - hw) < 0.01)) continue;
      b.add('paint', cyl(0.14, 0.15, hs, 12, 1), M(x, y0 + hs / 2, z));
    }
    // walls: centre door, side bays with slatted windows
    for (let side = 0; side < 4; side++) {
      const ry = side * Math.PI / 2;
      const m = (lx, ly, lz) => { const c = Math.cos(ry), s = Math.sin(ry); return [lx * c + lz * s, ly, -lx * s + lz * c]; };
      const bw = w / 3 - 0.3;
      const [dx, dy, dz] = m(0, y0 + hs * 0.46, hw);
      b.add('paint', box(bw, hs * 0.78, 0.08, 'y', 1), M(dx, dy, dz, ry));
      for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) { const [sx, sy, sz] = m(-bw / 2 + 0.15 + c * (bw - 0.3) / 3, y0 + hs * 0.2 + r * hs * 0.25, hw + 0.05); b.add('gold', new THREE.SphereGeometry(0.035, 6, 4), M(sx, sy, sz)); }
      for (const o of [-1, 1]) {
        const [px, py, pz] = m(o * w / 3, y0 + hs * 0.5, hw - 0.02);
        b.add('plaster', box(bw, hs * 0.85, 0.08, 'y', 1.4), M(px, py, pz, ry));
        const [wx, wy, wz] = m(o * w / 3, y0 + hs * 0.55, hw + 0.03);
        b.add('woodDark', box(bw * 0.7, hs * 0.38, 0.03, 'y', 1), M(wx, wy, wz, ry));
        for (let q = -3; q <= 3; q++) { const [sx, sy, sz] = m(o * w / 3 + q * bw * 0.09, y0 + hs * 0.55, hw + 0.06); b.add('paint', box(0.04, hs * 0.38, 0.04, 'y', 1), M(sx, sy, sz, ry)); }
      }
      const [bx2, by2, bz2] = m(0, y0 + hs - 0.12, hw + 0.03); b.add('paint', box(w + 0.3, 0.22, 0.12, 'x', 1), M(bx2, by2, bz2, ry));
      const [bx3, by3, bz3] = m(0, y0 + 0.12, hw + 0.03); b.add('paint', box(w + 0.3, 0.2, 0.12, 'x', 1), M(bx3, by3, bz3, ry));
    }
    // bracket band
    const by = y0 + hs;
    for (const x of xs) for (const z of xs) {
      if (!(Math.abs(Math.abs(x) - hw) < 0.01 || Math.abs(Math.abs(z) - hw) < 0.01)) continue;
      b.add('paint', box(0.36, 0.2, 0.36, 'x', 0.5), M(x, by + 0.1, z));
      b.add('paint', box(0.9, 0.13, 0.13, 'x', 0.5), M(x, by + 0.27, z)); b.add('paint', box(0.13, 0.13, 0.9, 'z', 0.5), M(x, by + 0.27, z));
      const ox = Math.abs(Math.abs(x) - hw) < 0.01 ? Math.sign(x) : 0, oz = Math.abs(Math.abs(z) - hw) < 0.01 ? Math.sign(z) : 0;
      if (ox) b.add('paint', box(0.8, 0.12, 0.1, 'x', 0.5), M(x + ox * 0.4, by + 0.4, z));
      if (oz) b.add('paint', box(0.1, 0.12, 0.8, 'z', 0.5), M(x, by + 0.4, z + oz * 0.4));
    }
    b.add('plaster', box(w + 0.02, 0.5, w + 0.02, 'x', 1.4), M(0, by + 0.25, 0));
    b.add('woodDark', box(w, 0.08, w, 'x', 1.4), M(0, by + 0.52, 0));
    const R = roof({ A: hw + 1.95, B: hw + 1.95, eaveY: by + 0.62, rise: 1.25 + 0.05 * i, lift: 0.42, over: 2.0, thick: 0.28, sp: 0.24, amp: 0.055 });
    for (const gg of R.tiles) b.add('tile', gg);
    for (const gg of R.wood) b.add('woodDark', gg);
    for (const gg of R.ridge) b.add('ridge', gg);
    // band from the wall line to the soffit
    b.add('plaster', box(w + 0.05, 0.9, w + 0.05, 'x', 1.4), M(0, by + 0.95, 0));
    for (const c of R.corners) bell(scene, localToWorld(g, c), 0.9);
    lastRoof = R;
    if (i < 4) {
      const nhw = widths[i + 1] / 2;
      const ez = (hw + 1.95) - nhw;
      y0 = R.f(ez) - 0.08;
    } else {
      // spire
      const top = R.f(hw + 1.95);
      let y = top - 0.25;
      b.add('bronze', box(1.0, 0.55, 1.0, 'x', 0.6), M(0, y + 0.27, 0)); y += 0.55;
      b.add('bronze', lathe([[0.5, 0], [0.52, 0.12], [0.45, 0.35], [0.25, 0.48], [0.1, 0.52]], 20), M(0, y, 0)); y += 0.5;
      b.add('bronze', lathe([[0.1, 0], [0.32, 0.1], [0.42, 0.28], [0.3, 0.3], [0.1, 0.32]], 16), M(0, y, 0)); y += 0.3;
      b.add('bronze', cyl(0.07, 0.08, 5.6, 10), M(0, y + 2.8, 0));
      for (let k = 0; k < 9; k++) b.add('bronze', new THREE.TorusGeometry(0.46 - k * 0.018, 0.045, 8, 24), M(0, y + 0.25 + k * 0.4, 0, 0, Math.PI / 2));
      y += 3.9;
      const fl = new THREE.Shape(); fl.moveTo(0, 0); fl.quadraticCurveTo(0.45, 0.2, 0.32, 0.6); fl.quadraticCurveTo(0.52, 0.8, 0.2, 1.2); fl.quadraticCurveTo(0.25, 0.9, 0.05, 0.85); fl.lineTo(0, 1.35); fl.lineTo(-0.05, 0.85); fl.quadraticCurveTo(-0.25, 0.9, -0.2, 1.2); fl.quadraticCurveTo(-0.52, 0.8, -0.32, 0.6); fl.quadraticCurveTo(-0.45, 0.2, 0, 0);
      const fg = new THREE.ExtrudeGeometry(fl, { depth: 0.03, bevelEnabled: false }); fg.translate(0, 0, -0.015);
      for (let k = 0; k < 4; k++) b.add('gold', fg, M(0, y, 0, k * Math.PI / 4));
      y += 1.3;
      b.add('gold', new THREE.SphereGeometry(0.16, 12, 8), M(0, y + 0.1, 0));
      b.add('gold', lathe([[0.001, 0], [0.12, 0.08], [0.15, 0.2], [0.1, 0.33], [0.001, 0.46]], 14), M(0, y + 0.25, 0));
      ARCH.pagodaTop = localToWorld(g, V(0, y + 0.6, 0));
    }
  }
  b.build(g, matSet());
  scene.add(g);
  ARCH.obstacleBoxes.push({ group: g, min: V(-5, -1, -5), max: V(5, 30, 5) });
}

// ---------------------------------------------------------------- small shrines
function smallShrine(b, s = 1, kind = 'hokora') {
  if (kind === 'hokora') {
    b.add('stone', box(1.8, 0.35, 1.6, 'x', 1), M(0, 0.1, 0));
    b.add('stone', box(1.3, 0.3, 1.1, 'x', 1), M(0, 0.4, 0));
    b.add('wood', box(0.9, 0.85, 0.72, 'y', 1), M(0, 0.55 + 0.43, -0.05));
    b.add('lattice', box(0.6, 0.62, 0.03, 'x', 1), M(0, 0.98, 0.32));
    b.add('wood', box(1.1, 0.06, 0.9, 'x', 1), M(0, 0.58, 0.05));
    const R = roof({ A: 0.8, B: 0.7, eaveY: 1.48, rise: 0.55, Th: 0.02, gable: true, lift: 0.06, over: 0.35, thick: 0.09, sp: 0.13, amp: 0.022 });
    for (const gg of R.tiles) b.add('broof', gg); for (const gg of R.wood) b.add('woodDark', gg); for (const gg of R.plaster) b.add('wood', gg);
    const top = R.f(0.7) + 0.02;
    b.add('woodDark', box(1.7, 0.1, 0.14, 'x', 1), M(0, top + 0.05, 0));
    for (const sx of [-1, 1]) { b.add('woodDark', box(0.05, 0.55, 0.1, 'y', 1), M(sx * 0.88, top + 0.2, 0, 0, 0, sx * 0.5)); b.add('woodDark', box(0.05, 0.55, 0.1, 'y', 1), M(sx * 0.88, top + 0.2, 0, 0, 0, -sx * 0.5)); }
    for (const sx of [-1, 1]) {
      b.add('stone', lathe([[0.001, 0], [0.06, 0], [0.07, 0.1], [0.05, 0.16], [0.07, 0.24], [0.001, 0.24]], 12), M(sx * 0.4, 0.55, 0.42));
      b.add('glow', lathe([[0.001, 0], [0.04, 0.0], [0.05, 0.03], [0.001, 0.03]], 10), M(sx * 0.18, 0.55, 0.45));
    }
  }
}
function buildShrines(scene) {
  // wayside shrine in the far-bank clearing
  const W = LAYOUT.wayside;
  const g = new THREE.Group(); place(g, W.x, W.y - 0.05, W.z, W.rot);
  const b = new Builder(); smallShrine(b, 1, 'hokora'); b.build(g, matSet()); scene.add(g);
  const g2 = new THREE.Group();
  const tor = new Builder(); torii(tor, { span: 1.5, H: 1.9, r: 0.09, ext: 0.45 });
  const fwd = localToWorld(g, V(0, 0, 2.6));
  place(g2, fwd.x, heightAt(fwd.x, fwd.z) - 0.1, fwd.z, W.rot); tor.build(g2, matSet()); scene.add(g2);
  const lb = new Builder();
  for (const sx of [-1, 1]) { const p = localToWorld(g, V(sx * 1.6, 0, 1.4)); stoneLantern(lb, p.x, heightAt(p.x, p.z) - 0.05, p.z, W.rot, 0.62); }
  // rope fence at the clearing edge
  const pts = [V(-3.4, 0, 3.6), V(-1.2, 0, 4.2)].map((v) => localToWorld(g, v));
  const pts2 = [V(1.2, 0, 4.2), V(3.4, 0, 3.6)].map((v) => localToWorld(g, v));
  fenceAlong(lb, pts, 2.2, 0.8, 'wood'); fenceAlong(lb, pts2, 2.2, 0.8, 'wood');
  lb.build(scene, matSet());
  ARCH.glows.push({ p: localToWorld(g, V(0, 0.8, 0.5)), c: new THREE.Color(1, 0.6, 0.3), r: 5, i: 0.6, kind: 'lamp' });

  // hillside shrine at the top of the torii tunnel
  const Hs = LAYOUT.hillShrine;
  const h = new THREE.Group(); place(h, Hs.x, Hs.y, Hs.z, Hs.rot);
  const hb = new Builder();
  hb.add('stone', box(5.2, 0.5, 4.6, 'x', 1), M(0, 0.05, 0));
  const fy = 0.95;
  hb.add('wood', box(4.4, 0.12, 3.8, 'x', 1), M(0, fy, 0));
  for (const [x, z] of [[-1.7, -1.4], [1.7, -1.4], [-1.7, 1.4], [1.7, 1.4], [0, -1.4], [0, 1.4]]) { hb.add('paint', cyl(0.13, 0.14, 2.3, 12), M(x, fy + 1.15, z)); hb.add('woodDark', box(0.2, fy - 0.3, 0.2, 'y', 1), M(x, 0.3 + (fy - 0.3) / 2, z)); }
  for (const x of [-0.85, 0.85]) hb.add('lattice', box(1.5, 1.9, 0.05, 'x', 1), M(x, fy + 1.05, 1.4));
  hb.add('plaster', box(3.5, 2.2, 0.08, 'x', 1.4), M(0, fy + 1.1, -1.4));
  for (const sx of [-1, 1]) hb.add('plaster', box(0.08, 2.2, 2.8, 'z', 1.4), M(sx * 1.7, fy + 1.1, 0));
  hb.add('paint', box(3.8, 0.2, 0.14, 'x', 1), M(0, fy + 2.2, 1.45)); hb.add('paint', box(3.8, 0.2, 0.14, 'x', 1), M(0, fy + 2.2, -1.45));
  hb.add('woodDark', box(3.5, 0.08, 2.9, 'x', 1), M(0, fy + 2.32, 0));
  const R = roof({ A: 2.9, B: 2.6, eaveY: fy + 2.55, rise: 1.4, Th: 0.02, gable: true, lift: 0.18, over: 1.2, thick: 0.2, sp: 0.2, amp: 0.045 });
  for (const gg of R.tiles) hb.add('tile', gg); for (const gg of R.wood) hb.add('woodDark', gg); for (const gg of R.ridge) hb.add('ridge', gg); for (const gg of R.plaster) hb.add('plaster', gg);
  for (let k = 0; k < 3; k++) hb.add('wood', box(1.6, 0.08, 0.32, 'x', 1), M(0, 0.3 + (k + 1) * 0.2, 2.1 + 0.3 - k * 0.3));
  hb.add('woodDark', box(0.9, 0.5, 0.45, 'x', 0.6), M(0, fy + 0.3, 1.75));
  // hanging lanterns
  for (const sx of [-1.2, 1.2]) { hb.add('glow', lathe([[0.001, 0], [0.12, 0.03], [0.17, 0.2], [0.12, 0.38], [0.001, 0.4]], 14), M(sx, fy + 1.55, 1.75)); hb.add('black', cyl(0.08, 0.08, 0.05, 10), M(sx, fy + 1.97, 1.75)); }
  hb.build(h, matSet()); scene.add(h);
  for (const sx of [-1.2, 1.2]) ARCH.glows.push({ p: localToWorld(h, V(sx, fy + 1.75, 1.75)), c: new THREE.Color(1, 0.5, 0.2), r: 6, i: 0.8, kind: 'lamp' });
  for (const c of R.corners) bell(scene, localToWorld(h, c), 0.7);
  const lb2 = new Builder();
  for (const sx of [-1, 1]) { const p = localToWorld(h, V(sx * 2.2, 0, 3.0)); stoneLantern(lb2, p.x, heightAt(p.x, p.z) - 0.05, p.z, Hs.rot, 0.75); }
  lb2.build(scene, matSet());
}

// ---------------------------------------------------------------- torii tunnel (instanced)
function buildToriiTunnel(scene) {
  const T = LAYOUT.tunnel;
  const tb = new Builder(); torii(tb, { span: 1.8, H: 2.55, r: 0.1, ext: 0.4 });
  const tmp = new THREE.Group(); const parts = tb.build(tmp, matSet(), {});
  const L = Math.hypot(T.bx - T.ax, T.bz - T.az); const n = Math.floor(L / 1.15);
  const ry = Math.atan2(T.bx - T.ax, T.bz - T.az);
  const m4 = new THREE.Matrix4();
  for (const key in parts) {
    const src = parts[key];
    const im = new THREE.InstancedMesh(src.geometry, src.material, n);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n; const x = lerp(T.ax, T.bx, t), z = lerp(T.az, T.bz, t);
      const y = lerp(T.ha, T.hb, t) - 0.3;
      const s = 1.05 - 0.15 * t + 0.03 * Math.sin(i * 1.7);
      m4.compose(V(x, y, z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), ry), V(s, s, s));
      im.setMatrixAt(i, m4);
    }
    im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere();
    scene.add(im);
  }
  const sb = new Builder();
  steps(sb, T.ax, T.az, T.ha, T.bx, T.bz, T.hb, 1.5, 0.24);
  sb.build(scene, matSet());
  const q = worldToSD((T.ax + T.bx) / 2, (T.az + T.bz) / 2);
}

// ---------------------------------------------------------------- lanterns + fences along the approach
function buildApproach(scene) {
  const b = new Builder();
  const P = LAYOUT.paths;
  const along = (pts, every, off, cb) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], c = pts[i + 1]; const L = Math.hypot(c.x - a.x, c.z - a.z);
      const dx = (c.x - a.x) / L, dz = (c.z - a.z) / L;
      for (let d = every * 0.5; d < L; d += every) cb(a.x + dx * d, a.z + dz * d, dx, dz, Math.atan2(dx, dz));
    }
  };
  along(P.approach, 6.5, 2.2, (x, z, dx, dz, ry) => { for (const sg of [-1, 1]) { const px = x + dz * sg * 2.3, pz = z - dx * sg * 2.3; stoneLantern(b, px, heightAt(px, pz) - 0.05, pz, ry); footprints.push({ x: px, z: pz, r: 0.8 }); } });
  along(P.walk, 5.5, 2, (x, z, dx, dz, ry) => { for (const sg of [-1, 1]) { const px = x + dz * sg * 2.1, pz = z - dx * sg * 2.1; stoneLantern(b, px, heightAt(px, pz) - 0.05, pz, ry, 0.9); } });
  along(P.pagoda, 9, 1.8, (x, z, dx, dz, ry) => { const px = x + dz * 1.7, pz = z - dx * 1.7; stoneLantern(b, px, heightAt(px, pz) - 0.05, pz, ry, 0.85); });
  // rope fence along the river side of the approach
  const fence = P.approach.map((p, i) => {
    const nx = i < P.approach.length - 1 ? P.approach[i + 1].z - p.z : p.z - P.approach[i - 1].z;
    const nz = i < P.approach.length - 1 ? -(P.approach[i + 1].x - p.x) : -(p.x - P.approach[i - 1].x);
    const l = Math.hypot(nx, nz); return V(p.x - nx / l * 3.4, 0, p.z - nz / l * 3.4);
  });
  // choose the side facing the river
  const c0 = LAYOUT.bridge; const t0 = fence[0];
  fenceAlong(b, fence.slice(0, 3), 2.6, 0.75, 'stone');
  b.build(scene, matSet());
  // shide mesh
  const A = shideAcc; const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(A.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(A.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(A.uv, 2)); g.setAttribute('aWind', new THREE.Float32BufferAttribute(A.wind, 2)); g.setIndex(A.idx);
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, SHIDE); m.castShadow = true; m.frustumCulled = false; scene.add(m);
}

export function buildArchitecture(scene) {
  mats();
  buildBridge(scene);
  buildMainTorii(scene);
  buildTempleGrounds(scene);
  buildHall(scene);
  buildPagoda(scene);
  buildShrines(scene);
  buildToriiTunnel(scene);
  buildApproach(scene);
  // AO stamps under structures
  for (const f of [LAYOUT.torii, LAYOUT.wayside, LAYOUT.hillShrine]) { const q = worldToSD(f.x, f.z); stamp(q.s, q.d, 3, 0.3); }
}

// ---------------------------------------------------------------- animation
const _e = new THREE.Euler();
export function updateArch(dt, t, wind) {
  const wx = wind.x * wind.z, wz = wind.y * wind.z;
  for (const b of ARCH.bells) {
    const gust = 0.5 + 0.5 * Math.sin(t * 0.8 + b.ph) * Math.sin(t * 0.33 + b.ph * 2);
    const fx = wx * (0.6 + gust) * 0.5, fz = wz * (0.6 + gust) * 0.5;
    // damped pendulum
    b.vx += (-b.ax * 9 + fz * 1.5 - b.vx * 1.2) * dt; b.ax += b.vx * dt;
    b.vz += (-b.az * 9 - fx * 1.5 - b.vz * 1.2) * dt; b.az += b.vz * dt;
    b.pivot.rotation.set(b.ax * 0.35, 0, b.az * 0.35);
    b.clapper.rotation.set(Math.sin(t * 4.1 + b.ph) * 0.25 * gust * wind.z + b.ax * 0.4, 0, Math.cos(t * 3.7 + b.ph) * 0.25 * gust * wind.z + b.az * 0.4);
  }
}
