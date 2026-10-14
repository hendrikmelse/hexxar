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
