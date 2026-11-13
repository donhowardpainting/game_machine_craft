// The component connection system.
//
// An Assembly is one rigid body holding parts on its own local integer grid.
// Joint parts (motor, bearing, hinge, piston) own the face they point at:
// anything built on that face starts a *child* assembly connected by a
// physics joint. A contraption is a tree of assemblies. Nothing here knows
// about "vehicles" or "cranes" - behaviour emerges from what is bolted where.
import * as THREE from 'three';
import { pw, RAPIER, owners, GROUP_PART, Q_PARTS } from '../game/phys';
import { ctx } from '../game/ctx';
import { DIRS, DIR_QUAT, PARTS, PartCfg, PartDef, PartType, PartVisual, defaultCfg, dirFromVec, makeVisual } from './parts';

export const ck = (x: number, y: number, z: number) => x + ',' + y + ',' + z;
let nextId = 1;

export class Part {
  id = nextId++;
  def: PartDef;
  cfg: PartCfg;
  st: any = {};
  vis!: PartVisual;
  collider!: RAPIER.Collider;
  link: Link | null = null;
  // transient simulation values
  want = 0; demand = 0; ratio = 1; spin = 0; cur = 0; tick = 0; onNow = false;
  constructor(public type: PartType, public asm: Assembly, public cell: [number, number, number], public dir: number) {
    this.def = PARTS[type];
    this.cfg = defaultCfg(type);
  }
  worldPos(out: THREE.Vector3) { return this.asm.cellWorld(this.cell[0], this.cell[1], this.cell[2], out); }
  worldDir(out: THREE.Vector3, d = this.dir) {
    const q = this.asm.body.rotation();
    return out.set(DIRS[d][0], DIRS[d][1], DIRS[d][2]).applyQuaternion(_q.set(q.x, q.y, q.z, q.w));
  }
}
export interface Link { part: Part; child: Assembly; joint: RAPIER.ImpulseJoint }
export interface Power { supply: number; demand: number; ratio: number; fuel: number }

const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

export class Assembly {
  id = nextId++;
  parts = new Map<string, Part>();
  active: Part[] = [];
  links = new Set<Link>();
  parent: Link | null = null;
  group = new THREE.Group();
  grid = false;        // fixed + aligned to the voxel grid (can merge with neighbours)
  power: Power = { supply: 0, demand: 0, ratio: 1, fuel: 0 };
  constructor(public body: RAPIER.RigidBody) {}
  get anchored() { return this.body.isFixed(); }
  cellWorld(x: number, y: number, z: number, out: THREE.Vector3) {
    const t = this.body.translation(), r = this.body.rotation();
    return out.set(x, y, z).applyQuaternion(_q.set(r.x, r.y, r.z, r.w)).add(_v2.set(t.x, t.y, t.z));
  }
  worldToLocal(p: THREE.Vector3, out: THREE.Vector3) {
    const t = this.body.translation(), r = this.body.rotation();
    return out.copy(p).sub(_v2.set(t.x, t.y, t.z)).applyQuaternion(_q.set(r.x, r.y, r.z, r.w).invert());
  }
  origin(): [number, number, number] { const t = this.body.translation(); return [Math.floor(t.x), Math.floor(t.y), Math.floor(t.z)]; }
  root(): Assembly { let a: Assembly = this; while (a.parent) a = a.parent.part.asm; return a; }
}

export interface PartHit { part: Part; dist: number; point: THREE.Vector3; ndir: number }

export class Mech {
  asms = new Set<Assembly>();
  gridParts = new Map<string, Part>();
  group = new THREE.Group();
  topoVersion = 0;

