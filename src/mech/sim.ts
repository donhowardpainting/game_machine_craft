// Per-tick machine behaviour: channel logic, per-contraption power budget,
// and what every active part does with the power and signals it receives.
import * as THREE from 'three';
import { pw, RAPIER, owners, Q_ITEMS } from '../game/phys';
import { ctx } from '../game/ctx';
import { B, BLOCKS, ITEMS, ItemId } from '../world/blocks';
import { Assembly, Part } from './assembly';
import { DIRS } from './parts';
import type { Item } from './items';

export const RECIPES: Record<string, Partial<Record<ItemId, { out: ItemId; n: number; time: number }>>> = {
  smelter: {
    iron_ore: { out: 'iron', n: 1, time: 2.6 }, copper_ore: { out: 'copper', n: 1, time: 2.6 }, sand: { out: 'glass', n: 1, time: 2 },
  },
  fabricator: {
    iron: { out: 'gear', n: 2, time: 2.4 }, copper: { out: 'wire', n: 2, time: 2.4 },
    wood: { out: 'plank', n: 2, time: 1.5 }, stone: { out: 'brick', n: 1, time: 1.5 },
  },
};
export const FUEL: Partial<Record<ItemId, number>> = { coal: 60, wood: 15, plank: 8 };

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3(), v5 = new THREE.Vector3();
const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();
const boxSmall = () => new RAPIER.Cuboid(0.6, 0.62, 0.6);
let shapeIntake: RAPIER.Cuboid, shapeBelt: RAPIER.Cuboid;
let tickN = 0;
const beltHits: Item[] = [];
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

function chanOn(p: Part) { return ctx.channels[p.cfg.ch] !== p.cfg.inv; }

/** Relative joint angle of the child about the joint axis. */
export function linkAngle(p: Part): number {
  if (!p.link) return 0;
  const a = p.asm.body.rotation(), b = p.link.child.body.rotation();
  q1.set(a.x, a.y, a.z, a.w).invert().multiply(q2.set(b.x, b.y, b.z, b.w));
  const f = DIRS[p.dir];
  return 2 * Math.atan2(q1.x * f[0] + q1.y * f[1] + q1.z * f[2], q1.w);
}
function linkExt(p: Part): number {
  if (!p.link) return p.cur;
  const f = DIRS[p.dir];
  p.asm.cellWorld(p.cell[0] + f[0], p.cell[1] + f[1], p.cell[2] + f[2], v1);
  const t = p.link.child.body.translation();
  p.worldDir(v2);
  return clamp((t.x - v1.x) * v2.x + (t.y - v1.y) * v2.y + (t.z - v1.z) * v2.z, 0, 3.2);
}

function intake(p: Part, accept: (it: Item) => boolean) {
  p.worldPos(v1);
  const r = p.asm.body.rotation();
  const found: Item[] = [];
  pw.intersectionsWithShape(v1, r, shapeIntake, (c) => {
    const o = owners.get(c.handle);
    if (o && o.kind === 'item') found.push(o.ref);
    return true;
  }, undefined, Q_ITEMS);
  for (const it of found) if (!it.dead && it.age > 0.25 && accept(it)) ctx.items.remove(it);
}

interface Info { seat: Part | null; driving: boolean; hasSteer: boolean; f: THREE.Vector3; u: THREE.Vector3; r: THREE.Vector3; sp: THREE.Vector3 }
const info: Info = { seat: null, driving: false, hasSteer: false, f: new THREE.Vector3(), u: new THREE.Vector3(), r: new THREE.Vector3(), sp: new THREE.Vector3() };

function hingeMode(p: Part) { return p.cfg.mode === 'auto' ? (info.seat ? 'steer' : 'free') : p.cfg.mode; }

