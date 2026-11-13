// The short progression: gather -> power -> drill -> drive -> automate ->
// fabricate -> the Skyring trial. Each step unlocks a tier of parts.
import { ctx, give } from './ctx';
import { PARTS, PART_TYPES } from '../mech/parts';

export interface Goal { label: string; cur: number; max: number }
interface Quest { title: string; text: string; goals: () => Goal[]; reward: string; onDone?: () => void; tierAfter: number }

const g = (label: string, cur: number, max: number): Goal => ({ label, cur: Math.min(cur, max), max });

export const QUESTS: Quest[] = [
  {
    title: 'Forage', text: 'Hold to mine. Chop a tree and dig some stone - everything starts with raw material.',
    goals: () => [g('Wood', ctx.inv.wood || 0, 8), g('Stone', ctx.inv.stone || 0, 12)],
    reward: '+6 coal', onDone: () => give('coal', 6), tierAfter: 0,
  },
  {
    title: 'First Spark', text: 'Place a Generator and a Smelter touching each other. Open the generator to add fuel, then feed the smelter iron ore from the rust-coloured vein.',
    goals: () => [g('Ingots smelted', ctx.stats.smelted, 4)],
    reward: 'Drill, Conveyor, Switch, Iron Block', tierAfter: 1,
  },
  {
    title: 'Let the Machine Dig', text: 'Bolt a Drill onto your powered machine. It bores into whatever sits in front of its bit - endless veins never run dry.',
    goals: () => [g('Blocks drilled', ctx.stats.drilled, 10)],
    reward: 'Motor, Wheel, Bearing, Seat, Axle + a tutorial rover', tierAfter: 2,
    onDone: () => { ctx.quests.rovers++; ctx.ui.toast('A tutorial rover is waiting: PARTS > Guide > Deliver rover', 'good'); },
  },
  {
    title: 'Take the Wheel', text: 'Deliver the tutorial rover from the Guide tab, sit in it and drive. Then pull it apart - or build your own from frames, motors and wheels.',
    goals: () => [g('Metres driven', Math.floor(ctx.stats.driven), 80)],
    reward: '+10 iron, +6 copper ingots', onDone: () => { give('iron', 10); give('copper', 6); }, tierAfter: 2,
  },
  {
    title: 'Assembly Line', text: 'Chain it up: a Smelter drops ingots on a Conveyor that carries them into a Storage Crate. Only machine-made, belt-carried items count.',
    goals: () => [g('Items delivered', ctx.stats.delivered, 8)],
    reward: 'Fabricator, Hinge, Piston, Cogwheel, Lamp', tierAfter: 3,
  },
  {
    title: 'Fine Mechanics', text: 'Build a Fabricator and turn ingots into cogs and wire. Pistons and hinges need them.',
    goals: () => [g('Batches fabricated', ctx.stats.crafted, 4)],
    reward: 'Sensor, Timer, Solar Panel, Thruster', tierAfter: 4,
  },
  {
    title: 'The Skyring Trial', text: 'A golden ring floats nearby. Send 5 items through it. Hand-dropped items do not count - invent a machine that throws, lifts or carries them.',
    goals: () => [g('Items through the ring', ctx.stats.ring, 5)],
    reward: 'Master Machinist - free parts forever', tierAfter: 4,
    onDone: () => { ctx.quests.master = true; },
  },
];

export class Quests {
  index = 0;
  rovers = 0;
  master = false;
  private timer = 0;
  get tier() { return ctx.mode === 'creative' ? 99 : this.index === 0 ? 0 : QUESTS[Math.min(this.index, QUESTS.length) - 1].tierAfter; }
  get current() { return this.index < QUESTS.length ? QUESTS[this.index] : null; }
  unlocked(tier: number) { return tier <= this.tier; }

  update(dt: number) {
    if (ctx.mode === 'creative') return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.4;
    const q = this.current;
    if (!q) return;
    if (q.goals().every(x => x.cur >= x.max)) {
      const before = this.tier;
      this.index++;
      q.onDone?.();
      ctx.ui.toast(`${q.title} complete - ${q.reward}`, 'big');
      ctx.sfx('quest');
      const now = this.tier;
      if (now > before) {
        const names = PART_TYPES.filter(t => PARTS[t].tier > before && PARTS[t].tier <= now).map(t => PARTS[t].name);
        if (names.length) ctx.ui.toast('New parts: ' + names.join(', '), 'good');
      }
      ctx.ui.invDirty = true;
    }
  }
}
