// Geometry kit for architecture: UV-correct boxes/cylinders/lathes, swept beams, curved tiled roofs,
// and a Builder that merges parts per material.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp } from './noise.js';

export const M = (x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));

function clean(g) {
  if (!g.index) { const n = g.attributes.position.count; const idx = []; for (let i = 0; i < n; i++) idx.push(i); g.setIndex(idx); }
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

export class Builder {
  constructor() { this.parts = {}; }
  add(key, geo, m) {
    const g = clean(geo.clone());
    if (m) g.applyMatrix4(m);
    (this.parts[key] = this.parts[key] || []).push(g);
    return this;
  }
  build(parent, mats, opt = {}) {
    const out = {};
    for (const k in this.parts) {
      const list = this.parts[k];
      if (!list.length) continue;
      const g = mergeGeometries(list, false);
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mats[k]);
      mesh.castShadow = opt.cast ?? true; mesh.receiveShadow = true;
      parent.add(mesh); out[k] = mesh;
    }
    return out;
  }
}

// box with planar UVs; grain (texture v) runs along lenAxis
export function box(w, h, d, lenAxis = 'x', ts = 1.2, off = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  const ax = ['x', 'y', 'z'];
  for (let i = 0; i < p.count; i++) {
    const c = { x: p.getX(i), y: p.getY(i), z: p.getZ(i) };
    const nn = [Math.abs(n.getX(i)), Math.abs(n.getY(i)), Math.abs(n.getZ(i))];
    const a = ax[nn.indexOf(Math.max(...nn))];
    const others = ax.filter((q) => q !== a);
    let U, V;
    if (others.includes(lenAxis)) { V = c[lenAxis]; U = c[others.find((q) => q !== lenAxis)]; }
    else { U = c[others[0]]; V = c[others[1]]; }
    uv.setXY(i, U / ts + off, V / ts + off * 0.7);
  }
  return g;
}
export function cyl(rt, rb, h, seg = 12, ts = 1.2, open = false) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
  const uv = g.attributes.uv; const circ = Math.PI * (rt + rb);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ / ts, uv.getY(i) * h / ts);
  return g;
}
export function lathe(prof, seg = 16, ts = 1.0) {
  const pts = prof.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y));
  const g = new THREE.LatheGeometry(pts, seg);
  const uv = g.attributes.uv;
  let len = 0; for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
  const rmax = Math.max(...prof.map((q) => q[0]));
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 * Math.PI * rmax / ts, uv.getY(i) * len / ts);
  return g;
}
// reorient triangles to match stored normals
function fixWinding(pos, nor, idx) {
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < idx.length; i += 3) {
    a.fromArray(pos, idx[i] * 3); b.fromArray(pos, idx[i + 1] * 3); c.fromArray(pos, idx[i + 2] * 3);
    n.fromArray(nor, idx[i] * 3);
    b.sub(a); c.sub(a); b.cross(c);
    if (b.dot(n) < 0) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  }
}
// rectangular beam swept along a polyline
export function sweep(pts, w, h, up = new THREE.Vector3(0, 1, 0), ts = 1.2, caps = true) {
  const pos = [], nor = [], uv = [], idx = [];
  const n = pts.length;
  const fr = [];
  let arc = 0;
  for (let i = 0; i < n; i++) {
    const t = new THREE.Vector3().subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
    const u = up.clone().addScaledVector(t, -up.dot(t)).normalize();
    const s = new THREE.Vector3().crossVectors(t, u).normalize();
    if (i > 0) arc += pts[i].distanceTo(pts[i - 1]);
    fr.push({ t, u, s, arc });
  }
  const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  const fn = [(f) => f.u.clone().negate(), (f) => f.s.clone(), (f) => f.u.clone(), (f) => f.s.clone().negate()];
  for (let face = 0; face < 4; face++) {
    const ca = corners[face], cb = corners[(face + 1) % 4];
    const base = pos.length / 3;
    const width = face % 2 === 0 ? w : h;
    for (let i = 0; i < n; i++) {
      const f = fr[i]; const nn = fn[face](f);
      for (const [k, cc] of [[0, ca], [1, cb]]) {
        const p = pts[i].clone().addScaledVector(f.s, cc[0] * w).addScaledVector(f.u, cc[1] * h);
        pos.push(p.x, p.y, p.z); nor.push(nn.x, nn.y, nn.z); uv.push(k * width / ts, f.arc / ts);
      }
    }
    for (let i = 0; i < n - 1; i++) { const a = base + i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  if (caps) for (const [i, sg] of [[0, -1], [n - 1, 1]]) {
    const f = fr[i]; const base = pos.length / 3;
    for (const cc of corners) {
      const p = pts[i].clone().addScaledVector(f.s, cc[0] * w).addScaledVector(f.u, cc[1] * h);
      pos.push(p.x, p.y, p.z); nor.push(f.t.x * sg, f.t.y * sg, f.t.z * sg); uv.push((cc[0] + 0.5) * w / ts, (cc[1] + 0.5) * h / ts);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  fixWinding(pos, nor, idx);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
// round tube along a polyline
export function tubeGeo(pts, r, seg = 8, ts = 1.0) {
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.TubeGeometry(curve, Math.max(4, pts.length * 3), r, seg, false);
  const uv = g.attributes.uv; const len = curve.getLength();
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / ts, uv.getY(i) * 2 * Math.PI * r / ts);
  return g;
}
// grid surface from a function (u,v)->Vector3 with upward orientation
export function surface(nu, nv, fn, wantUp = true, uvfn = null) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const p = fn(i / nu, j / nv); pos.push(p.x, p.y, p.z);
    const q = uvfn ? uvfn(i / nu, j / nv, p) : [i / nu, j / nv]; uv.push(q[0], q[1]);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  // orient
  const a = new THREE.Vector3().fromArray(pos, idx[0] * 3), b = new THREE.Vector3().fromArray(pos, idx[1] * 3), c = new THREE.Vector3().fromArray(pos, idx[2] * 3);
  const nrm = b.sub(a).cross(c.sub(a));
  if ((nrm.y < 0) === wantUp) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } g.setIndex(idx); }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- curved tiled roof (hip or hip-and-gable)
// returns { tiles, wood, ridge, plaster, corners:[Vector3] } geometries in local space
export function roof(o) {
  const { A, B, eaveY, rise, lift = 0.5 } = o;
  const gable = !!o.gable, Th = o.Th ?? B, sp = o.sp ?? 0.27, amp = o.amp ?? 0.065, thick = o.thick ?? 0.32;
  const cr = o.cr ?? B * 0.42, over = o.over ?? 2.6;
  const xg = A - Th;
  const f = (dist) => eaveY + rise * Math.pow(clamp(dist / B, 0, 1), 1.45);
  const L = (ex, ez) => lift * Math.exp(-(Math.max(0, ex) + Math.max(0, ez)) / cr);
  const hHip = (x, z) => { const ex = A - Math.abs(x), ez = B - Math.abs(z); return f(Math.min(ex, ez)) + L(ex, ez); };
  const hGab = (x, z) => { const ex = A - Math.abs(x), ez = B - Math.abs(z); return f(ez) + L(ex, ez); };
  const prof = (t) => Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * t / sp), 2.4) * amp;
  const tiles = [], wood = [], ridge = [], plaster = [];
  const courses = 0.3;
  const mk = (list, geo, mirrorX, mirrorZ) => {
    if (mirrorX || mirrorZ) {
      const g = geo.clone(); g.applyMatrix4(new THREE.Matrix4().makeScale(mirrorX ? -1 : 1, 1, mirrorZ ? -1 : 1));
      const idx = g.index.array; for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
      g.index.needsUpdate = true; g.computeVertexNormals(); list.push(g);
    } else list.push(geo);
  };
  // front (+z) faces
  const frontParts = gable ? [[0, Th, (ez) => A - ez, hHip], [Th, B, () => xg + 0.6, hGab]] : [[0, B, (ez) => Math.max(0.001, A - ez), hHip]];
  for (const [e0, e1, xmax, hf] of frontParts) {
    const nu = Math.ceil((2 * xmax(e0)) / 0.055), nv = Math.max(6, Math.ceil((e1 - e0) / 0.35));
    const g = surface(nu, nv, (u, v) => {
      const ez = e0 + (e1 - e0) * v; const xm = xmax(ez); const x = (u * 2 - 1) * xm; const z = B - ez;
      return new THREE.Vector3(x, hf(x, z) + prof(x), z);
    }, true, (u, v, p) => [(p.x / sp + 0.5) / 4, (B - p.z) / (4 * courses)]);
    mk(tiles, g, false, false); mk(tiles, g, false, true);
    // soffit under the eave band
    if (e0 === 0) {
      const eo = Math.min(over, e1);
      const gs = surface(Math.ceil(nu / 6), 4, (u, v) => { const ez = eo * v; const xm = xmax(ez); const x = (u * 2 - 1) * xm; const z = B - ez; return new THREE.Vector3(x, hf(x, z) - thick, z); }, false, (u, v, p) => [p.x / 1.2, p.z / 1.2]);
      mk(wood, gs, false, false); mk(wood, gs, false, true);
    }
  }
  // side (+x) faces
  const e1s = gable ? Th : B;
  {
    const nu = Math.ceil((2 * B) / 0.055), nv = Math.max(6, Math.ceil(e1s / 0.35));
    const g = surface(nu, nv, (u, v) => {
      const ex = e1s * v; const zm = Math.max(0.001, B - ex); const z = (u * 2 - 1) * zm; const x = A - ex;
      return new THREE.Vector3(x, hHip(x, z) + prof(z), z);
    }, true, (u, v, p) => [(p.z / sp + 0.5) / 4, (A - p.x) / (4 * courses)]);
    mk(tiles, g, false, false); mk(tiles, g, true, false);
    const eo = Math.min(over, e1s);
    const gs = surface(Math.ceil(nu / 6), 4, (u, v) => { const ex = eo * v; const zm = Math.max(0.001, B - ex); const z = (u * 2 - 1) * zm; const x = A - ex; return new THREE.Vector3(x, hHip(x, z) - thick, z); }, false, (u, v, p) => [p.z / 1.2, p.x / 1.2]);
    mk(wood, gs, false, false); mk(wood, gs, true, false);
  }
  // fascia bands along the eave perimeter
  const edge = [];
  const N = 80;
  for (let i = 0; i <= N; i++) { const x = -A + (2 * A * i) / N; edge.push(new THREE.Vector3(x, hHip(x, B), B)); }
  const edgeS = [];
  for (let i = 0; i <= N; i++) { const z = B - (2 * B * i) / N; edgeS.push(new THREE.Vector3(A, hHip(A, z), z)); }
  const fascia = (pts, outward) => {
    const pp = pts.map((p) => p.clone().add(new THREE.Vector3(0, -thick * 0.5 + 0.02, 0)).addScaledVector(outward, -0.02));
    return sweep(pp, 0.1, thick + 0.04, new THREE.Vector3(0, 1, 0), 1.0, true);
  };
  const fz = fascia(edge, new THREE.Vector3(0, 0, 1)); mk(wood, fz, false, false); mk(wood, fz, false, true);
  const fx = fascia(edgeS, new THREE.Vector3(1, 0, 0)); mk(wood, fx, false, false); mk(wood, fx, true, false);
  // round eave-end tiles
  const cap = cyl(amp * 1.25, amp * 1.25, 0.14, 8, 0.3);
  for (let x = -A + sp; x <= A - sp + 1e-3; x += sp) {
    const xs = Math.round(x / sp) * sp; if (Math.abs(xs) > A - 0.2) continue;
    for (const sz of [1, -1]) { const g = cap.clone(); g.applyMatrix4(M(xs, hHip(xs, B) + amp * 0.9, sz * (B + 0.04), 0, Math.PI / 2 + sz * 0.2)); tiles.push(g); }
  }
  for (let z = -B + sp; z <= B - sp + 1e-3; z += sp) {
    const zs = Math.round(z / sp) * sp; if (Math.abs(zs) > B - 0.2) continue;
    for (const sx of [1, -1]) { const g = cap.clone(); g.applyMatrix4(M(sx * (A + 0.04), hHip(A, zs) + amp * 0.9, zs, 0, 0, Math.PI / 2 - sx * 0.2)); tiles.push(g); }
  }
  // rafters under the soffit (straight runs, away from the corners)
  const raf = box(0.09, 0.11, 1, 'z', 0.8);
  const rafLen = over + 0.3;
  const beam = (p0, p1) => { const len = p0.distanceTo(p1); const dir = p1.clone().sub(p0).normalize(); const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir); const g = raf.clone(); g.applyMatrix4(new THREE.Matrix4().compose(p0.clone().add(p1).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, len))); wood.push(g); };
  for (let x = -A + over + 0.5; x <= A - over - 0.5; x += 0.34) {
    for (const sz of [1, -1]) {
      const z0 = sz * B, z1 = sz * (B - rafLen);
      beam(new THREE.Vector3(x, hHip(x, z0) - thick - 0.06, z0), new THREE.Vector3(x, hHip(x, z1) - thick - 0.06, z1));
    }
  }
  for (let z = -B + over + 0.5; z <= B - over - 0.5; z += 0.34) {
    for (const sx of [1, -1]) {
      const x0 = sx * A, x1 = sx * (A - rafLen);
      beam(new THREE.Vector3(x0, hHip(x0, z) - thick - 0.06, z), new THREE.Vector3(x1, hHip(x1, z) - thick - 0.06, z));
    }
  }
  // corner fan rafters
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    for (let k = 0; k < 9; k++) {
      const a = (k / 8) * Math.PI / 2;
      const ox = sx * (A - over), oz = sz * (B - over);
      const ex = Math.cos(a) * over * 1.35, ez = Math.sin(a) * over * 1.35;
      let tx = ox + sx * ex, tz = oz + sz * ez;
      tx = clamp(tx, -A + 0.05, A - 0.05); tz = clamp(tz, -B + 0.05, B - 0.05);
      const p0 = new THREE.Vector3(ox, hHip(ox, oz) - thick - 0.06, oz), p1 = new THREE.Vector3(tx, hHip(tx, tz) - thick - 0.06, tz);
      const len = p0.distanceTo(p1); const dir = p1.clone().sub(p0).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      const g = raf.clone(); g.applyMatrix4(new THREE.Matrix4().compose(p0.clone().add(p1).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, len))); wood.push(g);
    }
  }
  // ridges
  const ridgeTop = f(B) + 0.02;
  if (gable || A > B + 0.05) {
    const x0 = gable ? xg + 0.6 : A - B;
    const rp = [new THREE.Vector3(-x0 - 0.1, ridgeTop + 0.22, 0), new THREE.Vector3(x0 + 0.1, ridgeTop + 0.22, 0)];
    ridge.push(sweep(rp, 0.5, 0.48, new THREE.Vector3(0, 1, 0), 0.8));
    const rc = cyl(0.17, 0.17, 2 * x0 + 0.3, 10, 0.6); rc.applyMatrix4(M(0, ridgeTop + 0.5, 0, 0, 0, Math.PI / 2)); ridge.push(rc);
    // onigawara
    const sh = new THREE.Shape();
    sh.moveTo(-0.42, 0); sh.lineTo(0.42, 0); sh.lineTo(0.46, 0.55); sh.quadraticCurveTo(0.5, 0.95, 0.3, 1.0); sh.quadraticCurveTo(0.12, 0.78, 0, 0.84); sh.quadraticCurveTo(-0.12, 0.78, -0.3, 1.0); sh.quadraticCurveTo(-0.5, 0.95, -0.46, 0.55); sh.closePath();
    const og = new THREE.ExtrudeGeometry(sh, { depth: 0.28, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 });
    og.translate(0, 0, -0.14);
    for (const sx of [-1, 1]) { const g = og.clone(); g.applyMatrix4(M(sx * (x0 + 0.2), ridgeTop - 0.02, 0, Math.PI / 2)); ridge.push(g); }
  }
  // hip ridges (diagonals)
  const eMax = gable ? Th : B;
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const pts = [];
    pts.push(new THREE.Vector3(sx * (A + 0.35), hHip(A, B) + 0.32, sz * (B + 0.35)));
    for (let i = 0; i <= 10; i++) { const e = (eMax * i) / 10; const x = sx * (A - e), z = sz * (B - e); pts.push(new THREE.Vector3(x, hHip(x, z) + 0.12, z)); }
    ridge.push(tubeGeo(pts, 0.14, 8, 0.5));
  }
  const corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sz]) => new THREE.Vector3(sx * (A - 0.1), hHip(A, B) - thick - 0.05, sz * (B - 0.1)));
  // gable walls + bargeboards
  if (gable) {
    for (const sx of [-1, 1]) {
      const zmax = B - Th;
      const yLow = f(Th) + L(Th, Th) - 0.05;
      const gw = surface(24, 1, (u, v) => { const z = (u * 2 - 1) * zmax; const yh = hGab(xg, z) - thick * 0.5; return new THREE.Vector3(sx * (xg - 0.05), yLow + (yh - yLow) * v, z); }, false, (u, v, p) => [p.z / 1.5, p.y / 1.5]);
      // orient normal outward (+x*sx)
      const nrm = gw.attributes.normal; if (nrm.getX(0) * sx < 0) { const idx = gw.index.array; for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } gw.computeVertexNormals(); }
      plaster.push(gw);
      // vertical battens
      for (let z = -zmax + 0.2; z < zmax - 0.1; z += 0.28) {
        const yh = hGab(xg, z) - thick * 0.5; if (yh - yLow < 0.15) continue;
        const b = box(0.06, yh - yLow, 0.05, 'y', 0.8); b.translate(sx * (xg + 0.0), (yh + yLow) / 2, z); wood.push(b);
      }
      const bp = []; for (let i = 0; i <= 20; i++) { const z = (i / 20 * 2 - 1) * (zmax + 0.05); bp.push(new THREE.Vector3(sx * (xg + 0.66), hGab(xg + 0.6, z) - 0.16, z)); }
      wood.push(sweep(bp, 0.1, 0.38, new THREE.Vector3(0, 1, 0), 1.0));
      // pendant ornament at the apex
      const pend = box(0.1, 0.55, 0.42, 'y', 0.5); pend.translate(sx * (xg + 0.7), hGab(xg, 0) - 0.55, 0); wood.push(pend);
      // floor of the gable (hip band top line) board
      const fb = box(0.12, 0.12, 2 * zmax, 'z', 1.0); fb.translate(sx * (xg + 0.02), yLow, 0); wood.push(fb);
    }
  }
  return { tiles, wood, ridge, plaster, corners, hHip, f };
}
