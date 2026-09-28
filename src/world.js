// Valley model: river centerline, (s,d) river coordinates, terrain height, modifiers,
// obstacles, flow field and the autopilot path.
import { fbm2, ridge2, simplex2, clamp, lerp, smoothstep, RNG } from './noise.js';

export const S_MIN = -380;
export let S_MAX = 0;
export const LOOP_S = 790;     // head of the gorge: fade + restart
export const START_S = 0;
export const BRIDGE_S = 130;

// ---------------------------------------------------------------- centerline
const ctrl = [];
for (let z = 720; z >= -960; z -= 60) {
  let x = 34 * Math.sin(((720 - z) / 430) * Math.PI * 2 + 0.4);
  if (z > 470) x += Math.pow(z - 470, 2) * 0.0016;
  if (z < -690) x += Math.pow(-690 - z, 2) * 0.0016;
  ctrl.push([x, z]);
}
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
const dense = [];
for (let i = 0; i < ctrl.length - 1; i++) {
  const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
  for (let k = 0; k < 200; k++) {
    const t = k / 200;
    dense.push([catmull(p0[0], p1[0], p2[0], p3[0], t), catmull(p0[1], p1[1], p2[1], p3[1], t)]);
  }
}
dense.push(ctrl[ctrl.length - 1]);
const cum = [0];
for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
const L = cum[cum.length - 1];
const NS = Math.floor(L);
S_MAX = S_MIN + NS - 1;
export const CX = new Float32Array(NS), CZ = new Float32Array(NS), TX = new Float32Array(NS), TZ = new Float32Array(NS);
{
  let j = 0;
  for (let i = 0; i < NS; i++) {
    while (j < cum.length - 2 && cum[j + 1] < i) j++;
    const t = (i - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
    CX[i] = lerp(dense[j][0], dense[j + 1][0], t);
    CZ[i] = lerp(dense[j][1], dense[j + 1][1], t);
  }
  for (let i = 0; i < NS; i++) {
    const a = Math.max(0, i - 2), b = Math.min(NS - 1, i + 2);
    const dx = CX[b] - CX[a], dz = CZ[b] - CZ[a], l = Math.hypot(dx, dz);
    TX[i] = dx / l; TZ[i] = dz / l;
  }
}
// signed curvature (>0: turning towards +N = right bank), smoothed
const KS = new Float32Array(NS);
{
  const raw = new Float32Array(NS);
  for (let i = 1; i < NS - 1; i++) raw[i] = TX[i] * (TZ[i + 1] - TZ[i - 1]) * 0.5 - TZ[i] * (TX[i + 1] - TX[i - 1]) * 0.5;
  const W = 40;
  for (let i = 0; i < NS; i++) { let s = 0, n = 0; for (let k = -W; k <= W; k++) { const j = i + k; if (j >= 0 && j < NS) { s += raw[j]; n++; } } KS[i] = s / n; }
}
// far terrain follows a straight valley axis (prevents folding far from the river)
const SX = new Float32Array(NS), SZ = new Float32Array(NS), STX = new Float32Array(NS), STZ = new Float32Array(NS);
{
  const ax = CX[NS - 1] - CX[0], az = CZ[NS - 1] - CZ[0], al = Math.hypot(ax, az);
  const ux = ax / al, uz = az / al;
  let mx = 0, mz = 0; for (let i = 0; i < NS; i++) { mx += CX[i]; mz += CZ[i]; } mx /= NS; mz /= NS;
  // map arc-length index to a position along the axis, smoothly
  const proj = new Float32Array(NS); for (let i = 0; i < NS; i++) proj[i] = (CX[i] - mx) * ux + (CZ[i] - mz) * uz;
  const W = 120; const sp = new Float32Array(NS);
  for (let i = 0; i < NS; i++) { let t = 0, n = 0; for (let k = -W; k <= W; k += 3) { const j = clamp(i + k, 0, NS - 1); t += proj[j] + (i + k - j) * 0.9; n++; } sp[i] = t / n; }
  for (let i = 1; i < NS; i++) if (sp[i] < sp[i - 1] + 0.3) sp[i] = sp[i - 1] + 0.3;
  for (let i = 0; i < NS; i++) { SX[i] = mx + ux * sp[i]; SZ[i] = mz + uz * sp[i]; STX[i] = ux; STZ[i] = uz; }
}
function idx(s) { return clamp(s - S_MIN, 0, NS - 1.001); }
export function center(s, out = {}) {
  const f = idx(s), i = Math.floor(f), t = f - i;
  out.x = lerp(CX[i], CX[i + 1], t); out.z = lerp(CZ[i], CZ[i + 1], t);
  let tx = lerp(TX[i], TX[i + 1], t), tz = lerp(TZ[i], TZ[i + 1], t); const l = Math.hypot(tx, tz);
  out.tx = tx / l; out.tz = tz / l; out.nx = -out.tz; out.nz = out.tx;
  return out;
}
export function curvature(s) { const f = idx(s), i = Math.floor(f); return lerp(KS[i], KS[i + 1], f - i); }
export function sdToWorld(s, d, out = {}) {
  const f = idx(s), i = Math.floor(f), t = f - i;
  const cx = lerp(CX[i], CX[i + 1], t), cz = lerp(CZ[i], CZ[i + 1], t);
  const tx = lerp(TX[i], TX[i + 1], t), tz = lerp(TZ[i], TZ[i + 1], t);
  const w = smoothstep(28, 240, Math.abs(d));
  let px = cx, pz = cz, nx = -tz, nz = tx;
  if (w > 0) {
    const sx = lerp(SX[i], SX[i + 1], t), sz = lerp(SZ[i], SZ[i + 1], t);
    const stx = lerp(STX[i], STX[i + 1], t), stz = lerp(STZ[i], STZ[i + 1], t);
    px = lerp(cx, sx, w); pz = lerp(cz, sz, w); nx = lerp(nx, -stz, w); nz = lerp(nz, stx, w);
  }
  // extrapolate beyond the ends
  const ex = s - S_MIN - f;
  out.x = px + nx * d + tx * ex; out.z = pz + nz * d + tz * ex;
  return out;
}
const _c = {};
export function worldToSD(x, z, hint) {
  let best = 0, bd = 1e18;
  if (hint !== undefined && hint !== null) {
    const h = Math.round(idx(hint));
    for (let i = Math.max(0, h - 24); i <= Math.min(NS - 1, h + 24); i += 2) { const dx = x - CX[i], dz = z - CZ[i]; const dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; best = i; } }
  } else {
    for (let i = 0; i < NS; i += 6) { const dx = x - CX[i], dz = z - CZ[i]; const dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; best = i; } }
  }
  const a = Math.max(0, best - 6), b = Math.min(NS - 1, best + 6);
  for (let i = a; i <= b; i++) { const dx = x - CX[i], dz = z - CZ[i]; const dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; best = i; } }
  const dx = x - CX[best], dz = z - CZ[best];
  let s = S_MIN + best + dx * TX[best] + dz * TZ[best];
  let d = -dx * TZ[best] + dz * TX[best];
  if (Math.abs(d) > 24) {
    // Newton refine against the warped mapping
    for (let it = 0; it < 5; it++) {
      const p = sdToWorld(s, d, _c); const ex = p.x - x, ez = p.z - z;
      if (ex * ex + ez * ez < 1e-4) break;
      const p1 = sdToWorld(s + 0.5, d, {}), p2 = sdToWorld(s, d + 0.5, {});
      const a11 = (p1.x - p.x) * 2, a21 = (p1.z - p.z) * 2, a12 = (p2.x - p.x) * 2, a22 = (p2.z - p.z) * 2;
      const det = a11 * a22 - a12 * a21; if (Math.abs(det) < 1e-9) break;
      s -= (a22 * ex - a12 * ez) / det; d -= (-a21 * ex + a11 * ez) / det;
    }
  }
  return { s, d };
}

