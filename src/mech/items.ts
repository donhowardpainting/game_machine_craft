// Loose, physical resource items. They ride conveyors, get eaten by
// processors and crates, and can be picked up by walking over them.
import * as THREE from 'three';
import { pw, RAPIER, owners, GROUP_ITEM } from '../game/phys';
import { ctx, give } from '../game/ctx';
import { ITEMS, ItemId } from '../world/blocks';
import { itemGeo, partMat } from './parts';
import { ringPos } from '../world/gen';

export class Item {
  age = 0; beltT = -10; machine = false; conveyed = false; hand = false; counted = false; dead = false;
  px = 0;
  constructor(public type: ItemId, public body: RAPIER.RigidBody, public mesh: THREE.Mesh) {}
}
const MAX_ITEMS = 350;

export class Items {
  list: Item[] = [];
  group = new THREE.Group();

  spawn(type: ItemId, x: number, y: number, z: number, vx = 0, vy = 0, vz = 0, flags: Partial<Item> = {}): Item {
    if (this.list.length >= MAX_ITEMS) this.remove(this.list[0]);
    const body = pw.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setLinvel(vx, vy, vz)
      .setLinearDamping(0.3).setAngularDamping(1.2).setCcdEnabled(false));
    const col = pw.createCollider(RAPIER.ColliderDesc.cuboid(0.14, 0.12, 0.14).setDensity(1.2).setFriction(0.8).setRestitution(0.05).setCollisionGroups(GROUP_ITEM), body);
    const def = ITEMS[type];
    const mesh = new THREE.Mesh(itemGeo(def.shape, def.color), partMat);
    mesh.castShadow = true;
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    const it = new Item(type, body, mesh);
    Object.assign(it, flags);
    it.px = x;
    owners.set(col.handle, { kind: 'item', ref: it });
    this.list.push(it);
    return it;
  }
  remove(it: Item) {
    if (it.dead) return;
    it.dead = true;
    const c = it.body.collider(0);
    if (c) owners.delete(c.handle);
    pw.removeRigidBody(it.body);
    this.group.remove(it.mesh);
    const i = this.list.indexOf(it);
    if (i >= 0) this.list.splice(i, 1);
  }
  clear() { for (const it of [...this.list]) this.remove(it); }

  update(dt: number) {
    const pl = ctx.player;
    const ring = ringPos();
    for (let i = this.list.length - 1; i >= 0; i--) {
      const it = this.list[i];
      it.age += dt;
      const t = it.body.translation(), r = it.body.rotation();
      it.mesh.position.set(t.x, t.y, t.z); it.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      if (t.y < -20 || it.age > 900) { this.remove(it); continue; }
      const far = Math.abs(t.x - pl.pos.x) + Math.abs(t.z - pl.pos.z) > 150;
      if (far) { it.body.sleep(); continue; }
      if (!it.body.isSleeping()) ctx.world.requestCollider(t.x, t.z);
      // Skyring trial: cross the ring plane inside its radius
      if (!it.counted && (it.px - ring.x) * (t.x - ring.x) < 0) {
        const dy = t.y - ring.y, dz = t.z - ring.z;
        if (dy * dy + dz * dz < ring.r * ring.r) {
          const v = it.body.linvel();
          const fast = v.x * v.x + v.y * v.y + v.z * v.z > 16;
          if (!it.hand || fast) {
            it.counted = true; ctx.stats.ring++;
            ctx.fx.burst(t.x, t.y, t.z, 0xffe27a, 26, 5, 1.1, 0.2); ctx.sfx('ring');
          }
        }
      }
      it.px = t.x;
      // Pickup
      if (!pl.seat && it.age > 0.7 && ctx.now - it.beltT > 0.6) {
        const dx = t.x - pl.pos.x, dy = t.y - (pl.pos.y + 0.8), dz = t.z - pl.pos.z;
        if (dx * dx + dz * dz < 1.7 && dy * dy < 1.8) {
          give(it.type, 1); ctx.sfx('pick', 0.5);
          ctx.fx.burst(t.x, t.y, t.z, ITEMS[it.type].color, 4, 1.5, 0.3, 0.07);
          this.remove(it);
        }
      }
    }
  }

  serialize() {
    return this.list.slice(-200).map(it => { const t = it.body.translation(); return [it.type, +t.x.toFixed(2), +t.y.toFixed(2), +t.z.toFixed(2), it.machine ? 1 : 0, it.conveyed ? 1 : 0]; });
  }
  deserialize(data: any[]) {
    for (const d of data) if (ITEMS[d[0] as ItemId]) this.spawn(d[0], d[1], d[2], d[3], 0, 0, 0, { machine: !!d[4], conveyed: !!d[5] });
  }
}
