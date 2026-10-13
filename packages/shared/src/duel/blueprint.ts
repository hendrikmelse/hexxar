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
import { blocked, distance, pickWidth } from '../royale/archetypes/common.js';
import { topologyIssues } from '../royale/topology.js';
import { hexImage, pointImage, type DuelSymmetry } from './symmetry.js';

/** How big the blobs are: a little bigger on bigger boards. */
export const blobRadius = (size: number): number => Math.min(2.4, 1.2 + 0.1 * size);
/** How many extra blobs (not counting the starting ones and their twins) a board of this size gets. */
const extraBlobs = (size: number): number => Math.max(1, Math.round(size / 2.2));
/** Chance that an extra blob sits on the line (or point) of symmetry, and so has no twin. */
const ON_AXIS_CHANCE = 0.4;
/** The least open ground between two blobs, so the corridor between them reads as one. */
const GAP = 1.5;
const PLACE_TRIES = 200;

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

  // The starting blob, snapped to a hex so its city is exactly on a hex center, and its twin.
  let started = false;
  for (let attempt = 0; attempt < 50 && !started; attempt++) {
    let spot: Point;
    if (symmetry === 'mirror') {
      spot = { x: scale * between(rng, 0.45, 0.85), y: scale * between(rng, -0.5, 0.5) };
    } else {
      const angle = rng.next() * Math.PI * 2;
      const out = scale * between(rng, 0.5, 0.85);
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

  // Extra blobs. On a mirror board several can sit on the line; on a half-turn board only one,
  // in the middle.
  let middleTaken = false;
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
      if (onAxis && symmetry === 'rotational') middleTaken = true;
      break;
    }
  }

  // -- Corridors: always an edge together with its twin.
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
    const width = pickWidth(rng);
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

  // Every pair, once for each twin pair of pairs, shortest first.
  const candidates: { a: number; b: number; length: number }[] = [];
  const seen = new Set<number>();
  for (let a = 0; a < chambers.length; a++) {
    for (let b = a + 1; b < chambers.length; b++) {
      if (seen.has(keyOf(a, b))) continue;
      seen.add(keyOf(a, b));
      seen.add(twinKey(a, b));
      candidates.push({ a, b, length: distance(chambers[a]!.center, chambers[b]!.center) });
    }
  }
  candidates.sort((x, y) => x.length - y.length);
  const joinsSomething = (a: number, b: number): boolean =>
    find(a) !== find(b) || find(twin[a]!) !== find(twin[b]!);
  // First without corridors that run through another blob, then (if need be) with them.
  for (const allowBlocked of [false, true]) {
    for (const { a, b } of candidates) {
      if (!allowBlocked && blocked(chambers, a, b)) continue;
      if (!linked.has(keyOf(a, b)) && joinsSomething(a, b)) addEdge(a, b);
    }
    if (components() === 1) break;
  }
  if (components() !== 1) return null;

  // A few more short corridors, for loops.
  const extras = candidates.filter(
    ({ a, b }) => !linked.has(keyOf(a, b)) && !blocked(chambers, a, b),
  );
  for (const { a, b } of extras.slice(0, Math.round(chambers.length * 0.25))) {
    if (!linked.has(keyOf(a, b))) addEdge(a, b);
  }

  // No tail or peninsula longer than one corridor: close each into a loop, twins together.
  const all = chambers.map((_, i) => i);
  for (let step = 0; step < 4 * chambers.length; step++) {
    const { tails } = topologyIssues(chambers.length, corridors);
    let best: [number, number] | null = null;
    let bestScore = Infinity;
    for (const from of tails) {
      for (const to of all) {
        if (to === from || linked.has(keyOf(from, to))) continue;
        const score =
          distance(chambers[from]!.center, chambers[to]!.center) +
          (blocked(chambers, from, to) ? 1000 : 0);
        if (score < bestScore) {
          best = [from, to];
          bestScore = score;
        }
      }
    }
    if (!best) break;
    addEdge(best[0], best[1]);
  }
  return { chambers, corridors };
}