// ---------------------------------------------------------------- river shape
export function halfWidth(s) {
  let w = 15.5;
  w = lerp(w, 11, smoothstep(250, 480, s));
  w = lerp(w, 7.6, smoothstep(480, 700, s));
  w = lerp(w, 5.2, smoothstep(760, 980, s));
  const nb = smoothstep(18, 45, Math.abs(s - BRIDGE_S));
  w += 1.1 * simplex2(s * 0.012, 3.1) * nb;
  w = lerp(12.0, w, smoothstep(12, 30, Math.abs(s - BRIDGE_S)));
  return w;
}
export function channelDepth(s) { return lerp(2.4, 3.1, smoothstep(450, 700, s)); }
export function flowSpeed(s) { return lerp(0.75, 1.25, smoothstep(420, 720, s)); }
export function bankType(s, side) {
  let k = 0.5 + 0.38 * simplex2(s * 0.011, side * 7.7);
  k -= clamp(side * curvature(s) * 70, -0.6, 0.6);
  k = lerp(k, 1, smoothstep(520, 660, s));
  k = lerp(1, k, smoothstep(14, 34, Math.abs(s - BRIDGE_S)));
  if (side < 0) k = lerp(k, 0.95, bump(s, 120, 250, 20));
  return clamp(k, 0, 1);
}
function bump(x, a, b, f) { return smoothstep(a - f, a, x) * (1 - smoothstep(b, b + f, x)); }
function floorHalf(s, side) {
  let F = lerp(80, 52, smoothstep(200, 450, s));
  F = lerp(F, 18, smoothstep(470, 680, s));
  F = lerp(F, 13, smoothstep(700, 850, s));
  if (side < 0) F = lerp(F, 44, bump(s, 70, 250, 50));
  if (side > 0) F = lerp(F, 56, bump(s, 300, 360, 40) * (1 - smoothstep(420, 480, s)));
  return F;
}
function wallH(s) { return lerp(105, 135, smoothstep(380, 700, s)); }
function wallW(s) { return lerp(120, 66, smoothstep(440, 680, s)); }

