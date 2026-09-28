// Third-person chase camera: drag-orbit, scroll-zoom, slow cinematic drift, terrain / canopy / structure avoidance.
import * as THREE from 'three';
import { heightAt, groundFast, LAYOUT } from './world.js';
import { CANOPIES } from './veg.js';
import { ARCH } from './arch.js';
import { clamp, lerp } from './noise.js';

export class ChaseCam {
  constructor(camera, dom) {
    this.cam = camera; this.yaw = 0; this.pitch = 0.2; this.dist = 16; this.tDist = 16; this.idle = 99;
    this.pos = new THREE.Vector3(); this.look = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.lvel = new THREE.Vector3();
    this.snap = true; this.drag = null;
    dom.addEventListener('pointerdown', (e) => { this.drag = { x: e.clientX, y: e.clientY }; dom.setPointerCapture(e.pointerId); });
    dom.addEventListener('pointermove', (e) => { if (!this.drag) return; const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y; this.drag.x = e.clientX; this.drag.y = e.clientY; this.yaw -= dx * 0.0055; this.pitch = clamp(this.pitch + dy * 0.004, -0.05, 1.25); this.idle = 0; });
    const up = () => { this.drag = null; };
    dom.addEventListener('pointerup', up); dom.addEventListener('pointercancel', up);
    dom.addEventListener('wheel', (e) => { e.preventDefault(); this.tDist = clamp(this.tDist * Math.pow(1.0012, e.deltaY), 5.5, 55); this.idle = 0; }, { passive: false });
  }
  constrain(p, target, hint) {
    // structures: bridge deck slab + piers, and building boxes
    const B = LAYOUT.bridge;
    if (ARCH.bridgeGroup) {
      const inv = new THREE.Matrix4().copy(ARCH.bridgeGroup.matrixWorld).invert();
      const l = p.clone().applyMatrix4(inv);
      if (Math.abs(l.x) < B.half + 1.2 && Math.abs(l.z) < B.width / 2 + 0.8) {
        const a = ARCH.arc(clamp(l.x, -B.half, B.half));
        if (l.y > a - 1.1 && l.y < a + 1.9) { if (l.y > a + 0.4 || a - 1.1 < 1.3) l.y = a + 1.9; else l.y = a - 1.1; }
      }
      for (const px of B.piers) { const dx = l.x - px; if (Math.abs(dx) < 0.9 && Math.abs(l.z) < B.width / 2 + 0.9 && l.y < ARCH.arc(px)) l.x = px + Math.sign(dx || 1) * 0.9; }
      p.copy(l.applyMatrix4(ARCH.bridgeGroup.matrixWorld));
    }
    for (const bx of ARCH.obstacleBoxes) {
      if (bx.group === ARCH.bridgeGroup) continue;
      const inv = new THREE.Matrix4().copy(bx.group.matrixWorld).invert();
      const l = p.clone().applyMatrix4(inv);
      if (l.x > bx.min.x && l.x < bx.max.x && l.y > bx.min.y && l.y < bx.max.y && l.z > bx.min.z && l.z < bx.max.z) {
        const pen = [l.x - bx.min.x, bx.max.x - l.x, l.y - bx.min.y + 1e9, bx.max.y - l.y, l.z - bx.min.z, bx.max.z - l.z];
        const k = pen.indexOf(Math.min(...pen));
        if (k === 0) l.x = bx.min.x; else if (k === 1) l.x = bx.max.x; else if (k === 3) l.y = bx.max.y; else if (k === 4) l.z = bx.min.z; else l.z = bx.max.z;
        p.copy(l.applyMatrix4(bx.group.matrixWorld));
      }
    }
    // tree canopies
    for (let it = 0; it < 2; it++) for (const c of CANOPIES) {
      const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z; const d2 = dx * dx + dy * dy + dz * dz; const R = c.r + 0.8;
      if (d2 < R * R) {
        const d = Math.sqrt(d2) || 1;
        // prefer pushing towards the target side / upwards
        const nx = dx / d, ny = Math.max(dy / d, 0.25), nz = dz / d; const nl = Math.hypot(nx, ny, nz);
        p.set(c.x + nx / nl * R, c.y + ny / nl * R, c.z + nz / nl * R);
      }
    }
    // terrain under the camera and along the line of sight
    const g = heightAt(p.x, p.z, hint);
    p.y = Math.max(p.y, g + 1.8, 1.4);
    for (let k = 1; k <= 12; k++) {
      const f = k / 12; const x = lerp(target.x, p.x, f), z = lerp(target.z, p.z, f);
      const gg = groundFast(x, z) + 1.0;
      const lineY = lerp(target.y, p.y, f);
      if (gg > lineY) p.y = Math.max(p.y, target.y + (gg - target.y) / f);
    }
    return p;
  }
  update(dt, boat, t) {
    this.idle += dt;
    if (this.idle > 9) { this.yaw *= Math.exp(-dt * 0.12); this.pitch = lerp(this.pitch, 0.2, 1 - Math.exp(-dt * 0.1)); }
    this.dist = lerp(this.dist, this.tDist, 1 - Math.exp(-dt * 4));
    const fwd = new THREE.Vector3(Math.cos(boat.psi), 0, -Math.sin(boat.psi));
    const target = new THREE.Vector3(boat.x, 1.9, boat.z).addScaledVector(fwd, 2.0);
    const drift = 0.32 * Math.sin(t * 0.043) + 0.12 * Math.sin(t * 0.017 + 1.3);
    const az = boat.psi + Math.PI + this.yaw + drift;
    const pitch = clamp(this.pitch + 0.05 * Math.sin(t * 0.031), -0.05, 1.3);
    const dist = this.dist * (1 + 0.06 * Math.sin(t * 0.05));
    const h = Math.cos(pitch) * dist;
    const desired = new THREE.Vector3(target.x + Math.cos(az) * h, target.y + Math.sin(pitch) * dist, target.z - Math.sin(az) * h);
    this.constrain(desired, target, boat.s);
    if (this.snap) { this.pos.copy(desired); this.look.copy(target); this.vel.set(0, 0, 0); this.lvel.set(0, 0, 0); this.snap = false; }
    // critically damped springs
    const spring = (x, v, goal, w) => { const a = goal.clone().sub(x).multiplyScalar(w * w).addScaledVector(v, -2 * w); v.addScaledVector(a, dt); x.addScaledVector(v, dt); };
    spring(this.pos, this.vel, desired, 2.6);
    spring(this.look, this.lvel, target, 4.0);
    // hard guarantee after smoothing
    this.constrain(this.pos, this.look, boat.s);
    this.cam.position.copy(this.pos);
    this.cam.lookAt(this.look);
    this.cam.updateMatrixWorld();
  }
}
