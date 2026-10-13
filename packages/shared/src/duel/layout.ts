import { hexKey, hexNeighbors, type Hex } from '../hex.js';
import type { GenerationParams } from '../params.js';
import { createRng } from '../rng.js';
import { pointToHex, type Blueprint } from '../royale/blueprint.js';
import { components, landNeighborCount, type Land } from '../royale/grid.js';
import { createNoise, type Noise } from '../royale/noise.js';
import { rasterize } from '../royale/rasterize.js';
import { topologyOk } from '../royale/topology.js';
import { buildDuelBlueprint } from './blueprint.js';
import { hexImage, type DuelSymmetry } from './symmetry.js';

/** Why a board that was drawn was thrown away. */
export type DuelRejection = 'blueprint' | 'split' | 'area' | 'symmetry' | 'topology' | 'starts';

export interface DuelReport {
  readonly symmetry: DuelSymmetry;
  /** How many boards were drawn before one passed (1 means the first did). */
  readonly attempts: number;
  /** How many boards were thrown away, and why. */
  readonly rejections: Readonly<Partial<Record<DuelRejection, number>>>;
  readonly blueprint: Blueprint;
  readonly tiles: number;
  readonly targetTiles: number;
}

export interface DuelLayout {
  readonly hexes: Hex[];
  /** The two starting hexes: each is the other's image under the symmetry. */
  readonly starts: [Hex, Hex];
  readonly report: DuelReport;
}

const MAX_ATTEMPTS = 200;
/** The layout is stretched (up to this many times) until the land is roughly the wanted area. */
const SCALE_ITERATIONS = 8;
const SCALE_TOLERANCE = 0.2;
/** Then the land is grown or shrunk a little (this many times at most) to get it right. */
const OFFSET_STEPS = 9;
const OFFSET_LIMIT = 1.5;
const AREA_TOLERANCE = 0.03;
/** A board further than this from the target area is thrown away. */
const AREA_LIMIT = 0.08;

/**
 * Tidy a symmetric board: fill one-tile bays and trim one-tile spurs. Each step looks at the
 * board as it was before the step (never tile by tile), so the result does not depend on the order
 * tiles are visited in, and a symmetric board stays symmetric.
 */
function tidy(land: Land, protectedKeys: ReadonlySet<string>): void {
  for (let pass = 0; pass < 3; pass++) {
    const bays = new Map<string, Hex>();
    for (const hex of land.values()) {
      for (const n of hexNeighbors(hex)) if (!land.has(hexKey(n))) bays.set(hexKey(n), n);
    }
    const filled = [...bays].filter(([, hex]) => landNeighborCount(land, hex) >= 5);
    for (const [key, hex] of filled) land.set(key, hex);
    const spurs = [...land].filter(
      ([key, hex]) => !protectedKeys.has(key) && landNeighborCount(land, hex) <= 1,
    );
    for (const [key] of spurs) land.delete(key);
  }
}

interface Rendered {
  readonly land: Land;
  readonly starts: [Hex, Hex];
}

/**
 * Draw a blueprint onto hexes, symmetrically: the land is what the noisy drawing gives and its
 * image under the symmetry, tidied, and only the piece with the starts is kept. `null` if the
 * starts are not in one piece.
 */
function render(
  blueprint: Blueprint,
  symmetry: DuelSymmetry,
  noise: Noise,
  params: GenerationParams,
  offset: number,
): Rendered | null {
  const imageOfHex = hexImage(symmetry);
  const raster = rasterize(blueprint, {
    noise,
    coastRoughness: params.coastRoughness,
    coastDetail: params.coastDetail,
    warpStrength: params.warpStrength,
    offset,
  });
  // The noise is not symmetric, so the land is the drawn land together with its image.
  const land: Land = new Map(raster.land);
  for (const hex of raster.land.values()) {
    const image = imageOfHex(hex);
    land.set(hexKey(image), image);
  }
  tidy(land, raster.protectedKeys);

  const starts: [Hex, Hex] = [
    pointToHex(blueprint.chambers[0]!.center),
    pointToHex(blueprint.chambers[1]!.center),
  ];
  const piece = components(land).find((keys) => keys.includes(hexKey(starts[0])));
  if (!piece || !piece.includes(hexKey(starts[1]))) return null;
  const keep = new Set(piece);
  for (const key of [...land.keys()]) if (!keep.has(key)) land.delete(key);
  return { land, starts };
}

