import type { Rng } from '../../rng.js';
import {
  hexToPoint,
  pointToHex,
  segmentDistance,
  type Blueprint,
  type Chamber,
  type Corridor,
  type Point,
} from '../blueprint.js';
import type { ArchetypeInput } from './types.js';

/**
 * Spawn chambers are all the same size, so no player starts with a roomier bowl than another.
 * Closer cities get smaller bowls, but never less than the city and the ring around it.
 */
export const spawnRadius = (startDistance: number): number =>
  Math.min(2, Math.max(1.2, startDistance * 0.4));
/** Spawn chamber centers are a little further apart than the cities are required to be. */
const spawnSpacing = (startDistance: number): number => startDistance + 0.6;
/** The least open ground between two chambers, so a corridor is long enough to read as one. */
const minGap = (startDistance: number): number => Math.min(2.5, Math.max(1.5, startDistance * 0.5));
/** How many random spots are tried for each room before it is given up on. */
const PLACE_TRIES = 200;

/** Corridor widths, in hexes, and how often each is picked. The wide ones are not chokes. */
export const CORRIDOR_WIDTHS: readonly (readonly [width: number, weight: number])[] = [
  [1, 3],
  [2, 3],
  [3, 2.5],
  [4, 1.5],
];

export function pickWidth(rng: Rng): number {
  const total = CORRIDOR_WIDTHS.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng.next() * total;
  for (const [width, weight] of CORRIDOR_WIDTHS) {
    roll -= weight;
    if (roll < 0) return width;
  }
  return CORRIDOR_WIDTHS[0]![0];
}

/** A random spot in a disc of the given radius around the origin. */
function inDisc(radius: number, rng: Rng): Point {
  const angle = rng.next() * Math.PI * 2;
  const distance = radius * Math.sqrt(rng.next());
  return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
}

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Push apart any points closer than `spacing`, keeping them inside a disc, until none are (or
 * the rounds run out). Plain random spots cannot pack bowls tightly; this can.
 */
function relax(points: Point[], spacing: number, limit: number): void {
  for (let round = 0; round < 400; round++) {
    let moved = false;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i]!;
        const b = points[j]!;
        const gap = distance(a, b);
        if (gap >= spacing) continue;
        moved = true;
        const push = (spacing - gap) / 2 + 0.01;
        const dx = gap === 0 ? 1 : (b.x - a.x) / gap;
        const dy = gap === 0 ? 0 : (b.y - a.y) / gap;
        points[i] = { x: a.x - dx * push, y: a.y - dy * push };
        points[j] = { x: b.x + dx * push, y: b.y + dy * push };
      }
    }
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!;
      const out = Math.hypot(p.x, p.y);
      if (out > limit) points[i] = { x: (p.x / out) * limit, y: (p.y / out) * limit };
    }
    if (!moved) return;
  }
}

/**
 * Spawn chambers: each starts as the best of a few random spots, the one furthest from the spawns
 * already placed, which spreads the players out; then they are pushed apart until every pair is
 * far enough. Centers end up on a hex so the city is exactly there.
 */
function placeSpawns(
  count: number,
  spread: number,
  startDistance: number,
  rng: Rng,
): Chamber[] | null {
  const spacing = spawnSpacing(startDistance);
  const points: Point[] = [];
  for (let i = 0; i < count; i++) {
    let best: Point = inDisc(spread, rng);
    let bestGap = -1;
    for (let attempt = 0; attempt < 40; attempt++) {
      const spot = inDisc(spread, rng);
      const gap = Math.min(Infinity, ...points.map((other) => distance(spot, other)));
      if (gap > bestGap) {
        best = spot;
        bestGap = gap;
      }
    }
    points.push(best);
  }
  relax(points, spacing, spread * 1.15);
  const centers = points.map((p) => hexToPoint(pointToHex(p)));
  for (const [i, a] of centers.entries()) {
    // Snapping to a hex moves a point a little, so the real gap is checked on the hexes.
    if (centers.slice(i + 1).some((b) => distance(a, b) < startDistance)) return null;
  }
  return centers.map((center) => ({ center, radius: spawnRadius(startDistance), spawn: true }));
}

