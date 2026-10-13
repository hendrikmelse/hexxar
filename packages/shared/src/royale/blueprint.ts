import { hexRound, type Hex } from '../hex.js';

/**
 * A point in "tile units": the distance between two neighboring hex centers is 1. Blueprints are
 * drawn in these units, so a corridor that is 2 wide is 2 hexes wide on a small board and a big one.
 */
export interface Point {
  readonly x: number;
  readonly y: number;
}

const HALF_SQRT3 = Math.sqrt(3) / 2;

export const hexToPoint = (h: Hex): Point => ({ x: h.q + h.r / 2, y: h.r * HALF_SQRT3 });

export function pointToHex(p: Point): Hex {
  const r = p.y / HALF_SQRT3;
  return hexRound(p.x - r / 2, r);
}

/** A round room. Spawn chambers hold a starting city at their center. */
export interface Chamber {
  readonly center: Point;
  readonly radius: number;
  readonly spawn: boolean;
}

/** A passage between two chambers. `width` is in hexes and `bend` bows the middle sideways. */
export interface Corridor {
  readonly from: number;
  readonly to: number;
  readonly width: number;
  readonly bend: number;
}

/** The skeleton of a board: what is connected to what, before it is drawn onto hexes. */
export interface Blueprint {
  readonly chambers: readonly Chamber[];
  readonly corridors: readonly Corridor[];
}

/** The centerline of a corridor, from one chamber center to the other. */
export function corridorPath(blueprint: Blueprint, corridor: Corridor): Point[] {
  const a = blueprint.chambers[corridor.from]!.center;
  const b = blueprint.chambers[corridor.to]!.center;
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const middle = {
    x: (a.x + b.x) / 2 - ((b.y - a.y) / length) * corridor.bend,
    y: (a.y + b.y) / 2 + ((b.x - a.x) / length) * corridor.bend,
  };
  return [a, middle, b];
}

/** Distance from `p` to the segment `a`-`b`. */
export function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance from `p` to a polyline. */
export function pathDistance(p: Point, path: readonly Point[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i++) {
    best = Math.min(best, segmentDistance(p, path[i]!, path[i + 1]!));
  }
  return best;
}

export const translate = (p: Point, by: Point): Point => ({ x: p.x + by.x, y: p.y + by.y });
