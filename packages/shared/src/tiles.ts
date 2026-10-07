/**
 * Tile types are data, not code: adding one means adding an entry here.
 * All numbers are integers so the simulation stays exact and deterministic.
 * Matches can override any of these through `MatchConfig.tileOverrides`.
 *
 * NOTE: values are first guesses until the game is playable enough to balance.
 */
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
  /**
   * An owned tile gains `amount` troops every `everyTicks` ticks (before the
   * match's speed scale), and stops once its army has reached `cap`.
   */
  readonly generation: {
    readonly everyTicks: number;
    readonly amount: number;
    readonly cap: number;
  };
}

export const TILE_TYPES = {
  farmland: {
    id: 'farmland',
    name: 'Farmland',
    defensePercent: 100,
    baseGarrison: 1,
    generation: { everyTicks: 24, amount: 1, cap: 10 },
  },
  village: {
    id: 'village',
    name: 'Village',
    defensePercent: 125,
    baseGarrison: 4,
    generation: { everyTicks: 8, amount: 1, cap: 20 },
  },
  city: {
    id: 'city',
    name: 'City',
    defensePercent: 150,
    baseGarrison: 10,
    generation: { everyTicks: 3, amount: 1, cap: 50 },
  },
} as const satisfies Record<string, TileTypeDef>;

export type TileTypeId = keyof typeof TILE_TYPES;

export const TILE_TYPE_IDS = Object.keys(TILE_TYPES) as [TileTypeId, ...TileTypeId[]];
