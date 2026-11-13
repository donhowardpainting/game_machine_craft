// Thin wrapper around Rapier: one world, plus a registry that maps collider
// handles back to game objects (parts, loose items).
import RAPIER from '@dimforge/rapier3d-compat';

export { RAPIER };
export let pw: RAPIER.World;
export const GRAVITY = -20;
export const STEP = 1 / 60;

export type Owner = { kind: 'part'; ref: any } | { kind: 'item'; ref: any };
export const owners = new Map<number, Owner>();

// Collision groups: membership in the high 16 bits, filter in the low 16.
export const G_TERRAIN = 0x0001, G_PART = 0x0002, G_ITEM = 0x0004;
export const groups = (member: number, filter: number) => ((member << 16) | filter) >>> 0;
export const GROUP_TERRAIN = groups(G_TERRAIN, G_PART | G_ITEM);
export const GROUP_PART = groups(G_PART, G_TERRAIN | G_PART | G_ITEM);
export const GROUP_ITEM = groups(G_ITEM, G_TERRAIN | G_PART | G_ITEM);
/** Query filters */
export const Q_PARTS = groups(0xffff, G_PART);
export const Q_ITEMS = groups(0xffff, G_ITEM);
export const Q_ALL = groups(0xffff, 0xffff);

export async function initPhysics() {
  await RAPIER.init();
  pw = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  pw.timestep = STEP;
  pw.numSolverIterations = 10;
}
