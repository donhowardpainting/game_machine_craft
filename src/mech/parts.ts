// Part catalogue: what each mechanical component is, what it costs, how it
// collides and what it looks like (procedural, vertex-coloured geometry).
import * as THREE from 'three';
import type { ItemId } from '../world/blocks';

export type PartType =
  | 'frame' | 'plate' | 'axle' | 'wheel' | 'motor' | 'bearing' | 'hinge' | 'piston' | 'gear'
  | 'drill' | 'conveyor' | 'storage' | 'smelter' | 'fabricator' | 'generator' | 'solar'
  | 'seat' | 'switch' | 'sensor' | 'timer' | 'lamp' | 'thruster';

export interface PartCfg {
  mode: string; ch: number; inv: boolean; rev: boolean;
  speed: number; angle: number; len: number; period: number; range: number;
}
export interface PartDef {
  name: string; desc: string;
  orient: 'face' | 'flat' | 'none';
  cost: Partial<Record<ItemId, number>>;
  tier: number;
  density: number;
  joint?: 'revolute' | 'prismatic';
  shape: 'box' | 'ball' | 'cyl' | 'rod';
  friction?: number;
  modes?: string[];           // selectable behaviours
  cfg?: Partial<PartCfg>;     // defaults
  sliders?: (keyof PartCfg)[];
  power?: number;             // demand (+) when active
  supply?: number;            // generation
  active?: boolean;           // needs per-tick simulation
}

export const CHANNELS = [
  { name: 'Red', color: '#ff5a4d', hex: 0xff5a4d }, { name: 'Green', color: '#5fd96a', hex: 0x5fd96a },
  { name: 'Blue', color: '#4da3ff', hex: 0x4da3ff }, { name: 'Yellow', color: '#ffd24a', hex: 0xffd24a },
];
export const MODE_LABEL: Record<string, string> = {
  auto: 'Auto (driver, else on)', on: 'Always on', channel: 'On channel', free: 'Free swing', steer: 'Steering',
  sweep: 'Sweep back & forth', pump: 'Pump in & out', boost: 'Driver boost', night: 'At night', off: 'Off',
};

