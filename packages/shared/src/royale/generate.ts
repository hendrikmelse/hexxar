import { hexKey, type Hex } from '../hex.js';
import type { GenerationParams } from '../params.js';
import { createRng } from '../rng.js';
import { ARCHETYPE_IDS, archetypeById, type ArchetypeId } from './archetypes/index.js';
import { analyze, type RoyaleMetrics } from './analyze.js';
import { translate, pointToHex, hexToPoint, type Blueprint } from './blueprint.js';
import { depthFromCoast, type Land } from './grid.js';
import { createNoise } from './noise.js';
import { centroidShift, cleanup, rasterize } from './rasterize.js';

/** Why a candidate board was thrown away. */
export type Rejection = 'area' | 'spawns';

export interface RoyaleReport {
  readonly archetype: ArchetypeId;
  /** How many candidates were drawn before one passed (1 means the first did). */
  readonly attempts: number;
  /** How many candidates were thrown away, and why, over all attempts. */
  readonly rejections: Readonly<Partial<Record<Rejection, number>>>;
  readonly blueprint: Blueprint;
  readonly metrics: RoyaleMetrics;
  readonly targetTiles: number;
}

export interface RoyaleLayout {
  readonly hexes: Hex[];
  /** One starting hex for each player, in the order of the blueprint's spawn chambers. */
  readonly starts: Hex[];
  readonly report: RoyaleReport;
}

export interface RoyaleInput {
  readonly players: number;
  readonly seed: number;
  readonly params: GenerationParams;
  /** Defaults to a random one, chosen by the seed. */
  readonly archetype?: ArchetypeId | 'random';
}

const MAX_ATTEMPTS = 80;
/** A board is drawn again at a corrected scale until its area is this close to the target. */
const AREA_ITERATIONS = 6;
const AREA_TOLERANCE = 0.06;
/** A candidate this far off the target area is thrown away. */
const AREA_LIMIT = 0.12;

/** Tiles a board should have, never fewer than the players can fit. */
export const royaleTargetTiles = (players: number, params: GenerationParams): number =>
  players * params.tilesPerPlayer;

interface Candidate {
  readonly land: Land;
  readonly blueprint: Blueprint;
  readonly starts: Hex[];
  readonly metrics: RoyaleMetrics;
}

/** Draw one board. It is either a candidate that passed every check, or the reason it did not. */
function drawCandidate(
  input: RoyaleInput,
  archetypeId: ArchetypeId,
  seed: number,
): Candidate | Rejection {
  const { players, params } = input;
  const target = royaleTargetTiles(players, params);
  const rng = createRng(seed);
  const noise = createNoise(rng.int(0x7fffffff));
  const layoutSeed = rng.int(0x7fffffff);
  const archetype = archetypeById(archetypeId);

  // Rooms and passages keep their size, so area depends on the layout scale only roughly: draw
  // the same layout again at a corrected scale until the area is close to what is wanted.
  let scale = Math.sqrt((target * (Math.sqrt(3) / 2)) / Math.PI);
  let drawn: { blueprint: Blueprint; land: Land } | null = null;
  for (let i = 0; i < AREA_ITERATIONS; i++) {
    const blueprint = archetype.build({
      players,
      scale,
      rng: createRng(layoutSeed),
    });
    const raster = rasterize(blueprint, {
      noise,
      coastRoughness: params.coastRoughness,
      coastDetail: params.coastDetail,
      warpStrength: params.warpStrength,
    });
    drawn = {
      blueprint,
      land: cleanup(raster.land, raster.protectedKeys),
    };
    const ratio = target / drawn.land.size;
    if (Math.abs(ratio - 1) <= AREA_TOLERANCE) break;
    scale *= Math.min(1.4, Math.max(0.7, ratio ** 0.6));
  }
  if (!drawn) throw new Error('no board was drawn');
  if (Math.abs(drawn.land.size / target - 1) > AREA_LIMIT) return 'area';

  // Put the middle of the board on the origin.
  const shift = centroidShift(drawn.land);
  const shiftPoint = hexToPoint(shift);
  const land: Land = new Map();
  for (const hex of drawn.land.values()) {
    const moved = { q: hex.q + shift.q, r: hex.r + shift.r };
    land.set(hexKey(moved), moved);
  }
  const blueprint: Blueprint = {
    chambers: drawn.blueprint.chambers.map((c) => ({
      ...c,
      center: translate(c.center, shiftPoint),
    })),
    corridors: drawn.blueprint.corridors,
  };

  const depth = depthFromCoast(land);
  const starts = blueprint.chambers.filter((c) => c.spawn).map((c) => pointToHex(c.center));
  // Every player needs a city of their own, off the edge.
  if (new Set(starts.map(hexKey)).size !== starts.length) return 'spawns';
  for (const start of starts) {
    if ((depth.get(hexKey(start)) ?? 0) < 2) return 'spawns';
  }

  const metrics = analyze(blueprint, land, depth, starts);
  return { land, blueprint, starts, metrics };
}

/**
 * Lay out a battle royale board: pick an archetype, draw its blueprint onto hexes, and check the
 * result, drawing again with the next seed until a candidate passes. The same seed always gives
 * the same board.
 */
export function generateRoyaleLayout(input: RoyaleInput): RoyaleLayout {
  const { seed } = input;
  const rejections: Partial<Record<Rejection, number>> = {};
  const pick = createRng(seed ^ 0xa11ce);
  let best: { candidate: Candidate; archetype: ArchetypeId } | null = null;
  let attempts = 0;
  while (attempts < MAX_ATTEMPTS && !best) {
    attempts++;
    const archetype =
      input.archetype && input.archetype !== 'random'
        ? input.archetype
        : ARCHETYPE_IDS[pick.int(ARCHETYPE_IDS.length)]!;
    const candidate = drawCandidate(
      input,
      archetype,
      (seed + Math.imul(attempts, 0x9e3779b1)) >>> 0,
    );
    if (typeof candidate === 'string') {
      rejections[candidate] = (rejections[candidate] ?? 0) + 1;
      continue;
    }
    best = { candidate, archetype };
  }
  if (!best) throw new Error('could not make a battle royale board that fits');
  const { candidate, archetype } = best;
  return {
    hexes: [...candidate.land.values()].sort((a, b) => a.q - b.q || a.r - b.r),
    starts: candidate.starts,
    report: {
      archetype,
      attempts,
      rejections,
      blueprint: candidate.blueprint,
      metrics: candidate.metrics,
      targetTiles: royaleTargetTiles(input.players, input.params),
    },
  };
}
