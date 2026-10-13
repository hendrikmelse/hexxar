import { hexKey, hexNeighbors, type Hex } from '../hex.js';
import {
  corridorPath,
  hexToPoint,
  pathDistance,
  pointToHex,
  type Blueprint,
  type Point,
} from './blueprint.js';
import { components, landNeighborCount, type Land } from './grid.js';
import { fbm, type Noise } from './noise.js';

export interface RasterOptions {
  readonly noise: Noise;
  /** How far noise pushes the coast in and out, in tiles. */
  readonly coastRoughness: number;
  /** Size of the coast's bumps, in tiles. */
  readonly coastDetail: number;
  /** How far noise bends rooms out of round, in tiles. */
  readonly warpStrength: number;
  /** Added to the field before the land is decided: positive grows the land, negative shrinks it. */
  readonly offset?: number;
}

/** How softly two shapes blend where they meet, in tiles. */
const BLEND = 1.5;
/** Corridors follow their blueprint closely, so noise bites into them less than into rooms. */
const CORRIDOR_NOISE = 0.4;
/** Every hex a corridor's centerline passes through is land, so a corridor can never be cut. */
const CORRIDOR_CORE = 0.58;

/** The larger of two values, with the corner where they cross rounded off. */
const smoothMax = (a: number, b: number): number => {
  const h = Math.max(BLEND - Math.abs(a - b), 0) / BLEND;
  return Math.max(a, b) + (h * h * BLEND) / 4;
};

/**
 * Draw a blueprint onto hexes. Every hex center is tested against a field that is positive
 * inside the shapes (rooms and corridors blended together) and bent by noise, which turns the
 * round rooms and straight corridors into a natural coast.
 *
 * Hexes that must be land whatever the noise says (the city and the ring around it in every
 * spawn chamber) are returned too, so later steps can leave them alone.
 */
export function rasterize(
  blueprint: Blueprint,
  options: RasterOptions,
): { land: Land; protectedKeys: Set<string> } {
  const { noise, coastRoughness, coastDetail, warpStrength, offset = 0 } = options;
  const paths = blueprint.corridors.map((corridor) => corridorPath(blueprint, corridor));

  // The area worth testing: everything within reach of a shape, with a margin for the noise.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const margin = warpStrength + coastRoughness + 2;
  for (const { center, radius } of blueprint.chambers) {
    minX = Math.min(minX, center.x - radius - margin);
    maxX = Math.max(maxX, center.x + radius + margin);
    minY = Math.min(minY, center.y - radius - margin);
    maxY = Math.max(maxY, center.y + radius + margin);
  }

  const land: Land = new Map();
  const rowHeight = Math.sqrt(3) / 2;
  for (let r = Math.floor(minY / rowHeight); r <= Math.ceil(maxY / rowHeight); r++) {
    for (let q = Math.floor(minX - r / 2); q <= Math.ceil(maxX - r / 2); q++) {
      const hex = { q, r };
      const p = hexToPoint(hex);
      if (isLand(p)) land.set(hexKey(hex), hex);
    }
  }

  function isLand(p: Point): boolean {
    for (let i = 0; i < paths.length; i++) {
      if (pathDistance(p, paths[i]!) <= CORRIDOR_CORE) return true;
    }
    const bump = fbm(noise, p.x / coastDetail, p.y / coastDetail);
    // The rooms are bent by a second, slower noise field.
    const wx =
      p.x + warpStrength * noise(p.x / (coastDetail * 1.7) + 31.4, p.y / (coastDetail * 1.7));
    const wy =
      p.y + warpStrength * noise(p.x / (coastDetail * 1.7) - 19.2, p.y / (coastDetail * 1.7) + 8.8);
    let field = -Infinity;
    const blend = (term: number): void => {
      field = field === -Infinity ? term : smoothMax(field, term);
    };
    for (const { center, radius } of blueprint.chambers) {
      blend(radius - Math.hypot(wx - center.x, wy - center.y) + coastRoughness * bump);
    }
    for (let i = 0; i < paths.length; i++) {
      const width = blueprint.corridors[i]!.width;
      blend(width / 2 - pathDistance(p, paths[i]!) + coastRoughness * CORRIDOR_NOISE * bump);
    }
    return field + offset > 0;
  }

  // Every spawn chamber keeps its city and the ring around it.
  const protectedKeys = new Set<string>();
  for (const chamber of blueprint.chambers) {
    if (!chamber.spawn) continue;
    const city = pointToHex(chamber.center);
    for (const hex of [city, ...hexNeighbors(city)]) {
      land.set(hexKey(hex), hex);
      protectedKeys.add(hexKey(hex));
    }
  }
  return { land, protectedKeys };
}

/**
 * Tidy a drawn board: fill one-tile bays, trim one-tile spurs, and keep only the biggest piece.
 * Hexes in `protectedKeys` are never removed.
 */
export function cleanup(land: Land, protectedKeys: ReadonlySet<string>): Land {
  const result: Land = new Map(land);
  for (let pass = 0; pass < 3; pass++) {
    const bays = new Map<string, Hex>();
    for (const hex of result.values()) {
      for (const n of hexNeighbors(hex)) {
        if (!result.has(hexKey(n))) bays.set(hexKey(n), n);
      }
    }
    for (const [key, hex] of bays) {
      if (landNeighborCount(result, hex) >= 5) result.set(key, hex);
    }
    const spurs = [...result].filter(
      ([key, hex]) => !protectedKeys.has(key) && landNeighborCount(result, hex) <= 1,
    );
    for (const [key] of spurs) result.delete(key);
  }
  const pieces = components(result);
  if (pieces.length > 1) {
    const biggest = pieces.reduce((a, b) => (b.length > a.length ? b : a));
    const keep = new Set(biggest);
    for (const key of [...result.keys()]) if (!keep.has(key)) result.delete(key);
  }
  return result;
}

/** The shift that moves the middle of the land to the origin. */
export function centroidShift(land: ReadonlyMap<string, Hex>): Hex {
  let q = 0;
  let r = 0;
  for (const hex of land.values()) {
    q += hex.q;
    r += hex.r;
  }
  return { q: -Math.round(q / land.size), r: -Math.round(r / land.size) };
}