  // ---------- creation ----------
  createAssembly(pos: { x: number; y: number; z: number }, rot: { x: number; y: number; z: number; w: number }, fixed: boolean, grid = false): Assembly {
    const desc = (fixed ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic())
      .setTranslation(pos.x, pos.y, pos.z).setRotation(rot).setLinearDamping(0.08).setAngularDamping(0.25);
    const a = new Assembly(pw.createRigidBody(desc));
    a.grid = grid && fixed;
    this.asms.add(a); this.group.add(a.group);
    a.group.position.set(pos.x, pos.y, pos.z); a.group.quaternion.set(rot.x, rot.y, rot.z, rot.w);
    this.topoVersion++;
    return a;
  }

  private makeCollider(p: Part) {
    const def = p.def, [x, y, z] = p.cell;
    let d: RAPIER.ColliderDesc;
    if (def.shape === 'ball') d = RAPIER.ColliderDesc.ball(0.72);
    else if (def.shape === 'cyl') {
      d = RAPIER.ColliderDesc.cylinder(0.13, 0.5);
      _q.copy(DIR_QUAT[p.dir]).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
      d.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
    } else if (def.shape === 'rod') {
      d = RAPIER.ColliderDesc.cuboid(0.2, 0.2, 0.495);
      const q = DIR_QUAT[p.dir]; d.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    } else if (p.type === 'conveyor') d = RAPIER.ColliderDesc.cuboid(0.495, 0.39, 0.495);
    else d = RAPIER.ColliderDesc.cuboid(0.495, 0.495, 0.495);
    d.setTranslation(x, p.type === 'conveyor' ? y - 0.105 : y, z).setDensity(def.density).setFriction(def.friction ?? 0.7).setRestitution(0.02).setCollisionGroups(GROUP_PART);
    if (def.shape === 'ball') d.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max);
    p.collider = pw.createCollider(d, p.asm.body);
    owners.set(p.collider.handle, { kind: 'part', ref: p });
  }

  addPart(asm: Assembly, type: PartType, cell: [number, number, number], dir: number, cfg?: Partial<PartCfg>, st?: any): Part {
    const p = new Part(type, asm, [cell[0], cell[1], cell[2]], dir);
    if (cfg) Object.assign(p.cfg, cfg);
    if (st) p.st = st;
    p.vis = makeVisual(type);
    p.vis.root.position.set(cell[0], cell[1], cell[2]);
    p.vis.root.quaternion.copy(DIR_QUAT[dir]);
    asm.group.add(p.vis.root);
    asm.parts.set(ck(cell[0], cell[1], cell[2]), p);
    if (p.def.active) asm.active.push(p);
    this.makeCollider(p);
    if (asm.grid) { const o = asm.origin(); this.gridParts.set(ck(o[0] + cell[0], o[1] + cell[1], o[2] + cell[2]), p); }
    asm.body.wakeUp();
    this.topoVersion++;
    return p;
  }

  /** Build (or extend) the child assembly on a joint part's output face. */
  attachToJoint(jp: Part, type: PartType, dir: number, cfg?: Partial<PartCfg>): Part | null {
    if (jp.link) {
      if (jp.link.child.parts.has('0,0,0')) return null;
      return this.addPart(jp.link.child, type, [0, 0, 0], dir, cfg);
    }
    const f = DIRS[jp.dir];
    const pos = jp.asm.cellWorld(jp.cell[0] + f[0], jp.cell[1] + f[1], jp.cell[2] + f[2], new THREE.Vector3());
    const child = this.createAssembly(pos, jp.asm.body.rotation(), false);
    const lv = jp.asm.body.linvel(); child.body.setLinvel(lv, true);
    const part = this.addPart(child, type, [0, 0, 0], dir, cfg);
    this.makeLink(jp, child);
    return part;
  }

  makeLink(jp: Part, child: Assembly) {
    const f = DIRS[jp.dir];
    const a1 = { x: jp.cell[0] + f[0] * 0.5, y: jp.cell[1] + f[1] * 0.5, z: jp.cell[2] + f[2] * 0.5 };
    const a2 = { x: -f[0] * 0.5, y: -f[1] * 0.5, z: -f[2] * 0.5 };
    const axis = { x: f[0], y: f[1], z: f[2] };
    const data = jp.def.joint === 'prismatic' ? RAPIER.JointData.prismatic(a1, a2, axis) : RAPIER.JointData.revolute(a1, a2, axis);
    const joint = pw.createImpulseJoint(data, jp.asm.body, child.body, true);
    joint.setContactsEnabled(false);
    const j = joint as RAPIER.RevoluteImpulseJoint;
    j.configureMotorModel(RAPIER.MotorModel.ForceBased);
    if (jp.type === 'piston') j.setLimits(0, 3.02);
    if (jp.link) { jp.asm.links.delete(jp.link); }
    const link: Link = { part: jp, child, joint };
    jp.link = link; child.parent = link; jp.asm.links.add(link);
    this.topoVersion++;
    return link;
  }
  private breakLink(link: Link) {
    try { pw.removeImpulseJoint(link.joint, true); } catch { /* already gone */ }
    link.part.link = null; link.part.asm.links.delete(link); link.child.parent = null;
    this.topoVersion++;
  }

  private movePart(p: Part, to: Assembly, cell: [number, number, number]) {
    const from = p.asm;
    from.parts.delete(ck(p.cell[0], p.cell[1], p.cell[2]));
    const ai = from.active.indexOf(p); if (ai >= 0) from.active.splice(ai, 1);
    owners.delete(p.collider.handle); pw.removeCollider(p.collider, true);
    p.asm = to; p.cell = [cell[0], cell[1], cell[2]];
    to.parts.set(ck(cell[0], cell[1], cell[2]), p);
    if (p.def.active) to.active.push(p);
    to.group.add(p.vis.root); p.vis.root.position.set(cell[0], cell[1], cell[2]);
    this.makeCollider(p);
    if (p.link) {
      const child = p.link.child;
      try { pw.removeImpulseJoint(p.link.joint, true); } catch { /* */ }
      from.links.delete(p.link); p.link = null; child.parent = null;
      this.makeLink(p, child);
    }
  }

  private destroyAssembly(a: Assembly) {
    if (a.parent) this.breakLink(a.parent);
    for (const l of [...a.links]) this.breakLink(l);
    pw.removeRigidBody(a.body);
    this.group.remove(a.group);
    this.asms.delete(a);
    this.topoVersion++;
  }

  /** Merge grid assembly b into a (both fixed + voxel aligned). */
  private merge(a: Assembly, b: Assembly) {
    const oa = a.origin(), ob = b.origin();
    const d: [number, number, number] = [ob[0] - oa[0], ob[1] - oa[1], ob[2] - oa[2]];
    for (const p of [...b.parts.values()]) {
      const wc = ck(ob[0] + p.cell[0], ob[1] + p.cell[1], ob[2] + p.cell[2]);
      this.movePart(p, a, [p.cell[0] + d[0], p.cell[1] + d[1], p.cell[2] + d[2]]);
      this.gridParts.set(wc, p);
    }
    this.destroyAssembly(b);
  }

  /** After adding a part to a grid assembly, fuse with touching grid assemblies. */
  private mergeAround(p: Part) {
    const a = p.asm; if (!a.grid) return;
    const o = a.origin();
    for (const f of DIRS) {
      const n = this.gridParts.get(ck(o[0] + p.cell[0] + f[0], o[1] + p.cell[1] + f[1], o[2] + p.cell[2] + f[2]));
      if (n && n.asm !== a && n.asm.grid) this.merge(a, n.asm);
    }
  }

  /** Place a part into a free voxel-grid cell (new or adjacent fixed assembly). */
  placeOnGrid(wx: number, wy: number, wz: number, type: PartType, dir: number, cfg?: Partial<PartCfg>): Part | null {
    if (this.gridParts.has(ck(wx, wy, wz))) return null;
    let host: Assembly | null = null;
    for (const f of DIRS) {
      const n = this.gridParts.get(ck(wx + f[0], wy + f[1], wz + f[2]));
      if (n && n.asm.grid) { host = n.asm; break; }
    }
    if (!host) host = this.createAssembly({ x: wx + 0.5, y: wy + 0.5, z: wz + 0.5 }, { x: 0, y: 0, z: 0, w: 1 }, true, true);
    const o = host.origin();
    const p = this.addPart(host, type, [wx - o[0], wy - o[1], wz - o[2]], dir, cfg);
    this.mergeAround(p);
    return p;
  }

  /** Place a part in an assembly's local cell. */
  placeInAssembly(asm: Assembly, cell: [number, number, number], type: PartType, dir: number, cfg?: Partial<PartCfg>): Part | null {
    if (asm.parts.has(ck(cell[0], cell[1], cell[2]))) return null;
    if (asm.grid) { const o = asm.origin(); return this.placeOnGrid(o[0] + cell[0], o[1] + cell[1], o[2] + cell[2], type, dir, cfg); }
    return this.addPart(asm, type, cell, dir, cfg);
  }

  // ---------- removal ----------
  removePart(p: Part) {
    const a = p.asm;
    if (p.link) { const child = p.link.child; this.breakLink(p.link); child.body.wakeUp(); }
    const wasOrigin = !!a.parent && p.cell[0] === 0 && p.cell[1] === 0 && p.cell[2] === 0;
    a.parts.delete(ck(p.cell[0], p.cell[1], p.cell[2]));
    const ai = a.active.indexOf(p); if (ai >= 0) a.active.splice(ai, 1);
    if (a.grid) { const o = a.origin(); this.gridParts.delete(ck(o[0] + p.cell[0], o[1] + p.cell[1], o[2] + p.cell[2])); }
    owners.delete(p.collider.handle); pw.removeCollider(p.collider, true);
    a.group.remove(p.vis.root);
    if (p.vis.lampMat) p.vis.lampMat.dispose();
    if (ctx.drive.seat === p) ctx.player.leaveSeat();
    this.topoVersion++;
    if (wasOrigin && a.parent) this.breakLink(a.parent);
    if (a.parts.size === 0) { this.destroyAssembly(a); return; }
    // Split into connected components
    const seen = new Set<Part>();
    const comps: Part[][] = [];
    for (const start of a.parts.values()) {
      if (seen.has(start)) continue;
      const comp: Part[] = [], stack = [start]; seen.add(start);
      while (stack.length) {
        const q = stack.pop()!; comp.push(q);
        for (const f of DIRS) {
          const n = a.parts.get(ck(q.cell[0] + f[0], q.cell[1] + f[1], q.cell[2] + f[2]));
          if (n && !seen.has(n)) { seen.add(n); stack.push(n); }
        }
      }
      comps.push(comp);
    }
    if (comps.length < 2) { a.body.wakeUp(); return; }
    // Keep the component holding the joint origin (or the biggest) on the original body.
    let keep = comps.findIndex(c => a.parent && c.some(q => q.cell[0] === 0 && q.cell[1] === 0 && q.cell[2] === 0));
    if (keep < 0) keep = comps.reduce((bi, c, i) => (c.length > comps[bi].length ? i : bi), 0);
    const lv = a.body.linvel(), av = a.body.angvel();
    comps.forEach((comp, i) => {
      if (i === keep) return;
      const na = this.createAssembly(a.body.translation(), a.body.rotation(), a.anchored, a.grid);
      if (!na.anchored) { na.body.setLinvel(lv, true); na.body.setAngvel(av, true); }
      for (const q of comp) this.movePart(q, na, q.cell);
    });
    a.body.wakeUp();
  }

  // ---------- contraptions ----------
  /** All assemblies reachable from a root through joints. */
  members(root: Assembly, out: Assembly[] = []): Assembly[] {
    out.push(root);
    for (const l of root.links) this.members(l.child, out);
    return out;
  }
  setAnchored(any: Assembly, anchored: boolean) {
    const root = any.root();
    if (anchored === root.anchored) return;
    if (!anchored) {
      if (root.grid) { const o = root.origin(); for (const p of root.parts.values()) this.gridParts.delete(ck(o[0] + p.cell[0], o[1] + p.cell[1], o[2] + p.cell[2])); }
      root.grid = false;
      root.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    } else {
      root.body.setLinvel({ x: 0, y: 0, z: 0 }, false); root.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
      root.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
    }
    for (const m of this.members(root)) m.body.wakeUp();
    this.topoVersion++;
  }

  // ---------- queries ----------
  raycast(o: THREE.Vector3, d: THREE.Vector3, max: number, exclude?: RAPIER.RigidBody): PartHit | null {
    const hit = pw.castRayAndGetNormal(new RAPIER.Ray(o, d), max, true, undefined, Q_PARTS, undefined, exclude);
    if (!hit) return null;
    const ow = owners.get(hit.collider.handle);
    if (!ow || ow.kind !== 'part') return null;
    const part = ow.ref as Part;
    const point = new THREE.Vector3().copy(o).addScaledVector(d, hit.timeOfImpact);
    let ndir: number;
    if (part.def.shape === 'box') {
      const r = part.asm.body.rotation();
      _v.set(hit.normal.x, hit.normal.y, hit.normal.z).applyQuaternion(_q.set(r.x, r.y, r.z, r.w).invert());
      ndir = dirFromVec(_v.x, _v.y, _v.z);
    } else {
      part.asm.worldToLocal(point, _v);
      ndir = dirFromVec(_v.x - part.cell[0], _v.y - part.cell[1], _v.z - part.cell[2]);
    }
    return { part, dist: hit.timeOfImpact, point, ndir };
  }

  sync() {
    for (const a of this.asms) {
      const t = a.body.translation(), r = a.body.rotation();
      a.group.position.set(t.x, t.y, t.z); a.group.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  clear() {
    for (const a of [...this.asms]) {
      for (const p of a.parts.values()) owners.delete(p.collider.handle);
      for (const l of [...a.links]) { try { pw.removeImpulseJoint(l.joint, false); } catch { /* */ } }
      a.links.clear(); a.parent = null;
    }
    for (const a of this.asms) { pw.removeRigidBody(a.body); this.group.remove(a.group); }
    this.asms.clear(); this.gridParts.clear(); this.topoVersion++;
  }

  // ---------- persistence ----------
  serialize() {
    const out: any[] = [];
    for (const a of this.asms) {
      const t = a.body.translation(), r = a.body.rotation();
      const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
      out.push({
        id: a.id, p: [r4(t.x), r4(t.y), r4(t.z)], q: [r4(r.x), r4(r.y), r4(r.z), r4(r.w)],
        fx: a.anchored ? 1 : 0, g: a.grid ? 1 : 0, par: a.parent ? a.parent.part.id : 0,
        parts: [...a.parts.values()].map(p => ({ id: p.id, t: p.type, c: p.cell, d: p.dir, cfg: p.cfg, st: p.st })),
      });
    }
    return out;
  }
  deserialize(data: any[]) {
    const byId = new Map<number, Part>();
    const pending: [Assembly, number][] = [];
    for (const s of data) {
      if (!s.parts || !s.parts.length) continue;
      const a = this.createAssembly({ x: s.p[0], y: s.p[1], z: s.p[2] }, { x: s.q[0], y: s.q[1], z: s.q[2], w: s.q[3] }, !!s.fx, !!s.g);
      for (const ps of s.parts) {
        if (!PARTS[ps.t as PartType]) continue;
        const p = this.addPart(a, ps.t, ps.c, ps.d, ps.cfg, ps.st || {});
        byId.set(ps.id, p);
      }
      if (s.par) pending.push([a, s.par]);
    }
    for (const [child, pid] of pending) {
      const jp = byId.get(pid);
      if (jp && jp.def.joint && !jp.link) this.makeLink(jp, child);
    }
  }
}
