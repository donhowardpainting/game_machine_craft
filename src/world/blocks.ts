// Voxel block + item definitions. Deliberately small: a handful of terrain
// materials, three ores and their inexhaustible "vein" variants, and a few
// placeable building blocks.

export const CHUNK = 16;
export const HEIGHT = 64;
export const SEA = 18;

export const B = {
  Air: 0, Grass: 1, Dirt: 2, Stone: 3, Sand: 4, Snow: 5, Log: 6, Leaves: 7, PineLeaves: 8,
  IronOre: 9, CopperOre: 10, CoalOre: 11, IronVein: 12, CopperVein: 13, CoalVein: 14,
  Planks: 15, Brick: 16, RedRock: 17, Bedrock: 18, Glass: 19,
} as const;

export type ItemId =
  | 'wood' | 'stone' | 'sand' | 'dirt' | 'coal' | 'iron_ore' | 'copper_ore'
  | 'iron' | 'copper' | 'glass' | 'gear' | 'wire' | 'plank' | 'brick';

export interface BlockDef {
  name: string;
  top: number; side: number; bottom: number;
  hardness: number;          // seconds to mine by hand
  drop: ItemId | null;
  vein?: boolean;            // never depletes
  speck?: number;            // ore speckle colour
}

const d = (name: string, top: number, side: number, bottom: number, hardness: number, drop: ItemId | null, extra: Partial<BlockDef> = {}): BlockDef =>
  ({ name, top, side, bottom, hardness, drop, ...extra });

export const BLOCKS: BlockDef[] = [];
BLOCKS[B.Air] = d('Air', 0, 0, 0, 0, null);
BLOCKS[B.Grass] = d('Grass', 0x7fbf4e, 0x8a6a45, 0x8a6a45, 0.55, 'dirt');
BLOCKS[B.Dirt] = d('Dirt', 0x8a6a45, 0x8a6a45, 0x80613f, 0.5, 'dirt');
BLOCKS[B.Stone] = d('Stone', 0x8f9299, 0x868990, 0x7c7f86, 1.3, 'stone');
BLOCKS[B.Sand] = d('Sand', 0xecd9a0, 0xe4cf93, 0xd9c387, 0.45, 'sand');
BLOCKS[B.Snow] = d('Snow', 0xf4f8fb, 0xe3ebf2, 0xd6dfe8, 0.4, 'stone');
BLOCKS[B.Log] = d('Log', 0xb08a58, 0x6e4b30, 0xb08a58, 0.9, 'wood');
BLOCKS[B.Leaves] = d('Leaves', 0x4f9e44, 0x478f3f, 0x3f8038, 0.25, null);
BLOCKS[B.PineLeaves] = d('Pine Needles', 0x2f6f52, 0x2a644a, 0x245842, 0.25, null);
BLOCKS[B.IronOre] = d('Iron Ore', 0x8f9299, 0x868990, 0x7c7f86, 1.8, 'iron_ore', { speck: 0xd98a5a });
BLOCKS[B.CopperOre] = d('Copper Ore', 0x8f9299, 0x868990, 0x7c7f86, 1.8, 'copper_ore', { speck: 0x3fc4a4 });
BLOCKS[B.CoalOre] = d('Coal', 0x8f9299, 0x868990, 0x7c7f86, 1.4, 'coal', { speck: 0x24242b });
BLOCKS[B.IronVein] = d('Iron Vein (endless)', 0xc9744a, 0xb0633f, 0x9a5535, 2.2, 'iron_ore', { vein: true, speck: 0xffc59a });
BLOCKS[B.CopperVein] = d('Copper Vein (endless)', 0x2fae93, 0x27957e, 0x1f7d6a, 2.2, 'copper_ore', { vein: true, speck: 0xa8ffe6 });
BLOCKS[B.CoalVein] = d('Coal Seam (endless)', 0x34343d, 0x2b2b33, 0x222229, 1.8, 'coal', { vein: true, speck: 0x8a8aa0 });
BLOCKS[B.Planks] = d('Planks', 0xc79a5e, 0xba8e55, 0xab814c, 0.6, 'plank');
BLOCKS[B.Brick] = d('Stone Brick', 0xa9a39a, 0x9d978e, 0x908a82, 1.4, 'brick');
BLOCKS[B.RedRock] = d('Red Rock', 0xc9714a, 0xb9623f, 0xa85638, 1.2, 'stone');
BLOCKS[B.Bedrock] = d('Bedrock', 0x3a3a44, 0x33333c, 0x2c2c34, Infinity, null);
BLOCKS[B.Glass] = d('Glass', 0xbfe6ef, 0xb2dde8, 0xa5d3df, 0.3, 'glass');

export interface ItemDef { name: string; color: number; block?: number; shape: 'cube' | 'ingot' | 'gear' | 'coil' | 'chunk' }
export const ITEMS: Record<ItemId, ItemDef> = {
  wood: { name: 'Wood', color: 0x8a5d3b, block: B.Log, shape: 'cube' },
  stone: { name: 'Stone', color: 0x8f9299, block: B.Stone, shape: 'cube' },
  sand: { name: 'Sand', color: 0xecd9a0, block: B.Sand, shape: 'cube' },
  dirt: { name: 'Dirt', color: 0x8a6a45, block: B.Dirt, shape: 'cube' },
  coal: { name: 'Coal', color: 0x2b2b33, shape: 'chunk' },
  iron_ore: { name: 'Iron Ore', color: 0xc9744a, shape: 'chunk' },
  copper_ore: { name: 'Copper Ore', color: 0x2fae93, shape: 'chunk' },
  iron: { name: 'Iron Ingot', color: 0xc8ccd4, shape: 'ingot' },
  copper: { name: 'Copper Ingot', color: 0xe08a4f, shape: 'ingot' },
  glass: { name: 'Glass', color: 0xbfe6ef, block: B.Glass, shape: 'cube' },
  gear: { name: 'Cog', color: 0xd9b24a, shape: 'gear' },
  wire: { name: 'Wire Coil', color: 0xf0a060, shape: 'coil' },
  plank: { name: 'Planks', color: 0xc79a5e, block: B.Planks, shape: 'cube' },
  brick: { name: 'Stone Brick', color: 0xa9a39a, block: B.Brick, shape: 'cube' },
};
export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];

export const isSolid = (id: number) => id !== B.Air;
