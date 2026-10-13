/**
 * Everything that shapes a generated board, in one place. Matches use the defaults (apart from
 * the board size, which follows the chosen map size); tests override single values.
 */
export interface GenerationParams {
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

  // -- Battle royale boards ----------------------------------------------------------

  /** Battle Royale boards: tiles of board per player, which decides the board size. */
  tilesPerPlayer: number;
  /**
   * Battle Royale boards never get less than this many tiles per player. Cities are at least
   * `minStartDistance` apart, so below a certain size there is no room left for water or chokes.
   */
  minTilesPerPlayer: number;
  /** Battle Royale boards: starting cities are never closer than this to each other. */
  minStartDistance: number;

  // -- Coast (battle royale and duel boards) -------------------------------------------

  /** How far noise pushes the coast in and out, in tiles (0 leaves the blueprint's smooth outline). */
  coastRoughness: number;
  /** Size of the coast's bumps, in tiles. */
  coastDetail: number;
  /** How far noise bends the rooms out of round, in tiles. */
  warpStrength: number;
}

export const DEFAULT_GENERATION_PARAMS: GenerationParams = {
  tilesPerCity: 50,
  minCityDistance: 3,
  villageChance: 40,
  minVillageDistance: 2,
  villagesNextToCities: false,

  tilesPerPlayer: 25,
  minTilesPerPlayer: 0,
  minStartDistance: 4,

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
 * About how many tiles each player gets on a duel board at each map size. Normal is what quick
 * play uses.
 */
export const DUEL_TILES_PER_PLAYER: Readonly<Record<MapSize, number>> = {
  small: 18,
  normal: 50,
  large: 80,
};

/** The same for a board for three players, who get a little less each than in a duel. */
export const TRIO_TILES_PER_PLAYER: Readonly<Record<MapSize, number>> = {
  small: 16,
  normal: 40,
  large: 70,
};

/** The same for a board for four players, who get less again. */
export const QUAD_TILES_PER_PLAYER: Readonly<Record<MapSize, number>> = {
  small: 15,
  normal: 35,
  large: 60,
};

/** The same for a board for six players, who get less again. */
export const SEXTET_TILES_PER_PLAYER: Readonly<Record<MapSize, number>> = {
  small: 15,
  normal: 30,
  large: 50,
};

/** About how many tiles a duel board has at each map size (two players' shares). */
export const DUEL_TILES: Readonly<Record<MapSize, number>> = {
  small: 2 * DUEL_TILES_PER_PLAYER.small,
  normal: 2 * DUEL_TILES_PER_PLAYER.normal,
  large: 2 * DUEL_TILES_PER_PLAYER.large,
};

/** About how many tiles a board for three players has at each map size (three players' shares). */
export const TRIO_TILES: Readonly<Record<MapSize, number>> = {
  small: 3 * TRIO_TILES_PER_PLAYER.small,
  normal: 3 * TRIO_TILES_PER_PLAYER.normal,
  large: 3 * TRIO_TILES_PER_PLAYER.large,
};

/** About how many tiles a board for four players has at each map size (four players' shares). */
export const QUAD_TILES: Readonly<Record<MapSize, number>> = {
  small: 4 * QUAD_TILES_PER_PLAYER.small,
  normal: 4 * QUAD_TILES_PER_PLAYER.normal,
  large: 4 * QUAD_TILES_PER_PLAYER.large,
};

/** About how many tiles a board for six players has at each map size (six players' shares). */
export const SEXTET_TILES: Readonly<Record<MapSize, number>> = {
  small: 6 * SEXTET_TILES_PER_PLAYER.small,
  normal: 6 * SEXTET_TILES_PER_PLAYER.normal,
  large: 6 * SEXTET_TILES_PER_PLAYER.large,
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
