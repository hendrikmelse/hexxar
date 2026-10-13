import { parseMatchConfig, tileRules, type MatchConfig } from './config.js';
import { hexDistance, hexKey, hexNeighbors, hexagonalBoard, type Hex } from './hex.js';
import { createRng, type Rng } from './rng.js';
import { DUEL_TILES, TRIO_TILES, withDefaults, type GenerationParams } from './params.js';
import {
  generateDuelLayout,
  hexImage,
  generateTrioLayout,
  trioHexImages,
  type DuelAxis,
  type DuelReport,
  type DuelSymmetry,
  type TrioReport,
} from './duel/index.js';
import { generateRoyaleLayout, type ArchetypeId, type RoyaleReport } from './royale/index.js';
import type { GameState, PlayerId, Tile } from './state.js';
import type { TileTypeId } from './tiles.js';

/** Fisher-Yates shuffle driven by the seeded rng, so boards are reproducible. */
function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/** Can all of an orbit's hexes be cities, given the cities already placed? */
function cityFits(orbit: readonly Hex[], cities: readonly Hex[], minDistance: number): boolean {
  return orbit.every(
    (hex, i) =>
      cities.every((city) => hexDistance(hex, city) >= minDistance) &&
      orbit.slice(i + 1).every((other) => hexDistance(hex, other) >= minDistance),
  );
}

/** Every hex within `distance` of the origin, except the origin itself. */
const diskOffsets = (distance: number): Hex[] =>
  hexagonalBoard(distance).filter((h) => h.q !== 0 || h.r !== 0);

/**
 * Can all of an orbit's hexes be villages? Villages keep a minimum distance from each other
 * (2 means they never touch) and, unless allowed, never touch a city.
 */
function villageFits(
  orbit: readonly Hex[],
  villages: ReadonlySet<string>,
  cities: ReadonlySet<string>,
  params: GenerationParams,
): boolean {
  const nearVillage = diskOffsets(Math.max(0, params.minVillageDistance - 1));
  return orbit.every(
    (hex, i) =>
      nearVillage.every((d) => !villages.has(hexKey({ q: hex.q + d.q, r: hex.r + d.r }))) &&
      (params.villagesNextToCities || hexNeighbors(hex).every((n) => !cities.has(hexKey(n)))) &&
      orbit.slice(i + 1).every((other) => hexDistance(hex, other) >= params.minVillageDistance),
  );
}

/** Does this board have a tile at every neighbor of the hex? Tiles that do not are on the edge. */
const edgeTest =
  (tiles: ReadonlySet<string>) =>
  (hex: Hex): boolean =>
    hexNeighbors(hex).some((n) => !tiles.has(hexKey(n)));

/**
 * Decide which tiles are cities and villages. Everything else is farmland.
 *
 * `others` are groups of hexes that must share a type (symmetry orbits, or single hexes on
 * boards without symmetry); `startHexes` are the starting cities, already placed.
 */
function placeTerrain(input: {
  startHexes: readonly Hex[];
  others: readonly (readonly Hex[])[];
  /** Is this hex on the edge of the board (next to a tile that is not there)? */
  isEdgeHex: (hex: Hex) => boolean;
  totalTiles: number;
  /** Add cities beyond the starting ones? */
  extraCities: boolean;
  params: GenerationParams;
  rng: Rng;
}): Map<string, TileTypeId> {
  const { startHexes, others, isEdgeHex, totalTiles, extraCities: wantExtra, params, rng } = input;
  const types = new Map<string, TileTypeId>();
  const cities: Hex[] = [...startHexes];
  for (const hex of startHexes) types.set(hexKey(hex), 'city');
  // Symmetries preserve edge-ness, so a group is either all edge or all interior.
  const isEdge = (orbit: readonly Hex[]): boolean => orbit.some(isEdgeHex);
  const interior = others.filter((orbit) => !isEdge(orbit));
  const edge = others.filter(isEdge);

  // Cities: rare, spaced apart, and never on the edge of the board. Add groups (in random
  // order) while that brings the number of extra cities closer to the target density.
  const target = wantExtra && params.tilesPerCity > 0 ? totalTiles / params.tilesPerCity : 0;
  let extraCities = 0;
  for (const orbit of shuffle(interior, rng)) {
    if (Math.abs(extraCities + orbit.length - target) >= Math.abs(extraCities - target)) continue;
    if (!cityFits(orbit, cities, params.minCityDistance)) continue;
    for (const hex of orbit) {
      cities.push(hex);
      types.set(hexKey(hex), 'city');
    }
    extraCities += orbit.length;
  }

  // Villages: scatter them randomly wherever they fit, never touching another village or a
  // city. Placing one only ever removes options, so a single pass leaves nowhere legal to add
  // more. Edge tiles only get villages once no interior tile can take one.
  const villages = new Set<string>();
  const cityKeys = new Set(cities.map(hexKey));
  for (const orbit of [...shuffle(interior, rng), ...shuffle(edge, rng)]) {
    if (orbit.some((hex) => types.has(hexKey(hex)))) continue;
    if (!villageFits(orbit, villages, cityKeys, params)) continue;
    // Below 100%, only some of the places a village fits get one.
    if (params.villageChance < 100 && rng.next() * 100 >= params.villageChance) continue;
    for (const hex of orbit) {
      villages.add(hexKey(hex));
      types.set(hexKey(hex), 'village');
    }
  }
  return types;
}

