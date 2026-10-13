import type { Rng } from '../rng.js';

/**
 * Pieces shared by the blueprints of the fair boards (two players, in `blueprint.ts`, and three,
 * in `trio.ts`): how big and how far apart the blobs are, how wide the corridors are, and how
 * often boards cross over between their parts.
 */

/** How big the blobs are: a little bigger on bigger boards. */
export const blobRadius = (size: number): number => Math.min(2.4, 1.2 + 0.1 * size);
/** Chance that an extra blob sits on the line (or point) of symmetry, and so has no twin. */
export const ON_AXIS_CHANCE = 0.4;
/** The least open ground between two blobs, so the corridor between them reads as one. */
export const GAP = 2.2;
export const PLACE_TRIES = 200;
/** Corridor widths in hexes, and how often each is picked: mostly narrow, so they read as passages. */
export const CORRIDOR_WIDTHS: readonly (readonly [width: number, weight: number])[] = [
  [1, 5],
  [2, 3],
  [3, 1],
];
/**
 * How many corridors cross from one part of the board to another, besides the one that has to
 * when no blob is on the line or point of symmetry, and how often. Each comes with its twins.
 */
export const CROSSOVERS: readonly (readonly [count: number, weight: number])[] = [
  [0, 4],
  [1, 3],
  [2, 2],
  [3, 1],
];

/**
 * Chance that blobs on a line of symmetry of a mirror board may be joined to each other. Such a
 * corridor runs dead straight along the line, so it is allowed on only some boards; on the others
 * those blobs join the board through blobs off the line.
 */
export const SPINE_CHANCE = 0.3;

export const pickWeighted = (rng: Rng, options: readonly (readonly [number, number])[]): number => {
  const total = options.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng.next() * total;
  for (const [value, weight] of options) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return options[0]![0];
};

export const between = (rng: Rng, low: number, high: number): number =>
  low + rng.next() * (high - low);