/** Neutral rooms, scattered anywhere they fit without crowding another room. */
function placeNeutrals(
  chambers: Chamber[],
  count: number,
  spread: number,
  maxRadius: number,
  startDistance: number,
  rng: Rng,
): void {
  const smallest = Math.min(1.6, spawnRadius(startDistance));
  const gap = minGap(startDistance);
  for (let i = 0; i < count; i++) {
    const radius = smallest + rng.next() * Math.max(0, maxRadius - smallest);
    for (let attempt = 0; attempt < PLACE_TRIES; attempt++) {
      const center = inDisc(spread, rng);
      const fits = chambers.every(
        (other) => distance(center, other.center) >= radius + other.radius + gap,
      );
      if (fits) {
        chambers.push({ center, radius, spawn: false });
        break;
      }
    }
  }
}

/** Does the straight line between two chambers run through another one? */
const blocked = (chambers: readonly Chamber[], a: number, b: number): boolean =>
  chambers.some(
    (other, i) =>
      i !== a &&
      i !== b &&
      segmentDistance(other.center, chambers[a]!.center, chambers[b]!.center) < other.radius + 0.5,
  );

/**
 * Join the chambers: a minimum spanning tree so everything is reachable, then a few extra short
 * passages that make loops. Corridors are picked at random widths and bowed a little.
 */
function connect(chambers: readonly Chamber[], rng: Rng): Corridor[] {
  const corridors: Corridor[] = [];
  const linked = new Set<number>([0]);
  const pairs = new Set<string>();
  const add = (from: number, to: number): void => {
    const length = distance(chambers[from]!.center, chambers[to]!.center);
    corridors.push({
      from,
      to,
      width: pickWidth(rng),
      bend: (rng.next() - 0.5) * 0.3 * length,
    });
    pairs.add(`${Math.min(from, to)}-${Math.max(from, to)}`);
  };

  while (linked.size < chambers.length) {
    let best: [number, number] | null = null;
    let bestLength = Infinity;
    for (const from of linked) {
      for (let to = 0; to < chambers.length; to++) {
        if (linked.has(to)) continue;
        const length = distance(chambers[from]!.center, chambers[to]!.center);
        if (length < bestLength) {
          best = [from, to];
          bestLength = length;
        }
      }
    }
    if (!best) break;
    add(best[0], best[1]);
    linked.add(best[1]);
  }

  const treeLengths = corridors
    .map((c) => distance(chambers[c.from]!.center, chambers[c.to]!.center))
    .sort((a, b) => a - b);
  const reach = 1.4 * (treeLengths[Math.floor(treeLengths.length / 2)] ?? 0);
  const extras: [number, number, number][] = [];
  for (let from = 0; from < chambers.length; from++) {
    for (let to = from + 1; to < chambers.length; to++) {
      const length = distance(chambers[from]!.center, chambers[to]!.center);
      if (length <= reach && !pairs.has(`${from}-${to}`) && !blocked(chambers, from, to)) {
        extras.push([from, to, length]);
      }
    }
  }
  extras.sort((a, b) => a[2] - b[2] || rng.next() - 0.5);
  const loops = Math.round(chambers.length * 0.3);
  for (const [from, to] of extras.slice(0, loops)) add(from, to);
  return corridors;
}

/**
 * Rooms scattered at random, joined by a spanning tree and a few loops. The general-purpose
 * layout: no strong shape of its own, so it is the baseline the other archetypes are compared to.
 */
export function buildScattered({
  players,
  scale,
  rng,
  startDistance,
}: ArchetypeInput): Blueprint | null {
  const spawns = placeSpawns(players, scale, startDistance, rng);
  if (!spawns) return null;
  const chambers: Chamber[] = [...spawns];
  const neutrals = Math.max(1, Math.round(players * 0.5) + 1);
  placeNeutrals(chambers, neutrals, scale, 2.2 + 0.15 * scale, startDistance, rng);
  return { chambers, corridors: connect(chambers, rng) };
}
