import { hexKey, hexNeighbors, hexRotate, type Hex } from '../hex.js';
import type { GenerationParams } from '../params.js';
import { createRng } from '../rng.js';
import { type Blueprint } from '../royale/blueprint.js';
import { components, landNeighborCount, type Land } from '../royale/grid.js';
import { createNoise } from '../royale/noise.js';
import { rasterize } from '../royale/rasterize.js';
import {
  buildGroupBlueprint,
  duelGroup,
  QUAD_GROUP,
  sextetGroup,
  TRIO_GROUP,
  type FairGroup,
  type SextetSymmetry,
} from './group.js';
import { rotatePoint, type DuelAxis, type DuelSymmetry } from './symmetry.js';

export interface DuelReport {
  readonly symmetry: DuelSymmetry;
  /** The line of a mirror board (`points` for half-turn boards, which have none). */
  readonly axis: DuelAxis;
  /**
   * How many steps of 60 degrees a mirror board was turned after it was made (0 to 5), so that its
   * line can be any of the six hex mirror lines. The blueprint is turned with it. Half-turn boards
   * are not turned.
   */
  readonly turns: number;
  readonly blueprint: Blueprint;
}

export interface DuelLayout {
  readonly hexes: Hex[];
  /** The two starting hexes: each is the other's image under the symmetry. */
  readonly starts: [Hex, Hex];
  readonly report: DuelReport;
}

/** How a board for three players was made. */
export interface TrioReport {
  readonly blueprint: Blueprint;
}

export interface TrioLayout {
  readonly hexes: Hex[];
  /** The three starting hexes: each is the one before it turned by 120 degrees. */
  readonly starts: [Hex, Hex, Hex];
  readonly report: TrioReport;
}

/** How a board for four players was made. */
export interface QuadReport {
  /**
   * How many steps of 60 degrees the finished board was turned (0 to 2: turning by 180 degrees
   * changes nothing, so those are the three ways the two mirror lines can lie). The blueprint is
   * turned with it.
   */
  readonly turns: number;
  readonly blueprint: Blueprint;
}

export interface QuadLayout {
  readonly hexes: Hex[];
  /** The four starting hexes, one in each quarter: the first, then its image across the vertical
   *  line, across the horizontal line, and through the middle (before any turn). */
  readonly starts: [Hex, Hex, Hex, Hex];
  readonly report: QuadReport;
}

/** How a board for six players was made. */
export interface SextetReport {
  readonly symmetry: SextetSymmetry;
  /** The kind of line a mirror board's three mirror lines are (`points` for the other kind of board). */
  readonly axis: DuelAxis;
  readonly blueprint: Blueprint;
}

export interface SextetLayout {
  readonly hexes: Hex[];
  /** The six starting hexes: the first, then its image under each of the other symmetries. */
  readonly starts: [Hex, Hex, Hex, Hex, Hex, Hex];
  readonly report: SextetReport;
}

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

/**
 * Make a fair board for a group of symmetries: build its blueprint (see `buildGroupBlueprint`),
 * draw it onto hexes, and make the land symmetric. There is no target size, no check and no retry:
 * the board is drawn once, and its area is whatever the settings come to.
 *
 * The noise is not symmetric, so the land is what the noisy drawing gives together with its images
 * under every symmetry, then tidied (with rules that look at the board as it was before each step,
 * so it stays exactly symmetric), keeping only the biggest piece. Every start's city and the ring
 * round it are land whatever happens, so nothing can take them.
 */
function drawBoard(
  group: FairGroup,
  params: GenerationParams,
  seed: number,
): { land: Land; blueprint: Blueprint; starts: Hex[] } {
  const rng = createRng(seed);
  const noise = createNoise(rng.int(0x7fffffff));
  const layoutSeed = rng.int(0x7fffffff);
  const { blueprint, starts } = buildGroupBlueprint(group, {
    radius: params.bowlRadius,
    extraSets: params.extraSets,
    rng: createRng(layoutSeed),
  });
  const raster = rasterize(blueprint, {
    noise,
    coastRoughness: params.coastRoughness,
    coastDetail: params.coastDetail,
    warpStrength: params.warpStrength,
  });
  const land: Land = new Map(raster.land);
  for (const hex of raster.land.values()) {
    for (const image of group.hexMaps) {
      const moved = image(hex);
      land.set(hexKey(moved), moved);
    }
  }
  tidy(land, raster.protectedKeys);
  const pieces = components(land);
  if (pieces.length > 1) {
    const biggest = new Set(pieces.reduce((a, b) => (b.length > a.length ? b : a)));
    for (const key of [...land.keys()]) if (!biggest.has(key)) land.delete(key);
  }
  return { land, blueprint, starts };
}

const byPosition = (a: Hex, b: Hex): number => a.q - b.q || a.r - b.r;

