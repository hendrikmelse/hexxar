import { HEX_DIRECTIONS, hexKey, type Hex } from './hex.js';
import type { PlayerId } from './state.js';

/**
 * How much of a tile a player can see, under fog of war:
 * - `full`: everything. Their own tiles, and every tile next to one of them.
 * - `far`: the tile's owner and type, but not its troops. The tiles two steps from their own.
 * - anything else is hidden: the board knows the tile is there, and nothing more.
 */
export type Vision = 'full' | 'far';

/** The offsets of the tiles within two steps of a tile, nearest first, with their distance. */
const NEARBY: readonly { readonly q: number; readonly r: number; readonly far: boolean }[] =
  (() => {
    const ring1 = HEX_DIRECTIONS.map((d) => ({ q: d.q, r: d.r, far: false }));
    const seen = new Set<string>(['0,0', ...ring1.map(hexKey)]);
    const ring2: { q: number; r: number; far: boolean }[] = [];
    for (const a of HEX_DIRECTIONS) {
      for (const b of HEX_DIRECTIONS) {
        const hex = { q: a.q + b.q, r: a.r + b.r };
        if (!seen.has(hexKey(hex))) {
          seen.add(hexKey(hex));
          ring2.push({ ...hex, far: true });
        }
      }
    }
    return [{ q: 0, r: 0, far: false }, ...ring1, ...ring2];
  })();

/**
 * What `player` can see of a board with these tiles: a map from tile key to `Vision`, with the
 * tiles they cannot see left out. `ownerOf` can stand in for a tile's owner (a client uses it to
 * keep showing a tile as it was while an army is still walking onto it).
 */
export function visionOf(
  tiles: Readonly<
    Record<string, { readonly q: number; readonly r: number; readonly owner: PlayerId | null }>
  >,
  player: PlayerId,
  ownerOf?: ReadonlyMap<string, PlayerId | null>,
): Map<string, Vision> {
  const vision = new Map<string, Vision>();
  for (const [key, tile] of Object.entries(tiles)) {
    const owner = ownerOf?.has(key) ? ownerOf.get(key) : tile.owner;
    if (owner !== player) continue;
    for (const offset of NEARBY) {
      const near: Hex = { q: tile.q + offset.q, r: tile.r + offset.r };
      const nearKey = hexKey(near);
      if (!(nearKey in tiles)) continue;
      if (!offset.far) vision.set(nearKey, 'full');
      else if (!vision.has(nearKey)) vision.set(nearKey, 'far');
    }
  }
  return vision;
}
