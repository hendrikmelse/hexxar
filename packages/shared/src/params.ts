/**
 * Everything that shapes a generated board, in one place. Matches use the defaults (apart from
 * the board size, which follows the chosen map size); tests override single values.
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

  /**
   * About one lake per this many tiles (0 for no lakes), counting each set of symmetric copies as
   * one lake, so the same share of the board is water however many players there are.
   */
  tilesPerLake: number;
  /** How far the number of lakes may stray from that, in percent either way (0 is always the same number). */
  lakeCountVariation: number;
  /** The most water all the lakes together may take, as a percentage of the board. */
  maxTotalLakePercent: number;
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
  /**
   * Battle Royale boards never get less than this many tiles per player. Cities are at least
   * `minStartDistance` apart, so below a certain size there is no room left for water or chokes.
   */
  minTilesPerPlayer: number;
  /** Battle Royale boards: starting cities are never closer than this to each other. */
  minStartDistance: number;
  /**
   * Battle Royale boards: balance the players' surroundings. Every spawn chamber gets the same
   * exits, boards that are too lopsided are thrown away, and the fairest of several is used.
   */
  checkFairness: boolean;
  /** Battle Royale boards, with `checkFairness`: this many valid boards are drawn and the fairest one is used. */
  fairnessCandidates: number;

  // -- Battle royale terrain ------------------------------------------------------------

  /** How far noise pushes the coast in and out, in tiles (0 leaves the blueprint's smooth outline). */
  coastRoughness: number;
  /** Size of the coast's bumps, in tiles. */
  coastDetail: number;
  /** How far noise bends the rooms out of round, in tiles. */
  warpStrength: number;
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
  lakeCountVariation: 40,
  maxTotalLakePercent: 12,
  minLakeSize: 6,
  maxLakePercent: 8,
  maxLakeSize: 60,
  lakeClearance: 3,

  tilesPerCity: 50,
  minCityDistance: 3,
  villageChance: 40,
  minVillageDistance: 2,
  villagesNextToCities: false,

  startInset: 1,
  startRoom: 1,
  tilesPerPlayer: 25,
  minTilesPerPlayer: 0,
  minStartDistance: 4,
  checkFairness: false,
  fairnessCandidates: 4,

  coastRoughness: 1,
  coastDetail: 5,
  warpStrength: 1.5,
};

/** Fill in defaults for anything not given. */
export const withDefaults = (params: Partial<GenerationParams> = {}): GenerationParams => ({
  ...DEFAULT_GENERATION_PARAMS,
  ...params,
});

/** How big a game's map is, as chosen in a private game. */
export const MAP_SIZES = ['small', 'normal', 'large'] as const;
export type MapSize = (typeof MAP_SIZES)[number];

/**
 * Board radius of a symmetric board (2, 3, 4 or 6 players) at each map size, chosen so every player
 * gets about 15, 35 and 60 tiles at small, normal and large, as nearly as whole radii allow. Boards
 * for more players are bigger, in proportion. Normal is what quick play uses.
 *
 * Radius 3 is the smallest that works (and only for 2 or 3 players): the starting cities and the
 * land around them take up much of a board that small. The comments show the average tiles per
 * player measured over many seeds.
 */
const SYMMETRIC_RADIUS: Readonly<Record<MapSize, Readonly<Record<number, number>>>> = {
  //        2p r3: 16   3p r3: 12   4p r4: 17   6p r4: 12 per player
  small: { 2: 3, 3: 3, 4: 4, 6: 4 },
  //        2p r4: 29   3p r5: 33   4p r6: 37   6p r7: 34 per player
  normal: { 2: 4, 3: 5, 4: 6, 6: 7 },
  //        2p r6: 65   3p r7: 62   4p r8: 65   6p r10: 65 per player
  large: { 2: 6, 3: 7, 4: 8, 6: 10 },
};

export function symmetricRadius(size: MapSize, players: number): number {
  return SYMMETRIC_RADIUS[size][players] ?? SYMMETRIC_RADIUS[size][2]!;
}

/** The radius of a two-player duel at each map size. */
export const DUEL_RADIUS: Readonly<Record<MapSize, number>> = {
  small: SYMMETRIC_RADIUS.small[2]!,
  normal: SYMMETRIC_RADIUS.normal[2]!,
  large: SYMMETRIC_RADIUS.large[2]!,
};

/**
 * Tiles per player in a battle royale at each map size with 6 players, which decides the board
 * size. Normal is what quick play uses. See `royaleTilesPerPlayer` for other player counts.
 */
export const ROYALE_TILES_PER_PLAYER: Readonly<Record<MapSize, number>> = {
  small: 15,
  normal: 25,
  large: 45,
};

/**
 * How close starting cities may be in a battle royale at each map size. Smaller boards have
 * less land for each player, so their cities have to be closer together.
 */
export const ROYALE_START_DISTANCE: Readonly<Record<MapSize, number>> = {
  small: 3,
  normal: 4,
  large: 5,
};

/** Tiles per player in a battle royale: fewer for each player when there are many of them. */
export function royaleTilesPerPlayer(size: MapSize, players: number): number {
  return Math.round(ROYALE_TILES_PER_PLAYER[size] * (6 / Math.max(players, 2)) ** 0.25);
}
