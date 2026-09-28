// Valley terrain mesh built in river (s,d) coordinates, splat-textured shader.
import * as THREE from 'three';
import { S_MIN, S_MAX, sdToWorld, heightFull, lastPath, halfWidth, bankType, buildGroundGrid } from './world.js';
import { smoothstep, clamp } from './noise.js';
import { TEX } from './textures.js';
import { patch } from './materials.js';

export const TER = { ds: 1.25, dList: null, rows: 0, cols: 0, X: null, Z: null, H: null, AO: null, PATH: null, FOREST: null, GRAVEL: null, meshes: [] };

export function buildTerrainData() {
  const dl = [0];
  let d = 0;
  while (d < 660) { const step = d < 34 ? 0.62 : Math.min(22, 0.62 + (d - 34) * 0.065); d += step; dl.push(d); }
  const dList = [...dl.slice(1).map((v) => -v).reverse(), ...dl];
  TER.dList = dList;
  const rows = Math.floor((S_MAX - S_MIN) / TER.ds) + 1, cols = dList.length;
  TER.rows = rows; TER.cols = cols;
  const N = rows * cols;
  const X = new Float32Array(N), Z = new Float32Array(N), H = new Float32Array(N), PATH = new Float32Array(N), GRAVEL = new Float32Array(N);
  const p = {};
  const gx = [], gz = [], gh = [];
  for (let r = 0; r < rows; r++) {
    const s = S_MIN + r * TER.ds;
    const w = halfWidth(s);
    const kl = bankType(s, -1), kr = bankType(s, 1);
    for (let c = 0; c < cols; c++) {
      const dd = dList[c];
      sdToWorld(s, dd, p);
      const k = r * cols + c;
      X[k] = p.x; Z[k] = p.z;
      H[k] = heightFull(s, dd, p.x, p.z);
      PATH[k] = lastPath;
      const kk = dd < 0 ? kl : kr;
      GRAVEL[k] = (1 - kk) * (1 - smoothstep(w + 8, w + 22, Math.abs(dd)));
      if (Math.abs(dd) < 100) { gx.push(p.x); gz.push(p.z); gh.push(H[k]); }
    }
  }
  Object.assign(TER, { X, Z, H, PATH, GRAVEL, AO: new Float32Array(N).fill(1), FOREST: new Float32Array(N) });
  buildGroundGrid(gx, gz, gh, gx.length);
  // curvature AO
  const AO = TER.AO;
  for (let r = 2; r < rows - 2; r++) for (let c = 2; c < cols - 2; c++) {
    const k = r * cols + c;
    let occ = 0;
    for (const [dr, dc] of [[2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const q = (r + dr) * cols + (c + dc);
      const dist = Math.hypot(X[q] - X[k], Z[q] - Z[k]) + 0.3;
      occ += Math.max(0, (H[q] - H[k]) / dist);
    }
    AO[k] = clamp(1 - occ * 0.11, 0.45, 1);
  }
}
function colOf(d) { // nearest column index for d
  const L = TER.dList; let lo = 0, hi = L.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] < d) lo = m; else hi = m; }
  return (d - L[lo] < L[hi] - d) ? lo : hi;
}
export function stamp(s, d, radius, aoAmt, forestAmt = 0) {
  const r0 = Math.max(0, Math.floor((s - radius - S_MIN) / TER.ds)), r1 = Math.min(TER.rows - 1, Math.ceil((s + radius - S_MIN) / TER.ds));
  const c0 = colOf(d - radius), c1 = colOf(d + radius);
  const cols = TER.cols;
  for (let r = r0; r <= r1; r++) {
    const ss = S_MIN + r * TER.ds;
    for (let c = c0; c <= c1; c++) {
      const dist = Math.hypot(ss - s, TER.dList[c] - d) / radius;
      if (dist >= 1) continue;
      const k = r * cols + c, f = 1 - dist * dist;
      if (aoAmt) TER.AO[k] = Math.min(TER.AO[k], 1 - aoAmt * f);
      if (forestAmt) TER.FOREST[k] = Math.max(TER.FOREST[k], forestAmt * f);
    }
  }
}

