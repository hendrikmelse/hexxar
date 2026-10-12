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
import { topologyIssues, topologyOk } from '../topology.js';
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
function connect(chambers: readonly Chamber[], exits: number | null, rng: Rng): Corridor[] {
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
  repairTopology(chambers, corridors, add, pairs);
  // Without this, spawn chambers have whatever corridors the layout gave them, which can be one
  // (a peninsula) or many, and their widths vary.
  if (exits === null) return corridors;
  evenOutSpawns(chambers, corridors, add, pairs, exits);
  repairTopology(chambers, corridors, add, pairs);
  const width = SPAWN_EXIT_WIDTHS[rng.int(SPAWN_EXIT_WIDTHS.length)]!;
  return corridors.map((c) =>
    chambers[c.from]!.spawn || chambers[c.to]!.spawn ? { ...c, width } : c,
  );
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

/** Chance that a board with room for it gives every spawn chamber a third exit. */
const THREE_EXITS_CHANCE = 0.3;

/**
 * How many ways out every spawn chamber has, where the layout allows it. Three makes the board
 * well connected (several loops); two gives little more than one big ring. Boards with enough
 * room for a third corridor per bowl (not few players, not close cities) get three now and then,
 * at random, so boards differ in how connected they are.
 */
const spawnExits = (players: number, startDistance: number, rng: Rng): number =>
  players >= 5 && startDistance >= 4 && rng.next() < THREE_EXITS_CHANCE ? 3 : 2;
/** Widths of the passages leaving a spawn chamber (the same for every player on a board). */
const SPAWN_EXIT_WIDTHS = [2, 3] as const;

/** Is everything still joined up with the given corridors? */
function joined(count: number, corridors: readonly Corridor[]): boolean {
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length > 0) {
    const here = queue.pop()!;
    for (const { from, to } of corridors) {
      const other = from === here ? to : to === here ? from : -1;
      if (other >= 0 && !seen.has(other)) {
        seen.add(other);
        queue.push(other);
      }
    }
  }
  return seen.size === count;
}

/**
 * Give every spawn chamber the same kind of surroundings, so no player starts with a better
 * hand than another: the same number of ways out (dropping the longest ones that are not the
 * only way to somewhere, or adding one to the nearest chamber), all of one width.
 */
function evenOutSpawns(
  chambers: readonly Chamber[],
  corridors: Corridor[],
  add: (from: number, to: number) => void,
  pairs: Set<string>,
  exits: number,
): void {
  const touching = (spawn: number): number[] =>
    corridors.flatMap((c, i) => (c.from === spawn || c.to === spawn ? [i] : []));
  const lengthOf = (c: Corridor): number =>
    distance(chambers[c.from]!.center, chambers[c.to]!.center);
  chambers.forEach((chamber, spawn) => {
    if (!chamber.spawn) return;
    while (touching(spawn).length > exits) {
      const longest = touching(spawn).sort(
        (a, b) => lengthOf(corridors[b]!) - lengthOf(corridors[a]!),
      );
      // Only a corridor that keeps everything joined and leaves no long tail.
      const drop = longest.find((i) => {
        const rest = corridors.filter((_, k) => k !== i);
        return joined(chambers.length, rest) && topologyOk(chambers.length, rest);
      });
      if (drop === undefined) break;
      const { from, to } = corridors[drop]!;
      pairs.delete(`${Math.min(from, to)}-${Math.max(from, to)}`);
      corridors.splice(drop, 1);
    }
    while (touching(spawn).length < exits) {
      let nearest = -1;
      let nearestLength = Infinity;
      chambers.forEach((other, j) => {
        const length = distance(chamber.center, other.center);
        const key = `${Math.min(spawn, j)}-${Math.max(spawn, j)}`;
        if (
          j !== spawn &&
          !pairs.has(key) &&
          !blocked(chambers, spawn, j) &&
          length < nearestLength
        ) {
          nearest = j;
          nearestLength = length;
        }
      });
      if (nearest < 0) break;
      add(spawn, nearest);
    }
  });
}

/**
 * Rooms scattered at random, joined by a spanning tree and a few loops. The general-purpose
 * layout: no strong shape of its own, so it is the baseline the other archetypes are compared to.
 * Dead ends (peninsulas) happen where the tree has them, a start included, as long as they are
 * one corridor off a junction.
 */
export function buildScattered({
  players,
  scale,
  rng,
  startDistance,
  evenSpawns,
}: ArchetypeInput): Blueprint | null {
  const spawns = placeSpawns(players, scale, startDistance, rng);
  if (!spawns) return null;
  const chambers: Chamber[] = [...spawns];
  placeNeutrals(chambers, neutralRooms(), scale, 2.2 + 0.15 * scale, startDistance, rng);
  const exits = evenSpawns ? spawnExits(players, startDistance, rng) : null;
  return { chambers, corridors: connect(chambers, exits, rng) };
}
