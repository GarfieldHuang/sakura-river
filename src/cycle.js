// Day-night cycle: loop time -> hour -> all lighting / weather parameters.
import * as THREE from 'three';
import { clamp, lerp, smoothstep } from './noise.js';

// segments: [seconds, fromHour, toHour]
const SEG = [
  [30, 5.0, 6.5],    // dawn
  [50, 6.5, 11.0],   // morning
  [22, 11.0, 13.4],  // midday
  [58, 13.4, 15.8],  // storm
  [30, 15.8, 17.2],  // late afternoon, drying
  [62, 17.2, 18.3],  // golden hour
  [26, 18.3, 18.85], // sunset
  [26, 18.85, 19.5], // blue hour
  [80, 19.5, 27.5],  // night (to 3:30)
  [26, 27.5, 29.0],  // pre-dawn -> 5:00
];
export const CYCLE_LEN = SEG.reduce((a, s) => a + s[0], 0);
export function hourFromLoop(t) {
  t = ((t % CYCLE_LEN) + CYCLE_LEN) % CYCLE_LEN;
  for (const [d, a, b] of SEG) { if (t < d) return (lerp(a, b, t / d)) % 24; t -= d; }
  return 5;
}
export function loopFromHour(h) {
  let acc = 0;
  for (const [d, a, b] of SEG) {
    let hh = h; if (hh < a) hh += 24;
    if (hh >= a && hh <= b) return acc + d * (hh - a) / (b - a);
    acc += d;
  }
  return 0;
}

// sun arc: rises from +Z side (down-valley), sets up-valley (-Z)
const A = new THREE.Vector3(0.28, 0, 1).normalize();
const B = new THREE.Vector3(1, 0, -0.28).normalize();
const UP = new THREE.Vector3(0, 1, 0);
export function sunDirection(h, out) {
  const th = Math.PI * (h - 5.9) / (18.65 - 5.9);
  const e = 62 * Math.PI / 180;
  out.copy(A).multiplyScalar(Math.cos(th)).addScaledVector(B, Math.sin(th) * Math.cos(e)).addScaledVector(UP, Math.sin(th) * Math.sin(e));
  return out.normalize();
}
export function moonDirection(h, out) {
  let hh = h < 12 ? h + 24 : h;
  const th = Math.PI * (hh - 18.4) / (30.2 - 18.4);
  const e = 48 * Math.PI / 180;
  const a = new THREE.Vector3(0.1, 0, 1).normalize(), b = new THREE.Vector3(1, 0, -0.1).normalize();
  out.copy(a).multiplyScalar(Math.cos(th)).addScaledVector(b, Math.sin(th) * Math.cos(e)).addScaledVector(UP, Math.sin(th) * Math.sin(e));
  return out.normalize();
}