export function baseHeight(s, d, x, z) {
  const a = Math.abs(d), side = d >= 0 ? 1 : -1;
  const w = halfWidth(s);
  const k = bankType(s, side);
  let h;
  if (a < w) {
    const u = a / w, m = lerp(0.3, 0.11, k), D = channelDepth(s);
    let bd = u > 1 - m ? 0.55 * (1 - u) / m : 0.55 + (D - 0.55) * smoothstep(1 - m, Math.max(0.05, 1 - m - 0.42), u);
    bd += 0.22 * simplex2(x * 0.09, z * 0.09) * smoothstep(1.0, 0.75, u) + 0.12 * simplex2(x * 0.4, z * 0.4) * smoothstep(1, 0.9, u);
    h = -bd;
  } else {
    const e = a - w;
    const gravel = e * 0.085 + 0.6 * smoothstep(9, 22, e);
    const steep = 2.0 * smoothstep(0, 2.6, e) + e * 0.05;
    h = lerp(gravel, steep, k);
    const F = floorHalf(s, side);
    h += 3.2 * smoothstep(w + 6, F, a);
    const t = Math.max(0, a - F);
    const H = wallH(s), Ws = wallW(s);
    let wall = H * (1 - Math.exp(-t / (Ws * 0.62)));
    wall += 0.55 * H * smoothstep(Ws, Ws * 4.5, t) * (0.6 + 0.5 * fbm2(x * 0.0021, z * 0.0021, 3));
    const n = fbm2(x * 0.0065, z * 0.0065, 5);
    wall += n * (4 + 0.28 * wall) * smoothstep(0, 25, t + e * 0.3);
    wall += (ridge2(x * 0.0042, z * 0.0042, 4) - 0.5) * 0.3 * wall;
    const rug = smoothstep(400, 640, s) * smoothstep(2, 30, t);
    if (rug > 0) wall += rug * ((ridge2(x * 0.017, z * 0.017, 4) - 0.45) * 22 + fbm2(x * 0.05, z * 0.05, 3) * 5);
    h += wall;
    h += 0.35 * fbm2(x * 0.06, z * 0.06, 3) * smoothstep(0.5, 5, e);
  }
  // valley end caps (close the valley beyond the travelled range)
  const capA = smoothstep(S_MIN + 150, S_MIN + 5, s), capB = smoothstep(S_MAX - 170, S_MAX - 5, s);
  const cap = Math.max(capA, capB);
  if (cap > 0) h = Math.max(h, lerp(h, 170 + 60 * fbm2(x * 0.01, z * 0.01, 3), cap * cap));
  return h;
}

