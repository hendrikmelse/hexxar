import { hexFlipHorizontal, hexFlipVertical, hexRotate, type Hex } from '../hex.js';
import type { Point } from '../royale/blueprint.js';

/**
 * The two ways a two-player board can be symmetric: a mirror, or a half turn about the middle of
 * the board. Both are exact on hexes (they map hex centers to hex centers).
 */
export type DuelSymmetry = 'mirror' | 'rotational';

/**
 * Which line a mirror board is mirrored across. A hex has two kinds of mirror line through its
 * middle: `points` runs up and down, through two opposite corners of the center tile (the line
 * goes through tile corners and along tile edges); `edges` is turned 30 degrees from that and
 * runs through the middles of two opposite edges of the center tile. Half-turn boards have no line.
 */
export type DuelAxis = 'points' | 'edges';

const HALF_SQRT3 = Math.sqrt(3) / 2;

/** Where a hex goes under the symmetry. */
export const hexImage = (
  symmetry: DuelSymmetry,
  axis: DuelAxis = 'points',
): ((hex: Hex) => Hex) => {
  if (symmetry === 'rotational') return (hex) => hexRotate(hex, 3);
  // The `edges` mirror is the mirror across a line 60 degrees round from the sideways one, which
  // is that mirror followed by a turn of twice that angle (120 degrees, two steps).
  return axis === 'points' ? hexFlipHorizontal : (hex) => hexRotate(hexFlipVertical(hex), 2);
};

/** Where a point (in tile units, see `royale/blueprint.ts`) goes under the symmetry. */
export const pointImage = (
  symmetry: DuelSymmetry,
  axis: DuelAxis = 'points',
): ((point: Point) => Point) => {
  if (symmetry === 'rotational') return (p) => ({ x: -p.x, y: -p.y });
  return axis === 'points'
    ? (p) => ({ x: -p.x, y: p.y })
    : (p) => ({ x: -0.5 * p.x + HALF_SQRT3 * p.y, y: HALF_SQRT3 * p.x + 0.5 * p.y });
};

/** The direction of a mirror line, and the direction at right angles to it (both of length 1). */
export const mirrorFrame = (axis: DuelAxis): { along: Point; across: Point } =>
  axis === 'points'
    ? { along: { x: 0, y: 1 }, across: { x: 1, y: 0 } }
    : { along: { x: 0.5, y: HALF_SQRT3 }, across: { x: HALF_SQRT3, y: -0.5 } };