// keyframes by hour (colors are linear-ish floats)
const C = (r, g, b) => new THREE.Color(r, g, b);
const KEYS = [
  // h, zenith, horizon, sunCol, hemiSky, hemiGnd, fog, fogSun, exposure, sat, warm
  { h: 0.0, zen: C(0.004, 0.008, 0.022), hor: C(0.02, 0.035, 0.07), hemiS: C(0.045, 0.06, 0.11), hemiG: C(0.02, 0.022, 0.03), fog: C(0.028, 0.04, 0.07), fogS: C(0.02, 0.025, 0.04), exp: 2.6, sat: 0.8, warm: -0.35, mist: 0.55 },
  { h: 4.3, zen: C(0.006, 0.01, 0.028), hor: C(0.03, 0.04, 0.08), hemiS: C(0.05, 0.065, 0.12), hemiG: C(0.02, 0.022, 0.03), fog: C(0.035, 0.045, 0.08), fogS: C(0.02, 0.025, 0.04), exp: 2.5, sat: 0.8, warm: -0.3, mist: 0.75 },
  { h: 5.2, zen: C(0.05, 0.07, 0.16), hor: C(0.35, 0.25, 0.3), hemiS: C(0.16, 0.16, 0.24), hemiG: C(0.06, 0.05, 0.05), fog: C(0.3, 0.26, 0.32), fogS: C(0.4, 0.22, 0.12), exp: 1.6, sat: 0.9, warm: 0.1, mist: 1.0 },
  { h: 6.2, zen: C(0.16, 0.25, 0.5), hor: C(0.95, 0.62, 0.45), hemiS: C(0.4, 0.42, 0.55), hemiG: C(0.16, 0.12, 0.1), fog: C(0.72, 0.6, 0.58), fogS: C(1.2, 0.65, 0.3), exp: 1.1, sat: 1.0, warm: 0.3, mist: 1.0 },
  { h: 8.0, zen: C(0.16, 0.34, 0.75), hor: C(0.62, 0.72, 0.85), hemiS: C(0.52, 0.62, 0.8), hemiG: C(0.24, 0.22, 0.16), fog: C(0.62, 0.7, 0.82), fogS: C(0.6, 0.5, 0.35), exp: 0.8, sat: 1.05, warm: 0.05, mist: 0.45 },
  { h: 12.0, zen: C(0.12, 0.3, 0.72), hor: C(0.6, 0.72, 0.88), hemiS: C(0.55, 0.66, 0.85), hemiG: C(0.26, 0.24, 0.18), fog: C(0.62, 0.72, 0.86), fogS: C(0.45, 0.4, 0.3), exp: 0.72, sat: 1.05, warm: 0.0, mist: 0.15 },
  { h: 16.0, zen: C(0.14, 0.3, 0.68), hor: C(0.7, 0.72, 0.8), hemiS: C(0.52, 0.6, 0.75), hemiG: C(0.26, 0.23, 0.17), fog: C(0.66, 0.7, 0.78), fogS: C(0.7, 0.55, 0.35), exp: 0.78, sat: 1.05, warm: 0.1, mist: 0.25 },
  { h: 17.5, zen: C(0.16, 0.27, 0.56), hor: C(1.0, 0.68, 0.42), hemiS: C(0.46, 0.46, 0.55), hemiG: C(0.28, 0.19, 0.12), fog: C(0.62, 0.5, 0.42), fogS: C(1.0, 0.56, 0.24), exp: 1.05, sat: 1.18, warm: 0.35, mist: 0.35 },
  { h: 18.4, zen: C(0.12, 0.14, 0.32), hor: C(1.1, 0.45, 0.22), hemiS: C(0.32, 0.27, 0.34), hemiG: C(0.17, 0.1, 0.07), fog: C(0.52, 0.34, 0.28), fogS: C(1.0, 0.42, 0.18), exp: 1.25, sat: 1.15, warm: 0.4, mist: 0.4 },
  { h: 19.0, zen: C(0.03, 0.05, 0.14), hor: C(0.2, 0.18, 0.32), hemiS: C(0.1, 0.12, 0.22), hemiG: C(0.04, 0.035, 0.05), fog: C(0.12, 0.13, 0.22), fogS: C(0.2, 0.1, 0.1), exp: 1.9, sat: 0.95, warm: -0.2, mist: 0.6 },
  { h: 20.0, zen: C(0.008, 0.014, 0.04), hor: C(0.04, 0.055, 0.1), hemiS: C(0.055, 0.07, 0.13), hemiG: C(0.022, 0.024, 0.032), fog: C(0.04, 0.055, 0.09), fogS: C(0.02, 0.025, 0.04), exp: 2.5, sat: 0.85, warm: -0.35, mist: 0.5 },
];
function sampleKeys(h) {
  let i = 0;
  while (i < KEYS.length - 1 && KEYS[i + 1].h <= h) i++;
  const a = KEYS[i], b = i < KEYS.length - 1 ? KEYS[i + 1] : { ...KEYS[0], h: 24 };
  let t = (h - a.h) / (b.h - a.h); t = t * t * (3 - 2 * t);
  const out = {};
  for (const k in a) { if (k === 'h') continue; out[k] = a[k].isColor ? a[k].clone().lerp(b[k], t) : lerp(a[k], b[k], t); }
  return out;
}

