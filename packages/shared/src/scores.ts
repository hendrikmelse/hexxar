import type { MatchConfig } from './config.js';
import { tileRules } from './config.js';
import { generationInterval, ownedFarmNeighbors } from './generation.js';
import type { GameState, PlayerId } from './state.js';

/** How strong a player is: what the scoreboard shows. Not hidden by fog of war. */
export interface PlayerScore {
  readonly player: PlayerId;
  readonly tiles: number;
  /** Troops across all their tiles. */
  readonly troops: number;
  /** Troops their cities and villages make per tick, with the farms around them. */
  readonly capacity: number;
}

/** One score per player, in player order. */
export function scoresOf(state: GameState, config: MatchConfig): PlayerScore[] {
  const scores = new Map<PlayerId, { tiles: number; troops: number; capacity: number }>();
  for (const player of state.players) scores.set(player, { tiles: 0, troops: 0, capacity: 0 });
  for (const tile of Object.values(state.tiles)) {
    const score = tile.owner === null ? undefined : scores.get(tile.owner);
    if (!score) continue;
    score.tiles += 1;
    score.troops += tile.troops;
    const every = generationInterval(config, tile.type, ownedFarmNeighbors(state.tiles, tile));
    if (every !== null)
      score.capacity += (tileRules(config, tile.type).generation?.amount ?? 0) / every;
  }
  return state.players.map((player) => ({ player, ...scores.get(player)! }));
}