const TERRAIN_HEAD = /* glsl */`
uniform sampler2D tGA, tGN, tDA, tDN, tRA, tRN, tPA, tPN, tMA, tMN, tNoiseT;
varying vec4 vMask;
vec3 tNorm; float tRough; float tUnder;
vec4 tex2(sampler2D t, vec2 uv, float b){ return mix(texture2D(t, uv), texture2D(t, uv*0.31+vec2(0.37,0.71)), b); }
float caustic(vec2 p){
  float a = texture2D(tNoiseT, p*0.11 + vec2(uTime*0.021, uTime*0.013)).b;
  float b = texture2D(tNoiseT, p*0.13 - vec2(uTime*0.017, -uTime*0.019)).b;
  return pow(a*b, 3.0)*9.0;
}
`;
const TERRAIN_MAP = /* glsl */`
{
  vec3 N0 = normalize(vWN); vec3 wp = vWP;
  float slope = 1.0 - N0.y;
  vec4 nz = texture2D(tNoiseT, wp.xz*0.0037);
  vec4 nz2 = texture2D(tNoiseT, wp.xz*0.019);
  float y = wp.y;
  float anti = nz.b;
  vec2 uvG = wp.xz*0.26, uvD = wp.xz*0.33, uvP = wp.xz*0.3, uvM = wp.xz*0.3;
  vec4 aG = tex2(tGA, uvG, anti), nG = tex2(tGN, uvG, anti);
  vec4 aD = tex2(tDA, uvD, anti), nD = tex2(tDN, uvD, anti);
  vec4 aP = texture2D(tPA, uvP), nP = texture2D(tPN, uvP);
  vec4 aM = texture2D(tMA, uvM), nM = texture2D(tMN, uvM);
  // triplanar rock
  vec3 bw = pow(abs(N0), vec3(4.)); bw /= (bw.x+bw.y+bw.z);
  float rs = 0.075;
  vec4 aRx = texture2D(tRA, wp.zy*rs), aRy = texture2D(tRA, wp.xz*rs), aRz = texture2D(tRA, wp.xy*rs);
  vec4 nRx = texture2D(tRN, wp.zy*rs), nRy = texture2D(tRN, wp.xz*rs), nRz = texture2D(tRN, wp.xy*rs);
  vec4 aR = aRx*bw.x + aRy*bw.y + aRz*bw.z;
  vec3 rockN = vec3(0., (nRx.y-0.5)*2., (nRx.x-0.5)*2.)*bw.x + vec3((nRy.x-0.5)*2., 0., (nRy.y-0.5)*2.)*bw.y + vec3((nRz.x-0.5)*2., (nRz.y-0.5)*2., 0.)*bw.z;
  float aoR = nRx.w*bw.x + nRy.w*bw.y + nRz.w*bw.z;
  // weights (height-aware via AO channels)
  float gravel = vMask.a;
  float under = smoothstep(0.02, -0.12, y);
  float wRock = smoothstep(0.5, 0.68, slope + (nz.r-0.5)*0.3 + (nz2.g-0.5)*0.12);
  float wPeb = max(under, smoothstep(0.35 + gravel*1.4, 0.05 + gravel*0.8, y) * (0.3 + 0.7*gravel));
  wPeb = clamp(wPeb + smoothstep(0.35,0.0,y)*0.8, 0.0, 1.0) * (1.0 - wRock*0.6);
  float forest = vMask.b;
  float wDirt = clamp(smoothstep(0.3, 0.5, slope)*0.35*nz2.r + vMask.g + forest*0.3*smoothstep(0.45,0.7,nz2.r), 0.0, 1.0);
  float wMoss = clamp(forest*smoothstep(0.3, 0.6, nz2.g) + smoothstep(0.18, 0.4, slope)*0.8 + smoothstep(0.5,0.7,nz.g)*0.35, 0.0, 1.0)*(1.0-wRock);
  vec3 alb = aG.rgb; float rough = aG.a; vec3 tn = vec3((nG.x-0.5)*2., 0., (nG.y-0.5)*2.)*0.6; float ao = nG.w;
  float bM = smoothstep(0.4, 0.6, wMoss + (nM.w-0.5)*0.5);
  vec3 floorCol = mix(aM.rgb*vec3(0.62,0.72,0.55), aG.rgb*0.6, 0.35);
  alb = mix(alb, floorCol, bM); rough = mix(rough, aM.a, bM); tn = mix(tn, vec3((nM.x-0.5)*2., 0., (nM.y-0.5)*2.)*0.6, bM); ao = mix(ao, nM.w, bM);
  float bD = smoothstep(0.4, 0.6, wDirt + (nD.w - nG.w)*0.6);
  vec3 litter = mix(aD.rgb, mix(aD.rgb*vec3(0.78,0.7,0.58), aM.rgb*0.75, 0.45), forest*0.85);
  alb = mix(alb, litter, bD); rough = mix(rough, aD.a, bD); tn = mix(tn, vec3((nD.x-0.5)*2., 0., (nD.y-0.5)*2.), bD); ao = mix(ao, nD.w, bD);
  float bP = smoothstep(0.35, 0.65, wPeb + (nP.w-0.6)*0.9);
  alb = mix(alb, aP.rgb, bP); rough = mix(rough, aP.a, bP); tn = mix(tn, vec3((nP.x-0.5)*2., 0., (nP.y-0.5)*2.)*1.2, bP); ao = mix(ao, nP.w, bP);
  float bR = smoothstep(0.35, 0.65, wRock + (aoR-0.7)*0.8);
  vec3 cliff = aR.rgb;
  { float st = texture2D(tNoiseT, vec2((wp.x+wp.z)*0.004, wp.y*0.0015)).g; float st2 = texture2D(tNoiseT, vec2((wp.x-wp.z)*0.013, wp.y*0.004)).a;
    cliff *= 0.7 + 0.55*st;
    cliff = mix(cliff, cliff*vec3(0.55,0.5,0.45), smoothstep(0.55,0.8,st2)*0.7);
    cliff = mix(cliff, vec3(0.1,0.15,0.06), smoothstep(0.5,0.75,texture2D(tNoiseT, wp.xz*0.012 + wp.y*0.006).r)*0.55*smoothstep(0.3,0.8,N0.y+0.4)); }
  alb = mix(alb, cliff, bR); rough = mix(rough, aR.a, bR); tn = mix(tn, rockN*1.2, bR); ao = mix(ao, aoR, bR);
  // distant slopes read as forest canopy
  { float fd = smoothstep(140.0, 520.0, distance(wp, cameraPosition)) * smoothstep(3.0, 14.0, y) * (1.0 - bR*0.6);
    vec3 canopy = mix(vec3(0.05,0.1,0.04), vec3(0.15,0.21,0.07), nz2.r);
    canopy = mix(canopy, vec3(0.2,0.12,0.06), smoothstep(0.7,0.9,nz.a)*0.5);
    canopy = mix(canopy, vec3(0.62,0.42,0.47), smoothstep(0.86,0.95,texture2D(tNoiseT, wp.xz*0.047).b)*0.7);
    alb = mix(alb, canopy, fd); ao = mix(ao, 0.8, fd); }
  // macro colour variation
  alb *= 0.82 + 0.36*nz.g;
  alb = mix(alb, alb*vec3(1.08,0.98,0.85), smoothstep(0.55,0.8,nz.a)*0.4);
  // damp band at the waterline, sediment line
  float damp = smoothstep(0.45, 0.02, y) * (1.0-under);
  alb *= mix(1.0, 0.62, damp); rough = mix(rough, 0.25, damp*0.8);
  alb *= mix(1.0, 0.8, under);
  alb *= mix(0.55, 1.0, vMask.r) * mix(0.6, 1.0, ao);
  diffuseColor.rgb *= alb;
  tRough = rough; tUnder = under;
  tNorm = normalize(N0 + tn);
}`;

