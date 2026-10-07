import { hexDistance, hexKey, hexNeighbors, hexagonalBoard, type Hex } from './hex.js';
import type { Rng } from './rng.js';

type Transform = (h: Hex) => Hex;

export interface RandomShapeInput {
  /** The radius of a regular hexagonal board of about the same size. */
  readonly radius: number;
  readonly rng: Rng;
  /** The symmetries the shape must keep (just the identity for none). */
  readonly group: readonly Transform[];
  /** Hexes that must be on the board with room around them: the starting cities. */
  readonly protect: readonly Hex[];
}

/** Disk around each protected hex that is always kept: its neighbors and their neighbors. */
const PROTECT_RADIUS = 2;
/** Cutouts keep at least this many tiles of board between them and the outside. */
const CUTOUT_CLEARANCE = 3;
const SQRT3 = Math.sqrt(3);

/** Distance from the center in tile spacings, and direction, of a hex. */
function polar(h: Hex): { u: number; theta: number } {
  const x = SQRT3 * (h.q + h.r / 2);
  const y = 1.5 * h.r;
  return { u: Math.hypot(x, y) / SQRT3, theta: Math.atan2(y, x) };
}

const neighborKeys = (h: Hex): string[] => hexNeighbors(h).map(hexKey);

const byPosition = (a: Hex, b: Hex): number => a.q - b.q || a.r - b.r;

/**
 * A random board outline, as a list of hexes.
 *
 * The outline is a circle bent by a few random waves (so it has lobes and bays, not six
 * straight sides), with each tile's edge position jittered for a rough coastline. A few
 * cutouts are then carved out of the inside. Everything is decided so that the result
 * keeps the symmetries in `group`: a hex is kept if any of its images would be, and
 * cutouts are carved out along with all of their images.
 *
 * Falls back to a plain hexagon in the unlikely case that no random shape passes the
 * checks (one connected piece, the right amount of land, room around every start).
 */
export function randomShape(input: RandomShapeInput): Hex[] {
  for (let attempt = 0; attempt < 40; attempt++) {
    const shape = tryShape(input);
    if (shape) return shape;
  }
  return hexagonalBoard(input.radius);
}

function tryShape({ radius, rng, group, protect }: RandomShapeInput): Hex[] | null {
  const candidates = hexagonalBoard(radius + 5);

  // -- Outline: a bent circle with a rough edge.
  const waves = Array.from({ length: 3 }, () => ({
    k: 2 + rng.int(4),
    amplitude: 0.04 + rng.next() * 0.09,
    phase: rng.next() * Math.PI * 2,
  }));
  const jitter = new Map<string, number>();
  for (const hex of candidates) jitter.set(hexKey(hex), (rng.next() - 0.5) * 1.8);
  // A circle of this radius holds about as many tiles as a hexagon of the given radius.
  const base = 0.91 * radius;
  const wouldBeLand = (hex: Hex): boolean => {
    const { u, theta } = polar(hex);
    let scale = 1;
    for (const wave of waves) scale += wave.amplitude * Math.cos(wave.k * theta + wave.phase);
    return u + (jitter.get(hexKey(hex)) ?? 0) <= base * scale;
  };
  // Land if the hex or any of its images would be: that is what keeps the symmetry.
  const land = new Map<string, Hex>();
  for (const hex of candidates) {
    if (group.some((image) => wouldBeLand(image(hex)))) land.set(hexKey(hex), hex);
  }

  // Keep the starting cities and everything around them.
  const protectedKeys = new Set<string>();
  for (const start of protect) {
    for (const hex of candidates) {
      if (hexDistance(hex, start) <= PROTECT_RADIUS) {
        land.set(hexKey(hex), hex);
        protectedKeys.add(hexKey(hex));
      }
    }
  }

  tidy(land, candidates, protectedKeys);

  // -- Drop tiny islands; what is left must be one piece.
  for (const piece of components(land)) {
    if (piece.length < 6) for (const key of piece) land.delete(key);
  }
  if (components(land).length !== 1) return null;

  carveCutouts(land, { rng, group, protect });
  // Carving can leave a tile stranded between a lake and the coast; tidy up again.
  tidy(land, candidates, protectedKeys);
  if (components(land).length !== 1) return null;
  for (const key of protectedKeys) if (!land.has(key)) return null;

  // -- Not much bigger or smaller than the hexagon it stands in for.
  const hexagonSize = 3 * radius * (radius + 1) + 1;
  if (land.size < hexagonSize * 0.72 || land.size > hexagonSize * 1.3) return null;

  return [...land.values()].sort(byPosition);
}

/**
 * Tidy the edge: no spurs, no one-tile bays. Each step looks at the board as it was before
 * the step (not tile by tile), so the result does not depend on the order tiles are visited
 * in and symmetry is preserved.
 */
function tidy(
  land: Map<string, Hex>,
  candidates: readonly Hex[],
  protectedKeys: ReadonlySet<string>,
): void {
  const landNeighbors = (hex: Hex): number => neighborKeys(hex).filter((n) => land.has(n)).length;
  for (let pass = 0; pass < 3; pass++) {
    const spurs = [...land].filter(
      ([key, hex]) => !protectedKeys.has(key) && landNeighbors(hex) <= 2,
    );
    for (const [key] of spurs) land.delete(key);
    const bays = candidates.filter((hex) => !land.has(hexKey(hex)) && landNeighbors(hex) >= 5);
    for (const hex of bays) land.set(hexKey(hex), hex);
  }
}

