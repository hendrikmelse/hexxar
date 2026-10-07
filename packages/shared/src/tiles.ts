/**
 * Tile types are data, not code: adding one means adding an entry here.
 * All numbers are integers so the simulation stays exact and deterministic.
 *
 * NOTE: values are placeholders until the game is playable enough to balance.
 */
export interface TileTypeDef {
  readonly id: string;
  readonly name: string;
  /** Defender strength multiplier in percent (100 = no bonus). */
  readonly defensePercent: number;
  /** Troops stationed on this tile at match start if it is neutral. */
  readonly neutralGarrison: number;
  /** An owned tile gains `amount` troops every `everyTicks` ticks (before the match's speed scale). */
  readonly generation: { readonly everyTicks: number; readonly amount: number };
}

export const TILE_TYPES = {
  farmland: {
    id: 'farmland',
    name: 'Farmland',
    defensePercent: 100,
    neutralGarrison: 2,
    generation: { everyTicks: 8, amount: 1 },
  },
  village: {
    id: 'village',
    name: 'Village',
    defensePercent: 125,
    neutralGarrison: 4,
    generation: { everyTicks: 4, amount: 1 },
  },
  city: {
    id: 'city',
    name: 'City',
    defensePercent: 150,
    neutralGarrison: 8,
    generation: { everyTicks: 2, amount: 1 },
  },
} as const satisfies Record<string, TileTypeDef>;

export type TileTypeId = keyof typeof TILE_TYPES;

export const TILE_TYPE_IDS = Object.keys(TILE_TYPES) as TileTypeId[];

export const tileTypeDef = (id: TileTypeId): TileTypeDef => TILE_TYPES[id];
