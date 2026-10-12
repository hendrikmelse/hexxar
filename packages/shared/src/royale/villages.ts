import { hexDistance, hexKey, hexNeighbors, type Hex } from '../hex.js';
import type { GenerationParams } from '../params.js';
import type { Rng } from '../rng.js';
import { territories } from './fairness.js';

export interface VillageSummary {
  /** Villages in each player's own territory, in the order of the starts. */
  readonly perPlayer: readonly number[];
  /** Villages left over once the rounds ran out of room, on the borders between territories. */
  readonly contested: number;
}

function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/**
 * Place villages so that no player ends up with more than another.
 *
 * The land is split between the players by walking distance from their cities. Villages are then
 * placed in rounds: in each round every player gets one in their own territory, as near as
 * possible to the same distance from their city (2 steps in the first round, 3 in the second,
 * and so on), so everyone gets villages at the same distances, and far ones sit near the borders
 * where players meet. A round is only kept if every player got a village in it. If the rounds
 * run out of room before the village count is reached, the rest go on the borders at random.
 *
 * Villages never touch each other or a city (see `minVillageDistance`), and keep off the edge of
 * the board unless a player has nowhere else.
 */
export function placeVillages(input: {
  land: ReadonlyMap<string, Hex>;
  starts: readonly Hex[];
  /** Tiles from the coast (1 on the edge). */
  depth: ReadonlyMap<string, number>;
  params: GenerationParams;
  rng: Rng;
}): { villages: Hex[]; summary: VillageSummary } {
  const { land, starts, depth, params, rng } = input;
  const split = territories(land, starts);
  const cities = new Set(starts.map(hexKey));
  const villages: Hex[] = [];
  const chosen = new Set<string>();
  const perPlayer = starts.map(() => 0);

  const total = Math.round((land.size * params.villageDensity) / 100);
  const rounds = Math.floor(total / Math.max(1, starts.length));

  const fits = (hex: Hex): boolean => {
    const key = hexKey(hex);
    if (cities.has(key) || chosen.has(key)) return false;
    if (!params.villagesNextToCities && hexNeighbors(hex).some((n) => cities.has(hexKey(n)))) {
      return false;
    }
    return villages.every((village) => hexDistance(hex, village) >= params.minVillageDistance);
  };
  const isInterior = (hex: Hex): boolean => (depth.get(hexKey(hex)) ?? 0) >= 2;
  const place = (hex: Hex): void => {
    villages.push(hex);
    chosen.add(hexKey(hex));
  };

  const own = starts.map(() => [] as Hex[]);
  const border: Hex[] = [];
  for (const [key, hex] of land) {
    own[split.owner.get(key)!]!.push(hex);
    if (split.contested.has(key)) border.push(hex);
  }

  for (let round = 0; round < rounds; round++) {
    const target = 2 + round;
    const placedThisRound: number[] = [];
    let complete = true;
    for (const player of shuffle(
      starts.map((_, i) => i),
      rng,
    )) {
      const options = own[player]!.filter(fits);
      const interior = options.filter(isInterior);
      const pool = interior.length > 0 ? interior : options;
      let best: Hex | null = null;
      let bestScore = Infinity;
      for (const hex of pool) {
        // Closest to the round's distance wins; the random part (less than a step) breaks ties.
        const score = Math.abs(split.distance.get(hexKey(hex))! - target) + rng.next() * 0.9;
        if (score < bestScore) {
          best = hex;
          bestScore = score;
        }
      }
      if (!best) {
        complete = false;
        break;
      }
      place(best);
      placedThisRound.push(player);
    }
    if (!complete) {
      // Take back what this round placed, so nobody has more than the others.
      for (let i = 0; i < placedThisRound.length; i++) {
        const hex = villages.pop()!;
        chosen.delete(hexKey(hex));
      }
      break;
    }
    for (const player of placedThisRound) perPlayer[player] = perPlayer[player]! + 1;
  }

  // Whatever is left to place goes on the borders, at random.
  const placedOwn = villages.length;
  const borderOptions = shuffle(border, rng);
  const interiorFirst = [
    ...borderOptions.filter(isInterior),
    ...borderOptions.filter((hex) => !isInterior(hex)),
  ];
  for (const hex of interiorFirst) {
    if (villages.length >= total) break;
    if (fits(hex)) place(hex);
  }

  return {
    villages,
    summary: { perPlayer, contested: villages.length - placedOwn },
  };
}