export function buildTerrainMeshes(scene) {
  const T = TEX;
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  patch(mat, {
    key: 'terrain',
    uniforms: {
      tGA: { value: T.grass.map }, tGN: { value: T.grass.nrm }, tDA: { value: T.dirt.map }, tDN: { value: T.dirt.nrm },
      tRA: { value: T.rock.map }, tRN: { value: T.rock.nrm }, tPA: { value: T.pebble.map }, tPN: { value: T.pebble.nrm },
      tMA: { value: T.moss.map }, tMN: { value: T.moss.nrm }, tNoiseT: { value: T.noise },
    },
    vertHead: 'attribute vec4 aMask; varying vec4 vMask;',
    vertEnd: 'vMask = aMask;',
    fragHead: TERRAIN_HEAD,
    mapFrag: TERRAIN_MAP,
    roughFrag: 'float roughnessFactor = tRough;',
    normalFrag: 'normal = normalize((viewMatrix*vec4(tNorm,0.0)).xyz);',
    afterLights: `if (vWP.y < 0.05) { float cz = caustic(vWP.xz) * smoothstep(0.05,-0.25,vWP.y) * exp(vWP.y*0.35); reflectedLight.directDiffuse += diffuseColor.rgb * directLight.color * cz * 0.55; }`,
  });
  const { rows, cols, X, Z, H } = TER;
  const CH = 24;
  const rowsPer = Math.ceil(rows / CH);
  for (let ch = 0; ch < CH; ch++) {
    const r0 = ch * rowsPer, r1 = Math.min(rows - 1, (ch + 1) * rowsPer);
    if (r1 <= r0) break;
    const nr = r1 - r0 + 1;
    const pos = new Float32Array(nr * cols * 3), nor = new Float32Array(nr * cols * 3), msk = new Float32Array(nr * cols * 4);
    for (let r = r0; r <= r1; r++) for (let c = 0; c < cols; c++) {
      const k = r * cols + c, v = (r - r0) * cols + c;
      pos[v * 3] = X[k]; pos[v * 3 + 1] = H[k]; pos[v * 3 + 2] = Z[k];
      const ra = Math.max(0, r - 1), rb = Math.min(rows - 1, r + 1), ca = Math.max(0, c - 1), cb = Math.min(cols - 1, c + 1);
      const ka = ra * cols + c, kb = rb * cols + c, kc = r * cols + ca, kd = r * cols + cb;
      const ex = X[kd] - X[kc], ey = H[kd] - H[kc], ez = Z[kd] - Z[kc];
      const fx = X[kb] - X[ka], fy = H[kb] - H[ka], fz = Z[kb] - Z[ka];
      let nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx;
      const l = Math.hypot(nx, ny, nz) || 1; if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      nor[v * 3] = nx / l; nor[v * 3 + 1] = ny / l; nor[v * 3 + 2] = nz / l;
      msk[v * 4] = TER.AO[k]; msk[v * 4 + 1] = TER.PATH[k]; msk[v * 4 + 2] = TER.FOREST[k]; msk[v * 4 + 3] = TER.GRAVEL[k];
    }
    const idx = [];
    for (let r = 0; r < nr - 1; r++) for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = a + 1, cc = a + cols, d = cc + 1;
      idx.push(a, b, cc, b, d, cc);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('aMask', new THREE.BufferAttribute(msk, 4));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true; m.castShadow = true;
    scene.add(m); TER.meshes.push(m);
  }
  return mat;
}
