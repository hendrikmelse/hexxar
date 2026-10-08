import type { MatchConfig } from './config.js';
import { hexKey } from './hex.js';
import type { ExecutedMove } from './resolve.js';
import type { GameState, PlayerId, Tile } from './state.js';
import { visionOf } from './vision.js';

/**
 * Does fog of war hide things from this player right now? Not when the match has no fog, and not
 * once the player is out of it (beaten, or the match is over): then they get to see it all.
 */
export function fogHides(state: GameState, player: PlayerId, config: MatchConfig): boolean {
  return (
    config.fog === 'on' &&
    state.winner === null &&
    state.players.includes(player) &&
    !state.eliminated.includes(player)
  );
}

/**
 * What a player is allowed to see. The server must only ever send clients the output of this
 * function. Under fog, tiles the player cannot see are replaced by blank ones (their existence is
 * public, their content is not), and tiles they only see from far away lose their troops.
 */
export function visibleState(state: GameState, player: PlayerId, config: MatchConfig): GameState {
  if (!fogHides(state, player, config)) return state;
  const vision = visionOf(state.tiles, player);
  const tiles: Record<string, Tile> = {};
  for (const [key, tile] of Object.entries(state.tiles)) {
    const level = vision.get(key);
    if (level === 'full') tiles[key] = tile;
    else if (level === 'far') tiles[key] = { ...tile, troops: 0, progress: 0 };
    else {
      tiles[key] = { q: tile.q, r: tile.r, type: 'farmland', owner: null, troops: 0, progress: 0 };
    }
  }
  return { ...state, tiles };
}

/**
 * The moves a player may see happen: those with an end in a tile they see in full, as the tick
 * began or as it ended.
 */
export function visibleMoves(
  moves: readonly ExecutedMove[],
  player: PlayerId,
  before: GameState,
  after: GameState,
  config: MatchConfig,
): ExecutedMove[] {
  if (!fogHides(before, player, config) && !fogHides(after, player, config)) return [...moves];
  const seen = [before, after].map((state) => visionOf(state.tiles, player));
  return moves.filter((move) =>
    seen.some((vision) => [move.from, move.to].some((hex) => vision.get(hexKey(hex)) === 'full')),
  );
}