// ---------------------------------------------------------------- modifiers
export const mods = [];
export let lastPath = 0;
export function heightFull(s, d, x, z) {
  let h = baseHeight(s, d, x, z);
  let path = 0;
  for (let i = 0; i < mods.length; i++) {
    const m = mods[i];
    const dx0 = x - m.cx, dz0 = z - m.cz;
    if (dx0 * dx0 + dz0 * dz0 > m.br2) continue;
    if (m.type === 'disc') {
      const r = Math.hypot(dx0, dz0);
      const fall = h > m.h ? m.fallUp : m.fall;
      const w = m.linear ? clamp(1 - (r - m.r) / fall, 0, 1) : 1 - smoothstep(m.r, m.r + fall, r);
      if (w > 0) { h = lerp(h, m.h, w); if (m.path) path = Math.max(path, w * m.path); }
    } else if (m.type === 'bump') {
      const r2 = (dx0 * dx0 + dz0 * dz0) / (m.r * m.r);
      h += m.amp * Math.exp(-r2 * 2.2);
    } else if (m.type === 'ramp') {
      const px = x - m.ax, pz = z - m.az;
      let t = (px * m.dx + pz * m.dz) / m.len2; t = clamp(t, 0, 1);
      const qx = m.ax + m.dx * t - x, qz = m.az + m.dz * t - z;
      const dist = Math.hypot(qx, qz);
      const w = 1 - smoothstep(m.hw, m.hw + m.fall, dist);
      if (w > 0) { const th = lerp(m.ha, m.hb, t); h = lerp(h, th, w); if (m.path) path = Math.max(path, (1 - smoothstep(m.hw * 0.7, m.hw + 0.6, dist)) * m.path); }
    }
  }
  lastPath = path;
  return h;
}
export function addDisc(x, z, r, fall, h, opt = {}) {
  const m = { type: 'disc', cx: x, cz: z, r, fall, fallUp: opt.fallUp ?? fall, h, linear: !!opt.linear, path: opt.path || 0 };
  m.br2 = Math.pow(r + Math.max(fall, m.fallUp) + 1, 2); mods.push(m); return m;
}
export function addBump(x, z, r, amp) { mods.push({ type: 'bump', cx: x, cz: z, r, amp, br2: (r * 2.5) ** 2 }); }
export function addRamp(ax, az, ha, bx, bz, hb, hw, fall, path = 0) {
  const dx = bx - ax, dz = bz - az;
  const m = { type: 'ramp', ax, az, ha, bx, bz, hb, dx, dz, len2: dx * dx + dz * dz, hw, fall, path, cx: (ax + bx) / 2, cz: (az + bz) / 2 };
  m.br2 = Math.pow(Math.sqrt(m.len2) / 2 + hw + fall + 1, 2); mods.push(m); return m;
}
export function heightAt(x, z, hint) { const { s, d } = worldToSD(x, z, hint); return heightFull(s, d, x, z); }
export function naturalAt(x, z) { const { s, d } = worldToSD(x, z); return baseHeight(s, d, x, z); }

// ---------------------------------------------------------------- layout
export const LAYOUT = {};
export const footprints = [];   // {x,z,r} exclusion circles for vegetation
export const segFoot = [];      // {ax,az,bx,bz,hw}
export function isFree(x, z, pad = 0) {
  for (const f of footprints) { const dx = x - f.x, dz = z - f.z; if (dx * dx + dz * dz < (f.r + pad) ** 2) return false; }
  for (const g of segFoot) {
    const dx = g.bx - g.ax, dz = g.bz - g.az; let t = ((x - g.ax) * dx + (z - g.az) * dz) / (dx * dx + dz * dz); t = clamp(t, 0, 1);
    if (Math.hypot(g.ax + dx * t - x, g.az + dz * t - z) < g.hw + pad) return false;
  }
  return true;
}
function P(s, d) { const p = sdToWorld(s, d, {}); return p; }

