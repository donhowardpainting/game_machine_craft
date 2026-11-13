// The tutorial rover. It is assembled through exactly the same calls the
// player's own placements use - there is no special "vehicle" object.
import * as THREE from 'three';
import { ctx } from '../game/ctx';
import type { Part } from './assembly';

export function spawnRover(x: number, y: number, z: number, yaw: number): Part {
  const m = ctx.mech;
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const a = m.createAssembly({ x, y, z }, { x: q.x, y: q.y, z: q.z, w: q.w }, false);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -2; cz <= 2; cz++) m.addPart(a, 'frame', [cx, 0, cz], 4);
  const seat = m.addPart(a, 'seat', [0, 1, 0], 4);
  const gen = m.addPart(a, 'generator', [0, 1, -2], 5);
  gen.st.fuel = 300;
  m.addPart(a, 'storage', [0, 1, -1], 4);
  m.addPart(a, 'drill', [0, 0, 3], 4, { mode: 'channel', ch: 0 });
  m.addPart(a, 'lamp', [1, 1, 2], 4);
  m.addPart(a, 'lamp', [-1, 1, 2], 4);
  for (const sx of [-1, 1]) for (const sz of [-2, 2]) {
    const motor = m.addPart(a, 'motor', [sx * 2, 0, sz], sx > 0 ? 0 : 1);
    m.attachToJoint(motor, 'wheel', motor.dir);
  }
  return seat;
}
