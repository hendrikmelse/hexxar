import { hexKey, hexNeighbors, type Hex } from '../hex.js';

/** The land of a board, by hex key. */
export type Land = Map<string, Hex>;

export const neighborKeys = (h: Hex): string[] => hexNeighbors(h).map(hexKey);

export const landNeighborCount = (land: ReadonlyMap<string, Hex>, h: Hex): number =>
  neighborKeys(h).filter((key) => land.has(key)).length;

/** The connected pieces of a set of tiles, as lists of keys. */
export function components(land: ReadonlyMap<string, Hex>): string[][] {
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

/**
 * How many tiles each land tile is from the coast: 1 for a tile touching the outside (an
 * "edge" tile, where no city may stand), 2 for the next ring in, and so on.
 */
export function depthFromCoast(land: ReadonlyMap<string, Hex>): Map<string, number> {
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
