import { parseMatchConfig, tileRules, type MatchConfig } from './config.js';
import {
  hexDistance,
  hexFlipHorizontal,
  hexFlipVertical,
  hexKey,
  hexNeighbors,
  hexRotate,
  hexagonalBoard,
  type Hex,
} from './hex.js';
import { createRng, type Rng } from './rng.js';
import { withDefaults, type GenerationParams } from './params.js';
import {
  depthFromCoast,
  generateRoyaleLayout,
  placeVillages,
  type ArchetypeId,
  type RoyaleReport,
} from './royale/index.js';
import { randomShape } from './shape.js';
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

type Transform = (h: Hex) => Hex;

/**
 * - `rotational`: 6-fold rotation. Supports 2, 3 or 6 players.
 * - `mirror`: for 4 players, left-right and top-bottom mirrors (and so a 180 degree
 *   turn). For 2 players, just the left-right mirror, so the two halves of the board
 *   face each other but each half is not itself symmetric. Supports 2 or 4 players.
 */
export type Symmetry = 'rotational' | 'mirror';

/** Does this board have a tile at every neighbor of the hex? Tiles that do not are on the edge. */
const edgeTest =
  (tiles: ReadonlySet<string>) =>
  (hex: Hex): boolean =>
    hexNeighbors(hex).some((n) => !tiles.has(hexKey(n)));

export interface SymmetricMatchOptions {
  readonly players: readonly PlayerId[];
  readonly seed: number;
  /** Board radius in hexes. */
  readonly radius?: number;
  /** Defaults to `mirror` for 2 and 4 players, `rotational` for 3 and 6. */
  readonly symmetry?: Symmetry;
  /** Overrides for the generation settings; anything left out uses its default. */
  readonly params?: Partial<GenerationParams>;
  /** Partial match settings; defaults fill the rest. */
  readonly config?: unknown;
}

/** Rotations by a whole share of a turn: 180 degrees for 2 players, 120 for 3, 60 for 6. */
const rotationGroup = (count: number): Transform[] =>
  Array.from({ length: count }, (_, i) => (h) => hexRotate(h, (i * 6) / count));
const mirrors: Transform[] = [(h) => h, hexFlipVertical, hexFlipHorizontal, (h) => hexRotate(h, 3)];

/**
 * A hex on the given ring (distance from the center) in the lower-right quadrant closest to the given angle (0 = right, 90 = down)
 * whose symmetric images are all at least `minDistance` apart, since they all become cities.
 */
function ringHexNear(
  ring: number,
  degrees: number,
  images: readonly Transform[],
  minDistance: number,
): Hex {
  let best: Hex | null = null;
  let bestDiff = Infinity;
  for (const hex of hexagonalBoard(ring)) {
    if (hexDistance(hex, { q: 0, r: 0 }) !== ring) continue;
    const x = Math.sqrt(3) * (hex.q + hex.r / 2);
    const y = 1.5 * hex.r;
    if (x <= 0 || y <= 0) continue;
    const spread = images.map((image) => image(hex));
    const spaced = spread.every((a, i) =>
      spread.slice(i + 1).every((b) => hexDistance(a, b) >= minDistance),
    );
    if (!spaced) continue;
    const diff = Math.abs((Math.atan2(y, x) * 180) / Math.PI - degrees);
    if (diff < bestDiff - 1e-9) {
      best = hex;
      bestDiff = diff;
    }
  }
  if (!best) throw new Error('board too small');
  return best;
}

/** The terrain symmetry group, and where each player starts. */
function layout(
  count: number,
  symmetry: Symmetry,
  radius: number,
  params: GenerationParams,
): { terrain: Transform[]; starts: Hex[] } {
  const inset = params.startInset;
  if (symmetry === 'rotational') {
    if (![2, 3, 6].includes(count)) throw new Error('rotational boards support 2, 3 or 6 players');
    const corner: Hex = { q: radius - inset, r: 0 };
    const stride = 6 / count;
    return {
      terrain: rotationGroup(count),
      starts: Array.from({ length: count }, (_, i) => hexRotate(corner, i * stride)),
    };
  }
  if (count === 2) {
    // Left and right corners, mirror images across the vertical axis only.
    const start: Hex = { q: radius - inset, r: 0 };
    return {
      terrain: [(h) => h, hexFlipHorizontal],
      starts: [start, hexFlipHorizontal(start)],
    };
  }
  if (count === 4) {
    const start = ringHexNear(radius - inset, 45, mirrors, params.minCityDistance);
    const [, flipV, flipH, turn] = mirrors as [Transform, Transform, Transform, Transform];
    return { terrain: mirrors, starts: [start, flipV(start), flipH(start), turn(start)] };
  }
  throw new Error('mirror boards support 2 or 4 players');
}

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

