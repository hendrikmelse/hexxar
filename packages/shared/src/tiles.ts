/**
 * Tile types are data, not code: adding one means adding an entry here.
 * All numbers are integers so the simulation stays exact and deterministic.
 * Matches can override any of these through `MatchConfig.tileOverrides`.
 *
 * NOTE: values are first guesses until the game is playable enough to balance.
 */
/** Troop production for cities and villages. */
export interface TileGeneration {
  /**
   * Ticks per troop, indexed by how many of the tile's neighbors are farmland owned by
   * the same player (0 to 6). Fewer ticks means faster.
   */
  readonly everyTicks: readonly number[];
  readonly amount: number;
  /** Production stops while the tile's army is at or above this size. */
  readonly cap: number;
}

export interface TileTypeDef {
  readonly id: string;
  readonly name: string;
  /** Defender strength multiplier in percent (100 = no bonus). */
  readonly defensePercent: number;
  /**
   * The size of this tile's defensive army when it is neutral. Neutral tiles
   * start at this size, and neutral armies above it shrink back toward it.
   */
  readonly baseGarrison: number;
  /** `null` for tiles that never produce troops. */
  readonly generation: TileGeneration | null;
}

export const TILE_TYPES = {
  farmland: {
    id: 'farmland',
    name: 'Farmland',
    defensePercent: 100,
    baseGarrison: 1,
    // Farms produce nothing themselves; owning the farms around a city or village speeds it up.
    generation: null,
  },
  village: {
    id: 'village',
    name: 'Village',
    defensePercent: 125,
    baseGarrison: 4,
    generation: { everyTicks: [12, 11, 10, 9, 8, 7, 6], amount: 1, cap: 20 },
  },
  city: {
    id: 'city',
    name: 'City',
    defensePercent: 150,
    baseGarrison: 10,
    generation: { everyTicks: [6, 5, 4, 4, 3, 3, 2], amount: 1, cap: 50 },
  },
} as const satisfies Record<string, TileTypeDef>;

export type TileTypeId = keyof typeof TILE_TYPES;

export const TILE_TYPE_IDS = Object.keys(TILE_TYPES) as [TileTypeId, ...TileTypeId[]];
