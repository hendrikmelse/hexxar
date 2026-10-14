import type { Rng } from '../../rng.js';
import {
  hexToPoint,
  pointToHex,
  type Blueprint,
  type Chamber,
  type Corridor,
  type Point,
} from '../blueprint.js';
import { topologyIssues } from '../topology.js';
import { blocked, distance, MIN_GAP, pickWidth, SPAWN_GAP, SPAWN_START_RADIUS } from './common.js';
import type { ArchetypeInput } from './types.js';

/** How many random spots are tried for each room before it is given up on. */
const PLACE_TRIES = 200;

/** A random spot in a disc of the given radius around the origin. */
function inDisc(radius: number, rng: Rng): Point {
  const angle = rng.next() * Math.PI * 2;
  const distance = radius * Math.sqrt(rng.next());
  return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
}

/**
 * Push apart any points closer than `spacing`, until none are (or the rounds run out): each pair
 * that is too close moves half the shortfall apart. The points are free to spread out as far as
 * they need to, so this is what sets how far apart the start chambers end up.
 */
function relax(points: Point[], spacing: number): void {
  for (let round = 0; round < RELAX_ROUNDS; round++) {
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
    if (!moved) return;
  }
}

/** The most rounds of relaxing; far more than a board needs. */
const RELAX_ROUNDS = 2000;

/**
 * The start points, spread far apart: every point starts at a random place inside a disc of radius
 * 4 (so they all start piled up in the middle), and relaxing pushes them apart until every pair is
 * `4 × radius + 1.4` apart. They are pulled closer together again by the corridors later (see
 * `tighten`), so how far they end up apart varies from corridor to corridor.
 */
function spreadSpawns(count: number, radius: number, rng: Rng): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < count; i++) points.push(inDisc(SPAWN_START_RADIUS, rng));
  relax(points, 4 * radius + SPAWN_GAP);
  return points;
}

/** A spanning tree over the points: Prim's algorithm from point 0, the nearest unlinked point first. */
function spanningTree(points: readonly Point[]): [number, number][] {
  const tree: [number, number][] = [];
  const linked = new Set<number>([0]);
  while (linked.size < points.length) {
    let best: [number, number] | null = null;
    let bestLength = Infinity;
    for (const from of linked) {
      for (let to = 0; to < points.length; to++) {
        if (linked.has(to)) continue;
        const length = distance(points[from]!, points[to]!);
        if (length < bestLength) {
          best = [from, to];
          bestLength = length;
        }
      }
    }
    if (!best) break;
    tree.push(best);
    linked.add(best[1]);
  }
  return tree;
}

/**
 * How long a tree corridor's bridge is meant to be, in tiles of open ground between the two bowls:
 * 3 plus or minus a little, from the sum of two random numbers (so most are between 2 and 4, about
 * 3 in 4, and a few are shorter or longer, from 1 to 5).
 */
const bridgeLength = (rng: Rng): number => 3 + (rng.next() + rng.next() - 1) * 2;

/**
 * Pull the points together along the tree: each corridor tries to bring its two points to a target
 * distance (twice the radius plus its bridge length), moving both by a quarter of the error each
 * round, while every pair that is not joined by a corridor is still kept at least `2 × radius + 1.4`
 * apart. Stops when everything is within 0.02 of where it should be, or after `RELAX_ROUNDS`.
 */
