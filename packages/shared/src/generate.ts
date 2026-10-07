import { parseMatchConfig, type MatchConfig } from './config.js';
import { hexKey, hexRotate, hexagonalBoard, type Hex } from './hex.js';
import { createRng, type Rng } from './rng.js';
import type { GameState, PlayerId, Tile } from './state.js';
import { TILE_TYPES, type TileTypeId } from './tiles.js';

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

export interface SymmetricMatchOptions {
  readonly players: readonly PlayerId[];
  readonly seed: number;
  /** Board radius in hexes. */
  readonly radius?: number;
  /** Partial match settings; defaults fill the rest. */
  readonly config?: unknown;
}

/**
 * A fair board for 2, 3 or 6 players. The terrain has 6-fold rotational
 * symmetry and players start on corners spaced evenly around it, so every
 * player's surroundings are identical up to rotation.
 * (4 and 5 players can't be made rotationally fair on a hex grid.)
 */
export function createSymmetricMatch(options: SymmetricMatchOptions): {
  state: GameState;
  config: MatchConfig;
} {
  const { players, seed, radius = 6 } = options;
  const config = parseMatchConfig(options.config);
  if (![2, 3, 6].includes(players.length)) {
    throw new Error('symmetric boards support 2, 3 or 6 players');
  }
  if (new Set(players).size !== players.length) throw new Error('player ids must be unique');
  if (radius < 2) throw new Error('radius must be at least 2');

  const rng = createRng(seed);
  const startCorner: Hex = { q: radius, r: 0 };
  const stride = 6 / players.length;
  const startOwners = new Map<string, PlayerId>();
  players.forEach((player, i) => {
    startOwners.set(hexKey(hexRotate(startCorner, i * stride)), player);
  });
  const cornerOrbit = new Set(
    Array.from({ length: 6 }, (_, i) => hexKey(hexRotate(startCorner, i))),
  );

  // Choose one type per rotational orbit, then stamp it onto all six images.
  const tiles: Record<string, Tile> = {};
  const ordered = hexagonalBoard(radius).sort((a, b) => a.q - b.q || a.r - b.r);
  for (const hex of ordered) {
    if (tiles[hexKey(hex)]) continue;
    const type: TileTypeId = cornerOrbit.has(hexKey(hex)) ? 'city' : pickTileType(rng);
    for (let step = 0; step < 6; step++) {
      const image = hexRotate(hex, step);
      const key = hexKey(image);
      if (tiles[key]) continue;
      const owner = startOwners.get(key) ?? null;
      tiles[key] = {
        q: image.q,
        r: image.r,
        type,
        owner,
        troops: owner === null ? TILE_TYPES[type].neutralGarrison : config.startingTroops,
      };
    }
  }

  return {
    config,
    state: { tick: 0, players: [...players], eliminated: [], winner: null, tiles },
  };
}