/** Pass 1: decide what the part wants to do and what it would draw. */
function plan(p: Part) {
  const c = p.cfg;
  p.demand = 0; p.want = 0;
  switch (p.type) {
    case 'motor': {
      let w = 0;
      const mode = c.mode;
      if (mode === 'on' || (mode === 'auto' && !info.seat)) w = 1;
      else if (mode === 'channel') w = chanOn(p) ? 1 : 0;
      else if (info.driving) {
        p.worldDir(v1);
        const s = v1.dot(v3.crossVectors(info.u, info.f));
        if (Math.abs(s) > 0.3) {
          p.worldPos(v2).sub(info.sp);
          const side = Math.sign(v2.dot(info.r)) || 0;
          const mix = info.hasSteer ? 0.25 : 1;
          w = clamp(ctx.drive.throttle - ctx.drive.steer * side * mix, -1, 1) * Math.sign(s);
        }
      }
      p.want = w * (c.rev ? -1 : 1);
      if (Math.abs(p.want) > 0.01) p.demand = p.def.power!;
      break;
    }
    case 'hinge': {
      const mode = hingeMode(p);
      const ang = c.angle * Math.PI / 180;
      let t = 0;
      if (mode === 'steer') {
        if (info.driving) {
          p.worldDir(v1); p.worldPos(v2).sub(info.sp);
          const front = v2.dot(info.f) >= -0.1 ? 1 : -1;
          t = -ctx.drive.steer * ang * Math.sign(v1.dot(info.u)) * front;
        }
      } else if (mode === 'channel') t = chanOn(p) ? ang : 0;
      else if (mode === 'sweep') t = ang * Math.sin(ctx.now * Math.PI * 2 / c.period);
      p.want = t * (c.rev ? -1 : 1);
      p.onNow = mode !== 'free';
      if (p.onNow) p.demand = p.def.power!;
      break;
    }
    case 'piston': {
      const on = c.mode === 'on' ? true : c.mode === 'pump' ? (ctx.now % c.period) < c.period / 2 : chanOn(p);
      p.want = on ? c.len : 0;
      if (Math.abs(p.want - p.cur) > 0.01) p.demand = p.def.power!;
      break;
    }
    case 'drill': case 'conveyor': case 'lamp': case 'thruster': case 'smelter': case 'fabricator': {
      const m = c.mode;
      let on = m === 'on' ? true : m === 'channel' ? chanOn(p) : m === 'night' ? ctx.sky.daylight < 0.35 : m === 'boost' ? info.driving && ctx.drive.boost : false;
      if ((p.type === 'smelter' || p.type === 'fabricator') && !(p.st.n > 0)) on = false;
      p.onNow = on;
      if (on) p.demand = p.def.power!;
      break;
    }
  }
}

function spawnDrop(type: ItemId, x: number, y: number, z: number) {
  ctx.items.spawn(type, x, y, z, (Math.random() - 0.5) * 1.2, 1 + Math.random(), (Math.random() - 0.5) * 1.2, { machine: false });
}

