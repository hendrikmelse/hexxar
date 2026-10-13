import { hexFlipHorizontal, hexRotate, type Hex } from '../hex.js';
import type { Point } from '../royale/blueprint.js';

/**
 * The two ways a two-player board can be symmetric: a left-right mirror, or a half turn about the
 * middle of the board. Both are exact on hexes (they map hex centers to hex centers).
 */
export type DuelSymmetry = 'mirror' | 'rotational';

/** Where a hex goes under the symmetry. */
export const hexImage = (symmetry: DuelSymmetry): ((hex: Hex) => Hex) =>
  symmetry === 'mirror' ? hexFlipHorizontal : (hex) => hexRotate(hex, 3);

/** Where a point (in tile units, see `royale/blueprint.ts`) goes under the symmetry. */
export const pointImage = (symmetry: DuelSymmetry): ((point: Point) => Point) =>
  symmetry === 'mirror' ? (p) => ({ x: -p.x, y: p.y }) : (p) => ({ x: -p.x, y: -p.y });
