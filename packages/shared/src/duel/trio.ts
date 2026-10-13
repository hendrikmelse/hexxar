import { hexRotate, hexDistance } from '../hex.js';
import type { Rng } from '../rng.js';
import {
  hexToPoint,
  pointToHex,
  type Blueprint,
  type Chamber,
  type Corridor,
  type Point,
} from '../royale/blueprint.js';
import { blocked, distance } from '../royale/archetypes/common.js';
import {
  between,
  blobRadius,
  CORRIDOR_WIDTHS,
  CROSSOVERS,
  GAP,
  ON_AXIS_CHANCE,
  pickWeighted,
  PLACE_TRIES,
} from './common.js';
import { rotatePoint } from './symmetry.js';

/**
 * How many sets of extra blobs a board of this size gets. Each set is three blobs, one in each
 * third of the board, so this is a third as many sets as a duel board has pairs.
 */
const extraSets = (size: number): number => Math.max(1, Math.round(size / 4.4));

/**
 * Boards smaller than this (a radius, in tiles) may have nothing but the three starts. Bigger ones
 * must have another blob, or the layout is stretched until one fits.
 */
const SMALL_SIZE = 5;

export interface TrioBlueprintInput {
  /**
   * Roughly the radius of a board with the wanted number of tiles. It decides how big the blobs
   * are and how many there are, so those stay the same as the layout is stretched to fit.
   */
  readonly size: number;
  /** How far apart the blobs are spread, in tiles: around `size`, and adjusted to get the area right. */
  readonly scale: number;
  readonly rng: Rng;
  /** The three starting cities are at least this many tiles apart. */
  readonly minCityDistance: number;
}

/**
 * A layout of blobs and corridors that maps onto itself under turns of 120 degrees: one starting
 * blob with two twins (chambers 0, 1 and 2, each turned 120 degrees from the one before), a few
 * sets of three extra blobs, and perhaps one blob at the middle, which has no twins.
 *
 * Corridors are made for one third of the board and turned twice onto the others: a spanning tree
 * and some loops over one blob from each set (and the middle one), and then corridors that cross
 * over from one third to the next. The three thirds are joined through the middle blob or, if
 * there is none, by a corridor that crosses over; a random number more cross over as well.
 */