export function buildLayout() {
  const B = BRIDGE_S;
  const c = center(B, {});
  LAYOUT.bridge = { s: B, cx: c.x, cz: c.z, ax: c.nx, az: c.nz, tx: c.tx, tz: c.tz, half: 15.5, base: 2.0, rise: 5.2, width: 3.2, piers: [-6.2, 6.2] };
  // abutment pads
  for (const sd of [-1, 1]) { const p = P(B, sd * 18.5); addDisc(p.x, p.z, 4.2, 3.5, 2.05); }
  // torii at the near-bank end of the bridge
  const tor = P(B, -22.5); addDisc(tor.x, tor.z, 3.6, 3, 2.25, { path: 1 });
  LAYOUT.torii = { x: tor.x, z: tor.z, rot: Math.atan2(c.nx, c.nz), y: 2.25 };
  // path from torii along bank to the stairs
  const p0 = P(B + 1, -22.5), p1 = P(B + 12, -23.5), p2 = P(152, -24.5);
  addRamp(p0.x, p0.z, 2.25, p1.x, p1.z, 2.5, 1.5, 2.0, 1);
  addRamp(p1.x, p1.z, 2.5, p2.x, p2.z, 2.9, 1.5, 2.0, 1);
  // temple terrace cut into the left valley side
  const tc = P(156, -55); const TH = 8.8, TR = 20;
  LAYOUT.terrace = { x: tc.x, z: tc.z, r: TR, h: TH, fall: 3.2 };
  addDisc(tc.x, tc.z, TR, 3.2, TH, { linear: true, fallUp: 18, path: 0 });
  // stairs from the path to the terrace edge
  const sb = P(153, -25.5), st = P(154.5, -36.3);
  LAYOUT.stairs = { ax: sb.x, az: sb.z, ha: 2.95, bx: st.x, bz: st.z, hb: TH, hw: 1.7 };
  addRamp(sb.x, sb.z, 2.95, st.x, st.z, TH, 1.7, 1.6, 0.6);
  // terrace walkway to the hall
  const hallP = P(158, -60);
  const toward = { x: tc.x - hallP.x, z: tc.z - hallP.z };
  const hallRot = Math.atan2(c.nx, c.nz) + Math.PI; // front faces the river (+d)
  LAYOUT.hall = { x: hallP.x, z: hallP.z, y: TH, rot: Math.atan2(-(st.x - hallP.x), -(st.z - hallP.z)) + Math.PI };
  // align hall front towards stairs top
  { const dx = st.x - hallP.x, dz = st.z - hallP.z; LAYOUT.hall.rot = Math.atan2(dx, dz); }
  const wk0 = P(154.5, -37), wk1 = P(157.5, -51);
  addRamp(wk0.x, wk0.z, TH, wk1.x, wk1.z, TH, 1.3, 0.1, 1);
  // pagoda knoll
  const pk = P(212, -47);
  const knH = naturalAt(pk.x, pk.z) + 2.6;
  addBump(pk.x, pk.z, 13, 1.5);
  addDisc(pk.x, pk.z, 6.5, 6, knH);
  LAYOUT.pagoda = { x: pk.x, z: pk.z, y: knH, rot: LAYOUT.hall.rot };
  // path terrace -> pagoda
  const tp0 = P(172, -52), tp1 = P(205, -48.5);
  addRamp(tp0.x, tp0.z, TH, tp1.x, tp1.z, knH, 1.1, 1.5, 1);
  // wayside shrine clearing on the far bank
  const ws = P(332, 33);
  const wsH = naturalAt(ws.x, ws.z);
  addDisc(ws.x, ws.z, 7.5, 5, wsH, { path: 0.35 });
  LAYOUT.wayside = { x: ws.x, z: ws.z, y: wsH, rot: Math.atan2(-center(332, {}).nx, -center(332, {}).nz) };
  const wsp0 = P(329, 12.5), wsp1 = P(331, 27);
  addRamp(wsp0.x, wsp0.z, naturalAt(wsp0.x, wsp0.z) + 0.05, wsp1.x, wsp1.z, wsH, 0.9, 1.2, 1);
  // torii tunnel up the right bank to a hillside shrine
  const ta = P(548, 12.8), tb = P(582, 36);
  const ha = naturalAt(ta.x, ta.z) + 0.15;
  const shr = P(586, 40.5);
  const hb = Math.min(naturalAt(tb.x, tb.z), ha + 22);
  addRamp(ta.x, ta.z, ha, tb.x, tb.z, hb, 1.5, 2.2, 0.8);
  addDisc(shr.x, shr.z, 6, 4, hb, { fallUp: 7 });
  LAYOUT.tunnel = { ax: ta.x, az: ta.z, ha, bx: tb.x, bz: tb.z, hb };
  LAYOUT.hillShrine = { x: shr.x, z: shr.z, y: hb, rot: Math.atan2(ta.x - tb.x, ta.z - tb.z) };

  LAYOUT.paths = { approach: [p0, p1, p2], walk: [wk0, wk1], pagoda: [tp0, tp1], way: [wsp0, wsp1] };
  // vegetation exclusion
  footprints.push({ x: tc.x, z: tc.z, r: TR + 1.5 });
  footprints.push({ x: pk.x, z: pk.z, r: 8.5 });
  footprints.push({ x: ws.x, z: ws.z, r: 6.2 });
  footprints.push({ x: shr.x, z: shr.z, r: 6 });
  footprints.push({ x: tor.x, z: tor.z, r: 3.5 });
  for (const sd of [-1, 1]) { const p = P(B, sd * 17.5); footprints.push({ x: p.x, z: p.z, r: 4.5 }); }
  segFoot.push({ ax: p0.x, az: p0.z, bx: p1.x, bz: p1.z, hw: 2.0 }, { ax: p1.x, az: p1.z, bx: p2.x, bz: p2.z, hw: 2.0 });
  segFoot.push({ ax: sb.x, az: sb.z, bx: st.x, bz: st.z, hw: 2.4 });
  segFoot.push({ ax: tp0.x, az: tp0.z, bx: tp1.x, bz: tp1.z, hw: 1.6 });
  segFoot.push({ ax: ta.x, az: ta.z, bx: tb.x, bz: tb.z, hw: 2.4 });
  segFoot.push({ ax: wsp0.x, az: wsp0.z, bx: wsp1.x, bz: wsp1.z, hw: 1.2 });
  const bA = P(B, -16), bB = P(B, 16);
  segFoot.push({ ax: bA.x, az: bA.z, bx: bB.x, bz: bB.z, hw: 2.5 });
}

