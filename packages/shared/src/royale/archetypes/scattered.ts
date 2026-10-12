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

/** Spawn chambers are all this big, so no player starts with a roomier bowl than another. */
export const SPAWN_RADIUS = 2;
/** Spawn chambers are at least this far apart, centers measured, so their cities are 5+ apart. */
const SPAWN_SPACING = 5.6;
/** The least open ground between two chambers, so a corridor is long enough to read as one. */
const MIN_GAP = 2.5;
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
 * Spawn chambers: each is the best of a few random spots, the one furthest from the spawns
 * already placed, which spreads the players out. Centers sit on a hex so the city is exactly there.
 */
function placeSpawns(count: number, spread: number, rng: Rng): Chamber[] | null {
  const spawns: Chamber[] = [];
  for (let i = 0; i < count; i++) {
    let best: Point | null = null;
    let bestGap = -1;
    for (let attempt = 0; attempt < 40; attempt++) {
      const spot = hexToPoint(pointToHex(inDisc(spread, rng)));
      const gap = Math.min(Infinity, ...spawns.map((other) => distance(spot, other.center)));
      if (gap > bestGap) {
        best = spot;
        bestGap = gap;
      }
    }
    if (!best || bestGap < SPAWN_SPACING) return null;
    spawns.push({ center: best, radius: SPAWN_RADIUS, spawn: true });
  }
  return spawns;
}

/** Neutral rooms, scattered anywhere they fit without crowding another room. */
function placeNeutrals(
  chambers: Chamber[],
  count: number,
  spread: number,
  maxRadius: number,
  rng: Rng,
): void {
  for (let i = 0; i < count; i++) {
    const radius = 1.6 + rng.next() * (maxRadius - 1.6);
    for (let attempt = 0; attempt < PLACE_TRIES; attempt++) {
      const center = inDisc(spread, rng);
      const fits = chambers.every(
        (other) => distance(center, other.center) >= radius + other.radius + MIN_GAP,
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
export function buildScattered({ players, scale, rng }: ArchetypeInput): Blueprint | null {
  const spawns = placeSpawns(players, scale, rng);
  if (!spawns) return null;
  const chambers: Chamber[] = [...spawns];
  const neutrals = Math.max(1, Math.round(players * 0.5) + 1);
  placeNeutrals(chambers, neutrals, scale, 2.2 + 0.15 * scale, rng);
  return { chambers, corridors: connect(chambers, rng) };
}