function tighten(
  points: Point[],
  tree: readonly [number, number][],
  radius: number,
  rng: Rng,
): void {
  const targets = tree.map(() => 2 * radius + bridgeLength(rng));
  const joined = new Set(tree.map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`));
  const spacing = 2 * radius + SPAWN_GAP;
  const move = (i: number, j: number, amount: number): void => {
    // Move i and j toward each other by `amount` each (away, if negative).
    const a = points[i]!;
    const b = points[j]!;
    const gap = distance(a, b);
    const dx = gap === 0 ? 1 : (b.x - a.x) / gap;
    const dy = gap === 0 ? 0 : (b.y - a.y) / gap;
    points[i] = { x: a.x + dx * amount, y: a.y + dy * amount };
    points[j] = { x: b.x - dx * amount, y: b.y - dy * amount };
  };
  for (let round = 0; round < RELAX_ROUNDS; round++) {
    let worst = 0;
    tree.forEach(([a, b], k) => {
      const error = distance(points[a]!, points[b]!) - targets[k]!;
      worst = Math.max(worst, Math.abs(error));
      move(a, b, error / 4);
    });
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        if (joined.has(`${i}-${j}`)) continue;
        const gap = distance(points[i]!, points[j]!);
        if (gap >= spacing) continue;
        worst = Math.max(worst, spacing - gap);
        move(i, j, -((spacing - gap) / 2 + 0.01));
      }
    }
    if (worst < 0.02) return;
  }
}

/**
 * How many neutral rooms (round chambers with no city) this archetype asks for. None: on most
 * boards the starting bowls fill the land, so the rooms only fit on a few (mostly 3-player boards),
 * and a city-less room next to the starting bowls looks like a start with nobody in it. Archetypes
 * that want real neutral hubs use `placeNeutrals` with a count of their own.
 */
const neutralRooms = (): number => 0;

/** Neutral rooms, scattered anywhere they fit without crowding another room. */
function placeNeutrals(
  chambers: Chamber[],
  count: number,
  spread: number,
  maxRadius: number,
  bowlRadius: number,
  rng: Rng,
): void {
  const smallest = bowlRadius;
  const gap = MIN_GAP;
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

/**
 * Join the chambers: the spanning tree (made from where the starts were first spread out) so
 * everything is reachable, then a few extra short passages that make loops. Corridors are picked at random widths and bowed a little.
 */
function connect(
  chambers: readonly Chamber[],
  tree: readonly [number, number][],
  rng: Rng,
): Corridor[] {
  const corridors: Corridor[] = [];
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

  for (const [from, to] of tree) add(from, to);

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
  repairTopology(chambers, corridors, add, pairs);
  return corridors;
}

/**
 * The chamber closest to `from` among `candidates` that it is not already joined to, preferring
 * ones the straight line to does not run through another chamber (a last resort if none is clear).
 */
function nearestUnlinked(
  chambers: readonly Chamber[],
  from: number,
  candidates: readonly number[],
  pairs: ReadonlySet<string>,
): number {
  let best = -1;
  let bestScore = Infinity;
  for (const to of candidates) {
    if (to === from || pairs.has(`${Math.min(from, to)}-${Math.max(from, to)}`)) continue;
    const length = distance(chambers[from]!.center, chambers[to]!.center);
    const score = length + (blocked(chambers, from, to) ? 1000 : 0);
    if (score < bestScore) {
      best = to;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Make sure no tail or peninsula is longer than one corridor, by joining the end of each long
 * tail to the nearest chamber it is not already joined to, which closes it into a loop.
 */
function repairTopology(
  chambers: readonly Chamber[],
  corridors: Corridor[],
  add: (from: number, to: number) => void,
  pairs: ReadonlySet<string>,
): void {
  const all = chambers.map((_, i) => i);
  for (let step = 0; step < 4 * chambers.length; step++) {
    const { tails } = topologyIssues(chambers.length, corridors);
    let best: [number, number] | null = null;
    let bestScore = Infinity;
    for (const from of tails) {
      const to = nearestUnlinked(chambers, from, all, pairs);
      if (to < 0) continue;
      const score =
        distance(chambers[from]!.center, chambers[to]!.center) +
        (blocked(chambers, from, to) ? 1000 : 0);
      if (score < bestScore) {
        best = [from, to];
        bestScore = score;
      }
    }
    if (!best) return;
    add(best[0], best[1]);
  }
}

/**
 * Rooms scattered at random, joined by a spanning tree and a few loops. The general-purpose
 * layout: no strong shape of its own, so it is the baseline the other archetypes are compared to.
 * Dead ends (peninsulas) happen where the tree has them, a start included, as long as they are
 * one corridor off a junction.
 */
export function buildScattered({ players, bowlRadius, rng }: ArchetypeInput): Blueprint {
  const points = spreadSpawns(players, bowlRadius, rng);
  const tree = spanningTree(points);
  tighten(points, tree, bowlRadius, rng);
  // Each point is snapped to the nearest hex center, so the city sits exactly on a hex.
  const chambers: Chamber[] = points.map((p) => ({
    center: hexToPoint(pointToHex(p)),
    radius: bowlRadius,
    spawn: true,
  }));
  // Neutral rooms (none are asked for) are scattered over the ground the starts cover.
  const spread = Math.max(...chambers.map((c) => Math.hypot(c.center.x, c.center.y)));
  placeNeutrals(chambers, neutralRooms(), spread, 2.2 + 0.15 * spread, bowlRadius, rng);
  return { chambers, corridors: connect(chambers, tree, rng) };
}
