import type { Rng } from '../../rng.js';
import { segmentDistance, type Chamber, type Point } from '../blueprint.js';

/** Open ground between the start bowls that relaxing pushes them apart to: their centers end up `2 × radius + this` apart. */
export const SPAWN_GAP = 1.4;
/** The start bowls are all placed inside a disc of this radius at first, and pushed apart from there. */
export const SPAWN_START_RADIUS = 4;
/** The least open ground between two chambers, so a corridor is long enough to read as one. */
export const MIN_GAP = 2;
/** Corridor widths, in hexes, and how often each is picked (30%, 45% and 25%). */
export const CORRIDOR_WIDTHS: readonly (readonly [width: number, weight: number])[] = [
  [1, 30],
  [2, 45],
  [3, 25],
];

/** A random corridor width, by the weights above. */
export function pickWidth(rng: Rng): number {
  const total = CORRIDOR_WIDTHS.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng.next() * total;
  for (const [width, weight] of CORRIDOR_WIDTHS) {
    roll -= weight;
    if (roll < 0) return width;
  }
  return CORRIDOR_WIDTHS[0]![0];
}

export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Does the straight line between two chambers run through another one? */
export const blocked = (chambers: readonly Chamber[], a: number, b: number): boolean =>
  chambers.some(
    (other, i) =>
      i !== a &&
      i !== b &&
      segmentDistance(other.center, chambers[a]!.center, chambers[b]!.center) < other.radius + 0.5,
  );