/**
 * A fair board for 2, 3, 4 or 6 players (5 is unsupported). The terrain is
 * symmetric under the chosen group and players start on matching spots, so
 * every player's surroundings are identical up to rotation or reflection.
 */
export function createSymmetricMatch(options: SymmetricMatchOptions): {
  state: GameState;
  config: MatchConfig;
} {
  const { players, seed, radius = 6 } = options;
  // Two players get a mirror or a half turn, picked by the seed (so the same seed is the same
  // board, and different games get different kinds).
  const twoPlayerSymmetry: Symmetry =
    createRng(seed ^ 0x2b1d).next() < 0.5 ? 'mirror' : 'rotational';
  const symmetry =
    options.symmetry ??
    (players.length === 2 ? twoPlayerSymmetry : players.length === 4 ? 'mirror' : 'rotational');
  const config = parseMatchConfig(options.config);
  if (new Set(players).size !== players.length) throw new Error('player ids must be unique');
  if (radius < 3) throw new Error('radius must be at least 3');

  const params = withDefaults(options.params);
  const { terrain, starts } = layout(players.length, symmetry, radius, params);
  const startOwners = new Map<string, PlayerId>();
  starts.forEach((hex, i) => {
    const player = players[i];
    if (player === undefined) return;
    if (startOwners.has(hexKey(hex))) throw new Error('start positions overlap');
    startOwners.set(hexKey(hex), player);
  });
  // Every image of a start hex is a city, so no player sits next to a better spot than another.
  const cityOrbit = new Set(terrain.map((t) => hexKey(t(starts[0] as Hex))));

  // Group the board into symmetry orbits. Every hex in an orbit gets the same tile type,
  // which is what keeps the board fair.
  // The outline is irregular, with a rough coast and lakes, but keeps the board's symmetry.
  const ordered = randomShape({
    radius,
    rng: createRng(seed ^ 0x5eed5eed),
    group: terrain,
    protect: starts,
    params,
  }).sort((a, b) => a.q - b.q || a.r - b.r);
  const present = new Set(ordered.map(hexKey));
  const orbits: Hex[][] = [];
  const grouped = new Set<string>();
  for (const hex of ordered) {
    if (grouped.has(hexKey(hex))) continue;
    const orbit: Hex[] = [];
    for (const transform of terrain) {
      const image = transform(hex);
      if (grouped.has(hexKey(image)) || !present.has(hexKey(image))) continue;
      grouped.add(hexKey(image));
      orbit.push(image);
    }
    orbits.push(orbit);
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
  const tiles = buildTiles(ordered, types, startOwners, config);

  return {
    config,
    state: { tick: 0, players: [...players], eliminated: [], winner: null, tiles },
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
  const land = new Map(ordered.map((hex) => [hexKey(hex), hex]));
  const { villages, summary } = placeVillages({
    land,
    starts: layout.starts,
    depth: depthFromCoast(land),
    params,
    rng,
  });
  const starts = shuffle(layout.starts, rng);
  const startOwners = new Map<string, PlayerId>();
  starts.forEach((hex, i) => startOwners.set(hexKey(hex), players[i]!));
  const types = new Map<string, TileTypeId>();
  for (const hex of starts) types.set(hexKey(hex), 'city');
  for (const hex of villages) types.set(hexKey(hex), 'village');
  return {
    config,
    report: { ...layout.report, villages: summary },
    state: {
      tick: 0,
      players: [...players],
      eliminated: [],
      winner: null,
      tiles: buildTiles(ordered, types, startOwners, config),
    },
  };
}
