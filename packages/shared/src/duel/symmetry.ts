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

/**
 * Turn a point (in tile units) round the middle by `turns` steps of 60 degrees, the same way
 * `hexRotate` turns a hex.
 */
export function rotatePoint(point: Point, turns: number): Point {
  const angle = (((turns % 6) + 6) % 6) * (Math.PI / 3);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

/**
 * Where a hex goes under the symmetry. A board that has been turned by `turns` steps of 60 degrees
 * after it was made (see `generateDuelLayout`) is symmetric across the turned line: the turn, then
 * the mirror, then the turn back.
 */
export const hexImage = (
  symmetry: DuelSymmetry,
  axis: DuelAxis = 'points',
  turns = 0,
): ((hex: Hex) => Hex) => {
  // A half turn is a half turn however the board is turned.
  if (symmetry === 'rotational') return (hex) => hexRotate(hex, 3);
  // The `edges` mirror is the mirror across a line 60 degrees round from the sideways one, which
  // is that mirror followed by a turn of twice that angle (120 degrees, two steps).
  const mirror =
    axis === 'points' ? hexFlipHorizontal : (hex: Hex) => hexRotate(hexFlipVertical(hex), 2);
  if (turns % 6 === 0) return mirror;
  return (hex) => hexRotate(mirror(hexRotate(hex, -turns)), turns);
};

/** Where a point (in tile units, see `royale/blueprint.ts`) goes under the symmetry. */
export const pointImage = (
  symmetry: DuelSymmetry,
  axis: DuelAxis = 'points',
  turns = 0,
): ((point: Point) => Point) => {
  if (symmetry === 'rotational') return (p) => ({ x: -p.x, y: -p.y });
  const mirror =
    axis === 'points'
      ? (p: Point): Point => ({ x: -p.x, y: p.y })
      : (p: Point): Point => ({
          x: -0.5 * p.x + HALF_SQRT3 * p.y,
          y: HALF_SQRT3 * p.x + 0.5 * p.y,
        });
  if (turns % 6 === 0) return mirror;
  return (p) => rotatePoint(mirror(rotatePoint(p, -turns)), turns);
};

/** The direction of a mirror line, and the direction at right angles to it (both of length 1). */
export const mirrorFrame = (axis: DuelAxis): { along: Point; across: Point } =>
  axis === 'points'
    ? { along: { x: 0, y: 1 }, across: { x: 1, y: 0 } }
    : { along: { x: 0.5, y: HALF_SQRT3 }, across: { x: HALF_SQRT3, y: -0.5 } };

/**
 * The symmetry of a board for three players: turning by 120 and by 240 degrees about the middle
 * (the other two thirds of a full turn). The board maps onto itself under both, so the three
 * players each see the same board from where they start. There is no mirror version, since a mirror
 * would not treat three players alike.
 */
export const trioHexImages: readonly ((hex: Hex) => Hex)[] = [
  (hex) => hexRotate(hex, 2),
  (hex) => hexRotate(hex, 4),
];

/**
 * The symmetry of a board for four players: a mirror across a line through tile corners (up and
 * down), a mirror across the line at right angles to it (which runs through the middles of tile
 * edges: on a hex grid, two lines at right angles are always one of each kind), and the half turn
 * you get by doing both. A board turned by `turns` steps of 60 degrees after it was made is
 * symmetric across the turned lines (as with `hexImage`).
 */
export const quadHexImages = (turns = 0): ((hex: Hex) => Hex)[] => {
  const base: ((hex: Hex) => Hex)[] = [
    hexFlipHorizontal,
    hexFlipVertical,
    (hex) => hexRotate(hex, 3),
  ];
  if (turns % 6 === 0) return base;
  return base.map((image) => (hex) => hexRotate(image(hexRotate(hex, -turns)), turns));
};