export const PARTS: Record<PartType, PartDef> = {
  frame: { name: 'Frame', desc: 'Light wooden structure. The skeleton of every machine.', orient: 'none', cost: { wood: 1 }, tier: 0, density: 0.35, shape: 'box' },
  plate: { name: 'Iron Block', desc: 'Heavy, sturdy structure. Good ballast and counterweight.', orient: 'none', cost: { iron: 1 }, tier: 1, density: 1.6, shape: 'box' },
  axle: { name: 'Axle', desc: 'Slim rod. Structure that leaves room for moving parts.', orient: 'face', cost: { iron: 1 }, tier: 2, density: 0.5, shape: 'rod' },
  wheel: { name: 'Wheel', desc: 'Grippy tyre. Mount it on a Motor or Bearing face.', orient: 'face', cost: { wood: 2, iron: 1 }, tier: 2, density: 0.55, shape: 'ball', friction: 1.6 },
  motor: {
    name: 'Motor', desc: 'Spins whatever is built on its face. Follows the driver, a channel, or just runs.', orient: 'face',
    cost: { iron: 2, copper: 1 }, tier: 2, density: 0.9, joint: 'revolute', shape: 'box', active: true, power: 6,
    modes: ['auto', 'on', 'channel'], cfg: { mode: 'auto', speed: 3 }, sliders: ['speed'],
  },
  bearing: { name: 'Bearing', desc: 'Free-spinning pivot. For trailer wheels, rollers and flywheels.', orient: 'face', cost: { iron: 1 }, tier: 2, density: 0.7, joint: 'revolute', shape: 'box', active: true },
  hinge: {
    name: 'Hinge', desc: 'Angle-limited pivot: free swing, steering, servo or sweeping.', orient: 'face',
    cost: { iron: 1, gear: 1 }, tier: 3, density: 0.7, joint: 'revolute', shape: 'box', active: true, power: 3,
    modes: ['auto', 'free', 'steer', 'channel', 'sweep'], cfg: { mode: 'auto', angle: 35, speed: 3, period: 2 }, sliders: ['angle', 'speed', 'period'],
  },
  piston: {
    name: 'Piston', desc: 'Pushes its face out by up to 3 blocks. Lifts, shoves, stomps.', orient: 'face',
    cost: { iron: 2, gear: 2 }, tier: 3, density: 0.9, joint: 'prismatic', shape: 'box', active: true, power: 5,
    modes: ['channel', 'pump', 'on'], cfg: { mode: 'channel', len: 2, speed: 3, period: 2 }, sliders: ['len', 'speed', 'period'],
  },
  gear: { name: 'Cogwheel', desc: 'Meshes with neighbouring cogwheels on other bodies and passes rotation on, reversed.', orient: 'face', cost: { gear: 2 }, tier: 3, density: 0.6, shape: 'cyl', active: true },
  drill: {
    name: 'Drill', desc: 'Chews through the block in front of it and spits out the pieces.', orient: 'face',
    cost: { iron: 3 }, tier: 1, density: 1.0, shape: 'box', active: true, power: 14,
    modes: ['on', 'channel'], cfg: { mode: 'on' },
  },
  conveyor: {
    name: 'Conveyor', desc: 'Carries loose items along its arrow.', orient: 'flat',
    cost: { iron: 1, wood: 1 }, tier: 1, density: 0.6, shape: 'box', active: true, power: 2,
    modes: ['on', 'channel'], cfg: { mode: 'on', speed: 3 }, sliders: ['speed'],
  },
  storage: { name: 'Storage Crate', desc: 'Swallows any loose item that touches it. Open it to collect.', orient: 'none', cost: { wood: 6 }, tier: 0, density: 0.5, shape: 'box', active: true },
  smelter: {
    name: 'Smelter', desc: 'Ore to ingots, sand to glass. Output drops from the chute side.', orient: 'flat',
    cost: { stone: 8 }, tier: 0, density: 1.4, shape: 'box', active: true, power: 18,
    modes: ['on', 'channel'], cfg: { mode: 'on' },
  },
  fabricator: {
    name: 'Fabricator', desc: 'Ingots to cogs and wire, wood to planks, stone to brick.', orient: 'flat',
    cost: { iron: 4, copper: 2 }, tier: 3, density: 1.4, shape: 'box', active: true, power: 18,
    modes: ['on', 'channel'], cfg: { mode: 'on' },
  },
  generator: { name: 'Generator', desc: 'Burns coal or wood to power everything bolted to it.', orient: 'flat', cost: { stone: 6, wood: 4 }, tier: 0, density: 1.3, shape: 'box', active: true, supply: 60 },
  solar: { name: 'Solar Panel', desc: 'Free trickle of power while the sun is up.', orient: 'none', cost: { glass: 2, wire: 2 }, tier: 4, density: 0.4, shape: 'box', active: true, supply: 14 },
  seat: { name: 'Driver Seat', desc: 'Sit to steer the machine it is part of.', orient: 'flat', cost: { wood: 3 }, tier: 2, density: 0.4, shape: 'box', active: true },
  switch: { name: 'Switch', desc: 'Flip it to turn a colour channel on or off.', orient: 'face', cost: { copper: 1, stone: 1 }, tier: 1, density: 0.3, shape: 'box', active: true, cfg: { ch: 0 } },
  sensor: {
    name: 'Sensor', desc: 'Turns a channel on while something is in front of it.', orient: 'face',
    cost: { wire: 2, glass: 1 }, tier: 4, density: 0.3, shape: 'box', active: true, cfg: { ch: 1, range: 3 }, sliders: ['range'],
  },
  timer: {
    name: 'Timer', desc: 'Pulses a channel on and off forever.', orient: 'none',
    cost: { wire: 2, gear: 1 }, tier: 4, density: 0.3, shape: 'box', active: true, cfg: { ch: 2, period: 2 }, sliders: ['period'],
  },
  lamp: {
    name: 'Lamp', desc: 'Glows at night or on a channel.', orient: 'face',
    cost: { glass: 1, wire: 1 }, tier: 3, density: 0.3, shape: 'box', active: true, power: 1,
    modes: ['night', 'on', 'channel'], cfg: { mode: 'night' },
  },
  thruster: {
    name: 'Thruster', desc: 'Pushes hard, away from its nozzle. Hovercraft, rockets, bad ideas.', orient: 'face',
    cost: { iron: 2, wire: 2 }, tier: 4, density: 0.8, shape: 'box', active: true, power: 10,
    modes: ['boost', 'channel', 'on'], cfg: { mode: 'boost', speed: 3 }, sliders: ['speed'],
  },
};
export const PART_TYPES = Object.keys(PARTS) as PartType[];

