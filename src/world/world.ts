// Chunked voxel world: storage, edits, meshing (with AO + decorations),
// water surfaces and physics colliders.
import * as THREE from 'three';
import { B, BLOCKS, CHUNK, HEIGHT, SEA } from './blocks';
import { generateChunk, hash3, tint } from './gen';
import { pw, RAPIER, GROUP_TERRAIN } from '../game/phys';

const key = (cx: number, cz: number) => (cx + 2048) * 4096 + (cz + 2048);

export class Chunk {
  data = new Uint8Array(CHUNK * CHUNK * HEIGHT);
  hmap = new Uint8Array(CHUNK * CHUNK);
  mesh: THREE.Mesh | null = null;
  water: THREE.Mesh | null = null;
  collider: RAPIER.Collider | null = null;
  dirty = true;
  colDirty = true;
  colPos: Float32Array | null = null;
  colIdx: Uint32Array | null = null;
  constructor(public cx: number, public cz: number) {}
}

export interface VoxelHit { x: number; y: number; z: number; nx: number; ny: number; nz: number; dist: number; id: number }

const AO = [0.52, 0.7, 0.86, 1.0];
// face: normal, tangent u, tangent v with u x v = n
const FACES: [number[], number[], number[]][] = [
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
  [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
  [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
];
const FACE_SHADE = [0.88, 0.88, 1.0, 0.62, 0.94, 0.8];

const PW = CHUNK + 2;
const pad = new Uint8Array(PW * PW * HEIGHT);
const pidx = (x: number, y: number, z: number) => ((x + 1) + (z + 1) * PW) * HEIGHT + y;
const tmpC = new THREE.Color();

export class World {
  chunks = new Map<number, Chunk>();
  edits = new Map<number, Map<number, number>>();
  group = new THREE.Group();
  viewRadius = 5;
  terrainMat: THREE.MeshStandardMaterial;
  waterMat: THREE.Material;
  onEdit: ((x: number, y: number, z: number, id: number, prev: number) => void) | null = null;
  /** extra chunk keys that need colliders this tick (bodies far from player) */
  private wantCol = new Set<number>();
  pendingCount = 0;

  constructor(waterMat: THREE.Material) {
    this.terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    this.waterMat = waterMat;
  }

  getChunk(cx: number, cz: number, create = true): Chunk | undefined {
    const k = key(cx, cz);
    let c = this.chunks.get(k);
    if (!c && create) {
      c = new Chunk(cx, cz);
      generateChunk(cx, cz, c.data, c.hmap);
      const e = this.edits.get(k);
      if (e) for (const [i, id] of e) c.data[i] = id;
      this.chunks.set(k, c);
    }
    return c;
  }

  getBlock(x: number, y: number, z: number): number {
    if (y < 0) return B.Bedrock;
    if (y >= HEIGHT) return B.Air;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.getChunk(cx, cz)!;
    return c.data[((x - cx * CHUNK) + (z - cz * CHUNK) * CHUNK) * HEIGHT + y];
  }
  solid(x: number, y: number, z: number) { return this.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)) !== B.Air; }

  setBlock(x: number, y: number, z: number, id: number, silent = false) {
    if (y < 1 || y >= HEIGHT) return;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.getChunk(cx, cz)!;
    const lx = x - cx * CHUNK, lz = z - cz * CHUNK;
    const i = (lx + lz * CHUNK) * HEIGHT + y;
    const prev = c.data[i];
    if (prev === id) return;
    c.data[i] = id;
    const k = key(cx, cz);
    let e = this.edits.get(k);
    if (!e) this.edits.set(k, e = new Map());
    e.set(i, id);
    c.dirty = c.colDirty = true;
    const mark = (dx: number, dz: number) => { const n = this.chunks.get(key(cx + dx, cz + dz)); if (n) n.dirty = n.colDirty = true; };
    if (lx === 0) mark(-1, 0); if (lx === CHUNK - 1) mark(1, 0);
    if (lz === 0) mark(0, -1); if (lz === CHUNK - 1) mark(0, 1);
    if (!silent && this.onEdit) this.onEdit(x, y, z, id, prev);
  }

  /** Is this column natural open water? */
  isWater(x: number, y: number, z: number): boolean {
    if (y >= SEA - 0.1) return false;
    const xi = Math.floor(x), zi = Math.floor(z);
    const cx = Math.floor(xi / CHUNK), cz = Math.floor(zi / CHUNK);
    const c = this.getChunk(cx, cz)!;
    return c.hmap[(xi - cx * CHUNK) + (zi - cz * CHUNK) * CHUNK] < SEA && !this.solid(x, y, z);
  }

  topSolid(x: number, z: number): number {
    for (let y = HEIGHT - 1; y >= 0; y--) if (this.getBlock(x, y, z) !== B.Air) return y;
    return 0;
  }

  raycast(o: THREE.Vector3, d: THREE.Vector3, max: number): VoxelHit | null {
    let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
    const sx = d.x > 0 ? 1 : -1, sy = d.y > 0 ? 1 : -1, sz = d.z > 0 ? 1 : -1;
    const tdx = Math.abs(1 / (d.x || 1e-9)), tdy = Math.abs(1 / (d.y || 1e-9)), tdz = Math.abs(1 / (d.z || 1e-9));
    let tx = (d.x > 0 ? x + 1 - o.x : o.x - x) * tdx;
    let ty = (d.y > 0 ? y + 1 - o.y : o.y - y) * tdy;
    let tz = (d.z > 0 ? z + 1 - o.z : o.z - z) * tdz;
    let nx = 0, ny = 0, nz = 0, t = 0;
    for (let i = 0; i < 200; i++) {
      const id = this.getBlock(x, y, z);
      if (id !== B.Air && t > 0) return { x, y, z, nx, ny, nz, dist: t, id };
      if (tx < ty && tx < tz) { t = tx; tx += tdx; x += sx; nx = -sx; ny = nz = 0; }
      else if (ty < tz) { t = ty; ty += tdy; y += sy; ny = -sy; nx = nz = 0; }
      else { t = tz; tz += tdz; z += sz; nz = -sz; nx = ny = 0; }
      if (t > max) return null;
    }
    return null;
  }

  requestCollider(x: number, z: number) {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      // only neighbours when close to a border
      const bx = x - cx * CHUNK, bz = z - cz * CHUNK;
      if ((dx < 0 && bx > 4) || (dx > 0 && bx < CHUNK - 4) || (dz < 0 && bz > 4) || (dz > 0 && bz < CHUNK - 4)) continue;
      this.wantCol.add(key(cx + dx, cz + dz));
    }
  }
  /** True if the chunk under (x,z) has an up-to-date physics collider. */
  hasCollider(x: number, z: number) {
    const c = this.chunks.get(key(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
    return !!c && !!c.collider;
  }

  update(px: number, pz: number, budgetMs = 6) {
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
    const R = this.viewRadius;
    const t0 = performance.now();
    // Unload far chunks
    for (const [k, c] of this.chunks) {
      const dx = c.cx - pcx, dz = c.cz - pcz;
      if (Math.max(Math.abs(dx), Math.abs(dz)) > R + 2 && !this.wantCol.has(k)) { this.disposeChunk(c); this.chunks.delete(k); }
    }
    // Mesh nearest-first
    let pending = 0;
    for (let ring = 0; ring <= R; ring++) {
      for (let dx = -ring; dx <= ring; dx++) for (let dz = -ring; dz <= ring; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        if (dx * dx + dz * dz > (R + 0.5) * (R + 0.5)) continue;
        const c = this.getChunk(pcx + dx, pcz + dz)!;
        if (c.dirty) {
          if (performance.now() - t0 < budgetMs || ring <= 1) this.meshChunk(c); else pending++;
        }
        if (ring <= 2) this.wantCol.add(key(c.cx, c.cz));
      }
    }
    // Colliders
    for (const k of this.wantCol) {
      const cz = (k % 4096) - 2048, cx = Math.floor(k / 4096) - 2048;
      const c = this.getChunk(cx, cz)!;
      if (c.colDirty || !c.collider) {
        if (c.dirty || !c.colPos) this.meshChunk(c, Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz)) > R);
        this.buildCollider(c);
      }
    }
    // Drop colliders no one asked for
    for (const [k, c] of this.chunks) if (c.collider && !this.wantCol.has(k)) { pw.removeCollider(c.collider, false); c.collider = null; c.colDirty = true; }
    this.wantCol.clear();
    this.pendingCount = pending;
  }

  private disposeChunk(c: Chunk) {
    if (c.mesh) { this.group.remove(c.mesh); c.mesh.geometry.dispose(); }
    if (c.water) { this.group.remove(c.water); c.water.geometry.dispose(); }
    if (c.collider) pw.removeCollider(c.collider, false);
  }
  disposeAll() { for (const c of this.chunks.values()) this.disposeChunk(c); this.chunks.clear(); this.edits.clear(); }

  private buildCollider(c: Chunk) {
    if (c.collider) { pw.removeCollider(c.collider, false); c.collider = null; }
    c.colDirty = false;
    if (!c.colPos || !c.colIdx || c.colIdx.length === 0) return;
    const desc = RAPIER.ColliderDesc.trimesh(c.colPos, c.colIdx, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
      .setFriction(0.9).setCollisionGroups(GROUP_TERRAIN);
    c.collider = pw.createCollider(desc);
  }

  private meshChunk(c: Chunk, physicsOnly = false) {
    const x0 = c.cx * CHUNK, z0 = c.cz * CHUNK;
    // Fill padded buffer
    for (let lz = -1; lz <= CHUNK; lz++) for (let lx = -1; lx <= CHUNK; lx++) {
      const inside = lx >= 0 && lz >= 0 && lx < CHUNK && lz < CHUNK;
      const src = inside ? c : this.getChunk(Math.floor((x0 + lx) / CHUNK), Math.floor((z0 + lz) / CHUNK))!;
      const sx = inside ? lx : (x0 + lx) - src.cx * CHUNK, sz = inside ? lz : (z0 + lz) - src.cz * CHUNK;
      const so = (sx + sz * CHUNK) * HEIGHT, po = pidx(lx, 0, lz);
      pad.set(src.data.subarray(so, so + HEIGHT), po);
    }
    const P = (x: number, y: number, z: number) => (y < 0 ? 1 : y >= HEIGHT ? 0 : pad[pidx(x, y, z)]);
    const pos: number[] = [], nor: number[] = [], colr: number[] = [], idx: number[] = [];
    const cpos: number[] = [], cidx: number[] = [];
    const cmap = new Map<number, number>();
    const cvert = (x: number, y: number, z: number) => {
      const k = (x + 1) + (z + 1) * 19 + y * 361;
      let i = cmap.get(k);
      if (i === undefined) { i = cpos.length / 3; cpos.push(x0 + x, y, z0 + z); cmap.set(k, i); }
      return i;
    };
    const quad = (v: number[][], n: number[], cols: number[][], flip: boolean) => {
      const b = pos.length / 3;
      for (let i = 0; i < 4; i++) { pos.push(v[i][0], v[i][1], v[i][2]); nor.push(n[0], n[1], n[2]); colr.push(cols[i][0], cols[i][1], cols[i][2]); }
      if (flip) idx.push(b + 1, b + 2, b + 3, b + 1, b + 3, b); else idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    };
    const box = (cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, color: number, shadeTop = 1) => {
      tmpC.setHex(color);
      for (let f = 0; f < 6; f++) {
        const [n, u, v] = FACES[f];
        const s = FACE_SHADE[f] * (f === 2 ? shadeTop : 1);
        const cc = [tmpC.r * s, tmpC.g * s, tmpC.b * s];
        const h = [hx, hy, hz];
        const vs: number[][] = [];
        for (const [a, b2] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          vs.push([0, 1, 2].map(i => [cx, cy, cz][i] + (n[i] + u[i] * a + v[i] * b2) * h[i]));
        }
        quad(vs, n, [cc, cc, cc, cc], false);
      }
    };

    for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
      const wx = x0 + lx, wz = z0 + lz;
      let tn = -2;
      for (let y = 0; y < HEIGHT; y++) {
        const id = pad[pidx(lx, y, lz)];
        if (id === B.Air) continue;
        const def = BLOCKS[id];
        const jit = hash3(wx, y, wz, 77);
        for (let f = 0; f < 6; f++) {
          const [n, u, v] = FACES[f];
          const ax = lx + n[0], ay = y + n[1], az = lz + n[2];
          if (P(ax, ay, az) !== B.Air) continue;
          // collision quad
          {
            const bx = lx + (n[0] > 0 ? 1 : 0), by = y + (n[1] > 0 ? 1 : 0), bz = lz + (n[2] > 0 ? 1 : 0);
            const a = cvert(bx, by, bz), b = cvert(bx + u[0], by + u[1], bz + u[2]);
            const cc = cvert(bx + u[0] + v[0], by + u[1] + v[1], bz + u[2] + v[2]), dd = cvert(bx + v[0], by + v[1], bz + v[2]);
            cidx.push(a, b, cc, a, cc, dd);
          }
          if (physicsOnly) continue;
          if (tn === -2) tn = tint(wx, wz);
          const hex = f === 2 ? def.top : f === 3 ? def.bottom : def.side;
          tmpC.setHex(hex);
          let r = tmpC.r, g = tmpC.g, b = tmpC.b;
          const k = 1 + (jit - 0.5) * 0.1;
          r *= k; g *= k; b *= k;
          if (id === B.Grass || id === B.Leaves || id === B.PineLeaves) { r *= 1 + tn * 0.22; g *= 1 + tn * 0.06; b *= 1 - tn * 0.25; }
          else if (id === B.Sand || id === B.RedRock) { r *= 1 + tn * 0.05; g *= 1 + tn * 0.08; }
          else if (id === B.RedRock && (y & 3) === 0) { r *= 0.9; g *= 0.85; }
          const shade = FACE_SHADE[f];
          const vs: number[][] = [], cols: number[][] = [];
          const ao: number[] = [];
          const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
          for (let ci = 0; ci < 4; ci++) {
            const cu = corners[ci][0], cv = corners[ci][1];
            const su = cu * 2 - 1, sv = cv * 2 - 1;
            const s1 = P(ax + u[0] * su, ay + u[1] * su, az + u[2] * su) !== B.Air ? 1 : 0;
            const s2 = P(ax + v[0] * sv, ay + v[1] * sv, az + v[2] * sv) !== B.Air ? 1 : 0;
            const sc = P(ax + u[0] * su + v[0] * sv, ay + u[1] * su + v[1] * sv, az + u[2] * su + v[2] * sv) !== B.Air ? 1 : 0;
            const a = s1 && s2 ? 0 : 3 - (s1 + s2 + sc);
            ao.push(a);
            const px = lx + (n[0] > 0 ? 1 : 0) + u[0] * cu + v[0] * cv;
            const py = y + (n[1] > 0 ? 1 : 0) + u[1] * cu + v[1] * cv;
            const pz = lz + (n[2] > 0 ? 1 : 0) + u[2] * cu + v[2] * cv;
            vs.push([x0 + px, py, z0 + pz]);
            let m = AO[a] * shade;
            let rr = r, gg = g, bb = b;
            // grass sides: green lip fading into dirt
            if (id === B.Grass && f !== 2 && f !== 3) {
              const topv = py > y + 0.5;
              if (topv) { tmpC.setHex(def.top); rr = tmpC.r * k * (1 + tn * 0.22); gg = tmpC.g * k * (1 + tn * 0.06); bb = tmpC.b * k * (1 - tn * 0.25); m *= 0.92; }
            }
            if (id === B.Snow && f !== 2 && py < y + 0.5) { rr *= 0.8; gg *= 0.84; bb *= 0.9; }
            cols.push([rr * m, gg * m, bb * m]);
          }
          quad(vs, n, cols, ao[0] + ao[2] < ao[1] + ao[3]);
          // ore speckles
          if (def.speck !== undefined) {
            tmpC.setHex(def.speck);
            const sc = [tmpC.r * shade, tmpC.g * shade, tmpC.b * shade];
            const count = def.vein ? 4 : 3;
            for (let si = 0; si < count; si++) {
              const hu = 0.14 + hash3(wx * 7 + si, y * 3 + f, wz * 5, 5) * 0.62, hv = 0.14 + hash3(wx * 3 + si, y * 7 + f, wz * 11, 6) * 0.62;
              const sz = 0.09 + hash3(wx + si, y + f, wz, 8) * 0.1;
              const base = [lx + (n[0] > 0 ? 1 : 0) + n[0] * 0.004, y + (n[1] > 0 ? 1 : 0) + n[1] * 0.004, lz + (n[2] > 0 ? 1 : 0) + n[2] * 0.004];
              const sv2: number[][] = [];
              for (const [a2, b2] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
                const uu = hu + a2 * sz, vv = hv + b2 * sz * 0.8;
                sv2.push([x0 + base[0] + u[0] * uu + v[0] * vv, base[1] + u[1] * uu + v[1] * vv, z0 + base[2] + u[2] * uu + v[2] * vv]);
              }
              quad(sv2, n, [sc, sc, sc, sc], false);
            }
          }
        }
        if (physicsOnly) continue;
        // Decorations on exposed tops
        if (P(lx, y + 1, lz) === B.Air && y + 1 < HEIGHT) {
          const h = hash3(wx, y, wz, 31);
          if (id === B.Grass) {
            if (h < 0.16) {
              const n2 = 2 + Math.floor(h * 30) % 3;
              for (let i = 0; i < n2; i++) {
                const ox = 0.2 + hash3(wx, i, wz, 32) * 0.6, oz = 0.2 + hash3(wx, i, wz, 33) * 0.6, hh = 0.12 + hash3(wx, i, wz, 34) * 0.22;
                box(wx + ox, y + 1 + hh, wz + oz, 0.035, hh, 0.035, i % 2 ? 0x8fd45a : 0x6bb347, 1.15);
              }
            } else if (h > 0.972) {
              const colsF = [0xffd34d, 0xff7a8a, 0xffffff, 0xb48cff, 0xff9c3d];
              const ox = 0.3 + hash3(wx, 1, wz, 35) * 0.4, oz = 0.3 + hash3(wx, 2, wz, 36) * 0.4;
              box(wx + ox, y + 1.14, wz + oz, 0.02, 0.14, 0.02, 0x5aa040);
              box(wx + ox, y + 1.32, wz + oz, 0.075, 0.045, 0.075, colsF[Math.floor(h * 9973) % 5], 1.1);
            }
          } else if (id === B.Sand && h > 0.985 && y > SEA) {
            box(wx + 0.5, y + 1.06, wz + 0.5, 0.14, 0.06, 0.1, 0xb9a878);
          } else if ((id === B.Stone || id === B.RedRock) && h > 0.975) {
            box(wx + 0.45, y + 1.07, wz + 0.55, 0.13, 0.07, 0.11, id === B.Stone ? 0x9a9da4 : 0xc2683f);
          } else if (def.vein) {
            const cnt = 1 + Math.floor(h * 3);
            for (let i = 0; i < cnt; i++) {
              const ox = 0.22 + hash3(wx, i, wz, 37) * 0.56, oz = 0.22 + hash3(wx, i, wz, 38) * 0.56, hh = 0.1 + hash3(wx, i, wz, 39) * 0.2;
              box(wx + ox, y + 1 + hh, wz + oz, 0.08, hh, 0.08, def.speck!, 1.2);
            }
          }
        }
      }
    }
    c.colPos = new Float32Array(cpos); c.colIdx = new Uint32Array(cidx); c.colDirty = true;
    if (physicsOnly) return;
    c.dirty = false;
    if (c.mesh) { this.group.remove(c.mesh); c.mesh.geometry.dispose(); c.mesh = null; }
    if (idx.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
      g.setIndex(idx);
      g.computeBoundingSphere();
      c.mesh = new THREE.Mesh(g, this.terrainMat);
      c.mesh.castShadow = c.mesh.receiveShadow = true;
      c.mesh.matrixAutoUpdate = false;
      this.group.add(c.mesh);
    }
    // Water surface over naturally submerged columns
    if (!c.water) {
      const wp: number[] = [], wd: number[] = [], wi: number[] = [];
      const hm = (lx: number, lz: number) => {
        if (lx >= 0 && lz >= 0 && lx < CHUNK && lz < CHUNK) return c.hmap[lx + lz * CHUNK];
        const n = this.getChunk(Math.floor((x0 + lx) / CHUNK), Math.floor((z0 + lz) / CHUNK))!;
        return n.hmap[(x0 + lx - n.cx * CHUNK) + (z0 + lz - n.cz * CHUNK) * CHUNK];
      };
      for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
        if (c.hmap[lx + lz * CHUNK] >= SEA) continue;
        const b = wp.length / 3;
        for (const [a, b2] of [[0, 0], [0, 1], [1, 1], [1, 0]]) {
          wp.push(x0 + lx + a, SEA - 0.18, z0 + lz + b2);
          // depth averaged over the four columns touching this vertex
          let dsum = 0;
          for (const [ox, oz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) dsum += Math.max(0, SEA - hm(lx + a + ox, lz + b2 + oz));
          wd.push(dsum / 4);
        }
        wi.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
      if (wi.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
        g.setAttribute('depth', new THREE.Float32BufferAttribute(wd, 1));
        g.setIndex(wi);
        g.computeBoundingSphere();
        c.water = new THREE.Mesh(g, this.waterMat);
        c.water.matrixAutoUpdate = false;
        c.water.renderOrder = 2;
        this.group.add(c.water);
      }
    }
  }
}