/** Pass 2: act, scaled by the power ratio the contraption could deliver. */
function act(p: Part, ratio: number, dt: number) {
  const c = p.cfg;
  p.ratio = ratio;
  switch (p.type) {
    case 'motor': {
      const w = p.want * c.speed * 2.4;
      if (p.link) {
        const j = p.link.joint as RAPIER.RevoluteImpulseJoint;
        j.configureMotorVelocity(w * ratio, ratio > 0 ? 3 + 13 * ratio : 0.02);
        if (Math.abs(w) > 0.01 && ratio > 0) { p.link.child.body.wakeUp(); p.asm.body.wakeUp(); }
        p.vis.moving!.rotation.z = linkAngle(p);
      } else { p.spin += w * ratio * dt; p.vis.moving!.rotation.z = p.spin; }
      break;
    }
    case 'bearing':
      if (p.link) p.vis.moving!.rotation.z = linkAngle(p);
      break;
    case 'hinge': {
      const ang = c.angle * Math.PI / 180;
      if (p.link) {
        const j = p.link.joint as RAPIER.RevoluteImpulseJoint;
        if (p.st.lim !== c.angle) { j.setLimits(-ang - 0.02, ang + 0.02); p.st.lim = c.angle; }
        if (!p.onNow || ratio <= 0) j.configureMotorPosition(0, 0, 0.6);
        else {
          const rate = c.speed * 0.9 * ratio * dt;
          const before = p.cur;
          p.cur += clamp(p.want - p.cur, -rate, rate);
          j.configureMotorPosition(p.cur, 700, 70);
          if (Math.abs(p.cur - before) > 1e-5) { p.link.child.body.wakeUp(); p.asm.body.wakeUp(); }
        }
        p.vis.moving!.rotation.z = linkAngle(p);
      } else {
        const rate = c.speed * 0.9 * dt;
        p.cur += clamp((p.onNow ? p.want : 0) - p.cur, -rate, rate);
        p.vis.moving!.rotation.z = p.cur;
      }
      break;
    }
    case 'piston': {
      const rate = c.speed * 1.1 * ratio * dt;
      const before = p.cur;
      p.cur += clamp(p.want - p.cur, -rate, rate);
      if (p.link) {
        (p.link.joint as RAPIER.PrismaticImpulseJoint).configureMotorPosition(p.cur, 2200, 160);
        if (Math.abs(p.cur - before) > 1e-5) { p.link.child.body.wakeUp(); p.asm.body.wakeUp(); }
      }
      const ext = linkExt(p);
      p.vis.moving!.position.z = ext; p.vis.rod!.scale.z = Math.max(0.01, ext);
      break;
    }
    case 'drill': {
      if (!p.onNow || ratio <= 0) { p.tick = 0; break; }
      p.spin += 16 * ratio * dt; p.vis.moving!.rotation.z = p.spin;
      p.worldPos(v1); p.worldDir(v2);
      let hit = 0, vx = 0, vy = 0, vz = 0, id = 0;
      for (let k = 1; k <= 2 && !hit; k++) {
        vx = Math.floor(v1.x + v2.x * k); vy = Math.floor(v1.y + v2.y * k); vz = Math.floor(v1.z + v2.z * k);
        id = ctx.world.getBlock(vx, vy, vz);
        if (id !== B.Air) hit = k;
      }
      if (!hit) { p.tick = 0; break; }
      const def = BLOCKS[id];
      const key = vx * 73856093 ^ vy * 19349663 ^ vz * 83492791;
      if (p.st.key !== key) { p.st.key = key; p.tick = 0; }
      if ((tickN & 3) === 0) {
        ctx.fx.emit(vx + 0.5 - v2.x * 0.5 + (Math.random() - 0.5) * 0.4, vy + 0.5 - v2.y * 0.5 + (Math.random() - 0.5) * 0.4, vz + 0.5 - v2.z * 0.5 + (Math.random() - 0.5) * 0.4,
          -v2.x * 2 + (Math.random() - 0.5) * 3, 2 + Math.random() * 2, -v2.z * 2 + (Math.random() - 0.5) * 3, Math.random() < 0.3 ? 0xffd27a : def.side, 0.5, 0.1);
      }
      if (!isFinite(def.hardness)) break;
      p.tick += dt * ratio * 1.7 / def.hardness;
      if (p.tick >= 1) {
        p.tick = 0;
        ctx.stats.drilled++;
        ctx.sfx('break', 0.35);
        let sx = vx + 0.5, sy = vy + 0.5, sz = vz + 0.5;
        if (hit === 2) { sx = v1.x + v2.x; sy = v1.y + v2.y; sz = v1.z + v2.z; }
        else if (def.vein) { sx = v1.x; sy = v1.y + 0.8; sz = v1.z; }
        if (!def.vein) { ctx.world.setBlock(vx, vy, vz, B.Air); ctx.fx.burst(vx + 0.5, vy + 0.5, vz + 0.5, def.side, 12, 3); }
        if (def.drop) spawnDrop(def.drop, sx, sy, sz);
      }
      break;
    }
    case 'conveyor': {
      if (!p.onNow || ratio <= 0) break;
      const sp = c.speed * 0.55 * ratio * (c.rev ? -1 : 1);
      p.spin = (p.spin + sp * dt) % 0.25;
      p.vis.moving!.position.z = p.spin < 0 ? p.spin + 0.25 : p.spin;
      p.worldPos(v1); p.worldDir(v2);
      const r = p.asm.body.rotation();
      v3.set(0, 0.5, 0).applyQuaternion(q1.set(r.x, r.y, r.z, r.w));
      v4.copy(v1).add(v3);
      const bv = p.asm.body.linvel();
      beltHits.length = 0;
      pw.intersectionsWithShape(v4, r, shapeBelt, (col) => {
        const o = owners.get(col.handle);
        if (o && o.kind === 'item') beltHits.push(o.ref);
        return true;
      }, undefined, Q_ITEMS);
      for (const it of beltHits) {
        if (it.dead) continue;
        const b = it.body, t = b.translation(), lv = b.linvel();
        // steer toward the belt centre line while carrying forward
        v5.set(t.x - v1.x, 0, t.z - v1.z);
        const along = v5.dot(v2);
        v5.addScaledVector(v2, -along);
        b.setLinvel({ x: v2.x * sp - v5.x * 3 + bv.x, y: Math.max(lv.y, -3), z: v2.z * sp - v5.z * 3 + bv.z }, true);
        it.beltT = ctx.now; it.conveyed = true;
      }
      break;
    }
    case 'smelter': case 'fabricator': {
      const st = p.st; const rec = RECIPES[p.type];
      if ((tickN + p.id) % 6 === 0 && !(st.n >= 8)) {
        intake(p, (it) => {
          if (!rec[it.type] || (st.n > 0 && st.it !== it.type) || st.n >= 8) return false;
          st.it = it.type; st.n = (st.n || 0) + 1; ctx.sfx('pick', 0.25); return true;
        });
      }
      if (p.onNow && ratio > 0 && st.n > 0) {
        const r = rec[st.it as ItemId]!;
        st.prog = (st.prog || 0) + dt * ratio / r.time;
        if ((tickN & 7) === 0) { p.worldPos(v1); ctx.fx.emit(v1.x + (Math.random() - 0.5) * 0.3, v1.y + 0.7, v1.z + (Math.random() - 0.5) * 0.3, 0, 1.2, 0, p.type === 'smelter' ? 0x8a8a8a : 0xd9d9e0, 1.4, 0.16, -0.05, 1.5); }
        if (st.prog >= 1) {
          st.prog = 0; st.n--;
          p.worldPos(v1); p.worldDir(v2);
          for (let i = 0; i < r.n; i++) {
            ctx.items.spawn(r.out, v1.x + v2.x * 0.8 + (Math.random() - 0.5) * 0.1, v1.y + 0.42 + i * 0.26, v1.z + v2.z * 0.8 + (Math.random() - 0.5) * 0.1, v2.x * 1.3, 0.4, v2.z * 1.3, { machine: true });
          }
          if (p.type === 'smelter') ctx.stats.smelted++; else ctx.stats.crafted++;
          ctx.fx.burst(v1.x + v2.x * 0.7, v1.y, v1.z + v2.z * 0.7, 0xffb347, 6, 1.5, 0.4, 0.08);
          ctx.sfx('ding', 0.3);
        }
      }
      break;
    }
    case 'storage': {
      if ((tickN + p.id) % 6 !== 0) break;
      const st = p.st; if (!st.store) st.store = {};
      intake(p, (it) => {
        st.store[it.type] = (st.store[it.type] || 0) + 1;
        if (it.machine && it.conveyed) ctx.stats.delivered++;
        ctx.sfx('pick', 0.2);
        return true;
      });
      break;
    }
    case 'generator': {
      if ((tickN + p.id) % 10 === 0 && !(p.st.fuel > 300)) {
        intake(p, (it) => { const f = FUEL[it.type]; if (!f) return false; p.st.fuel = (p.st.fuel || 0) + f; return true; });
      }
      break;
    }
    case 'lamp':
      p.vis.lampMat!.emissiveIntensity = p.onNow && ratio > 0 ? 2.4 : 0;
      break;
    case 'thruster': {
      if (!p.onNow || ratio <= 0) break;
      p.worldPos(v1); p.worldDir(v2);
      const F = c.speed * 42 * ratio * dt;
      p.asm.body.applyImpulseAtPoint({ x: -v2.x * F, y: -v2.y * F, z: -v2.z * F }, v1, true);
      for (let i = 0; i < 2; i++) ctx.fx.emit(v1.x + v2.x * 0.6, v1.y + v2.y * 0.6, v1.z + v2.z * 0.6, v2.x * 9 + (Math.random() - 0.5) * 2, v2.y * 9 + (Math.random() - 0.5) * 2, v2.z * 9 + (Math.random() - 0.5) * 2, Math.random() < 0.5 ? 0xffc34d : 0xff7a2e, 0.35, 0.22, 0, -0.6);
      break;
    }
    case 'switch':
      p.vis.moving!.rotation.x = p.st.on ? -0.6 : 0.6;
      break;
  }
}