// Bridge deck height (for petals/people): returns -Infinity if outside
export function bridgeDeckAt(x, z) {
  const b = LAYOUT.bridge; if (!b) return -Infinity;
  const dx = x - b.cx, dz = z - b.cz;
  const along = dx * b.ax + dz * b.az, across = dx * b.tx + dz * b.tz;
  if (Math.abs(along) > b.half || Math.abs(across) > b.width / 2 - 0.1) return -Infinity;
  return b.base + b.rise * (1 - (along / b.half) ** 2) + 0.12;
}

export function overheadLimit(x, z) {
  const b = LAYOUT.bridge; if (!b) return 99;
  const dx = x - b.cx, dz = z - b.cz;
  const along = dx * b.ax + dz * b.az, across = dx * b.tx + dz * b.tz;
  if (Math.abs(along) > b.half || Math.abs(across) > b.width / 2 + 1.2) return 99;
  return b.base + b.rise * (1 - (along / b.half) ** 2) - 0.75;
}
// ---------------------------------------------------------------- autopilot path
export function pathOffset(s) {
  const w = halfWidth(s);
  let d = 0.3 * w * Math.sin(s * 0.0105 + 1.3) + 0.12 * w * Math.sin(s * 0.031);
  d = lerp(-0.9, d, smoothstep(20, 55, Math.abs(s - BRIDGE_S)));
  d = clamp(d, -(w - 4.2), w - 4.6);
  return d;
}

// ---------------------------------------------------------------- obstacles
export const rocks = [];      // river boulders {x,z,s,d,r,y,h, scale}
export const piers = [];      // pier posts {x,z,r}
export const obstacles = [];  // circles {x,z,r,s,d}
export function buildObstacles() {
  const rng = new RNG(77);
  const b = LAYOUT.bridge;
  for (const pd of b.piers) {
    for (const off of [-1.25, 0, 1.25]) {
      const s = b.s + off; const p = P(s, pd);
      piers.push({ x: p.x, z: p.z, r: 0.2, s, d: pd });
      obstacles.push({ x: p.x, z: p.z, r: 0.34, s, d: pd, pier: true });
    }
  }
  // boulders
  for (let s = -300; s < 1000; s += rng.range(9, 24)) {
    if (Math.abs(s - b.s) < 16) continue;
    const w = halfWidth(s), dp = pathOffset(s);
    const n = s > 520 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const r = rng.range(0.6, s > 520 ? 2.2 : 1.6);
      let d;
      if (rng.next() < 0.55) d = rng.sign() * (w - rng.range(0.2, 2.5));
      else d = rng.range(-w + 1, w - 1);
      const clearR = d > dp ? 5.4 : 3.9;
      if (Math.abs(d - dp) < clearR + r) continue;
      if (s > -10 && s < 20 && Math.abs(d) < w - 2) continue;
      const p = P(s, d);
      let clash = false; for (const o of obstacles) if (Math.hypot(o.x - p.x, o.z - p.z) < o.r + r + 0.6) clash = true;
      if (clash) continue;
      const rock = { x: p.x, z: p.z, s, d, r, h: r * rng.range(0.45, 0.9), seed: rng.int(1, 99999) };
      rocks.push(rock); obstacles.push({ x: p.x, z: p.z, r: r * 0.95, s, d });
    }
  }
}

