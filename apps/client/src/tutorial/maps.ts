import type { GameState, Hex, PlayerId, Tile, TileTypeId } from '@hexxar/shared';
import { hexKey } from '@hexxar/shared';

/** Players in the tutorial: you, and up to two rivals that follow the lesson's script. */
export const YOU: PlayerId = 'you';
export const RIVAL: PlayerId = 'rival';
export const RIVAL_TWO: PlayerId = 'rival2';

interface Piece {
  readonly type: TileTypeId;
  readonly owner: PlayerId | null;
  readonly troops: number;
}

/** What each character of a map stands for. Cities and villages hold the starting troops shown here. */
const PIECES: Readonly<Record<string, Piece>> = {
  '.': { type: 'farmland', owner: null, troops: 1 },
  v: { type: 'village', owner: null, troops: 4 },
  c: { type: 'city', owner: null, troops: 10 },
  Y: { type: 'city', owner: YOU, troops: 10 },
  y: { type: 'farmland', owner: YOU, troops: 1 },
  E: { type: 'city', owner: RIVAL, troops: 10 },
  e: { type: 'farmland', owner: RIVAL, troops: 1 },
  F: { type: 'village', owner: RIVAL, troops: 4 },
  G: { type: 'city', owner: RIVAL_TWO, troops: 10 },
};

/**
 * The board at a column and row of a map, as hex coordinates. Rows are laid out with every odd
 * row shifted half a tile to the right, which is how the board is drawn.
 */
export function at(column: number, row: number): Hex {
  return { q: column - (row - (row & 1)) / 2, r: row };
}

/**
 * Build a tutorial board from rows of characters (see `PIECES`; a space is no tile). Every tile
 * starts with zero generation progress.
 */
export function parseMap(rows: readonly string[], players: readonly PlayerId[]): GameState {
  const tiles: Record<string, Tile> = {};
  rows.forEach((line, row) => {
    [...line].forEach((char, column) => {
      const piece = PIECES[char];
      if (!piece) return;
      const hex = at(column, row);
      tiles[hexKey(hex)] = { ...hex, ...piece, progress: 0 };
    });
  });
  return { tick: 1, players: [...players], eliminated: [], winner: null, tiles };
}

/** A copy of the state with some tiles changed. */
export function withTiles(
  state: GameState,
  changes: readonly { at: Hex; set: Partial<Omit<Tile, 'q' | 'r'>> }[],
): GameState {
  const tiles = { ...state.tiles };
  for (const { at: hex, set } of changes) {
    const key = hexKey(hex);
    const tile = tiles[key];
    if (!tile) throw new Error(`no tile at ${key}`);
    tiles[key] = { ...tile, ...set };
  }
  return { ...state, tiles };
}