function simContraption(root: Assembly, dt: number) {
  const members = ctx.mech.members(root);
  info.seat = null; info.driving = false; info.hasSteer = false;
  let supply = 0, fuel = 0;
  const gens: Part[] = [];
  for (const a of members) for (const p of a.active) {
    if (p.type === 'seat') { if (!info.seat || p === ctx.drive.seat) info.seat = p; }
    else if (p.type === 'hinge' && (p.cfg.mode === 'steer' || p.cfg.mode === 'auto')) info.hasSteer = true;
    else if (p.type === 'generator') {
      if (ctx.mode === 'creative' || p.st.fuel > 0) { supply += p.def.supply!; gens.push(p); }
      fuel += p.st.fuel || 0;
    } else if (p.type === 'solar') supply += p.def.supply! * ctx.sky.daylight;
  }
  if (info.seat) {
    info.driving = info.seat === ctx.drive.seat;
    const s = info.seat;
    s.worldDir(info.f); s.worldDir(info.u, 2); info.r.crossVectors(info.f, info.u); s.worldPos(info.sp);
  }
  let demand = 0;
  for (const a of members) for (const p of a.active) { plan(p); demand += p.demand; }
  const ratio = demand <= 0 ? (supply > 0 ? 1 : 0) : Math.min(1, supply / demand);
  root.power.supply = supply; root.power.demand = demand; root.power.ratio = ratio; root.power.fuel = fuel;
  if (gens.length && demand > 0 && ctx.mode !== 'creative') {
    const load = clamp(demand / supply, 0.1, 1) * dt;
    for (const g of gens) g.st.fuel = Math.max(0, g.st.fuel - load);
  }
  if (gens.length && demand > 0 && (tickN & 7) === 0) {
    const g = gens[tickN % gens.length]; g.worldPos(v1);
    ctx.fx.emit(v1.x + 0.28, v1.y + 0.85, v1.z - 0.26, (Math.random() - 0.5) * 0.3, 1.4, (Math.random() - 0.5) * 0.3, 0x55555c, 1.8, 0.18, -0.04, 2);
  }
  for (const a of members) for (const p of a.active) act(p, ratio, dt);
}