export function defaultCfg(type: PartType): PartCfg {
  return { mode: 'on', ch: 0, inv: false, rev: false, speed: 3, angle: 35, len: 2, period: 2, range: 3, ...(PARTS[type].cfg || {}) };
}
export const SLIDERS: Record<string, { label: string; min: number; max: number; step: number; unit: string }> = {
  speed: { label: 'Speed', min: 1, max: 5, step: 1, unit: '' },
  angle: { label: 'Angle', min: 10, max: 90, step: 5, unit: '°' },
  len: { label: 'Stroke', min: 1, max: 3, step: 1, unit: ' blocks' },
  period: { label: 'Period', min: 0.5, max: 8, step: 0.5, unit: ' s' },
  range: { label: 'Range', min: 1, max: 8, step: 1, unit: ' blocks' },
};

// ---------- orientation ----------
export const DIRS: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export const DIR_VEC = DIRS.map(d => new THREE.Vector3(...d));
const Z = new THREE.Vector3(0, 0, 1);
export const DIR_QUAT = DIR_VEC.map((v, i) => {
  if (i === 2) return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  if (i === 3) return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  if (i === 5) return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  return new THREE.Quaternion().setFromUnitVectors(Z, v);
});
export function dirFromVec(x: number, y: number, z: number): number {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  if (ax >= ay && ax >= az) return x > 0 ? 0 : 1;
  if (ay >= az) return y > 0 ? 2 : 3;
  return z > 0 ? 4 : 5;
}