// ---------------------------------------------------------------- flow map (s,d space)
export const FLOW = { ds: 0.5, dd: 0.25, dRange: 22, W: 0, H: 0, data: null, fs: null, fd: null, foam: null };
export function buildFlow() {
  const W = Math.round((FLOW.dRange * 2) / FLOW.dd) + 1;
  const H = Math.round((S_MAX - S_MIN) / FLOW.ds) + 1;
  FLOW.W = W; FLOW.H = H;
  const fs = new Float32Array(W * H), fd = new Float32Array(W * H), src = new Float32Array(W * H), turb = new Float32Array(W * H);
  const obs = obstacles.slice().sort((a, b) => a.s - b.s);
  let o0 = 0;
  for (let j = 0; j < H; j++) {
    const s = S_MIN + j * FLOW.ds;
    const w = halfWidth(s), U0 = flowSpeed(s);
    while (o0 < obs.length && obs[o0].s < s - 14) o0++;
    const near = [];
    for (let k = o0; k < obs.length && obs[k].s < s + 14; k++) near.push(obs[k]);
    for (let i = 0; i < W; i++) {
      const d = -FLOW.dRange + i * FLOW.dd;
      const u = Math.abs(d) / w;
      let U = u < 1 ? U0 * Math.pow(Math.max(0, 1 - u * u), 0.55) + 0.04 : 0;
      let vs = -U, vd = 0, so = 0, tb = 0;
      for (const o of near) {
        const a = o.r; const x = -(s - o.s), y = d - o.d; // local frame with stream along +x
        const r2 = x * x + y * y, r = Math.sqrt(r2);
        if (r < a) { vs = 0; vd = 0; so = 0; tb = 1; break; }
        if (r > a * 9) continue;
        const a2 = a * a, r4 = r2 * r2;
        const uu = U * (1 - a2 * (x * x - y * y) / r4), vv = -2 * U * a2 * x * y / r4;
        vs += -(uu - U); vd += vv;
        const ring = Math.exp(-(r - a) / (o.pier ? 0.22 : 0.4));
        so = Math.max(so, ring * (0.55 + 0.45 * clamp(-x / r, 0, 1)) * (o.pier ? 1.0 : 0.9));
        if (x > 0) tb = Math.max(tb, Math.exp(-Math.abs(y) / (a * 1.2)) * Math.exp(-x / (a * 8)));
      }
      // shallow riffles
      if (u < 1) { const depth = -baseHeight(s, d, 0, 0); tb = Math.max(tb, smoothstep(0.5, 0.1, depth) * 0.6); }
      const k = j * W + i; fs[k] = vs; fd[k] = vd; src[k] = so; turb[k] = tb;
    }
  }
  // advect foam downstream
  let F = new Float32Array(W * H), F2 = new Float32Array(W * H);
  const dt = 0.6;
  const sample = (A, fi, fj) => {
    fi = clamp(fi, 0, W - 1.001); fj = clamp(fj, 0, H - 1.001);
    const i = Math.floor(fi), j = Math.floor(fj), ti = fi - i, tj = fj - j;
    const a = A[j * W + i], b = A[j * W + i + 1], c = A[(j + 1) * W + i], e = A[(j + 1) * W + i + 1];
    return lerp(lerp(a, b, ti), lerp(c, e, ti), tj);
  };
  for (let it = 0; it < 50; it++) {
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i;
      const bi = i - fd[k] * dt / FLOW.dd, bj = j - fs[k] * dt / FLOW.ds;
      F2[k] = Math.min(1, sample(F, bi, bj) * 0.945 + src[k] * 0.35);
    }
    const t = F; F = F2; F2 = t;
  }
  const data = new Uint8Array(W * H * 4);
  for (let k = 0; k < W * H; k++) {
    data[k * 4] = clamp(Math.round((fs[k] / 4 + 0.5) * 255), 0, 255);
    data[k * 4 + 1] = clamp(Math.round((fd[k] / 4 + 0.5) * 255), 0, 255);
    data[k * 4 + 2] = clamp(Math.round(Math.min(1, F[k] * 1.3) * 255), 0, 255);
    data[k * 4 + 3] = clamp(Math.round(turb[k] * 255), 0, 255);
  }
  FLOW.data = data; FLOW.fs = fs; FLOW.fd = fd; FLOW.foam = F;
}
// world-space current at (s,d)
export function flowSD(s, d) {
  const fi = clamp((d + FLOW.dRange) / FLOW.dd, 0, FLOW.W - 1.001), fj = clamp((s - S_MIN) / FLOW.ds, 0, FLOW.H - 1.001);
  const i = Math.floor(fi), j = Math.floor(fj), ti = fi - i, tj = fj - j, W = FLOW.W;
  const g = (A) => lerp(lerp(A[j * W + i], A[j * W + i + 1], ti), lerp(A[(j + 1) * W + i], A[(j + 1) * W + i + 1], ti), tj);
  return { vs: g(FLOW.fs), vd: g(FLOW.fd) };
}
const _cc = {};
export function flowWorld(s, d) {
  const f = flowSD(s, d); const c = center(s, _cc);
  return { x: f.vs * c.tx + f.vd * c.nx, z: f.vs * c.tz + f.vd * c.nz };
}

