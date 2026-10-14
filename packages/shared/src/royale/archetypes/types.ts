import type { Rng } from '../../rng.js';
import type { Blueprint } from '../blueprint.js';

export interface ArchetypeInput {
  readonly players: number;
  /**
   * Roughly the radius of the board in tiles. Rooms and corridors keep their size whatever the
   * scale is; the scale only decides how far apart they sit, which is what makes a bigger
   * board hold more land.
   */
  readonly scale: number;
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