// ---------- geometry ----------
class GB {
  pos: number[] = []; nor: number[] = []; col: number[] = []; idx: number[] = [];
  private m = new THREE.Matrix4(); private c = new THREE.Color(); private v = new THREE.Vector3(); private nm = new THREE.Matrix3();
  add(g: THREE.BufferGeometry, color: number, shade = 1) {
    const p = g.attributes.position, n = g.attributes.normal, b = this.pos.length / 3;
    this.c.setHex(color).multiplyScalar(shade);
    this.nm.getNormalMatrix(this.m);
    for (let i = 0; i < p.count; i++) {
      this.v.fromBufferAttribute(p, i).applyMatrix4(this.m); this.pos.push(this.v.x, this.v.y, this.v.z);
      this.v.fromBufferAttribute(n, i).applyMatrix3(this.nm).normalize(); this.nor.push(this.v.x, this.v.y, this.v.z);
      this.col.push(this.c.r, this.c.g, this.c.b);
    }
    const ix = g.index!;
    for (let i = 0; i < ix.count; i++) this.idx.push(b + ix.getX(i));
    g.dispose();
    return this;
  }
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: number, rot?: THREE.Euler) {
    this.m.makeRotationFromEuler(rot || new THREE.Euler()).setPosition(x, y, z);
    return this.add(new THREE.BoxGeometry(w, h, d), color);
  }
  /** cylinder along axis ('x'|'y'|'z') */
  cyl(r1: number, r2: number, len: number, axis: 'x' | 'y' | 'z', x: number, y: number, z: number, color: number, seg = 14) {
    const e = axis === 'z' ? new THREE.Euler(Math.PI / 2, 0, 0) : axis === 'x' ? new THREE.Euler(0, 0, -Math.PI / 2) : new THREE.Euler();
    this.m.makeRotationFromEuler(e).setPosition(x, y, z);
    // CylinderGeometry: radiusTop is +Y end, which maps to +Z / +X
    return this.add(new THREE.CylinderGeometry(r2, r1, len, seg), color);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const WOOD = 0xc39558, WOOD_D = 0x7a5534, STEEL = 0xa3adb8, STEEL_D = 0x59636e, TEAL = 0x2f8f8a, TEAL_D = 0x226b68,
  COPPER = 0xd9824a, BRASS = 0xe0b84c, HAZ = 0xf2c230, RUBBER = 0x2a2c33, RED = 0xd8483a, STONE = 0x9a968e, STONE_D = 0x6f6b66,
  DARK = 0x23252b, GLOW = 0xffa53a, BLUE = 0x2b5fb8;

interface PartGeo { fixed: THREE.BufferGeometry; moving?: THREE.BufferGeometry; rod?: THREE.BufferGeometry }
const cache = new Map<PartType, PartGeo>();

function beams(g: GB, s: number, t: number, color: number) {
  const h = s / 2 - t / 2;
  for (const a of [-h, h]) for (const b of [-h, h]) {
    g.box(s, t, t, 0, a, b, color); g.box(t, s, t, a, 0, b, color); g.box(t, t, s, a, b, 0, color);
  }
}

function build(type: PartType): PartGeo {
  const g = new GB(), m = new GB();
  let rod: THREE.BufferGeometry | undefined;
  let hasMoving = false;
  switch (type) {
    case 'frame':
      g.box(0.86, 0.86, 0.86, 0, 0, 0, WOOD); beams(g, 1, 0.13, WOOD_D);
      break;
    case 'plate':
      g.box(0.98, 0.98, 0.98, 0, 0, 0, STEEL_D);
      for (const s of [-1, 1]) { g.box(0.8, 0.8, 0.02, 0, 0, s * 0.5, STEEL); g.box(0.02, 0.8, 0.8, s * 0.5, 0, 0, STEEL); g.box(0.8, 0.02, 0.8, 0, s * 0.5, 0, STEEL); }
      break;
    case 'axle':
      g.cyl(0.13, 0.13, 1, 'z', 0, 0, 0, STEEL, 10); g.cyl(0.2, 0.2, 0.1, 'z', 0, 0, -0.45, STEEL_D, 10); g.cyl(0.2, 0.2, 0.1, 'z', 0, 0, 0.45, STEEL_D, 10);
      break;
    case 'wheel':
      g.cyl(0.72, 0.72, 0.46, 'z', 0, 0, 0, RUBBER, 20);
      g.cyl(0.46, 0.46, 0.5, 'z', 0, 0, 0, STEEL, 16); g.cyl(0.16, 0.16, 0.56, 'z', 0, 0, 0, BRASS, 10);
      for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.box(0.14, 0.09, 0.5, Math.cos(a) * 0.72, Math.sin(a) * 0.72, 0, DARK, new THREE.Euler(0, 0, a + Math.PI / 2)); }
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; g.box(0.07, 0.3, 0.52, Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0, STEEL_D, new THREE.Euler(0, 0, a + Math.PI / 2)); }
      break;
    case 'motor':
      g.box(0.92, 0.92, 0.72, 0, 0, -0.14, TEAL); g.box(0.96, 0.2, 0.5, 0, 0, -0.14, COPPER); g.box(0.2, 0.96, 0.5, 0, 0, -0.14, COPPER);
      g.cyl(0.4, 0.4, 0.1, 'z', 0, 0, 0.27, TEAL_D, 14);
      m.cyl(0.3, 0.3, 0.18, 'z', 0, 0, 0.41, STEEL, 12); m.box(0.56, 0.12, 0.06, 0, 0, 0.47, BRASS); m.box(0.12, 0.56, 0.06, 0, 0, 0.47, BRASS);
      hasMoving = true; break;
    case 'bearing':
      g.box(0.92, 0.92, 0.5, 0, 0, -0.25, STEEL_D); g.cyl(0.42, 0.42, 0.3, 'z', 0, 0, 0.14, STEEL, 14);
      m.cyl(0.3, 0.3, 0.2, 'z', 0, 0, 0.4, BRASS, 12); m.box(0.5, 0.1, 0.05, 0, 0, 0.48, STEEL_D);
      hasMoving = true; break;
    case 'hinge':
      g.box(0.92, 0.92, 0.44, 0, 0, -0.28, STEEL_D); g.cyl(0.22, 0.22, 0.4, 'z', 0, 0, 0.08, BRASS, 10);
      g.box(0.96, 0.14, 0.2, 0, 0.3, -0.28, HAZ); g.box(0.96, 0.14, 0.2, 0, -0.3, -0.28, HAZ);
      m.cyl(0.46, 0.46, 0.2, 'z', 0, 0, 0.4, STEEL, 16); m.box(0.14, 0.4, 0.04, 0, 0.22, 0.49, RED);
      hasMoving = true; break;
    case 'piston': {
      g.box(0.92, 0.92, 0.78, 0, 0, -0.11, STEEL_D); g.box(0.96, 0.96, 0.12, 0, 0, -0.42, HAZ); g.box(0.96, 0.96, 0.1, 0, 0, 0.2, HAZ);
      m.box(0.88, 0.88, 0.18, 0, 0, 0.4, STEEL); m.box(0.5, 0.5, 0.03, 0, 0, 0.5, STEEL_D);
      const r = new GB(); r.cyl(0.16, 0.16, 1, 'z', 0, 0, 0.5, BRASS, 10); rod = r.build();
      hasMoving = true; break;
    }
    case 'gear':
      g.cyl(0.5, 0.5, 0.26, 'z', 0, 0, 0, BRASS, 18); g.cyl(0.2, 0.2, 0.34, 'z', 0, 0, 0, STEEL_D, 10);
      for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; g.box(0.16, 0.17, 0.24, Math.cos(a) * 0.55, Math.sin(a) * 0.55, 0, BRASS, new THREE.Euler(0, 0, a + Math.PI / 2)); }
      for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.4; g.cyl(0.08, 0.08, 0.28, 'z', Math.cos(a) * 0.33, Math.sin(a) * 0.33, 0, STEEL_D, 8); }
      break;
    case 'drill':
      g.box(0.9, 0.9, 0.6, 0, 0, -0.2, STEEL_D); g.box(0.94, 0.3, 0.3, 0, 0, -0.2, HAZ); g.cyl(0.38, 0.38, 0.16, 'z', 0, 0, 0.16, STEEL, 12);
      m.cyl(0.36, 0.04, 0.95, 'z', 0, 0, 0.7, STEEL, 10);
      for (let i = 0; i < 7; i++) { const t = i / 7, a = t * Math.PI * 4; const r = 0.34 * (1 - t) + 0.03; m.box(r * 1.5, 0.07, 0.08, Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, 0.26 + t * 0.85, BRASS, new THREE.Euler(0, 0, a)); }
      hasMoving = true; break;
    case 'conveyor':
      g.box(0.98, 0.5, 0.98, 0, -0.24, 0, STEEL_D); g.box(0.8, 0.07, 1.0, 0, 0.245, 0, DARK);
      g.box(0.09, 0.18, 1.0, -0.455, 0.2, 0, HAZ); g.box(0.09, 0.18, 1.0, 0.455, 0.2, 0, HAZ);
      g.box(0.99, 0.12, 0.12, 0, -0.1, 0.44, STEEL); g.box(0.99, 0.12, 0.12, 0, -0.1, -0.44, STEEL);
      for (let i = 0; i < 4; i++) m.box(0.74, 0.03, 0.06, 0, 0.29, -0.375 + i * 0.25, 0x4a4d57);
      m.box(0.16, 0.032, 0.1, 0, 0.29, 0.02, BRASS);
      hasMoving = true; break;
    case 'storage':
      g.box(0.94, 0.9, 0.94, 0, -0.03, 0, WOOD); g.box(0.99, 0.12, 0.99, 0, 0.44, 0, WOOD_D); g.box(0.99, 0.1, 0.99, 0, -0.45, 0, WOOD_D);
      for (const s of [-1, 1]) for (const t of [-1, 1]) g.box(0.12, 0.99, 0.12, s * 0.44, 0, t * 0.44, STEEL_D);
      g.box(0.3, 0.2, 0.04, 0, 0.1, 0.48, BRASS); g.box(0.3, 0.2, 0.04, 0, 0.1, -0.48, BRASS);
      break;
    case 'smelter':
      g.box(0.98, 0.98, 0.98, 0, 0, 0, STONE); beams(g, 1, 0.1, STONE_D);
      g.box(0.5, 0.4, 0.06, 0, -0.12, 0.48, DARK); g.box(0.38, 0.22, 0.07, 0, -0.18, 0.485, GLOW);
      g.box(0.5, 0.08, 0.2, 0, -0.36, 0.56, STONE_D);
      g.cyl(0.2, 0.16, 0.3, 'y', 0.22, 0.62, -0.22, STONE_D, 8);
      g.box(0.44, 0.06, 0.44, -0.18, 0.5, 0.14, DARK);
      break;
    case 'fabricator':
      g.box(0.98, 0.98, 0.98, 0, 0, 0, STEEL); g.box(1.0, 0.16, 1.0, 0, -0.38, 0, HAZ); g.box(1.0, 0.1, 1.0, 0, 0.42, 0, STEEL_D);
      g.box(0.5, 0.36, 0.06, 0, -0.08, 0.48, DARK); g.box(0.5, 0.07, 0.2, 0, -0.3, 0.56, STEEL_D);
      g.cyl(0.24, 0.24, 0.08, 'x', 0.5, 0.08, 0, BRASS, 10); g.cyl(0.24, 0.24, 0.08, 'x', -0.5, 0.08, 0, BRASS, 10);
      g.box(0.44, 0.06, 0.44, 0, 0.5, 0, DARK);
      break;
    case 'generator':
      g.box(0.98, 0.7, 0.98, 0, -0.14, 0, STONE_D); g.cyl(0.4, 0.4, 0.9, 'z', 0, 0.16, 0, COPPER, 14);
      g.cyl(0.14, 0.11, 0.42, 'y', 0.28, 0.6, -0.26, DARK, 8);
      g.box(0.44, 0.3, 0.06, 0, -0.16, 0.48, DARK); g.box(0.32, 0.16, 0.07, 0, -0.18, 0.485, GLOW);
      g.box(0.2, 0.2, 0.06, -0.3, 0.22, 0.47, BRASS);
      break;
    case 'solar':
      g.box(0.98, 0.3, 0.98, 0, -0.34, 0, STEEL_D); g.box(0.96, 0.06, 0.96, 0, -0.16, 0, BLUE);
      for (let i = -1; i <= 1; i++) { g.box(0.02, 0.07, 0.96, i * 0.24, -0.16, 0, STEEL); g.box(0.96, 0.07, 0.02, 0, -0.16, i * 0.24, STEEL); }
      break;
    case 'seat':
      g.box(0.9, 0.3, 0.9, 0, -0.35, 0, STEEL_D); g.box(0.8, 0.14, 0.76, 0, -0.14, 0.04, RED);
      g.box(0.8, 0.72, 0.14, 0, 0.14, -0.4, RED); g.box(0.1, 0.24, 0.6, -0.42, 0, 0, STEEL_D); g.box(0.1, 0.24, 0.6, 0.42, 0, 0, STEEL_D);
      break;
    case 'switch':
      g.box(0.6, 0.6, 0.22, 0, 0, -0.38, STEEL_D); g.box(0.4, 0.4, 0.06, 0, 0, -0.26, DARK);
      m.box(0.09, 0.09, 0.42, 0, 0, 0.21, STEEL); m.box(0.16, 0.16, 0.16, 0, 0, 0.42, RED);
      hasMoving = true; break;
    case 'sensor':
      g.box(0.6, 0.6, 0.5, 0, 0, -0.24, STEEL_D); g.cyl(0.2, 0.24, 0.2, 'z', 0, 0, 0.1, DARK, 10); g.cyl(0.13, 0.13, 0.04, 'z', 0, 0, 0.2, RED, 10);
      break;
    case 'timer':
      g.box(0.7, 0.7, 0.7, 0, -0.15, 0, STEEL_D); g.cyl(0.26, 0.26, 0.06, 'y', 0, 0.22, 0, 0xf2efe6, 14); g.box(0.04, 0.03, 0.22, 0, 0.26, 0.08, RED);
      g.box(0.74, 0.1, 0.74, 0, -0.45, 0, BRASS);
      break;
    case 'lamp':
      g.box(0.5, 0.5, 0.16, 0, 0, -0.42, STEEL_D); g.cyl(0.14, 0.14, 0.2, 'z', 0, 0, -0.26, BRASS, 8);
      m.box(0.36, 0.36, 0.36, 0, 0, 0.0, 0xfff1c4);
      hasMoving = true; break;
    case 'thruster':
      g.box(0.8, 0.8, 0.4, 0, 0, -0.3, STEEL_D); g.cyl(0.24, 0.42, 0.6, 'z', 0, 0, 0.2, STEEL, 12); g.cyl(0.2, 0.36, 0.5, 'z', 0, 0, 0.26, DARK, 12);
      g.box(0.84, 0.14, 0.2, 0, 0, -0.3, RED);
      break;
  }
  return { fixed: g.build(), moving: hasMoving ? m.build() : undefined, rod };
}
export function partGeo(type: PartType): PartGeo {
  let c = cache.get(type);
  if (!c) cache.set(type, c = build(type));
  return c;
}