interface GearRef { p: Part; pos: THREE.Vector3; ax: THREE.Vector3 }
function gears(list: GearRef[]) {
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    const ba = a.p.asm.body, bb = b.p.asm.body;
    if (ba === bb) continue;
    const d = v1.copy(b.pos).sub(a.pos), dist = d.length();
    if (dist < 0.8 || dist > 1.25) continue;
    if (Math.abs(a.ax.dot(b.ax)) < 0.9 || Math.abs(d.dot(a.ax)) > 0.35) continue;
    const wa = ba.angvel(), wb = bb.angvel();
    const oa = wa.x * a.ax.x + wa.y * a.ax.y + wa.z * a.ax.z, ob = wb.x * a.ax.x + wb.y * a.ax.y + wb.z * a.ax.z;
    const fa = ba.isFixed(), fb = bb.isFixed();
    if (fa && fb) continue;
    const err = oa + ob;
    if (Math.abs(err) < 1e-3) continue;
    const g = 0.85;
    const da = fa ? 0 : fb ? -err * g : -err * 0.5 * g, db = fb ? 0 : fa ? -err * g : -err * 0.5 * g;
    if (!fa) ba.setAngvel({ x: wa.x + a.ax.x * da, y: wa.y + a.ax.y * da, z: wa.z + a.ax.z * da }, true);
    if (!fb) bb.setAngvel({ x: wb.x + a.ax.x * db, y: wb.y + a.ax.y * db, z: wb.z + a.ax.z * db }, true);
  }
}

export function simulate(dt: number) {
  tickN++;
  if (!shapeIntake) { shapeIntake = boxSmall(); shapeBelt = new RAPIER.Cuboid(0.44, 0.24, 0.5); }
  const { mech } = ctx;
  // 1. signal sources
  const ch = [ctx.manual[0], ctx.manual[1], ctx.manual[2], ctx.manual[3]];
  const gearList: GearRef[] = [];
  for (const a of mech.asms) for (const p of a.active) {
    if (p.type === 'switch') { if (p.st.on) ch[p.cfg.ch] = true; }
    else if (p.type === 'timer') { p.st.t = ((p.st.t || 0) + dt) % p.cfg.period; if (p.st.t < p.cfg.period / 2) ch[p.cfg.ch] = true; }
    else if (p.type === 'sensor') {
      if ((tickN + p.id) % 4 === 0) {
        p.worldPos(v1); p.worldDir(v2);
        v1.addScaledVector(v2, 0.55);
        const hit = pw.castRay(new RAPIER.Ray(v1, v2), p.cfg.range, true, undefined, undefined, undefined, a.body);
        p.st.hit = !!hit || !!ctx.world.raycast(v1, v2, p.cfg.range);
      }
      if (!!p.st.hit !== p.cfg.inv) ch[p.cfg.ch] = true;
    } else if (p.type === 'gear') gearList.push({ p, pos: p.worldPos(new THREE.Vector3()), ax: p.worldDir(new THREE.Vector3()) });
  }
  for (let i = 0; i < 4; i++) ctx.channels[i] = ch[i];
  // 2. contraptions
  for (const a of mech.asms) if (!a.parent) simContraption(a, dt);
  if (gearList.length > 1) gears(gearList);
}
