import { hexKey, type Hex } from './hex.js';
import { TILE_TYPES, type TileTypeId } from './tiles.js';

export type PlayerId = string;

/**
 * A tile holds at most one army, represented as a troop count. The army always
 * belongs to the tile's owner (or to nobody, for a neutral garrison).
 * State is plain JSON so it can be sent over the wire and stored as-is.
 */
export interface Tile {
  readonly q: number;
  readonly r: number;
  readonly type: TileTypeId;
  /** `null` means neutral. */
  readonly owner: PlayerId | null;
  readonly troops: number;
  /**
   * Ticks of progress toward the next generation (owned tiles) or decay step
   * (oversized neutral armies). Resets when the tile is captured.
   */
  readonly progress: number;
}

export interface GameState {
  /** Number of ticks resolved so far. */
  readonly tick: number;
  readonly players: readonly PlayerId[];
  /** Players who have lost all their tiles or surrendered. */
  readonly eliminated: readonly PlayerId[];
  /** Set once exactly one player is left standing. */
  readonly winner: PlayerId | null;
  /** Keyed by `hexKey`. */
  readonly tiles: Readonly<Record<string, Tile>>;
}

export const getTile = (state: GameState, hex: Hex): Tile | undefined => state.tiles[hexKey(hex)];

/**
 * Derive `eliminated` and `winner`. A player is still in the game while they own a producer (a
 * city or village) or any army that can move (a tile with more than one troop). Once all they have
 * left is farmland with a single troop on each, they are beaten: nobody has to take those tiles one
 * by one. `forced` lists players to eliminate regardless (surrender).
 */
export function settlePlayers(
  state: GameState,
  forced: readonly PlayerId[] = [],
): Pick<GameState, 'eliminated' | 'winner'> {
  const inTheGame = new Set<PlayerId>();
  for (const tile of Object.values(state.tiles)) {
    if (tile.owner === null) continue;
    if (TILE_TYPES[tile.type].generation !== null || tile.troops > 1) inTheGame.add(tile.owner);
  }
  const eliminated = state.players.filter(
    (p) => state.eliminated.includes(p) || forced.includes(p) || !inTheGame.has(p),
  );
  const alive = state.players.filter((p) => !eliminated.includes(p));
  const winner = state.players.length > 1 && alive.length === 1 ? (alive[0] ?? null) : null;
  return { eliminated, winner };
}

/**
 * Tiles in `next` that differ from (or are missing in) `previous`. Changes to
 * `progress` alone are ignored: clients predict them with `applyTickDiff`.
 */
export function diffTiles(previous: GameState, next: GameState): Tile[] {
  const changed: Tile[] = [];
  for (const [key, tile] of Object.entries(next.tiles)) {
    const before = previous.tiles[key];
    if (
      !before ||
      before.type !== tile.type ||
      before.owner !== tile.owner ||
      before.troops !== tile.troops
    ) {
      changed.push(tile);
    }
  }
  return changed;
}

/**
 * `settlePlayers`, applied: the state with `eliminated` and `winner` updated, and every tile an
 * eliminated player still holds turned neutral (the lone troop on each stays as its garrison).
 */
export function settle(state: GameState, forced: readonly PlayerId[] = []): GameState {
  const result = settlePlayers(state, forced);
  const out = new Set(result.eliminated);
  const tiles: Record<string, Tile> = {};
  for (const [key, tile] of Object.entries(state.tiles)) {
    tiles[key] =
      tile.owner !== null && out.has(tile.owner) ? { ...tile, owner: null, progress: 0 } : tile;
  }
  return { ...state, tiles, ...result };
}