export const partMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.18 });
export const ghostMat = new THREE.MeshBasicMaterial({ color: 0x8ff7ff, transparent: true, opacity: 0.45, depthWrite: false });
export const ghostBadMat = new THREE.MeshBasicMaterial({ color: 0xff6a5a, transparent: true, opacity: 0.45, depthWrite: false });

export interface PartVisual { root: THREE.Group; moving?: THREE.Mesh; rod?: THREE.Mesh; lampMat?: THREE.MeshStandardMaterial }
export function makeVisual(type: PartType): PartVisual {
  const geo = partGeo(type);
  const root = new THREE.Group();
  const fixed = new THREE.Mesh(geo.fixed, partMat);
  fixed.castShadow = fixed.receiveShadow = true;
  root.add(fixed);
  const v: PartVisual = { root };
  if (geo.moving) {
    let mat: THREE.Material = partMat;
    if (type === 'lamp') { v.lampMat = new THREE.MeshStandardMaterial({ color: 0xfff1c4, emissive: 0xffc860, emissiveIntensity: 0 }); mat = v.lampMat; }
    v.moving = new THREE.Mesh(geo.moving, mat);
    v.moving.castShadow = true;
    root.add(v.moving);
  }
  if (geo.rod) { v.rod = new THREE.Mesh(geo.rod, partMat); v.rod.scale.z = 0.01; root.add(v.rod); }
  return v;
}

