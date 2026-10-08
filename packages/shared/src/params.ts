/**
 * Everything that shapes a generated board. The defaults are the current best guesses; the
 * map preview has a control for each one so they can be tuned by eye.
 */
export interface GenerationParams {
  // -- Outline (random board shapes) --------------------------------------------------

  /** Size of the outline circle relative to a hexagon of the same radius (0.91 holds about as many tiles). */
  outlineScale: number;
  /** How many waves bend the outline. 0 leaves a plain circle. */
  waveCount: number;
  /** How far the waves push the outline in and out (1 = the default amplitude). */
  waveStrength: number;
  /** The highest wave frequency; higher gives finer lobes. */
  waveDetail: number;
  /** How rough the coast is, in tiles (0 = smooth). */
  jaggedness: number;
  /** A shape is only kept if its area is between these fractions of the matching hexagon. */
  minAreaRatio: number;
  maxAreaRatio: number;

  // -- Lakes ----------------------------------------------------------------------------

  /** About one lake per this many tiles (0 for no lakes). The actual number is random up to that. */
  tilesPerLake: number;
  minLakeSize: number;
  /** The biggest a lake may be, as a percentage of the board. */
  maxLakePercent: number;
  /** An absolute cap on lake size, in tiles. */
  maxLakeSize: number;
  /** Tiles of land kept between a lake and the coast. */
  lakeClearance: number;

  // -- Cities and villages -------------------------------------------------------------

  /** About one extra city per this many tiles, not counting starting cities. */
  tilesPerCity: number;
  /** Cities are never closer than this to each other, starting cities included. */
  minCityDistance: number;
  /** Add extra cities on battle royale boards too (normally the starting cities are the only ones). */
  freeForAllCities: boolean;
  /** Chance (percent) that a village is placed where one fits. 100 packs the board as full as it goes. */
  villageChance: number;
  /** Villages are never closer than this to each other (2 means they never touch). */
  minVillageDistance: number;
  /** Allow villages to touch cities. */
  villagesNextToCities: boolean;

  // -- Starting positions -------------------------------------------------------------

  /** Symmetric boards: starting cities sit this many tiles in from the edge. */
  startInset: number;
  /** Rings of land kept around each starting city on random shapes. */
  startRoom: number;
  /** Battle Royale boards: tiles of board per player, which decides the board size. */
  tilesPerPlayer: number;
}

export const DEFAULT_GENERATION_PARAMS: GenerationParams = {
  outlineScale: 0.91,
  waveCount: 4,
  waveStrength: 1.5,
  waveDetail: 6,
  jaggedness: 1.2,
  minAreaRatio: 0.5,
  maxAreaRatio: 1.3,

  tilesPerLake: 60,
  minLakeSize: 6,
  maxLakePercent: 8,
  maxLakeSize: 60,
  lakeClearance: 3,

  tilesPerCity: 50,
  minCityDistance: 3,
  freeForAllCities: false,
  villageChance: 40,
  minVillageDistance: 2,
  villagesNextToCities: false,

  startInset: 1,
  startRoom: 1,
  tilesPerPlayer: 20,
};

/** Fill in defaults for anything not given. */
export const withDefaults = (params: Partial<GenerationParams> = {}): GenerationParams => ({
  ...DEFAULT_GENERATION_PARAMS,
  ...params,
});

/** How big a game's map is, as chosen in a private game. */
export const MAP_SIZES = ['small', 'normal', 'large'] as const;
export type MapSize = (typeof MAP_SIZES)[number];

/** Board radius of a duel at each map size. Normal is what quick play uses. */
export const DUEL_RADIUS: Readonly<Record<MapSize, number>> = { small: 5, normal: 7, large: 9 };

/**
 * Tiles per player in a battle royale at each map size, which decides the board size. Normal
 * is what quick play uses.
 */
export const ROYALE_TILES_PER_PLAYER: Readonly<Record<MapSize, number>> = {
  small: 14,
  normal: DEFAULT_GENERATION_PARAMS.tilesPerPlayer,
  large: 30,
};