function buildTiles(
  hexes: readonly Hex[],
  types: ReadonlyMap<string, TileTypeId>,
  startOwners: ReadonlyMap<string, PlayerId>,
  config: MatchConfig,
): Record<string, Tile> {
  const tiles: Record<string, Tile> = {};
  for (const hex of hexes) {
    const key = hexKey(hex);
    const type = types.get(key) ?? 'farmland';
    const owner = startOwners.get(key) ?? null;
    tiles[key] = {
      q: hex.q,
      r: hex.r,
      type,
      owner,
      progress: 0,
      troops: owner === null ? tileRules(config, type).baseGarrison : config.startingTroops,
    };
  }
  return tiles;
}

export interface DuelMatchOptions {
  /** Exactly two players. */
  readonly players: readonly PlayerId[];
  readonly seed: number;
  /** About how many tiles the board has; by default the normal duel size. */
  readonly tiles?: number;
  /** Defaults to one of the two, picked by the seed. */
  readonly symmetry?: DuelSymmetry;
  /** Which line a mirror board is mirrored across; by default one of the two, picked by the seed. */
  readonly axis?: DuelAxis;
  /** How far a mirror board is turned, in steps of 60 degrees (0 to 5); by default random. */
  readonly turns?: number;
  /** Overrides for the generation settings; anything left out uses its default. */
  readonly params?: Partial<GenerationParams>;
  /** Partial match settings; defaults fill the rest. */
  readonly config?: unknown;
}

/**
 * A fair board for two players: made of blobs (see `duel/`), and exactly symmetric, either
 * mirrored left to right or turned half way round. Every tile has a twin of the same type, and the
 * two players start on twin cities, so each sees the same board from their side.
 */
export function createDuelMatch(options: DuelMatchOptions): {
  state: GameState;
  config: MatchConfig;
  /** How the board was made (the blobs it is drawn from). */
  duel: DuelReport;
} {
  const { players, seed, tiles = DUEL_TILES.normal } = options;
  if (players.length !== 2) throw new Error('a duel is for exactly 2 players');
  if (new Set(players).size !== 2) throw new Error('player ids must be unique');
  if (tiles < 20) throw new Error('a duel board needs at least 20 tiles');
  // The same seed gives the same board, and different games get both kinds.
  const symmetry: DuelSymmetry =
    options.symmetry ?? (createRng(seed ^ 0x2b1d).next() < 0.5 ? 'mirror' : 'rotational');
  const config = parseMatchConfig(options.config);
  const params = withDefaults(options.params);

  const duel = generateDuelLayout({
    seed,
    symmetry,
    axis: options.axis,
    turns: options.turns,
    targetTiles: tiles,
    params,
  });
  return {
    config,
    duel: duel.report,
    state: symmetricState({
      players,
      seed,
      hexes: duel.hexes,
      starts: duel.starts,
      images: [hexImage(symmetry, duel.report.axis, duel.report.turns)],
      config,
      params,
    }),
  };
}

export interface TrioMatchOptions {
  /** Exactly three players. */
  readonly players: readonly PlayerId[];
  readonly seed: number;
  /** About how many tiles the board has; by default the normal size for three players. */
  readonly tiles?: number;
  /** Overrides for the generation settings; anything left out uses its default. */
  readonly params?: Partial<GenerationParams>;
  /** Partial match settings; defaults fill the rest. */
  readonly config?: unknown;
}

/**
 * A fair board for three players: made of blobs (see `duel/`), and exactly symmetric under turns
 * of 120 degrees (there is no mirror version, which would not treat three players alike). Every
 * tile has two twins of the same type, one a third of a turn round and one two thirds, and the three
 * players start on twin cities, so each sees the same board from their side.
 */