// ---------------------------------------------------------------- fast ground grid (world space, near river)
export const GRID = { x0: 0, z0: 0, cell: 1.5, nx: 0, nz: 0, h: null };
// built from terrain vertex samples (x,z,h) near the river
export function buildGroundGrid(xs, zs, hs, n) {
  let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
  for (let k = 0; k < n; k++) { minx = Math.min(minx, xs[k]); maxx = Math.max(maxx, xs[k]); minz = Math.min(minz, zs[k]); maxz = Math.max(maxz, zs[k]); }
  const c = GRID.cell; GRID.x0 = minx; GRID.z0 = minz;
  GRID.nx = Math.ceil((maxx - minx) / c) + 2; GRID.nz = Math.ceil((maxz - minz) / c) + 2;
  const N = GRID.nx * GRID.nz;
  const acc = new Float32Array(N), wsum = new Float32Array(N);
  for (let k = 0; k < n; k++) {
    const fi = (xs[k] - minx) / c, fj = (zs[k] - minz) / c;
    const i = Math.round(fi), j = Math.round(fj);
    const w = 1 / (0.05 + (fi - i) ** 2 + (fj - j) ** 2);
    const q = j * GRID.nx + i; acc[q] += hs[k] * w; wsum[q] += w;
  }
  const H = new Float32Array(N).fill(NaN);
  for (let q = 0; q < N; q++) if (wsum[q] > 0) H[q] = acc[q] / wsum[q];
  // fill holes by dilation
  for (let pass = 0; pass < 12; pass++) {
    let holes = 0; const Hn = H.slice();
    for (let j = 0; j < GRID.nz; j++) for (let i = 0; i < GRID.nx; i++) {
      const q = j * GRID.nx + i; if (!isNaN(H[q])) continue;
      let s = 0, m = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= GRID.nx || jj >= GRID.nz) continue; const v = H[jj * GRID.nx + ii]; if (!isNaN(v)) { s += v; m++; } }
      if (m) Hn[q] = s / m; else holes++;
    }
    H.set(Hn); if (!holes) break;
  }
  for (let q = 0; q < N; q++) if (isNaN(H[q])) H[q] = 80;
  GRID.h = H;
}
export function groundFast(x, z) {
  const fi = (x - GRID.x0) / GRID.cell, fj = (z - GRID.z0) / GRID.cell;
  if (fi < 0 || fj < 0 || fi >= GRID.nx - 1 || fj >= GRID.nz - 1) return 80;
  const i = Math.floor(fi), j = Math.floor(fj), ti = fi - i, tj = fj - j, n = GRID.nx, H = GRID.h;
  return lerp(lerp(H[j * n + i], H[j * n + i + 1], ti), lerp(H[(j + 1) * n + i], H[(j + 1) * n + i + 1], ti), tj);
}
export function surfaceFast(x, z) { return Math.max(groundFast(x, z), bridgeDeckAt(x, z)); }