export function buildTrioBlueprint({
  size,
  scale,
  rng,
  minCityDistance,
}: TrioBlueprintInput): Blueprint | null {
  const radius = blobRadius(size);
  /** A point turned by `k` times 120 degrees. */
  const turn = (point: Point, k: number): Point => rotatePoint(point, 2 * k);
  const chambers: Chamber[] = [];
  /** For each chamber: the first of its three twins, and where it is among them (the middle blob is alone). */
  const first: number[] = [];
  const slot: number[] = [];
  const alone: boolean[] = [];

  const addBlob = (center: Point, blobSize: number, spawn: boolean, atMiddle: boolean): void => {
    const index = chambers.length;
    for (let k = 0; k < (atMiddle ? 1 : 3); k++) {
      chambers.push({ center: turn(center, k), radius: blobSize, spawn });
      first.push(index);
      slot.push(k);
      alone.push(atMiddle);
    }
  };
  /** The chamber that chamber `i` becomes after `k` turns of 120 degrees. */
  const twin = (i: number, k: number): number => (alone[i] ? i : first[i]! + ((slot[i]! + k) % 3));

  // A blob at the middle is decided first, because it needs room between the three starts: they
  // are put far enough out for it to fit.
  const middleSize = rng.next() < ON_AXIS_CHANCE ? radius * between(rng, 0.8, 1.1) : null;
  const leastOut = middleSize === null ? 0 : middleSize + radius + GAP + 0.3;

  // The starting blob, snapped to a hex so its city is exactly on a hex center, and its twins.
  let started = false;
  for (let attempt = 0; attempt < 50 && !started; attempt++) {
    const angle = rng.next() * Math.PI * 2;
    const out = Math.max(scale * between(rng, 0.5, 0.85), leastOut + scale * between(rng, 0, 0.2));
    const hex = pointToHex({ x: Math.cos(angle) * out, y: Math.sin(angle) * out });
    if (hexDistance(hex, hexRotate(hex, 2)) < minCityDistance) continue;
    const center = hexToPoint(hex);
    if (distance(center, turn(center, 1)) < 2 * radius + GAP) continue;
    addBlob(center, radius, true, false);
    started = true;
  }
  if (!started) return null;
  if (middleSize !== null) addBlob({ x: 0, y: 0 }, middleSize, false, true);

  // Extra sets of three blobs, wherever they fit.
  for (let set = 0; set < extraSets(size); set++) {
    const blobSize = radius * between(rng, 0.8, 1.25);
    for (let attempt = 0; attempt < PLACE_TRIES; attempt++) {
      const angle = rng.next() * Math.PI * 2;
      const out = scale * 1.2 * Math.sqrt(rng.next());
      const center = { x: Math.cos(angle) * out, y: Math.sin(angle) * out };
      // The existing blobs map onto themselves under the turns, so room for this one is room for its twins.
      const fits =
        chambers.every(
          (other) => distance(center, other.center) >= blobSize + other.radius + GAP,
        ) && distance(center, turn(center, 1)) >= 2 * blobSize + GAP;
      if (!fits) continue;
      addBlob(center, blobSize, false, false);
      break;
    }
  }

  if (chambers.length === 3 && size >= SMALL_SIZE) return null;

  // -- Corridors. Every one is added together with its two twins, so the layout maps onto itself.
  const corridors: Corridor[] = [];
  const keyOf = (a: number, b: number): number => Math.min(a, b) * 1000 + Math.max(a, b);
  const linked = new Set<number>();
  const parent = chambers.map((_, i) => i);
  const find = (i: number): number => {
    if (parent[i] !== i) parent[i] = find(parent[i]!);
    return parent[i]!;
  };
  const components = (): number => new Set(chambers.map((_, i) => find(i))).size;
  const addEdge = (a: number, b: number): void => {
    const length = distance(chambers[a]!.center, chambers[b]!.center);
    const width = pickWeighted(rng, CORRIDOR_WIDTHS);
    // Turning leaves a corridor's bend as it is.
    const bend = (rng.next() - 0.5) * 0.3 * length;
    for (let k = 0; k < 3; k++) {
      const from = twin(a, k);
      const to = twin(b, k);
      if (linked.has(keyOf(from, to))) continue;
      corridors.push({ from, to, width, bend });
      linked.add(keyOf(from, to));
      parent[find(from)] = find(to);
    }
  };

  // The three starts are never joined by a corridor of their own, unless they are the only blobs:
  // then there is no other way to join them.
  const onlyStarts = chambers.length === 3;
  const betweenStarts = (a: number, b: number): boolean =>
    !onlyStarts && chambers[a]!.spawn && chambers[b]!.spawn;
  // Lengths are shaken up a little, so the nearest blob is not always the one that gets joined.
  const shaken = (a: number, b: number): number =>
    distance(chambers[a]!.center, chambers[b]!.center) * between(rng, 0.8, 1.3);

  // One third of the board: one blob from each set, and the middle blob. Joined by a spanning tree
  // (first without corridors that run through another blob, then, if need be, with them), and a
  // few more short corridors for loops.
  const third = chambers.map((_, i) => i).filter((i) => slot[i] === 0);
  const pairs: { a: number; b: number; weight: number }[] = [];
  for (const [n, a] of third.entries()) {
    for (const b of third.slice(n + 1)) pairs.push({ a, b, weight: shaken(a, b) });
  }
  pairs.sort((x, y) => x.weight - y.weight);
  const thirdParent = new Map(third.map((i) => [i, i]));
  const thirdFind = (i: number): number => {
    const up = thirdParent.get(i)!;
    if (up === i) return i;
    const root = thirdFind(up);
    thirdParent.set(i, root);
    return root;
  };
  const chosen: { a: number; b: number }[] = [];
  for (const allowBlocked of [false, true]) {
    for (const { a, b } of pairs) {
      if (!allowBlocked && blocked(chambers, a, b)) continue;
      if (thirdFind(a) === thirdFind(b)) continue;
      thirdParent.set(thirdFind(a), thirdFind(b));
      chosen.push({ a, b });
    }
    if (new Set(third.map(thirdFind)).size === 1) break;
  }
  if (new Set(third.map(thirdFind)).size !== 1) return null;
  const isChosen = new Set(chosen.map(({ a, b }) => keyOf(a, b)));
  const loops = pairs.filter(({ a, b }) => !isChosen.has(keyOf(a, b)) && !blocked(chambers, a, b));
  for (const pair of loops.slice(0, Math.round(third.length * 0.35))) chosen.push(pair);
  for (const { a, b } of chosen) addEdge(a, b);

  // Crossovers: corridors from a blob in one third to a twin of a blob in the next. If the thirds
  // are not already joined (through the middle blob), one has to cross over; after that, a random
  // number more do (none is the most likely).
  const across: { a: number; b: number; weight: number }[] = [];
  for (const a of third) {
    for (const b of third) {
      for (const k of [1, 2]) {
        const target = twin(b, k);
        if (target === a || betweenStarts(a, target) || alone[b]) continue;
        across.push({ a, b: target, weight: shaken(a, target) });
      }
    }
  }
  across.sort((x, y) => x.weight - y.weight);
  let extraCrossovers = pickWeighted(rng, CROSSOVERS);
  for (const allowBlocked of [false, true]) {
    for (const { a, b } of across) {
      const needed = components() !== 1;
      if (!needed && extraCrossovers === 0) break;
      // Only the one that has to cross over may run through another blob.
      if (allowBlocked && !needed) break;
      if (!allowBlocked && blocked(chambers, a, b)) continue;
      if (linked.has(keyOf(a, b))) continue;
      addEdge(a, b);
      if (!needed) extraCrossovers--;
    }
  }
  if (components() !== 1) return null;
  return { chambers, corridors };
}
