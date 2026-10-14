import type { Rng } from '../../rng.js';
import type { Blueprint } from '../blueprint.js';

export interface ArchetypeInput {
  readonly players: number;
  /** The radius of every start chamber, in tiles. This is what sets the size of the board. */
  readonly bowlRadius: number;
  readonly rng: Rng;
}

/**
 * A kind of board. It lays out the rooms and passages (never touching hexes), with one spawn
 * chamber for each player, .
 */
export interface Archetype {
  readonly id: string;
  readonly build: (input: ArchetypeInput) => Blueprint;
}
