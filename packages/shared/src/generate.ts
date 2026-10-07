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
import type { GameState, PlayerId, Tile } from './state.js';
import type { TileTypeId } from './tiles.js';

/** Roughly one extra city per this many tiles. The starting cities are not counted. */
export const TILES_PER_CITY = 50;
/** Cities are never closer than this to each other, starting cities included. */
export const MIN_CITY_DISTANCE = 4;

/** Starting cities sit this many tiles in from the edge of the board. */
const START_INSET = 1;

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
function cityFits(orbit: readonly Hex[], cities: readonly Hex[]): boolean {
  return orbit.every(
    (hex, i) =>
      cities.every((city) => hexDistance(hex, city) >= MIN_CITY_DISTANCE) &&
      orbit.slice(i + 1).every((other) => hexDistance(hex, other) >= MIN_CITY_DISTANCE),
  );
}

/**
 * Can all of an orbit's hexes be villages? Villages never touch each other or a city.
 */
function villageFits(
  orbit: readonly Hex[],
  villages: ReadonlySet<string>,
  cities: ReadonlySet<string>,
): boolean {
  return orbit.every(
    (hex, i) =>
      hexNeighbors(hex).every((n) => !villages.has(hexKey(n)) && !cities.has(hexKey(n))) &&
      orbit.slice(i + 1).every((other) => hexDistance(hex, other) > 1),
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

export interface SymmetricMatchOptions {
  readonly players: readonly PlayerId[];
  readonly seed: number;
  /** Board radius in hexes. */
  readonly radius?: number;
  /** Defaults to `mirror` for 2 and 4 players, `rotational` for 3 and 6. */
  readonly symmetry?: Symmetry;
  /** Partial match settings; defaults fill the rest. */
  readonly config?: unknown;
}

const rotations: Transform[] = Array.from({ length: 6 }, (_, i) => (h) => hexRotate(h, i));
const mirrors: Transform[] = [(h) => h, hexFlipVertical, hexFlipHorizontal, (h) => hexRotate(h, 3)];

/**
 * A hex on the given ring (distance from the center) in the lower-right quadrant closest to the given angle (0 = right, 90 = down)
 * whose symmetric images are all at least `MIN_CITY_DISTANCE` apart, since they all become cities.
 */
function ringHexNear(ring: number, degrees: number, images: readonly Transform[]): Hex {
  let best: Hex | null = null;
  let bestDiff = Infinity;
  for (const hex of hexagonalBoard(ring)) {
    if (hexDistance(hex, { q: 0, r: 0 }) !== ring) continue;
    const x = Math.sqrt(3) * (hex.q + hex.r / 2);
    const y = 1.5 * hex.r;
    if (x <= 0 || y <= 0) continue;
    const spread = images.map((image) => image(hex));
    const spaced = spread.every((a, i) =>
      spread.slice(i + 1).every((b) => hexDistance(a, b) >= MIN_CITY_DISTANCE),
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
): { terrain: Transform[]; starts: Hex[] } {
  if (symmetry === 'rotational') {
    if (![2, 3, 6].includes(count)) throw new Error('rotational boards support 2, 3 or 6 players');
    const corner: Hex = { q: radius - START_INSET, r: 0 };
    const stride = 6 / count;
    return {
      terrain: rotations,
      starts: Array.from({ length: count }, (_, i) => hexRotate(corner, i * stride)),
    };
  }
  if (count === 2) {
    // Left and right corners, mirror images across the vertical axis only.
    const start: Hex = { q: radius - START_INSET, r: 0 };
    return {
      terrain: [(h) => h, hexFlipHorizontal],
      starts: [start, hexFlipHorizontal(start)],
    };
  }
  if (count === 4) {
    const start = ringHexNear(radius - START_INSET, 45, mirrors);
    const [, flipV, flipH, turn] = mirrors as [Transform, Transform, Transform, Transform];
    return { terrain: mirrors, starts: [start, flipV(start), flipH(start), turn(start)] };
  }
  throw new Error('mirror boards support 2 or 4 players');
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
  const symmetry =
    options.symmetry ?? (players.length === 2 || players.length === 4 ? 'mirror' : 'rotational');
  const config = parseMatchConfig(options.config);
  if (new Set(players).size !== players.length) throw new Error('player ids must be unique');
  if (radius < 5) throw new Error('radius must be at least 5');

  const { terrain, starts } = layout(players.length, symmetry, radius);
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
  const ordered = hexagonalBoard(radius).sort((a, b) => a.q - b.q || a.r - b.r);
  const orbits: Hex[][] = [];
  const grouped = new Set<string>();
  for (const hex of ordered) {
    if (grouped.has(hexKey(hex))) continue;
    const orbit: Hex[] = [];
    for (const transform of terrain) {
      const image = transform(hex);
      if (grouped.has(hexKey(image))) continue;
      grouped.add(hexKey(image));
      orbit.push(image);
    }
    orbits.push(orbit);
  }

  const rng = createRng(seed);
  const types = new Map<string, TileTypeId>();
  const startOrbit = orbits.find((orbit) => orbit.some((h) => cityOrbit.has(hexKey(h)))) ?? [];
  const cities: Hex[] = [...startOrbit];
  for (const hex of startOrbit) types.set(hexKey(hex), 'city');
  const others = orbits.filter((orbit) => orbit !== startOrbit);

  // Cities: rare, spaced apart. Add orbits (in random order) while that brings the number
  // of extra cities closer to the target density.
  const target = ordered.length / TILES_PER_CITY;
  let extraCities = 0;
  for (const orbit of shuffle(others, rng)) {
    if (Math.abs(extraCities + orbit.length - target) >= Math.abs(extraCities - target)) continue;
    if (!cityFits(orbit, cities)) continue;
    for (const hex of orbit) {
      cities.push(hex);
      types.set(hexKey(hex), 'city');
    }
    extraCities += orbit.length;
  }

  // Villages: scatter them randomly wherever they fit, never touching another village.
  // Placing one only ever removes options, so a single pass leaves nowhere legal to add more.
  const villages = new Set<string>();
  const cityKeys = new Set(cities.map(hexKey));
  for (const orbit of shuffle(others, rng)) {
    if (orbit.some((hex) => types.has(hexKey(hex)))) continue;
    if (!villageFits(orbit, villages, cityKeys)) continue;
    for (const hex of orbit) {
      villages.add(hexKey(hex));
      types.set(hexKey(hex), 'village');
    }
  }

  const tiles: Record<string, Tile> = {};
  for (const hex of ordered) {
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

  return {
    config,
    state: { tick: 0, players: [...players], eliminated: [], winner: null, tiles },
  };
}