/** The same board turned by `turns` steps of 60 degrees about the middle (the blueprint turns too). */
function turned(
  board: { land: Land; blueprint: Blueprint; starts: Hex[] },
  turns: number,
): { hexes: Hex[]; starts: Hex[]; blueprint: Blueprint } {
  const turn = (hex: Hex): Hex => hexRotate(hex, turns);
  return {
    hexes: [...board.land.values()].map(turn).sort(byPosition),
    starts: board.starts.map(turn),
    blueprint: {
      chambers: board.blueprint.chambers.map((c) => ({
        ...c,
        center: rotatePoint(c.center, turns),
      })),
      corridors: board.blueprint.corridors,
    },
  };
}

/**
 * A fully symmetric two-player board made of blobs: one starting blob and its twin, and a few
 * extra blobs, on the line of symmetry or not, joined by corridors. Bigger bowls make a bigger
 * board with more blobs. The same seed always gives the same board.
 */
export function generateDuelLayout(input: {
  seed: number;
  symmetry: DuelSymmetry;
  /** The line of a mirror board; by default one of the two, picked by the seed. */
  axis?: DuelAxis;
  /** How far the finished mirror board is turned, in steps of 60 degrees; by default random. */
  turns?: number;
  params: GenerationParams;
}): DuelLayout {
  const { seed, symmetry, params } = input;
  // Half the mirror boards are mirrored across a line through tile corners, half across one
  // through the middles of tile edges (30 degrees round from the first).
  // Then the finished board is turned by a random multiple of 60 degrees (possibly none), so the
  // mirror line can lie any of the six ways a hex mirror line can.
  const turns =
    symmetry === 'rotational'
      ? 0
      : (((input.turns ?? createRng(seed ^ 0x5bd1).int(6)) % 6) + 6) % 6;
  const axis: DuelAxis =
    symmetry === 'rotational'
      ? 'points'
      : (input.axis ?? (createRng(seed ^ 0x6a09).next() < 0.5 ? 'points' : 'edges'));
  const board = turned(drawBoard(duelGroup(symmetry, axis), params, seed), turns);
  return {
    hexes: board.hexes,
    starts: [board.starts[0]!, board.starts[1]!],
    report: { symmetry, axis, turns, blueprint: board.blueprint },
  };
}

/**
 * A fully symmetric board for three players, made of blobs the way a duel board is, but
 * symmetric under turns of 120 degrees. The same seed always gives the same board.
 */
export function generateTrioLayout(input: { seed: number; params: GenerationParams }): TrioLayout {
  const board = drawBoard(TRIO_GROUP, input.params, input.seed);
  return {
    hexes: [...board.land.values()].sort(byPosition),
    starts: [board.starts[0]!, board.starts[1]!, board.starts[2]!],
    report: { blueprint: board.blueprint },
  };
}

/**
 * A fully symmetric board for four players, made of blobs the way a duel board is, but with two
 * mirror lines at right angles (and so a half turn). After it is made the board is turned by a
 * random multiple of 60 degrees, so the lines can lie any of the three ways two hex mirror lines at
 * right angles can. The same seed always gives the same board.
 */
export function generateQuadLayout(input: {
  seed: number;
  /** How far the finished board is turned, in steps of 60 degrees (0 to 2); by default random. */
  turns?: number;
  params: GenerationParams;
}): QuadLayout {
  const { seed, params } = input;
  const turns = (((input.turns ?? createRng(seed ^ 0x51ad).int(3)) % 6) + 6) % 6;
  const board = turned(drawBoard(QUAD_GROUP, params, seed), turns);
  return {
    hexes: board.hexes,
    starts: [board.starts[0]!, board.starts[1]!, board.starts[2]!, board.starts[3]!],
    report: { turns, blueprint: board.blueprint },
  };
}

/**
 * A fully symmetric board for six players, made of blobs the way the others are. There are two
 * ways it can be symmetric, because a hex board has two groups of six symmetries: turns by a sixth
 * of a turn (`rotational`), or turns by a third of a turn with a mirror (`mirror`, which has three
 * mirror lines, all through tile corners or all through the middles of tile edges, as `axis` says;
 * by default one of the two, picked by the seed). Turning the board by a sixth of a turn changes
 * neither group, so boards are not turned afterwards. The same seed always gives the same board.
 */
export function generateSextetLayout(input: {
  seed: number;
  symmetry: SextetSymmetry;
  /** The kind of line of a mirror board; by default one of the two, picked by the seed. */
  axis?: DuelAxis;
  params: GenerationParams;
}): SextetLayout {
  const { seed, symmetry, params } = input;
  const axis: DuelAxis =
    symmetry === 'rotational'
      ? 'points'
      : (input.axis ?? (createRng(seed ^ 0x6a09).next() < 0.5 ? 'points' : 'edges'));
  const board = drawBoard(sextetGroup(symmetry, axis), params, seed);
  return {
    hexes: [...board.land.values()].sort(byPosition),
    starts: board.starts as SextetLayout['starts'],
    report: { symmetry, axis, blueprint: board.blueprint },
  };
}
