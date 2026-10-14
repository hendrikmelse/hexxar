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

/** The average width the weights above give (1.95). */
export const MEAN_WIDTH =
  CORRIDOR_WIDTHS.reduce((sum, [width, weight]) => sum + width * weight, 0) /
  CORRIDOR_WIDTHS.reduce((sum, [, weight]) => sum + weight, 0);

/** Shuffle a list in place, with the rng. */
export function shuffleInPlace<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

/**
 * Widths for `lengths.length` corridors. The widths are a fixed set, in exactly the proportions of
 * `CORRIDOR_WIDTHS` as far as whole corridors allow (the rounding goes to the likeliest widths), so
 * no board is all narrow or all wide. They start shuffled; then pairs are swapped (a wide corridor
 * with a narrow one) while that brings the total area of the corridors, the sum of length times
 * width (each counted as many times as the corridor has copies), closer to what the average width would give: a long corridor tends to get a narrow
 * width, and a short one a wide width, so the land they cover does not depend on the luck of the draw.
 */
export function assignWidths(
  lengths: readonly number[],
  rng: Rng,
  weights: readonly number[] = lengths.map(() => 1),
): number[] {
  const count = lengths.length;
  const total = CORRIDOR_WIDTHS.reduce((sum, [, weight]) => sum + weight, 0);
  // Whole numbers of each width, the biggest remainders getting the spare corridors.
  const exact = CORRIDOR_WIDTHS.map(([width, weight]) => ({
    width,
    share: (count * weight) / total,
  }));
  const counts = exact.map(({ share }) => Math.floor(share));
  const spare = count - counts.reduce((sum, n) => sum + n, 0);
  exact
    .map(({ share }, i) => ({ i, remainder: share - Math.floor(share) }))
    .sort((a, b) => b.remainder - a.remainder)
    .slice(0, spare)
    .forEach(({ i }) => counts[i]!++);
  const widths = shuffleInPlace(
    exact.flatMap(({ width }, i) => Array.from({ length: counts[i]! }, () => width)),
    rng,
  );
  // Corridors count `weights[i]` times (a symmetric board has copies of each one).
  const weighted = lengths.map((length, i) => length * weights[i]!);
  const budget = weighted.reduce((sum, length) => sum + length, 0) * MEAN_WIDTH;
  let area = widths.reduce((sum, width, i) => sum + width * weighted[i]!, 0);
  for (let step = 0; step < 50 * count && count > 1; step++) {
    const i = rng.int(count);
    const j = rng.int(count);
    if (widths[i] === widths[j]) continue;
    const next = area + (widths[j]! - widths[i]!) * (weighted[i]! - weighted[j]!);
    if (Math.abs(next - budget) < Math.abs(area - budget)) {
      [widths[i], widths[j]] = [widths[j]!, widths[i]!];
      area = next;
    }
  }
  return widths;
}

/**
 * How long each tree corridor's bridge is meant to be, in tiles of open ground between the two
 * bowls. The lengths follow the sum of two random numbers, `4 + (U₁ + U₂ − 1) × 2` (so most are
 * between 3 and 5, about 3 in 4, and a few are shorter or longer, from 2 to 6), but are not drawn
 * independently: they are the evenly spaced quantiles of that distribution, shuffled among the
 * corridors, so the average length of a board's bridges is always the same.
 */
export function bridgeLengths(count: number, rng: Rng): number[] {
  const lengths = Array.from({ length: count }, (_, i) => {
    const u = (i + 0.5) / count;
    // The inverse of the distribution of U₁ + U₂ (a triangle between 0 and 2).
    const sum = u < 0.5 ? Math.sqrt(2 * u) : 2 - Math.sqrt(2 * (1 - u));
    return 4 + (sum - 1) * 2;
  });
  return shuffleInPlace(lengths, rng);
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