export function createTrioMatch(options: TrioMatchOptions): {
  state: GameState;
  config: MatchConfig;
  /** How the board was made (the blobs it is drawn from). */
  trio: TrioReport;
} {
  const { players, seed, tiles = TRIO_TILES.normal } = options;
  if (players.length !== 3) throw new Error('a three-player board is for exactly 3 players');
  if (new Set(players).size !== 3) throw new Error('player ids must be unique');
  if (tiles < 30) throw new Error('a three-player board needs at least 30 tiles');
  const config = parseMatchConfig(options.config);
  const params = withDefaults(options.params);
  const trio = generateTrioLayout({ seed, targetTiles: tiles, params });
  return {
    config,
    trio: trio.report,
    state: symmetricState({
      players,
      seed,
      hexes: trio.hexes,
      starts: trio.starts,
      images: trioHexImages,
      config,
      params,
    }),
  };
}

/**
 * The match state for a symmetric board. The tiles are grouped into orbits (a tile and its twins,
 * or a tile alone if it is its own twin) and every tile in an orbit gets the same type, which is
 * what keeps the board fair. The starting cities are all twins of one another.
 */
function symmetricState(input: {
  players: readonly PlayerId[];
  seed: number;
  hexes: readonly Hex[];
  starts: readonly Hex[];
  /** Where each tile goes under every symmetry except doing nothing. */
  images: readonly ((hex: Hex) => Hex)[];
  config: MatchConfig;
  params: GenerationParams;
}): GameState {
  const { players, seed, hexes: ordered, starts, images, config, params } = input;
  const startOwners = new Map<string, PlayerId>();
  starts.forEach((hex, i) => startOwners.set(hexKey(hex), players[i]!));
  // Every twin of a start tile is a starting city.
  const cityOrbit = new Set(starts.map(hexKey));

  const present = new Set(ordered.map(hexKey));
  const orbits: Hex[][] = [];
  const grouped = new Set<string>();
  for (const hex of ordered) {
    if (grouped.has(hexKey(hex))) continue;
    const orbit: Hex[] = [hex];
    for (const image of images) {
      const twin = image(hex);
      if (!orbit.some((member) => hexKey(member) === hexKey(twin))) orbit.push(twin);
    }
    for (const member of orbit) grouped.add(hexKey(member));
    if (orbit.every((member) => present.has(hexKey(member)))) orbits.push(orbit);
  }

  const others = orbits.filter((orbit) => !orbit.some((h) => cityOrbit.has(hexKey(h))));
  const startOrbit = orbits.find((orbit) => orbit.some((h) => cityOrbit.has(hexKey(h)))) ?? [];
  const types = placeTerrain({
    startHexes: startOrbit,
    others,
    isEdgeHex: edgeTest(present),
    totalTiles: ordered.length,
    extraCities: true,
    params,
    rng: createRng(seed),
  });
  return {
    tick: 0,
    players: [...players],
    eliminated: [],
    winner: null,
    tiles: buildTiles(ordered, types, startOwners, config),
  };
}

export interface FreeForAllOptions {
  readonly players: readonly PlayerId[];
  readonly seed: number;
  /** Overrides for the generation settings; anything left out uses its default. */
  readonly params?: Partial<GenerationParams>;
  /** Which kind of board to make; by default one picked by the seed. */
  readonly archetype?: ArchetypeId | 'random';
  /** Partial match settings; defaults fill the rest. */
  readonly config?: unknown;
}

/**
 * A battle royale board: random terrain with no symmetry, drawn from a blueprint of rooms and
 * passages (see `royale/`), with a starting city in every spawn chamber. Cities are never on
 * the edge and never closer than `minStartDistance`. The same terrain rules apply as on
 * symmetric boards. Players are assigned to the starting cities at random.
 */
export function createFreeForAllMatch(options: FreeForAllOptions): {
  state: GameState;
  config: MatchConfig;
  report: RoyaleReport;
} {
  const { players, seed } = options;
  const config = parseMatchConfig(options.config);
  if (players.length < 2) throw new Error('a match needs at least 2 players');
  if (new Set(players).size !== players.length) throw new Error('player ids must be unique');
  const params = withDefaults(options.params);

  const rng = createRng(seed);
  const layout = generateRoyaleLayout({
    players: players.length,
    seed,
    params,
    archetype: options.archetype,
  });
  const ordered = layout.hexes;
  const present = new Set(ordered.map(hexKey));
  const starts = shuffle(layout.starts, rng);
  const startOwners = new Map<string, PlayerId>();
  starts.forEach((hex, i) => startOwners.set(hexKey(hex), players[i]!));

  const startKeys = new Set(starts.map(hexKey));
  const others = ordered.filter((hex) => !startKeys.has(hexKey(hex))).map((hex) => [hex]);
  const types = placeTerrain({
    startHexes: starts,
    others,
    isEdgeHex: edgeTest(present),
    totalTiles: ordered.length,
    extraCities: false,
    params,
    rng,
  });
  return {
    config,
    report: layout.report,
    state: {
      tick: 0,
      players: [...players],
      eliminated: [],
      winner: null,
      tiles: buildTiles(ordered, types, startOwners, config),
    },
  };
}
