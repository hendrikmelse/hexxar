import type { Rng } from '../rng.js';
import { hexDistance } from '../hex.js';
import {
  hexToPoint,
  pointToHex,
  type Blueprint,
  type Chamber,
  type Corridor,
  type Point,
} from '../royale/blueprint.js';
import { blocked, distance } from '../royale/archetypes/common.js';
import { hexImage, pointImage, type DuelSymmetry } from './symmetry.js';

/** How big the blobs are: a little bigger on bigger boards. */
export const blobRadius = (size: number): number => Math.min(2.4, 1.2 + 0.1 * size);
/** How many extra blobs (not counting the starting ones and their twins) a board of this size gets. */
const extraBlobs = (size: number): number => Math.max(1, Math.round(size / 2.2));
/** Chance that an extra blob sits on the line (or point) of symmetry, and so has no twin. */
const ON_AXIS_CHANCE = 0.4;
/** The least open ground between two blobs, so the corridor between them reads as one. */
const GAP = 2.2;
const PLACE_TRIES = 200;
/** Corridor widths in hexes, and how often each is picked: mostly narrow, so they read as passages. */
const CORRIDOR_WIDTHS: readonly (readonly [width: number, weight: number])[] = [
  [1, 5],
  [2, 3],
  [3, 1],
];
/**
 * Chance that blobs on the line of symmetry of a mirror board may be joined to each other. Such a
 * corridor runs dead straight down the middle, so it is allowed on only some boards; on the others
 * those blobs join the board through blobs off the line.
 */
const SPINE_CHANCE = 0.3;
/**
 * How many corridors cross from one half of the board to the other, besides the one that has to
 * when no blob is on the line or point of symmetry, and how often. Each comes with its twin.
 */
const CROSSOVERS: readonly (readonly [count: number, weight: number])[] = [
  [0, 4],
  [1, 3],
  [2, 2],
  [3, 1],
];

const pickWeighted = (rng: Rng, options: readonly (readonly [number, number])[]): number => {
  const total = options.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng.next() * total;
  for (const [value, weight] of options) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return options[0]![0];
};

export interface DuelBlueprintInput {
  readonly symmetry: DuelSymmetry;
  /**
   * Roughly the radius of a board with the wanted number of tiles. It decides how big the blobs
   * are and how many there are, so those stay the same as the layout is stretched to fit.
   */
  readonly size: number;
  /** How far apart the blobs are spread, in tiles: around `size`, and adjusted to get the area right. */
  readonly scale: number;
  readonly rng: Rng;
  /** The two starting cities are at least this many tiles apart. */
  readonly minCityDistance: number;
}

const between = (rng: Rng, low: number, high: number): number => low + rng.next() * (high - low);

/**
 * A symmetric layout of blobs and corridors: one starting blob (and, across the board, its twin),
 * and a few extra blobs, some of them on the line or point of symmetry and some not (those come
 * in twin pairs). Every corridor is added together with its twin, so the whole thing maps onto
 * itself. Chambers 0 and 1 are the two starts.
 */
