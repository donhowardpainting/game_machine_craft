// Targeting, placing, mining, removing and interacting.
import * as THREE from 'three';
import { ctx, give, has, take } from './ctx';
import { input } from './input';
import { B, BLOCKS, ITEMS, ItemId } from '../world/blocks';
import { Assembly, Part, PartHit, ck } from '../mech/assembly';
import { DIRS, DIR_QUAT, PARTS, PartType, dirFromVec, ghostBadMat, ghostMat, partGeo } from '../mech/parts';
import type { VoxelHit } from '../world/world';

export type Entry = { kind: 'block'; item: ItemId } | { kind: 'part'; type: PartType };
type Plan =
  | { mode: 'voxel'; x: number; y: number; z: number; ok: boolean }
  | { mode: 'grid'; x: number; y: number; z: number; dir: number; ok: boolean }
  | { mode: 'asm'; asm: Assembly; cell: [number, number, number]; dir: number; ok: boolean }
  | { mode: 'joint'; part: Part; dir: number; ok: boolean };

const REACH = 6.5;
const o = new THREE.Vector3(), d = new THREE.Vector3(), v = new THREE.Vector3(), q = new THREE.Quaternion();
const yawQ = [0, 1, 2, 3].map(i => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * Math.PI / 2));

export class Builder {
  vox: VoxelHit | null = null;
  ph: PartHit | null = null;
  plan: Plan | null = null;
  rot = 0;
  mineProg = 0;
  private mineKey = '';
  private cool = 0;
  ghost: THREE.Mesh<THREE.BufferGeometry, THREE.Material> = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), ghostMat);
  private boxGeo = new THREE.BoxGeometry(1.0, 1.0, 1.0);
  outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.01, 1.01, 1.01)), new THREE.LineBasicMaterial({ color: 0x10131a, transparent: true, opacity: 0.75 }));
  crack = new THREE.Mesh(new THREE.BoxGeometry(1.012, 1.012, 1.012), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
  arrow = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.42, 10).rotateX(Math.PI / 2).translate(0, 0, 0.72), new THREE.MeshBasicMaterial({ color: 0xffd24a, depthTest: false, transparent: true, opacity: 0.95 }));

  constructor() {
    this.ghost.visible = this.outline.visible = this.arrow.visible = false;
    this.ghost.renderOrder = 4; this.arrow.renderOrder = 6;
    this.ghost.add(this.arrow);
    ctx.scene.add(this.ghost, this.outline, this.crack);
  }

  private partDir(type: PartType, normalDir: number, frame: { x: number; y: number; z: number; w: number } | null): number {
    const or = PARTS[type].orient;
    if (or === 'none') return 4;
    if (or === 'face') { const r = this.rot % 7; return r === 0 ? normalDir : r - 1; }
    v.copy(d);
    if (frame) v.applyQuaternion(q.set(frame.x, frame.y, frame.z, frame.w).invert());
    v.y = 0;
    if (v.lengthSq() < 1e-4) v.set(0, 0, 1);
    v.applyQuaternion(yawQ[this.rot % 4]);
    return dirFromVec(v.x, 0, v.z);
  }

  private computePlan(sel: Entry | null): Plan | null {
    if (!sel) return null;
    const useVox = this.vox && (!this.ph || this.vox.dist < this.ph.dist);
    const m = ctx.mech;
    if (useVox) {
      const h = this.vox!;
      const x = h.x + h.nx, y = h.y + h.ny, z = h.z + h.nz;
      const free = !m.gridParts.has(ck(x, y, z)) && y > 0 && y < 63;
      if (sel.kind === 'block') return { mode: 'voxel', x, y, z, ok: free && !ctx.player.overlapsVoxel(x, y, z) };
      return { mode: 'grid', x, y, z, dir: this.partDir(sel.type, dirFromVec(h.nx, h.ny, h.nz), null), ok: free };
    }
    if (!this.ph) return null;
    const P = this.ph.part, nd = this.ph.ndir, a = P.asm;
    if (sel.kind === 'block') {
      if (!a.grid) return null;
      const og = a.origin(), f = DIRS[nd];
      const x = og[0] + P.cell[0] + f[0], y = og[1] + P.cell[1] + f[1], z = og[2] + P.cell[2] + f[2];
      return { mode: 'voxel', x, y, z, ok: ctx.world.getBlock(x, y, z) === B.Air && !m.gridParts.has(ck(x, y, z)) && !ctx.player.overlapsVoxel(x, y, z) };
    }
    if (P.def.joint && nd === P.dir) {
      const frame = P.link ? P.link.child.body.rotation() : a.body.rotation();
      const ok = !P.link || !P.link.child.parts.has('0,0,0');
      return { mode: 'joint', part: P, dir: this.partDir(sel.type, nd, frame), ok };
    }
    const f = DIRS[nd];
    const cell: [number, number, number] = [P.cell[0] + f[0], P.cell[1] + f[1], P.cell[2] + f[2]];
    let ok = !a.parts.has(ck(cell[0], cell[1], cell[2]));
    const dir = this.partDir(sel.type, nd, a.body.rotation());
    if (a.grid) {
      const og = a.origin();
      const x = og[0] + cell[0], y = og[1] + cell[1], z = og[2] + cell[2];
      ok = ok && ctx.world.getBlock(x, y, z) === B.Air && !m.gridParts.has(ck(x, y, z));
      return { mode: 'grid', x, y, z, dir, ok };
    }
    return { mode: 'asm', asm: a, cell, dir, ok };
  }

  private affordable(sel: Entry): string | null {
    if (ctx.mode === 'creative') return null;
    if (sel.kind === 'block') return has(sel.item, 1) ? null : `Out of ${ITEMS[sel.item].name}`;
    const cost = PARTS[sel.type].cost;
    for (const k in cost) if (!has(k as ItemId, cost[k as ItemId]!)) return `Need ${cost[k as ItemId]} ${ITEMS[k as ItemId].name}`;
    return null;
  }

  private place(sel: Entry) {
    const p = this.plan;
    if (!p || !p.ok) { if (p) ctx.sfx('error', 0.4); return; }
    const why = this.affordable(sel);
    if (why) { ctx.ui.toast(why, 'warn'); ctx.sfx('error', 0.4); return; }
    if (p.mode === 'voxel' && sel.kind === 'block') {
      const id = ITEMS[sel.item].block!;
      ctx.world.setBlock(p.x, p.y, p.z, id);
      take(sel.item, 1);
      ctx.fx.burst(p.x + 0.5, p.y + 0.5, p.z + 0.5, BLOCKS[id].side, 5, 1.4, 0.3, 0.08);
      ctx.sfx('place');
      return;
    }
    if (sel.kind !== 'part') return;
    const m = ctx.mech;
    let part: Part | null = null;
    if (p.mode === 'grid') part = m.placeOnGrid(p.x, p.y, p.z, sel.type, p.dir);
    else if (p.mode === 'asm') part = m.placeInAssembly(p.asm, p.cell, sel.type, p.dir);
    else if (p.mode === 'joint') part = m.attachToJoint(p.part, sel.type, p.dir);
    if (!part) { ctx.sfx('error', 0.4); return; }
    const cost = PARTS[sel.type].cost;
    for (const k in cost) take(k as ItemId, cost[k as ItemId]!);
    ctx.stats.placed++;
    part.worldPos(v);
    ctx.fx.burst(v.x, v.y, v.z, 0xffe9b0, 8, 1.8, 0.35, 0.08);
    ctx.sfx('place');
  }

  removePart(p: Part) {
    const cost = p.def.cost;
    if (ctx.mode !== 'creative') {
      for (const k in cost) give(k as ItemId, cost[k as ItemId]!);
      if (p.st.store) for (const k in p.st.store) give(k as ItemId, p.st.store[k]);
      if (p.st.n > 0 && p.st.it) give(p.st.it, p.st.n);
    }
    p.worldPos(v);
    ctx.fx.burst(v.x, v.y, v.z, 0xc9b28a, 10, 2.4, 0.45, 0.1);
    ctx.mech.removePart(p);
    ctx.sfx('break', 0.6);
  }

  private mine(dt: number) {
    const h = this.vox!;
    const def = BLOCKS[h.id];
    const key = h.x + ',' + h.y + ',' + h.z;
    if (key !== this.mineKey) { this.mineKey = key; this.mineProg = 0; }
    if (!isFinite(def.hardness)) return;
    if (ctx.mode === 'creative') { if (this.cool > 0) return; this.mineProg = 1; this.cool = 0.16; }
    else this.mineProg += dt / def.hardness;
    if (Math.random() < dt * 14) ctx.fx.emit(h.x + 0.5 + h.nx * 0.52 + (Math.random() - 0.5) * 0.5, h.y + 0.5 + h.ny * 0.52 + (Math.random() - 0.5) * 0.5, h.z + 0.5 + h.nz * 0.52 + (Math.random() - 0.5) * 0.5, h.nx * 1.5, 1.5, h.nz * 1.5, def.side, 0.45, 0.08);
    if (this.mineProg >= 1) {
      this.mineProg = 0;
      if (def.drop && ctx.mode !== 'creative') give(def.drop, 1);
      if (!def.vein || ctx.mode === 'creative') ctx.world.setBlock(h.x, h.y, h.z, B.Air);
      ctx.fx.burst(h.x + 0.5, h.y + 0.5, h.z + 0.5, def.side, 14, 3, 0.55, 0.11);
      if (def.speck !== undefined) ctx.fx.burst(h.x + 0.5, h.y + 0.5, h.z + 0.5, def.speck, 6, 3, 0.6, 0.09);
      ctx.sfx('break');
    } else if (Math.random() < dt * 5) ctx.sfx('tick', 0.25);
  }

  update(dt: number, sel: Entry | null) {
    this.cool -= dt;
    const pl = ctx.player;
    this.vox = null; this.ph = null; this.plan = null;
    this.ghost.visible = this.outline.visible = false;
    (this.crack.material as THREE.MeshBasicMaterial).opacity = 0;
    if (!input.enabled()) return;
    if (input.pressed.has('rotate')) { this.rot++; ctx.sfx('click', 0.4); }

    if (pl.seat) {
      if (input.pressed.has('use')) pl.leaveSeat();
      return;
    }
    ctx.camera.getWorldPosition(o); ctx.camera.getWorldDirection(d);
    this.vox = ctx.world.raycast(o, d, REACH);
    this.ph = ctx.mech.raycast(o, d, REACH);
    const partFirst = this.ph && (!this.vox || this.ph.dist <= this.vox.dist);
    if (partFirst) this.vox = null; else this.ph = null;
    this.plan = this.computePlan(sel);

    // ---- outline on the thing we point at ----
    if (this.ph) {
      const P = this.ph.part;
      P.worldPos(this.outline.position);
      const r = P.asm.body.rotation(); this.outline.quaternion.set(r.x, r.y, r.z, r.w);
      this.outline.visible = true;
    } else if (this.vox) {
      this.outline.position.set(this.vox.x + 0.5, this.vox.y + 0.5, this.vox.z + 0.5);
      this.outline.quaternion.identity(); this.outline.visible = true;
    }
    // ---- ghost preview ----
    const p = this.plan;
    if (p && sel) {
      const g = this.ghost;
      g.visible = true; g.material = p.ok ? ghostMat : ghostBadMat;
      g.geometry = sel.kind === 'part' ? partGeo(sel.type).fixed : this.boxGeo;
      this.arrow.visible = sel.kind === 'part' && PARTS[sel.type].orient !== 'none';
      g.scale.setScalar(sel.kind === 'part' ? 1.0 : 0.98);
      if (p.mode === 'voxel') { g.position.set(p.x + 0.5, p.y + 0.5, p.z + 0.5); g.quaternion.identity(); }
      else if (p.mode === 'grid') { g.position.set(p.x + 0.5, p.y + 0.5, p.z + 0.5); g.quaternion.copy(DIR_QUAT[p.dir]); }
      else if (p.mode === 'asm') {
        p.asm.cellWorld(p.cell[0], p.cell[1], p.cell[2], g.position);
        const r = p.asm.body.rotation(); g.quaternion.set(r.x, r.y, r.z, r.w).multiply(DIR_QUAT[p.dir]);
      } else {
        const jp = p.part, f = DIRS[jp.dir];
        const host = jp.link ? jp.link.child : jp.asm;
        if (jp.link) host.cellWorld(0, 0, 0, g.position); else host.cellWorld(jp.cell[0] + f[0], jp.cell[1] + f[1], jp.cell[2] + f[2], g.position);
        const r = host.body.rotation(); g.quaternion.set(r.x, r.y, r.z, r.w).multiply(DIR_QUAT[p.dir]);
      }
    }

    // ---- actions ----
    if (input.pressed.has('place') && sel) this.place(sel);
    if (input.pressed.has('pickBlock')) {
      if (this.ph) ctx.ui.assign({ kind: 'part', type: this.ph.part.type });
      else if (this.vox) { const dr = BLOCKS[this.vox.id].drop; if (dr && ITEMS[dr].block) ctx.ui.assign({ kind: 'block', item: dr }); }
    }
    if (this.ph) {
      const P = this.ph.part;
      if (input.pressed.has('break')) { this.removePart(P); input.breakHeld = false; }
      else if (input.pressed.has('use')) this.use(P);
      else if (input.pressed.has('config')) ctx.ui.openPart(P, true);
      else if (input.pressed.has('anchor')) this.toggleAnchor(P);
      this.mineProg = 0; this.mineKey = '';
    } else if (this.vox && input.breakHeld) {
      this.mine(dt);
      if (this.mineProg > 0) {
        this.crack.position.set(this.vox.x + 0.5, this.vox.y + 0.5, this.vox.z + 0.5);
        (this.crack.material as THREE.MeshBasicMaterial).opacity = this.mineProg * 0.42;
      }
    } else { this.mineProg = 0; }
  }

  toggleAnchor(P: Part) {
    const root = P.asm.root();
    ctx.mech.setAnchored(root, !root.anchored);
    ctx.ui.toast(root.anchored ? 'Anchored in place' : 'Released - it is free to move', 'info');
    ctx.sfx('click');
  }

  use(P: Part) {
    switch (P.type) {
      case 'seat': ctx.player.sit(P); break;
      case 'switch': P.st.on = !P.st.on; ctx.sfx('click'); break;
      default: ctx.ui.openPart(P, false);
    }
  }

  /** Short description of what the crosshair is on, for the HUD. */
  describe(): { title: string; hint: string } | null {
    const t = input.touch;
    if (this.ph) {
      const P = this.ph.part;
      const act = P.type === 'seat' ? 'Sit' : P.type === 'switch' ? 'Flip' : 'Open';
      return { title: P.def.name, hint: t ? `${act} with ✋ · settings with ⚙` : `[E] ${act} · [Q] Settings · [G] Anchor/Release` };
    }
    if (this.vox) return { title: BLOCKS[this.vox.id].name, hint: '' };
    return null;
  }
}
