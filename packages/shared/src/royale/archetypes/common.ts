import type { Rng } from '../../rng.js';
import { segmentDistance, type Chamber, type Point } from '../blueprint.js';

/**
 * How crowded a board is with players, from 0 (6 players or fewer) rising evenly to 1 (12 or
 * more). Crowded boards get narrower corridors and bowls a little further apart, so that with
 * many players the land does not turn into one wide tangle.
 */
export const crowding = (players: number): number => Math.min(1, Math.max(0, (players - 6) / 6));
/**
 * Spawn chambers are all the same size, so no player starts with a roomier bowl than another.
 * Closer cities get smaller bowls, but never less than the city and the ring around it. Crowded
 * boards (see `crowding`) get bigger bowls, so the land is bowls and short bridges, not thin spindles.
 */
export const spawnRadius = (startDistance: number, crowded = 0): number =>
  Math.min(2, Math.max(1.2, startDistance * 0.4)) +
  CROWDED_RADIUS * crowded * Math.min(1, Math.max(0, (startDistance - 3) / 2));
/**
 * How much bigger (in tiles) the bowls of a fully crowded board are than those of an empty one,
 * on large boards (start distance 5); normal boards get half of it, and small boards none.
 */
const CROWDED_RADIUS = 0.4;
/** How much further apart (in tiles) the bowls of a fully crowded board are than those of an empty one. */
const CROWDED_SPACING = 0.6;
/** Spawn chamber centers are a little further apart than the cities are required to be. */
export const spawnSpacing = (startDistance: number, crowded = 0): number =>
  startDistance + 0.6 + CROWDED_SPACING * crowded;
/** The least open ground between two chambers, so a corridor is long enough to read as one. */
export const minGap = (startDistance: number): number =>
  Math.min(2.5, Math.max(1.5, startDistance * 0.5));
/** Corridor widths, in hexes, and how often each is picked. The wide ones are not chokes. */
export const CORRIDOR_WIDTHS: readonly (readonly [width: number, weight: number])[] = [
  [1, 3],
  [2, 3],
  [3, 2.5],
  [4, 1.5],
];

/**
 * A random corridor width. On a crowded board (see `crowding`) the narrow ones are likelier and
 * the wide ones rarer: at full crowding, 1 wide is picked 5 times in 10 (not 3 in 10) and 4 wide
 * only 0.5 in 10 (not 1.5).
 */
export function pickWidth(rng: Rng, crowded = 0): number {
  const weights = CORRIDOR_WIDTHS.map(([width, weight]): [number, number] => [
    width,
    width === 1
      ? weight + 3 * crowded
      : width >= 3
        ? Math.max(0.2, weight - 1.5 * crowded)
        : weight,
  ]);
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng.next() * total;
  for (const [width, weight] of weights) {
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
