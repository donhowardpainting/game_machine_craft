// First-person walker with voxel AABB collision, creative flight, swimming,
// standing on machines, and a chase camera while driving.
import * as THREE from 'three';
import { ctx } from './ctx';
import { input } from './input';
import { pw, RAPIER, Q_PARTS } from './phys';
import { SEA } from '../world/blocks';
import type { Part } from '../mech/assembly';

const W = 0.3, H = 1.8, EYE = 1.62;
const v = new THREE.Vector3(), v2 = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3();

export class Player {
  pos = new THREE.Vector3(0.5, 40, 0.5);
  vel = new THREE.Vector3();
  yaw = 0; pitch = -0.1;
  grounded = false; flying = false; inWater = false;
  seat: Part | null = null;
  camDist = 8;
  private lastSeat = new THREE.Vector3();
  private lastHeading = 0;
  private lastJumpTap = -1;
  private bob = 0;

  private collides(x: number, y: number, z: number) {
    const w = ctx.world;
    const x0 = Math.floor(x - W), x1 = Math.floor(x + W), y0 = Math.floor(y), y1 = Math.floor(y + H), z0 = Math.floor(z - W), z1 = Math.floor(z + W);
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) for (let zz = z0; zz <= z1; zz++) if (w.getBlock(xx, yy, zz) !== 0) return true;
    return false;
  }
  /** Would a block at this voxel intersect the player? */
  overlapsVoxel(x: number, y: number, z: number) {
    return x + 1 > this.pos.x - W && x < this.pos.x + W && y + 1 > this.pos.y && y < this.pos.y + H && z + 1 > this.pos.z - W && z < this.pos.z + W;
  }

  private heading(p: Part) { p.worldDir(v2); return Math.atan2(-v2.x, -v2.z); }
  sit(p: Part) { this.seat = p; ctx.drive.seat = p; p.worldPos(this.lastSeat); this.lastHeading = this.heading(p); this.yaw = this.lastHeading; this.pitch = -0.3; this.vel.set(0, 0, 0); ctx.sfx('click'); }
  leaveSeat() {
    if (!this.seat) return;
    this.seat.worldPos(this.pos); this.pos.y += 0.9;
    for (let i = 0; i < 4 && this.collides(this.pos.x, this.pos.y, this.pos.z); i++) this.pos.y += 1;
    this.seat = null; ctx.drive.seat = null; ctx.drive.throttle = ctx.drive.steer = 0; ctx.drive.boost = false;
    this.vel.set(0, 0, 0);
  }

  update(dt: number) {
    const en = input.enabled();
    if (en) {
      this.yaw -= input.lookDX; this.pitch -= input.lookDY;
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch));
    }
    if (this.seat) {
      ctx.drive.throttle = en ? input.moveY : 0; ctx.drive.steer = en ? input.moveX : 0; ctx.drive.boost = en && input.jump;
      this.seat.worldPos(v);
      const d = Math.hypot(v.x - this.lastSeat.x, v.z - this.lastSeat.z);
      if (d < 3) ctx.stats.driven += d;
      this.lastSeat.copy(v);
      const hd = this.heading(this.seat);
      let dh = hd - this.lastHeading; if (dh > Math.PI) dh -= Math.PI * 2; else if (dh < -Math.PI) dh += Math.PI * 2;
      if (Math.abs(dh) < 0.3) this.yaw += dh;
      this.lastHeading = hd;
      this.pos.copy(v); this.pos.y -= 0.3;
      if (en) this.camDist = Math.max(3, Math.min(16, this.camDist + input.wheel * 0.8));
      return;
    }
    if (input.pressed.has('fly') && ctx.mode === 'creative') { this.flying = !this.flying; this.vel.y = 0; }
    if (input.pressed.has('jumpTap') && ctx.mode === 'creative') {
      if (ctx.now - this.lastJumpTap < 0.3) { this.flying = !this.flying; this.vel.y = 0; }
      this.lastJumpTap = ctx.now;
    }
    fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const mx = en ? input.moveX : 0, my = en ? input.moveY : 0;
    this.inWater = ctx.world.isWater(this.pos.x, this.pos.y + 0.9, this.pos.z);
    const speed = this.flying ? (input.sprint ? 22 : 11) : this.inWater ? 3 : input.sprint ? 7.4 : 4.8;
    const tx = (fwd.x * my + right.x * mx) * speed, tz = (fwd.z * my + right.z * mx) * speed;
    const acc = this.flying ? 10 : this.grounded ? 14 : this.inWater ? 5 : 4;
    const k = Math.min(1, acc * dt);
    this.vel.x += (tx - this.vel.x) * k; this.vel.z += (tz - this.vel.z) * k;
    if (this.flying) {
      const ty = ((en && input.jump ? 1 : 0) - (en && input.down ? 1 : 0)) * speed * 0.8;
      this.vel.y += (ty - this.vel.y) * k;
    } else if (this.inWater) {
      this.vel.y += (-4 - this.vel.y * 2.5) * dt;
      if (en && input.jump) this.vel.y = Math.min(3.4, this.vel.y + 18 * dt);
    } else {
      this.vel.y -= 26 * dt;
      if (en && input.jump && this.grounded) { this.vel.y = 8.6; this.grounded = false; }
    }
    this.vel.y = Math.max(-45, this.vel.y);

    // machine in the way? (ray at waist height)
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > 0.5) {
      v.set(this.pos.x, this.pos.y + 0.7, this.pos.z); v2.set(this.vel.x / hs, 0, this.vel.z / hs);
      const hit = pw.castRay(new RAPIER.Ray(v, v2), W + 0.2 + hs * dt, true, undefined, Q_PARTS);
      if (hit) { this.vel.x *= 0.05; this.vel.z *= 0.05; }
    }

    // sweep each axis in small steps
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(this.vel.x), Math.abs(this.vel.y), Math.abs(this.vel.z)) * dt / 0.4));
    const sdt = dt / steps;
    let blockedH = false;
    this.grounded = false;
    for (let s = 0; s < steps; s++) {
      let n = this.pos.x + this.vel.x * sdt;
      if (!this.collides(n, this.pos.y, this.pos.z)) this.pos.x = n; else { this.vel.x = 0; blockedH = true; }
      n = this.pos.z + this.vel.z * sdt;
      if (!this.collides(this.pos.x, this.pos.y, n)) this.pos.z = n; else { this.vel.z = 0; blockedH = true; }
      n = this.pos.y + this.vel.y * sdt;
      if (!this.collides(this.pos.x, n, this.pos.z)) this.pos.y = n;
      else {
        if (this.vel.y < 0) { this.grounded = true; this.pos.y = Math.floor(n) + 1.0001; if (this.collides(this.pos.x, this.pos.y, this.pos.z)) this.pos.y = Math.ceil(this.pos.y); }
        this.vel.y = 0;
      }
    }
    // stand on machines
    if (!this.flying && this.vel.y <= 0.01) {
      v.set(this.pos.x, this.pos.y + 0.6, this.pos.z);
      const hit = pw.castRay(new RAPIER.Ray(v, { x: 0, y: -1, z: 0 }), 0.66 - this.vel.y * dt, true, undefined, Q_PARTS);
      if (hit) {
        const body = hit.collider.parent();
        this.pos.y = v.y - hit.timeOfImpact; this.vel.y = 0; this.grounded = true;
        if (body && !body.isFixed()) {
          const lv = body.linvel(), av = body.angvel(), bt = body.translation();
          const rx = this.pos.x - bt.x, rz = this.pos.z - bt.z, ry = this.pos.y - bt.y;
          const cx = lv.x + av.y * rz - av.z * ry, cz = lv.z + av.x * ry - av.y * rx;
          if (!this.collides(this.pos.x + cx * dt, this.pos.y, this.pos.z + cz * dt)) { this.pos.x += cx * dt; this.pos.z += cz * dt; }
        }
      }
    }
    // auto-step: hop up single ledges so touch players need no jump timing
    if (blockedH && this.grounded && (mx || my) && !this.flying) {
      const ax = this.pos.x + fwd.x * my * 0.5 + right.x * mx * 0.5, az = this.pos.z + fwd.z * my * 0.5 + right.z * mx * 0.5;
      if (!this.collides(ax, this.pos.y + 1.05, az) && !this.collides(this.pos.x, this.pos.y + 1.05, this.pos.z)) { this.vel.y = 8.2; this.grounded = false; }
    }
    if (this.pos.y < -30) { this.pos.y = 60; this.vel.set(0, 0, 0); }
    if (this.grounded && hs > 1) this.bob += hs * dt * 1.6;
    if (this.flying && this.grounded) this.flying = ctx.mode === 'creative' && false;
  }

  /** Camera position + orientation for this frame. */
  applyCamera(cam: THREE.PerspectiveCamera) {
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    if (this.seat) {
      this.seat.worldPos(v); v.y += 1.3;
      cam.getWorldDirection(v2);
      let dist = this.camDist;
      const back = v2.clone().negate();
      const hit = ctx.world.raycast(v, back, dist + 0.4);
      if (hit) dist = Math.max(1.2, hit.dist - 0.4);
      cam.position.copy(v).addScaledVector(back, dist);
    } else {
      const b = this.grounded ? Math.sin(this.bob * 2) * 0.035 : 0;
      cam.position.set(this.pos.x, this.pos.y + EYE + b, this.pos.z);
    }
  }
  underwater() { return !this.seat && this.pos.y + EYE < SEA - 0.2 && ctx.world.isWater(this.pos.x, this.pos.y + EYE, this.pos.z); }
}
