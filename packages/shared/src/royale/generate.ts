import { hexKey, type Hex } from '../hex.js';
import type { GenerationParams } from '../params.js';
import { createRng } from '../rng.js';
import { ARCHETYPE_IDS, archetypeById, type ArchetypeId } from './archetypes/index.js';
import { translate, pointToHex, hexToPoint, type Blueprint } from './blueprint.js';
import type { Land } from './grid.js';
import { createNoise } from './noise.js';
import { centroidShift, cleanup, rasterize } from './rasterize.js';

export interface RoyaleReport {
  readonly archetype: ArchetypeId;
  readonly blueprint: Blueprint;
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
  /** The bowl radius (`bowlRadius`) is what sets the size of the board; the coast settings shape it. */
  readonly params: GenerationParams;
  /** Defaults to a random one, chosen by the seed. */
  readonly archetype?: ArchetypeId | 'random';
}

/**
 * Lay out a battle royale board: pick an archetype, make its blueprint, and draw it onto hexes. There
 * is no target size and nothing is checked or redrawn: the area is whatever the bowls, corridors
 * and the spacing between them come to. The same seed always gives the same board.
 */
export function generateRoyaleLayout(input: RoyaleInput): RoyaleLayout {
  const { players, seed, params } = input;
  const archetypeId =
    input.archetype && input.archetype !== 'random'
      ? input.archetype
      : ARCHETYPE_IDS[createRng(seed ^ 0xa11ce).int(ARCHETYPE_IDS.length)]!;
  const rng = createRng(seed);
  const noise = createNoise(rng.int(0x7fffffff));
  const layoutSeed = rng.int(0x7fffffff);

  const drawn = archetypeById(archetypeId).build({
    players,
    bowlRadius: params.bowlRadius,
    rng: createRng(layoutSeed),
  });
  const raster = rasterize(drawn, {
    noise,
    coastRoughness: params.coastRoughness,
    coastDetail: params.coastDetail,
    warpStrength: params.warpStrength,
  });
  const drawnLand = cleanup(raster.land, raster.protectedKeys);

  // Put the middle of the board on the origin.
  const shift = centroidShift(drawnLand);
  const shiftPoint = hexToPoint(shift);
  const land: Land = new Map();
  for (const hex of drawnLand.values()) {
    const moved = { q: hex.q + shift.q, r: hex.r + shift.r };
    land.set(hexKey(moved), moved);
  }
  const blueprint: Blueprint = {
    chambers: drawn.chambers.map((c) => ({ ...c, center: translate(c.center, shiftPoint) })),
    corridors: drawn.corridors,
  };
  return {
    hexes: [...land.values()].sort((a, b) => a.q - b.q || a.r - b.r),
    starts: blueprint.chambers.filter((c) => c.spawn).map((c) => pointToHex(c.center)),
    report: { archetype: archetypeId, blueprint },
  };
}
