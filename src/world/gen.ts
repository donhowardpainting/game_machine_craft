// Procedural terrain: three blended regions (meadow, alpine, red desert),
// trees, buried ore and a sparse grid of endless surface veins.
import { B, CHUNK, HEIGHT, SEA } from './blocks';

let seed = 1337;
export function setSeed(s: number) { seed = s | 0; }
export function getSeed() { return seed; }

export function hash2(x: number, z: number, s = 0): number {
  let h = (x * 374761393 + z * 668265263 + (seed + s) * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function hash3(x: number, y: number, z: number, s = 0): number {
  let h = (x * 374761393 + y * 1103515245 + z * 668265263 + (seed + s) * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const fade = (t: number) => t * t * (3 - 2 * t);

/** 2D value noise in [-1,1]. */
export function noise2(x: number, z: number, s = 0): number {
  const xi = Math.floor(x), zi = Math.floor(z);
  const u = fade(x - xi), v = fade(z - zi);
  const a = hash2(xi, zi, s), b = hash2(xi + 1, zi, s), c = hash2(xi, zi + 1, s), d = hash2(xi + 1, zi + 1, s);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
export function noise3(x: number, y: number, z: number, s = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const x00 = l(hash3(xi, yi, zi, s), hash3(xi + 1, yi, zi, s), u);
  const x10 = l(hash3(xi, yi + 1, zi, s), hash3(xi + 1, yi + 1, zi, s), u);
  const x01 = l(hash3(xi, yi, zi + 1, s), hash3(xi + 1, yi, zi + 1, s), u);
  const x11 = l(hash3(xi, yi + 1, zi + 1, s), hash3(xi + 1, yi + 1, zi + 1, s), u);
  return l(l(x00, x10, v), l(x01, x11, v), w);
}
export function fbm(x: number, z: number, oct: number, s = 0): number {
  let a = 1, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) { sum += noise2(x * f, z * f, s + i * 17) * a; norm += a; a *= 0.5; f *= 2.03; }
  return sum / norm;
}
const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export interface Column { h: number; desert: number; alpine: number; mesa: number }
const col: Column = { h: 0, desert: 0, alpine: 0, mesa: 0 };

/** Terrain column info (shared object - copy what you need). */
export function column(x: number, z: number): Column {
  const t = fbm(x / 210, z / 210, 2, 50);
  const desert = sstep(0.12, 0.3, t);
  const alpine = sstep(-0.1, -0.28, t);
  const meadow = 1 - desert - alpine;
  const cont = fbm(x / 170, z / 170, 3, 7);
  const rolling = fbm(x / 46, z / 46, 4, 3);
  const hMeadow = SEA + 3.5 + cont * 9 + rolling * 4.5;
  const ridge = 1 - Math.abs(fbm(x / 90, z / 90, 4, 21));
  const hAlp = SEA + 8 + cont * 6 + ridge * ridge * 30 + rolling * 3;
  const m = fbm(x / 60, z / 60, 3, 33);
  const mesa = sstep(0.18, 0.28, m);
  const hDes = SEA + 2.5 + cont * 5 + rolling * 2 + mesa * (7 + Math.floor((m - 0.18) * 14) * 2.2);
  let h = hMeadow * meadow + hAlp * alpine + hDes * desert;
  // A gentle, dry landing area around the origin.
  const dist = Math.sqrt(x * x + z * z);
  const spawn = 1 - sstep(26, 70, dist);
  h = h * (1 - spawn) + (SEA + 4 + rolling * 1.6) * spawn;
  col.h = Math.max(3, Math.min(HEIGHT - 6, Math.floor(h)));
  col.desert = desert * (1 - spawn); col.alpine = alpine * (1 - spawn); col.mesa = mesa * desert;
  return col;
}
export function heightAt(x: number, z: number): number { return column(x, z).h; }

export const VEIN_REGION = 40;
/** Endless vein patch centre for the region containing (x,z). */
export function veinFor(rx: number, rz: number): { x: number; z: number; type: number } {
  let x = rx * VEIN_REGION + 6 + Math.floor(hash2(rx, rz, 91) * (VEIN_REGION - 12));
  let z = rz * VEIN_REGION + 6 + Math.floor(hash2(rx, rz, 92) * (VEIN_REGION - 12));
  let type: number = [B.IronVein, B.CopperVein, B.CoalVein][Math.floor(hash2(rx, rz, 93) * 3)];
  // Three starter veins are guaranteed on the dry land around the origin.
  const near = (sx: number, sz: number) => { x = sx * (9 + Math.floor(hash2(rx, rz, 94) * 9)); z = sz * (9 + Math.floor(hash2(rx, rz, 95) * 9)); };
  if (rx === 0 && rz === 0) { type = B.IronVein; near(1, 1); }
  else if (rx === -1 && rz === 0) { type = B.CoalVein; near(-1, 1); }
  else if (rx === 0 && rz === -1) { type = B.CopperVein; near(1, -1); }
  return { x, z, type };
}
/** Positions of the three starter veins (for the compass hints). */
export function starterVeins() {
  return [veinFor(0, 0), veinFor(-1, 0), veinFor(0, -1)];
}

export const RING = { x: 34, z: -26, y: 0, r: 2.3 };
export function ringPos() { RING.y = Math.max(heightAt(RING.x, RING.z), SEA) + 8.5; return RING; }

export function tint(x: number, z: number): number { return noise2(x / 23, z / 23, 5) * 0.5 + noise2(x / 5.3, z / 5.3, 6) * 0.2; }

function treeAt(x: number, z: number, c: Column): number {
  // returns 0 none, 1 oak, 2 pine
  if (c.h <= SEA + 1 || c.desert > 0.4) return 0;
  if (x * x + z * z < 64) return 0;
  const vv = veinFor(Math.floor(x / VEIN_REGION), Math.floor(z / VEIN_REGION));
  if (Math.abs(x - vv.x) < 4 && Math.abs(z - vv.z) < 4) return 0;
  const r = hash2(x, z, 11);
  const grove = noise2(x / 31, z / 31, 12) * 0.5 + 0.5;
  if (c.alpine > 0.5) return c.h < 44 && r < 0.006 + grove * 0.03 ? 2 : 0;
  return r < 0.003 + grove * grove * 0.03 ? 1 : 0;
}

export function generateChunk(cx: number, cz: number, data: Uint8Array, hmap: Uint8Array) {
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
    const x = x0 + lx, z = z0 + lz;
    const c = column(x, z);
    const h = c.h;
    hmap[lx + lz * CHUNK] = h;
    const base = (lx + lz * CHUNK) * HEIGHT;
    const beach = h <= SEA + 1;
    const snowy = c.alpine > 0.5 && h > 42 + noise2(x / 9, z / 9, 40) * 3;
    const rocky = c.alpine > 0.5 && h > 34 && noise2(x / 7, z / 7, 41) > 0.1;
    for (let y = 0; y < h; y++) {
      let id: number;
      const depth = h - 1 - y;
      if (y === 0) id = B.Bedrock;
      else if (c.desert > 0.5) id = depth < 3 ? (c.mesa > 0.5 ? B.RedRock : B.Sand) : depth < 9 && c.mesa > 0.3 ? B.RedRock : B.Stone;
      else if (beach) id = depth < 3 ? B.Sand : B.Stone;
      else if (snowy) id = depth < 1 ? B.Snow : B.Stone;
      else if (rocky) id = B.Stone;
      else id = depth === 0 ? B.Grass : depth < 3 ? B.Dirt : B.Stone;
      if (id === B.Stone) {
        // Buried ore pockets; a little richer close to the surface on rocky ground.
        const s = 1 / 5.5;
        if (noise3(x * s, y * s, z * s, 60) > 0.74) id = B.IronOre;
        else if (noise3(x * s, y * s, z * s, 61) > 0.76) id = B.CopperOre;
        else if (noise3(x * s, y * s, z * s, 62) > 0.75) id = B.CoalOre;
      }
      data[base + y] = id;
    }
    // Endless vein patches sit on the surface.
    if (h > SEA) {
      const rx = Math.floor(x / VEIN_REGION), rz = Math.floor(z / VEIN_REGION);
      const v = veinFor(rx, rz);
      const dx = Math.abs(x - v.x), dz = Math.abs(z - v.z);
      if (dx <= 1 && dz <= 1 && dx + dz < 2) {
        // an outcrop: two blocks proud of the ground, three in the middle
        const top = h + (dx + dz === 0 ? 2 : 1);
        for (let y = h - 2; y <= top && y < HEIGHT; y++) data[base + y] = v.type;
      }
    }
  }
  // Trees (may originate outside this chunk).
  for (let tz = -3; tz < CHUNK + 3; tz++) for (let tx = -3; tx < CHUNK + 3; tx++) {
    const x = x0 + tx, z = z0 + tz;
    const c = column(x, z);
    const kind = treeAt(x, z, c);
    if (!kind) continue;
    const h = c.h;
    const put = (wx: number, y: number, wz: number, id: number, over: boolean) => {
      const lx = wx - x0, lz = wz - z0;
      if (lx < 0 || lz < 0 || lx >= CHUNK || lz >= CHUNK || y < 0 || y >= HEIGHT) return;
      const i = (lx + lz * CHUNK) * HEIGHT + y;
      if (over || data[i] === B.Air) data[i] = id;
    };
    const r = hash2(x, z, 13);
    if (kind === 1) {
      const th = 4 + Math.floor(r * 3);
      for (let y = 0; y < th; y++) put(x, h + y, z, B.Log, true);
      for (let dy = -2; dy <= 2; dy++) {
        const rad = dy <= -1 ? 2.6 : dy === 0 ? 2.4 : dy === 1 ? 1.8 : 1.0;
        for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
          const dd = Math.sqrt(dx * dx + dz * dz) + hash3(x + dx, dy, z + dz, 14) * 0.7;
          if (dd <= rad) put(x + dx, h + th + dy, z + dz, B.Leaves, false);
        }
      }
    } else {
      const th = 6 + Math.floor(r * 4);
      for (let y = 0; y < th; y++) put(x, h + y, z, B.Log, true);
      for (let y = 2; y <= th + 1; y++) {
        const k = (th + 1 - y);
        const rad = y > th ? 0.5 : 0.9 + (k % 2 === 0 ? 0.9 : 0.2) + k * 0.16;
        const ri = Math.ceil(rad);
        for (let dx = -ri; dx <= ri; dx++) for (let dz = -ri; dz <= ri; dz++) {
          if (Math.sqrt(dx * dx + dz * dz) <= rad) put(x + dx, h + y, z + dz, B.PineLeaves, false);
        }
      }
    }
  }
}