export function buildDuelBlueprint({
  symmetry,
  size,
  scale,
  rng,
  minCityDistance,
}: DuelBlueprintInput): Blueprint | null {
  const imageOfPoint = pointImage(symmetry);
  const imageOfHex = hexImage(symmetry);
  const radius = blobRadius(size);
  const chambers: Chamber[] = [];
  /** For each chamber, the one it is the twin of (itself, if it is on the line or point). */
  const twin: number[] = [];

  const addBlob = (center: Point, size: number, spawn: boolean, onAxis: boolean): void => {
    const index = chambers.length;
    chambers.push({ center, radius: size, spawn });
    if (onAxis) twin.push(index);
    else {
      chambers.push({ center: imageOfPoint(center), radius: size, spawn });
      twin.push(index + 1, index);
    }
  };
  const room = (center: Point, size: number, hasTwin: boolean): boolean =>
    chambers.every((other) => distance(center, other.center) >= size + other.radius + GAP) &&
    (!hasTwin || distance(center, imageOfPoint(center)) >= 2 * size + GAP);

  // A half-turn board may have a blob at the middle. That is decided first, because it needs room
  // between the two starts: they are put far enough out for it to fit.
  const middleSize =
    symmetry === 'rotational' && rng.next() < ON_AXIS_CHANCE
      ? radius * between(rng, 0.8, 1.1)
      : null;
  const leastOut = middleSize === null ? 0 : middleSize + radius + GAP + 0.3;

  // The starting blob, snapped to a hex so its city is exactly on a hex center, and its twin.
  let started = false;
  for (let attempt = 0; attempt < 50 && !started; attempt++) {
    let spot: Point;
    if (symmetry === 'mirror') {
      spot = { x: scale * between(rng, 0.45, 0.85), y: scale * between(rng, -0.5, 0.5) };
    } else {
      const angle = rng.next() * Math.PI * 2;
      const out = Math.max(
        scale * between(rng, 0.5, 0.85),
        leastOut + scale * between(rng, 0, 0.2),
      );
      spot = { x: Math.cos(angle) * out, y: Math.sin(angle) * out };
    }
    const hex = pointToHex(spot);
    if (hexDistance(hex, imageOfHex(hex)) < minCityDistance) continue;
    const center = hexToPoint(hex);
    if (distance(center, imageOfPoint(center)) < 2 * radius + GAP) continue;
    addBlob(center, radius, true, false);
    started = true;
  }
  if (!started) return null;

  if (middleSize !== null) addBlob({ x: 0, y: 0 }, middleSize, false, true);

  // Extra blobs. On a mirror board several can sit on the line; a half-turn board has the middle
  // blob above or none, and no other blob is on its point.
  const middleTaken = symmetry === 'rotational';
  for (let blob = 0; blob < extraBlobs(size); blob++) {
    const size = radius * between(rng, 0.8, 1.25);
    for (let attempt = 0; attempt < PLACE_TRIES; attempt++) {
      const onAxis = rng.next() < ON_AXIS_CHANCE && !(symmetry === 'rotational' && middleTaken);
      let center: Point;
      if (onAxis) {
        center =
          symmetry === 'mirror' ? { x: 0, y: scale * between(rng, -1.1, 1.1) } : { x: 0, y: 0 };
      } else {
        const angle = rng.next() * Math.PI * 2;
        const out = scale * 1.2 * Math.sqrt(rng.next());
        center = { x: Math.cos(angle) * out, y: Math.sin(angle) * out };
      }
      if (!room(center, size, !onAxis)) continue;
      addBlob(center, size, false, onAxis);
      break;
    }
  }

  // -- Corridors. Every one is added together with its twin, so the layout maps onto itself.
  const corridors: Corridor[] = [];
  const keyOf = (a: number, b: number): number => Math.min(a, b) * 1000 + Math.max(a, b);
  const twinKey = (a: number, b: number): number => keyOf(twin[a]!, twin[b]!);
  const linked = new Set<number>();
  const parent = chambers.map((_, i) => i);
  const find = (i: number): number => {
    if (parent[i] !== i) parent[i] = find(parent[i]!);
    return parent[i]!;
  };
  const union = (a: number, b: number): void => {
    parent[find(a)] = find(b);
  };
  const addEdge = (a: number, b: number): void => {
    const length = distance(chambers[a]!.center, chambers[b]!.center);
    const width = pickWeighted(rng, CORRIDOR_WIDTHS);
    // An edge that is its own twin has to run straight, or it would not be symmetric.
    const alone = keyOf(a, b) === twinKey(a, b);
    const bend = alone ? 0 : (rng.next() - 0.5) * 0.3 * length;
    corridors.push({ from: a, to: b, width, bend });
    linked.add(keyOf(a, b));
    union(a, b);
    if (!alone) {
      // A mirror turns a bend the other way round; a half turn leaves it as it is.
      corridors.push({
        from: twin[a]!,
        to: twin[b]!,
        width,
        bend: symmetry === 'mirror' ? -bend : bend,
      });
      linked.add(twinKey(a, b));
      union(twin[a]!, twin[b]!);
    }
  };
  const components = (): number => new Set(chambers.map((_, i) => find(i))).size;

  // The corridors are made for one half of the board, picked at random, and mirrored onto the
  // other. The half has every blob on its side, and the blobs on the line or point of symmetry.
  const keepSide = rng.next() < 0.5 ? 1 : -1;
  const sideOf = (i: number): number => {
    const { x, y } = chambers[i]!.center;
    return Math.sign(symmetry === 'mirror' || y === 0 ? x : y);
  };
  const half = chambers.map((_, i) => i).filter((i) => twin[i] === i || sideOf(i) === keepSide);
  // Lengths are shaken up a little, so the nearest blob is not always the one that gets joined.
  const shaken = (a: number, b: number): number =>
    distance(chambers[a]!.center, chambers[b]!.center) * between(rng, 0.8, 1.3);
  const spine = rng.next() < SPINE_CHANCE;
  // The two starts (chambers 0 and 1) are never joined by a corridor of their own: they are only
  // ever joined through other blobs, though the land may happen to run together.
  const startsKey = keyOf(0, 1);
  const pairs: { a: number; b: number; weight: number }[] = [];
  for (const [n, a] of half.entries()) {
    for (const b of half.slice(n + 1)) {
      // Two blobs on the line: the corridor between them would run straight down it.
      if (!spine && twin[a] === a && twin[b] === b) continue;
      if (keyOf(a, b) === startsKey) continue;
      pairs.push({ a, b, weight: shaken(a, b) });
    }
  }
  pairs.sort((x, y) => x.weight - y.weight);

  // A spanning tree over the half (first without corridors that run through another blob, then,
  // if need be, with them), then a few more short corridors for loops.
  const inHalf = new Map(half.map((i) => [i, i]));
  const halfFind = (i: number): number => {
    const parentOf = inHalf.get(i)!;
    if (parentOf === i) return i;
    const root = halfFind(parentOf);
    inHalf.set(i, root);
    return root;
  };
  const chosen: { a: number; b: number }[] = [];
  const isChosen = new Set<number>();
  const choose = (a: number, b: number): void => {
    chosen.push({ a, b });
    isChosen.add(keyOf(a, b));
  };
  const halfComponents = (): number => new Set(half.map(halfFind)).size;
  for (const allowBlocked of [false, true]) {
    for (const { a, b } of pairs) {
      if (!allowBlocked && blocked(chambers, a, b)) continue;
      if (halfFind(a) === halfFind(b)) continue;
      inHalf.set(halfFind(a), halfFind(b));
      choose(a, b);
    }
    if (halfComponents() === 1) break;
  }
  if (halfComponents() !== 1) return null;
  const loops = pairs.filter(({ a, b }) => !isChosen.has(keyOf(a, b)) && !blocked(chambers, a, b));
  for (const { a, b } of loops.slice(0, Math.round(half.length * 0.35))) choose(a, b);
  for (const { a, b } of chosen) if (!linked.has(keyOf(a, b))) addEdge(a, b);

  // Corridors from one half to the other, nearest first. If the halves are not already joined
  // through a blob on the line or point, one has to cross over; after that, a random number more
  // do (none is the most likely), each with its twin.
  const across: { a: number; b: number; weight: number }[] = [];
  for (const a of half) {
    for (let b = 0; b < chambers.length; b++) {
      // Never straight from one start to the other (that corridor is its own twin).
      if (keyOf(a, b) === startsKey) continue;
      if (twin[a] !== a && twin[b] !== b && sideOf(b) !== keepSide) {
        across.push({ a, b, weight: shaken(a, b) });
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