function drawBoard(
  symmetry: DuelSymmetry,
  targetTiles: number,
  params: GenerationParams,
  seed: number,
): { land: Land; blueprint: Blueprint; starts: [Hex, Hex] } | DuelRejection {
  const imageOfHex = hexImage(symmetry);
  const rng = createRng(seed);
  const noise = createNoise(rng.int(0x7fffffff));
  const layoutSeed = rng.int(0x7fffffff);
  const size = Math.sqrt((targetTiles * (Math.sqrt(3) / 2)) / Math.PI);
  const off = (rendered: Rendered): number => Math.abs(rendered.land.size / targetTiles - 1);

  // Stretch the layout until the area is in the right region. Blob sizes and counts come from
  // `size`, so only how far apart the blobs are changes, and the area follows smoothly.
  let scale = size;
  let drawn: { blueprint: Blueprint; rendered: Rendered } | null = null;
  let failure: DuelRejection = 'blueprint';
  for (let i = 0; i < SCALE_ITERATIONS; i++) {
    const blueprint = buildDuelBlueprint({
      symmetry,
      size,
      scale,
      rng: createRng(layoutSeed),
      minCityDistance: params.minCityDistance,
    });
    if (!blueprint) {
      failure = 'blueprint';
      scale *= 1.1;
      continue;
    }
    const rendered = render(blueprint, symmetry, noise, params, 0);
    if (!rendered) {
      failure = 'split';
      scale *= 1.1;
      continue;
    }
    if (!drawn || off(rendered) < off(drawn.rendered)) drawn = { blueprint, rendered };
    if (off(rendered) <= SCALE_TOLERANCE) break;
    scale *= Math.min(1.25, Math.max(0.8, (targetTiles / rendered.land.size) ** 0.5));
  }
  if (!drawn) return failure;

  // Fine tune: grow or shrink the land by a fraction of a tile everywhere.
  const { blueprint } = drawn;
  let best = drawn.rendered;
  let low = -OFFSET_LIMIT;
  let high = OFFSET_LIMIT;
  for (let step = 0; step < OFFSET_STEPS && off(best) > AREA_TOLERANCE; step++) {
    const middle = (low + high) / 2;
    const rendered = render(blueprint, symmetry, noise, params, middle);
    if (!rendered || rendered.land.size < targetTiles) low = middle;
    else high = middle;
    if (rendered && off(rendered) < off(best)) best = rendered;
  }
  if (off(best) > AREA_LIMIT) return 'area';

  const { land, starts } = best;
  const [first, second] = starts;
  const twin = imageOfHex(first);
  if (twin.q !== second.q || twin.r !== second.r) return 'starts';
  if (!topologyOk(blueprint.chambers.length, blueprint.corridors)) return 'topology';
  for (const hex of land.values()) if (!land.has(hexKey(imageOfHex(hex)))) return 'symmetry';
  // The starts have all six neighbors (the rasterizer keeps the ring).
  for (const start of starts) {
    if (hexNeighbors(start).some((n) => !land.has(hexKey(n)))) return 'starts';
  }
  return { land, blueprint, starts };
}

/**
 * A fully symmetric two-player board made of blobs: one starting blob and its twin, and a few
 * extra blobs, on the line of symmetry or not, joined by corridors. Bigger boards get a few more
 * blobs and slightly bigger ones. The same seed always gives the same board.
 */
export function generateDuelLayout(input: {
  seed: number;
  symmetry: DuelSymmetry;
  /** About how many tiles the board should have. */
  targetTiles: number;
  params: GenerationParams;
}): DuelLayout {
  const { seed, symmetry, targetTiles, params } = input;
  const rejections: Partial<Record<DuelRejection, number>> = {};
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const board = drawBoard(
      symmetry,
      targetTiles,
      params,
      (seed + Math.imul(attempt, 0x9e3779b1)) >>> 0,
    );
    if (typeof board === 'string') {
      rejections[board] = (rejections[board] ?? 0) + 1;
      continue;
    }
    return {
      hexes: [...board.land.values()].sort((a, b) => a.q - b.q || a.r - b.r),
      starts: board.starts,
      report: {
        symmetry,
        attempts: attempt,
        rejections,
        blueprint: board.blueprint,
        tiles: board.land.size,
        targetTiles,
      },
    };
  }
  throw new Error(`could not make a ${symmetry} duel board of about ${targetTiles} tiles`);
}
