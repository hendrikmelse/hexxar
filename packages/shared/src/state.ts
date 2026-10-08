import { hexKey, type Hex } from './hex.js';
import type { TileTypeId } from './tiles.js';

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
 * Derive `eliminated` and `winner` from who still owns tiles. `forced` lists
 * players to eliminate regardless (surrender).
 */
export function settlePlayers(
  state: GameState,
  forced: readonly PlayerId[] = [],
): Pick<GameState, 'eliminated' | 'winner'> {
  const owners = new Set<PlayerId>();
  for (const tile of Object.values(state.tiles)) {
    if (tile.owner !== null) owners.add(tile.owner);
  }
  const eliminated = state.players.filter(
    (p) => state.eliminated.includes(p) || forced.includes(p) || !owners.has(p),
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
