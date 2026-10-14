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

  /**
   * Battle Royale boards: the radius of every player's starting bowl, in tiles. This is what
   * makes a board big or small: the board's area is whatever the bowls, corridors and the
   * spacing between them come to.
   */
  bowlRadius: number;
  /**
   * Fair boards: how many sets of extra blobs (a set is one blob for each symmetry, fewer if it is
   * on a mirror line) the board has, besides the starts. Rooms set it from the map size
   * (`extraSetsFor`). Without it, the radius decides: `round(2 × radius / the number of symmetries)`.
   */
  extraSets?: number;

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

  bowlRadius: 1.6,

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
 * The radius of a player's starting bowl at each map size with 6 players, which is what tells the
 * map sizes apart on every board (battle royales and fair boards). Normal is what quick play uses.
 * See `bowlRadiusFor` for other player counts.
 */
export const BOWL_RADIUS: Readonly<Record<MapSize, number>> = {
  small: 0.8,
  normal: 1.5,
  large: 2.8,
};

/** The bowl radius of a board: smaller for each player when there are many of them. */
export function bowlRadiusFor(size: MapSize, players: number): number {
  return BOWL_RADIUS[size] * (6 / Math.max(players, 2)) ** 0.27;
}

/**
 * The radius of every start bowl on a fair board (duel, trio, quad, sextet) at each map size. The
 * same whatever the number of players: what makes a bigger board for more players is that there
 * are more bowls (and more blobs in each set of extras).
 */
export const FAIR_BOWL_RADIUS: Readonly<Record<MapSize, number>> = {
  small: 1.05,
  normal: 1.3,
  large: 1.5,
};

/**
 * How many sets of extra blobs a fair board for this many players has at a map size, besides the
 * starts: small, normal and large. A set is as many blobs as there are players (one for each
 * symmetry), so the more players, the fewer sets keep a board about the same size per player.
 */
const EXTRA_SETS: Readonly<Record<number, readonly [number, number, number]>> = {
  2: [0, 1, 2],
  3: [0, 1, 1],
  4: [0, 0, 1],
  6: [0, 0, 1],
};

export const extraSetsFor = (size: MapSize, players: number): number =>
  (EXTRA_SETS[players] ?? [0, 1, 2])[MAP_SIZES.indexOf(size)]!;
