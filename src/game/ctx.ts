// Shared game context. Modules reach each other through this object so that
// construction order (and import cycles) stay simple.
import type * as THREE from 'three';
import type { World } from '../world/world';
import type { Sky } from '../render/sky';
import type { Particles } from '../render/particles';
import type { Mech, Part } from '../mech/assembly';
import type { Items } from '../mech/items';
import type { Player } from './player';
import type { UI } from '../ui/ui';
import type { Quests } from './quests';
import type { ItemId } from '../world/blocks';

export interface Stats {
  smelted: number; drilled: number; delivered: number; driven: number; ring: number; crafted: number; placed: number;
}
export const newStats = (): Stats => ({ smelted: 0, drilled: 0, delivered: 0, driven: 0, ring: 0, crafted: 0, placed: 0 });

export const ctx = {
  scene: null! as THREE.Scene,
  camera: null! as THREE.PerspectiveCamera,
  world: null! as World,
  sky: null! as Sky,
  fx: null! as Particles,
  mech: null! as Mech,
  items: null! as Items,
  player: null! as Player,
  ui: null! as UI,
  quests: null! as Quests,
  mode: 'survival' as 'survival' | 'creative',
  inv: {} as Partial<Record<ItemId, number>>,
  stats: newStats(),
  /** live channel state (R,G,B,Y) and the manual latches set from a seat / HUD */
  channels: [false, false, false, false],
  manual: [false, false, false, false],
  drive: { seat: null as Part | null, throttle: 0, steer: 0, boost: false },
  now: 0,
  mobile: false,
  sfx: (_name: string, _vol = 1) => {},
};

export const free = () => ctx.mode === 'creative' || !!(ctx.quests && ctx.quests.master);
export function has(item: ItemId, n: number) { return free() || (ctx.inv[item] || 0) >= n; }
export function give(item: ItemId, n: number) {
  ctx.inv[item] = (ctx.inv[item] || 0) + n;
  if (ctx.ui) ctx.ui.invDirty = true;
}
export function take(item: ItemId, n: number): boolean {
  if (free()) return true;
  if ((ctx.inv[item] || 0) < n) return false;
  ctx.inv[item]! -= n;
  if (ctx.ui) ctx.ui.invDirty = true;
  return true;
}
