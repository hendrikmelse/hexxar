import { hexDistance, hexKey, type Hex } from '../hex.js';
import { corridorPath, hexToPoint, pointToHex, type Blueprint, type Point } from './blueprint.js';
import { components } from './grid.js';

/** A passage as it came out on the board, measured on the hexes and not read off the blueprint. */
export interface Choke {
  /** Indexes of the two chambers it joins. */
  readonly from: number;
  readonly to: number;
  /** Hexes across at the narrowest point. */
  readonly width: number;
  /** Does closing the narrowest point split the board in two? (False when there is a way around.) */
  readonly cut: boolean;
}

export interface RoyaleMetrics {
  readonly tiles: number;
  /** Share of land at least 4 tiles from the coast: high means a big round blob. */
  readonly interiorShare: number;
  /** Passages 3 or fewer hexes across. */
  readonly chokes: readonly Choke[];
  /** Chokes by width in hexes (index 1 is the number that are 1 wide, and so on). */
  readonly widths: readonly number[];
  /** Independent loops in the layout: passages beyond what it takes to join every chamber. */
  readonly loops: number;
  /** Neutral chambers with a single way in: places to hold out, or to be cornered in. */
  readonly deadEnds: number;
  /** Fewest tiles between any two starting cities. */
  readonly spawnSpacing: number;
}

/** The widest passage that counts as a choke. */
export const CHOKE_MAX_WIDTH = 3;

const SAMPLE_SPACING = 0.5;
const PROBE_STEP = 0.2;
const PROBE_REACH = 10;

/** Land hexes in a straight line from `from` along `direction`, in tile units, until water. */
function probe(land: ReadonlyMap<string, Hex>, from: Point, direction: Point): number {
  let reached = 0;
  for (let s = PROBE_STEP; s <= PROBE_REACH; s += PROBE_STEP) {
    const spot = { x: from.x + direction.x * s, y: from.y + direction.y * s };
    if (!land.has(hexKey(pointToHex(spot)))) break;
    reached = s;
  }
  return reached;
}

interface Section {
  readonly width: number;
  readonly center: Point;
  readonly along: Point;
}

/**
 * Cross sections of a corridor, from its middle stretch (clear of the chambers at each end):
 * how wide the land is at right angles to the centerline, and where.
 */
function sections(blueprint: Blueprint, index: number, land: ReadonlyMap<string, Hex>): Section[] {
  const corridor = blueprint.corridors[index]!;
  const path = corridorPath(blueprint, corridor);
  const a = blueprint.chambers[corridor.from]!;
  const b = blueprint.chambers[corridor.to]!;
  const found: Section[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const start = path[i]!;
    const end = path[i + 1]!;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length === 0) continue;
    const along = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
    const across = { x: -along.y, y: along.x };
    for (let s = 0; s <= length; s += SAMPLE_SPACING) {
      const spot = { x: start.x + along.x * s, y: start.y + along.y * s };
      if (
        Math.hypot(spot.x - a.center.x, spot.y - a.center.y) < a.radius + 0.8 ||
        Math.hypot(spot.x - b.center.x, spot.y - b.center.y) < b.radius + 0.8
      ) {
        continue;
      }
      if (!land.has(hexKey(pointToHex(spot)))) {
        found.push({ width: 0, center: spot, along });
        continue;
      }
      const positive = probe(land, spot, across);
      const negative = probe(land, spot, { x: -across.x, y: -across.y });
      const middle = {
        x: spot.x + (across.x * (positive - negative)) / 2,
        y: spot.y + (across.y * (positive - negative)) / 2,
      };
      found.push({ width: Math.max(1, Math.round(positive + negative)), center: middle, along });
    }
  }
  return found;
}

/** Would removing the slice of land around this cross section leave the board in pieces? */
function splitsBoard(land: ReadonlyMap<string, Hex>, section: Section): boolean {
  const remaining = new Map(land);
  const reach = section.width / 2 + 0.9;
  for (const [key, hex] of land) {
    const p = hexToPoint(hex);
    const dx = p.x - section.center.x;
    const dy = p.y - section.center.y;
    const alongDistance = dx * section.along.x + dy * section.along.y;
    const acrossDistance = -dx * section.along.y + dy * section.along.x;
    if (Math.abs(alongDistance) <= 0.9 && Math.abs(acrossDistance) <= reach) remaining.delete(key);
  }
  return components(remaining).filter((piece) => piece.length >= 4).length > 1;
}

/** Measure a finished board against its blueprint. */
export function analyze(
  blueprint: Blueprint,
  land: ReadonlyMap<string, Hex>,
  depth: ReadonlyMap<string, number>,
  starts: readonly Hex[],
): RoyaleMetrics {
  const chokes: Choke[] = [];
  blueprint.corridors.forEach((corridor, index) => {
    const found = sections(blueprint, index, land);
    if (found.length === 0) return;
    const narrowest = found.reduce((a, b) => (b.width < a.width ? b : a));
    if (narrowest.width > CHOKE_MAX_WIDTH) return;
    chokes.push({
      from: corridor.from,
      to: corridor.to,
      width: narrowest.width,
      cut: splitsBoard(land, narrowest),
    });
  });
  const widths: number[] = Array.from({ length: CHOKE_MAX_WIDTH + 1 }, () => 0);
  for (const choke of chokes) widths[choke.width] = widths[choke.width]! + 1;

  const degree = blueprint.chambers.map(() => 0);
  for (const { from, to } of blueprint.corridors) {
    degree[from] = degree[from]! + 1;
    degree[to] = degree[to]! + 1;
  }

  let spawnSpacing = Infinity;
  for (let i = 0; i < starts.length; i++) {
    for (let j = i + 1; j < starts.length; j++) {
      spawnSpacing = Math.min(spawnSpacing, hexDistance(starts[i]!, starts[j]!));
    }
  }

  let interior = 0;
  for (const value of depth.values()) if (value >= 4) interior++;
  return {
    tiles: land.size,
    interiorShare: land.size === 0 ? 0 : interior / land.size,
    chokes,
    widths,
    loops: blueprint.corridors.length - (blueprint.chambers.length - 1),
    deadEnds: blueprint.chambers.filter((c, i) => !c.spawn && degree[i] === 1).length,
    spawnSpacing,
  };
}
