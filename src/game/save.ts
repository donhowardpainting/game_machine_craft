// Local save / load (localStorage, one slot).
import { ctx, newStats } from './ctx';
import { getSeed } from '../world/gen';

const KEY = 'machinecraft.save.v1';

export function hasSave(): boolean { try { return !!localStorage.getItem(KEY); } catch { return false; } }
export function clearSave() { try { localStorage.removeItem(KEY); } catch { /* */ } }

export function saveGame(): boolean {
  const edits: Record<string, number[]> = {};
  for (const [k, m] of ctx.world.edits) { const a: number[] = []; for (const [i, id] of m) a.push(i, id); edits[k] = a; }
  const pl = ctx.player;
  if (pl.seat) pl.leaveSeat();
  const data = {
    v: 1, seed: getSeed(), mode: ctx.mode, time: ctx.sky.time, now: ctx.now,
    player: { p: [pl.pos.x, pl.pos.y, pl.pos.z], yaw: pl.yaw, pitch: pl.pitch, fly: pl.flying },
    inv: ctx.inv, stats: ctx.stats, quest: { i: ctx.quests.index, rovers: ctx.quests.rovers, master: ctx.quests.master },
    hotbar: ctx.ui.hotbar, sel: ctx.ui.sel, manual: ctx.manual,
    edits, mech: ctx.mech.serialize(), items: ctx.items.serialize(),
  };
  try { localStorage.setItem(KEY, JSON.stringify(data)); return true; } catch { return false; }
}

export function readSave(): any | null {
  try { const s = localStorage.getItem(KEY); if (!s) return null; const d = JSON.parse(s); return d && d.v === 1 ? d : null; } catch { return null; }
}

/** Apply a parsed save. The world must already be reset with the save's seed. */
export function applySave(d: any) {
  ctx.mode = d.mode === 'creative' ? 'creative' : 'survival';
  ctx.inv = d.inv || {};
  ctx.stats = { ...newStats(), ...(d.stats || {}) };
  ctx.sky.time = d.time ?? 0.3;
  ctx.now = d.now || 0;
  ctx.quests.index = d.quest?.i || 0; ctx.quests.rovers = d.quest?.rovers || 0; ctx.quests.master = !!d.quest?.master;
  for (const k in d.edits || {}) {
    const a: number[] = d.edits[k], m = new Map<number, number>();
    for (let i = 0; i < a.length; i += 2) m.set(a[i], a[i + 1]);
    ctx.world.edits.set(+k, m);
  }
  const pl = ctx.player;
  pl.pos.set(d.player.p[0], d.player.p[1] + 0.05, d.player.p[2]); pl.yaw = d.player.yaw; pl.pitch = d.player.pitch; pl.flying = !!d.player.fly && ctx.mode === 'creative';
  pl.vel.set(0, 0, 0);
  ctx.mech.deserialize(d.mech || []);
  ctx.items.deserialize(d.items || []);
  ctx.ui.hotbar = (d.hotbar || []).concat(new Array(9).fill(null)).slice(0, 9);
  for (let i = 0; i < 4; i++) ctx.manual[i] = !!(d.manual && d.manual[i]);
  ctx.ui.select(d.sel || 0);
}
