import { parseMatchConfig, tileRules, type MatchConfig } from './config.js';
import {
  hexDistance,
  hexFlipHorizontal,
  hexFlipVertical,
  hexKey,
  hexRotate,
  hexagonalBoard,
  type Hex,
} from './hex.js';
import { createRng, type Rng } from './rng.js';
import type { GameState, PlayerId, Tile } from './state.js';
import type { TileTypeId } from './tiles.js';

/** Relative odds of each tile type on generated boards. */
const TILE_WEIGHTS: Readonly<Record<TileTypeId, number>> = { farmland: 70, village: 22, city: 8 };

function pickTileType(rng: Rng): TileTypeId {
  const total = Object.values(TILE_WEIGHTS).reduce((a, b) => a + b, 0);
  let roll = rng.next() * total;
  for (const [id, weight] of Object.entries(TILE_WEIGHTS) as [TileTypeId, number][]) {
    roll -= weight;
    if (roll < 0) return id;
  }
  return 'farmland';
}

type Transform = (h: Hex) => Hex;

/**
 * - `rotational`: 6-fold rotation. Supports 2, 3 or 6 players.
 * - `mirror`: left-right and top-bottom mirrors (and so a 180 degree turn).
 *   Supports 2 or 4 players.
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

/** A rim hex in the lower-right quadrant closest to the given angle (0 = right, 90 = down). */
function rimHexNear(radius: number, degrees: number): Hex {
  let best: Hex | null = null;
  let bestDiff = Infinity;
  for (const hex of hexagonalBoard(radius)) {
    if (hexDistance(hex, { q: 0, r: 0 }) !== radius) continue;
    const x = Math.sqrt(3) * (hex.q + hex.r / 2);
    const y = 1.5 * hex.r;
    if (x <= 0 || y <= 0) continue;
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
    const corner: Hex = { q: radius, r: 0 };
    const stride = 6 / count;
    return {
      terrain: rotations,
      starts: Array.from({ length: count }, (_, i) => hexRotate(corner, i * stride)),
    };
  }
  if (count === 2) {
    // Opposite sides, mirror images of each other.
    const start = rimHexNear(radius, 10);
    return { terrain: mirrors, starts: [start, hexFlipHorizontal(start)] };
  }
  if (count === 4) {
    const start = rimHexNear(radius, 45);
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
  if (radius < 3) throw new Error('radius must be at least 3');

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

  // Choose one type per symmetry orbit, then stamp it onto every image.
  const rng = createRng(seed);
  const tiles: Record<string, Tile> = {};
  const ordered = hexagonalBoard(radius).sort((a, b) => a.q - b.q || a.r - b.r);
  for (const hex of ordered) {
    if (tiles[hexKey(hex)]) continue;
    const type: TileTypeId = cityOrbit.has(hexKey(hex)) ? 'city' : pickTileType(rng);
    for (const transform of terrain) {
      const image = transform(hex);
      const key = hexKey(image);
      if (tiles[key]) continue;
      const owner = startOwners.get(key) ?? null;
      tiles[key] = {
        q: image.q,
        r: image.r,
        type,
        owner,
        troops: owner === null ? tileRules(config, type).baseGarrison : config.startingTroops,
      };
    }
  }

  return {
    config,
    state: { tick: 0, players: [...players], eliminated: [], winner: null, tiles },
  };
}