export const ENV = {
  hour: 8, sunDir: new THREE.Vector3(), moonDir: new THREE.Vector3(), keyDir: new THREE.Vector3(), keyCol: new THREE.Color(), keyIsSun: true,
  sunI: 0, moonI: 0, storm: 0, rain: 0, clouds: 0.3, wet: 0, night: 0, stars: 0, godrays: 0, fireflies: 0, lanterns: 0, wisps: 0,
  zen: new THREE.Color(), hor: new THREE.Color(), hemiS: new THREE.Color(), hemiG: new THREE.Color(), fog: new THREE.Color(), fogS: new THREE.Color(),
  exposure: 1, sat: 1, warm: 0, fogDensity: 0.002, mist: 0.3, golden: 0, dayF: 1,
};
let wetState = 0;
export function updateEnv(h, dt) {
  const E = ENV; E.hour = h;
  sunDirection(h, E.sunDir); moonDirection(h, E.moonDir);
  const k = sampleKeys(h);
  // storm envelope
  const storm = smoothstep(13.4, 14.1, h) * (1 - smoothstep(15.2, 15.9, h));
  const rain = smoothstep(13.85, 14.2, h) * (1 - smoothstep(15.05, 15.45, h));
  E.storm = storm; E.rain = rain;
  E.clouds = lerp(0.42, 1.0, storm) + 0.08 * Math.sin(h * 0.7);
  // wetness: soak fast in rain, dry slowly
  if (rain > 0.05) wetState = Math.min(1, wetState + dt * 0.35 * rain);
  else wetState = Math.max(0, wetState - dt * 0.012);
  if (h < 13 && h > 5) wetState = Math.max(0, wetState - dt * 0.05);
  E.wet = wetState;
  const sunEl = E.sunDir.y, moonEl = E.moonDir.y;
  let sunI = smoothstep(-0.03, 0.12, sunEl) * (1 - 0.88 * storm);
  const moonI = smoothstep(-0.02, 0.15, moonEl) * smoothstep(0.02, -0.12, sunEl);
  E.sunI = sunI; E.moonI = moonI;
  const golden = smoothstep(16.6, 17.6, h) * (1 - smoothstep(18.45, 18.8, h));
  E.golden = golden;
  if (sunEl > -0.05 || moonI < 0.02) {
    E.keyIsSun = true; E.keyDir.copy(E.sunDir); if (E.keyDir.y < 0.02) E.keyDir.y = 0.02; E.keyDir.normalize();
    const low = 1 - smoothstep(0.0, 0.45, sunEl);
    E.keyCol.setRGB(lerp(1.0, 1.5, low), lerp(0.96, 0.62, low), lerp(0.9, 0.3, low)).multiplyScalar(sunI * lerp(3.2, 2.6, low));
  } else {
    E.keyIsSun = false; E.keyDir.copy(E.moonDir);
    E.keyCol.setRGB(0.42, 0.52, 0.8).multiplyScalar(moonI * 0.5 * (1 - 0.7 * storm));
  }
  const stormGrey = new THREE.Color(0.2, 0.22, 0.25);
  E.zen.copy(k.zen).lerp(stormGrey.clone().multiplyScalar(0.8), storm * 0.85);
  E.hor.copy(k.hor).lerp(stormGrey, storm * 0.85);
  E.hemiS.copy(k.hemiS).lerp(new THREE.Color(0.32, 0.35, 0.4), storm * 0.7);
  E.hemiG.copy(k.hemiG).lerp(new THREE.Color(0.14, 0.14, 0.14), storm * 0.6);
  E.fog.copy(k.fog).lerp(new THREE.Color(0.32, 0.35, 0.38), storm * 0.85);
  E.fogS.copy(k.fogS).multiplyScalar(1 - storm * 0.9);
  E.exposure = k.exp * (1 + storm * 0.55);
  E.sat = k.sat - storm * 0.18;
  E.warm = k.warm * (1 - storm);
  E.mist = clamp(k.mist + storm * 0.35 + wetState * 0.2, 0, 1);
  E.fogDensity = 0.0014 + storm * 0.0042 + golden * 0.0004 + (1 - smoothstep(5.5, 8.5, h)) * smoothstep(4.0, 5.5, h) * 0.002;
  E.night = 1 - smoothstep(-0.12, 0.05, sunEl);
  E.stars = (1 - smoothstep(-0.2, -0.02, sunEl)) * (1 - storm);
  E.dayF = smoothstep(-0.05, 0.2, sunEl);
  E.godrays = sunI * (0.35 + 0.9 * golden + 0.4 * (1 - smoothstep(6.0, 8.5, h)) * smoothstep(5.5, 6.2, h));
  E.fireflies = smoothstep(18.8, 19.6, h < 12 ? h + 24 : h) * (1 - smoothstep(22.5, 24.5, h < 12 ? h + 24 : h));
  E.lanterns = smoothstep(18.5, 19.2, h < 12 ? h + 24 : h) * (1 - smoothstep(29.0, 29.6, h < 12 ? h + 24 : h));
  E.wisps = smoothstep(19.3, 20.2, h < 12 ? h + 24 : h) * (1 - smoothstep(28.2, 28.9, h < 12 ? h + 24 : h));
  return E;
}
