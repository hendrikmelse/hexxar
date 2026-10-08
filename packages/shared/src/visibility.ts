import type { ExecutedMove } from './resolve.js';
import type { GameState, PlayerId } from './state.js';

/**
 * What a player is allowed to see. The server must only ever send clients the
 * output of this function. Fog of war isn't implemented yet, so everyone sees
 * everything; when it is, only this function changes.
 */
export function visibleState(state: GameState, player: PlayerId): GameState {
  void player;
  return state;
}

/** The moves a player may see happen. Like the state, this is everything until fog of war exists. */
export function visibleMoves(moves: readonly ExecutedMove[], player: PlayerId): ExecutedMove[] {
  void player;
  return [...moves];
}