/** The connected pieces of a set of tiles, as lists of keys. */
function components(land: ReadonlyMap<string, Hex>): string[][] {
  const seen = new Set<string>();
  const pieces: string[][] = [];
  for (const [start, hex] of land) {
    if (seen.has(start)) continue;
    const piece: string[] = [];
    const stack: Hex[] = [hex];
    seen.add(start);
    while (stack.length > 0) {
      const current = stack.pop()!;
      piece.push(hexKey(current));
      for (const next of hexNeighbors(current)) {
        const key = hexKey(next);
        if (land.has(key) && !seen.has(key)) {
          seen.add(key);
          stack.push(next);
        }
      }
    }
    pieces.push(piece);
  }
  return pieces;
}

/** How many tiles each land tile is from the coast (1 for a tile touching the outside). */
function depthFromCoast(land: ReadonlyMap<string, Hex>): Map<string, number> {
  const depth = new Map<string, number>();
  let frontier: Hex[] = [];
  for (const [key, hex] of land) {
    if (neighborKeys(hex).some((n) => !land.has(n))) {
      depth.set(key, 1);
      frontier.push(hex);
    }
  }
  while (frontier.length > 0) {
    const next: Hex[] = [];
    for (const hex of frontier) {
      const here = depth.get(hexKey(hex))!;
      for (const neighbor of hexNeighbors(hex)) {
        const key = hexKey(neighbor);
        if (land.has(key) && !depth.has(key)) {
          depth.set(key, here + 1);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }
  return depth;
}

/**
 * Cut a few lakes out of the board. Each is one blob of contiguous tiles (never a lone
 * tile), kept away from the coast, the starting cities and each other, and carved out of
 * every symmetric image at once.
 */
function carveCutouts(
  land: Map<string, Hex>,
  { rng, group, protect }: Pick<RandomShapeInput, 'rng' | 'group' | 'protect'>,
): void {
  const depth = depthFromCoast(land);
  const area = land.size;
  const count = rng.int(Math.max(1, Math.round(area / 140)) + 1);
  const minSize = 5;
  const maxSize = Math.min(60, Math.max(10, Math.round(area / 30)));
  const cut = new Set<string>();
  const cutHexes: Hex[] = [];
  const tooClose = (hex: Hex, others: readonly Hex[], distance: number): boolean =>
    others.some((other) => hexDistance(hex, other) < distance);

  for (let i = 0; i < count; i++) {
    const centers = [...land.values()].filter(
      (hex) =>
        (depth.get(hexKey(hex)) ?? 0) >= CUTOUT_CLEARANCE + 2 &&
        !tooClose(hex, protect, PROTECT_RADIUS + 4) &&
        !tooClose(hex, cutHexes, 4),
    );
    if (centers.length === 0) break;
    const center = centers[rng.int(centers.length)]!;
    const size = minSize + rng.int(maxSize - minSize + 1);
    const blob = growBlob(center, size, rng, (hex) => {
      const key = hexKey(hex);
      return (
        land.has(key) &&
        !cut.has(key) &&
        (depth.get(key) ?? 0) >= CUTOUT_CLEARANCE &&
        !tooClose(hex, protect, PROTECT_RADIUS + 2) &&
        !tooClose(hex, cutHexes, 3)
      );
    });
    if (blob.length < 4) continue;

    // Carve every image of the blob, as long as the images stay clear of each other.
    const images = group.map((image) => blob.map(image));
    const blobKeys = new Set(blob.map(hexKey));
    const valid = images.every((image) => {
      const keys = image.map(hexKey);
      if (keys.every((key) => blobKeys.has(key))) return true; // the blob is symmetric itself
      return !image.some((hex) => tooClose(hex, blob, 3)) && keys.every((key) => land.has(key));
    });
    if (!valid) continue;
    for (const image of images) {
      for (const hex of image) {
        if (!cut.has(hexKey(hex))) {
          cut.add(hexKey(hex));
          cutHexes.push(hex);
        }
      }
    }
  }
  for (const key of cut) land.delete(key);
}

/** Grow a compact blob of up to `size` tiles outward from `center`. */
function growBlob(center: Hex, size: number, rng: Rng, allowed: (hex: Hex) => boolean): Hex[] {
  if (!allowed(center)) return [];
  const blob = [center];
  const inBlob = new Set([hexKey(center)]);
  while (blob.length < size) {
    // Favor tiles that touch several blob tiles, so the blob stays round, not stringy.
    const options: { hex: Hex; weight: number }[] = [];
    const seen = new Set<string>();
    for (const tile of blob) {
      for (const hex of hexNeighbors(tile)) {
        const key = hexKey(hex);
        if (inBlob.has(key) || seen.has(key) || !allowed(hex)) continue;
        seen.add(key);
        const touching = neighborKeys(hex).filter((n) => inBlob.has(n)).length;
        options.push({ hex, weight: touching * touching });
      }
    }
    if (options.length === 0) break;
    let roll = rng.next() * options.reduce((sum, option) => sum + option.weight, 0);
    let chosen = options[options.length - 1]!;
    for (const option of options) {
      roll -= option.weight;
      if (roll < 0) {
        chosen = option;
        break;
      }
    }
    blob.push(chosen.hex);
    inBlob.add(hexKey(chosen.hex));
  }
  return blob;
}