// ---------- item meshes ----------
const itemGeoCache = new Map<string, THREE.BufferGeometry>();
export function itemGeo(shape: string, color: number): THREE.BufferGeometry {
  const k = shape + color;
  let geo = itemGeoCache.get(k);
  if (geo) return geo;
  const g = new GB();
  const c = new THREE.Color(color), dark = c.clone().multiplyScalar(0.72).getHex(), light = c.clone().lerp(new THREE.Color(0xffffff), 0.25).getHex();
  if (shape === 'ingot') { g.box(0.34, 0.12, 0.2, 0, -0.04, 0, dark); g.box(0.28, 0.08, 0.15, 0, 0.05, 0, light); }
  else if (shape === 'gear') { g.cyl(0.13, 0.13, 0.08, 'y', 0, 0, 0, color, 10); for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; g.box(0.07, 0.08, 0.07, Math.cos(a) * 0.15, 0, Math.sin(a) * 0.15, light, new THREE.Euler(0, -a, 0)); } g.cyl(0.05, 0.05, 0.1, 'y', 0, 0, 0, dark, 6); }
  else if (shape === 'coil') { g.cyl(0.07, 0.07, 0.26, 'y', 0, 0, 0, 0x6b5a48, 8); g.cyl(0.14, 0.14, 0.18, 'y', 0, 0, 0, color, 10); g.cyl(0.16, 0.16, 0.03, 'y', 0, 0.11, 0, dark, 10); g.cyl(0.16, 0.16, 0.03, 'y', 0, -0.11, 0, dark, 10); }
  else if (shape === 'chunk') { g.box(0.22, 0.18, 0.2, 0, 0, 0, color, new THREE.Euler(0.3, 0.5, 0.2)); g.box(0.14, 0.14, 0.16, 0.08, 0.05, 0.06, light, new THREE.Euler(0.8, 0.2, 0.5)); g.box(0.12, 0.1, 0.12, -0.08, -0.03, -0.05, dark, new THREE.Euler(0.1, 0.9, 0.4)); }
  else { g.box(0.26, 0.26, 0.26, 0, 0, 0, color); g.box(0.27, 0.06, 0.27, 0, 0.1, 0, light); }
  geo = g.build();
  itemGeoCache.set(k, geo);
  return geo;
}
