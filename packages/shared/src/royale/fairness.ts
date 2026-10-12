import { hexKey, hexNeighbors, type Hex } from '../hex.js';

/** Who is closest to each land tile, by walking distance over land. */
export interface Territories {
  /** For each tile, the index of the nearest start (ties go to the start listed first). */
  readonly owner: ReadonlyMap<string, number>;
  /** For each tile, how many steps it is from its owner's start. */
  readonly distance: ReadonlyMap<string, number>;
  /** Tiles that touch another player's territory: the border, where players meet. */
  readonly contested: ReadonlySet<string>;
  /** Tiles in each player's territory. */
  readonly sizes: readonly number[];
}

/** Split the land between the starts by walking distance (a Voronoi diagram over the land). */
export function territories(land: ReadonlyMap<string, Hex>, starts: readonly Hex[]): Territories {
  const owner = new Map<string, number>();
  const distance = new Map<string, number>();
  let frontier: Hex[] = [];
  starts.forEach((start, index) => {
    owner.set(hexKey(start), index);
    distance.set(hexKey(start), 0);
    frontier.push(start);
  });
  while (frontier.length > 0) {
    const next: Hex[] = [];
    for (const hex of frontier) {
      const key = hexKey(hex);
      for (const neighbor of hexNeighbors(hex)) {
        const nKey = hexKey(neighbor);
        if (!land.has(nKey) || owner.has(nKey)) continue;
        owner.set(nKey, owner.get(key)!);
        distance.set(nKey, distance.get(key)! + 1);
        next.push(neighbor);
      }
    }
    frontier = next;
  }
  const sizes = starts.map(() => 0);
  const contested = new Set<string>();
  for (const [key, index] of owner) {
    sizes[index] = sizes[index]! + 1;
    const hex = land.get(key)!;
    if (hexNeighbors(hex).some((n) => owner.has(hexKey(n)) && owner.get(hexKey(n)) !== index)) {
      contested.add(key);
    }
  }
  return { owner, distance, contested, sizes };
}

/** How many land tiles are within `steps` walking steps of `start`, itself included. */
export function reachWithin(land: ReadonlyMap<string, Hex>, start: Hex, steps: number): number {
  const seen = new Set([hexKey(start)]);
  let frontier: Hex[] = [start];
  for (let step = 0; step < steps; step++) {
    const next: Hex[] = [];
    for (const hex of frontier) {
      for (const neighbor of hexNeighbors(hex)) {
        const key = hexKey(neighbor);
        if (land.has(key) && !seen.has(key)) {
          seen.add(key);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }
  return seen.size;
}

export interface Fairness {
  /** Tiles in each player's territory, in the order of the starts. */
  readonly territory: readonly number[];
  /** Tiles within a few steps of each player's city: the room they have to grow into. */
  readonly reach: readonly number[];
  /** Biggest territory over smallest. 1 is perfectly even. */
  readonly territoryRatio: number;
  /** Biggest reach over smallest. */
  readonly reachRatio: number;
  /** How much territories differ, as a share of their average (0 is perfectly even). */
  readonly territorySpread: number;
  /** How much reaches differ, as a share of their average. */
  readonly reachSpread: number;
  /** Territory and reach spread added up: lower is fairer, and what the best board is picked by. */
  readonly score: number;
}

/** How many steps out `reach` is counted. */
export const REACH_STEPS = 5;

const ratio = (values: readonly number[]): number =>
  Math.max(...values) / Math.max(1, Math.min(...values));

/** Standard deviation over mean: how uneven a set of numbers is, whatever their size. */
const spread = (values: readonly number[]): number => {
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / Math.max(1, mean);
};

/** How even the board is for the players, from the land around each start. */
export function measureFairness(
  land: ReadonlyMap<string, Hex>,
  starts: readonly Hex[],
  split: Territories = territories(land, starts),
): Fairness {
  const reach = starts.map((start) => reachWithin(land, start, REACH_STEPS));
  return {
    territory: split.sizes,
    reach,
    territoryRatio: ratio(split.sizes),
    reachRatio: ratio(reach),
    territorySpread: spread(split.sizes),
    reachSpread: spread(reach),
    score: spread(split.sizes) + spread(reach),
  };
}
