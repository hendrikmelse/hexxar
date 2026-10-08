import { describe, expect, it } from 'vitest';
import { parseMatchConfig } from './config.js';
import { hexKey, hexagonalBoard } from './hex.js';
import { scoresOf } from './scores.js';
import type { GameState, Tile } from './state.js';
import { visibleMoves, visibleState } from './visibility.js';
import { visionOf } from './vision.js';

const fogged = parseMatchConfig({ fog: 'on' });
const clear = parseMatchConfig({ fog: 'off' });

/** A radius-6 board with the given owners at the given hexes, 5 troops on owned tiles. */
function board(owned: { q: number; r: number; owner: string; type?: Tile['type'] }[]): GameState {
  const tiles: Record<string, Tile> = {};
  for (const hex of hexagonalBoard(6)) {
    tiles[hexKey(hex)] = { ...hex, type: 'farmland', owner: null, troops: 1, progress: 0 };
  }
  for (const { owner, type, ...hex } of owned) {
    tiles[hexKey(hex)] = { ...hex, type: type ?? 'farmland', owner, troops: 5, progress: 0 };
  }
  return { tick: 0, players: ['A', 'B'], eliminated: [], winner: null, tiles };
}

describe('visionOf', () => {
  it('sees a tile and its neighbors in full, and the ring beyond as far', () => {
    const state = board([{ q: 0, r: 0, owner: 'A' }]);
    const vision = visionOf(state.tiles, 'A');
    const count = (level: string) => [...vision.values()].filter((v) => v === level).length;
    expect(count('full')).toBe(7); // the tile and its six neighbors
    expect(count('far')).toBe(12); // the ring two steps away
    expect(vision.get('0,0')).toBe('full');
    expect(vision.get('1,0')).toBe('full');
    expect(vision.get('2,0')).toBe('far');
    expect(vision.get('2,-1')).toBe('far');
    expect(vision.has('3,0')).toBe(false);
  });

  it('only counts tiles that are on the board, and joins up several tiles', () => {
    const state = board([
      { q: 6, r: 0, owner: 'A' },
      { q: 4, r: 0, owner: 'A' },
    ]);
    const vision = visionOf(state.tiles, 'A');
    expect(vision.has('7,0')).toBe(false);
    // 5,0 is next to both: full. 2,0 is two from 4,0: far.
    expect(vision.get('5,0')).toBe('full');
    expect(vision.get('2,0')).toBe('far');
  });

  it('can take a tile as owned by someone else, for tiles being walked onto', () => {
    const state = board([{ q: 0, r: 0, owner: 'A' }]);
    const stale = new Map<string, string | null>([['0,0', null]]);
    expect(visionOf(state.tiles, 'A', stale).size).toBe(0);
  });
});

describe('visibleState', () => {
  const state = board([
    { q: 0, r: 0, owner: 'A', type: 'city' },
    { q: 2, r: 0, owner: 'B', type: 'village' },
    { q: 5, r: 0, owner: 'B', type: 'city' },
  ]);

  it('shows everything, in full, with the fog off', () => {
    expect(visibleState(state, 'A', clear)).toBe(state);
  });

  it('shows near tiles in full, far ones without troops, and blanks out the rest', () => {
    const seen = visibleState(state, 'A', fogged).tiles;
    expect(seen['0,0']).toMatchObject({ type: 'city', owner: 'A', troops: 5 });
    expect(seen['1,0']).toMatchObject({ owner: null, troops: 1 });
    // B's village is two steps away: owner and type, but not how many troops.
    expect(seen['2,0']).toMatchObject({ type: 'village', owner: 'B', troops: 0 });
    // B's city is far out of sight: nothing but the fact that there is a tile.
    expect(seen['5,0']).toEqual({
      q: 5,
      r: 0,
      type: 'farmland',
      owner: null,
      troops: 0,
      progress: 0,
    });
    expect(Object.keys(seen)).toHaveLength(Object.keys(state.tiles).length);
  });

  it('shows B what B can see, which is not the same', () => {
    const seen = visibleState(state, 'B', fogged).tiles;
    expect(seen['0,0']).toMatchObject({ type: 'city', owner: 'A', troops: 0 });
    expect(seen['1,0']).toMatchObject({ troops: 1 });
  });

  it('shows everything to a player who is out of the game, and once it is over', () => {
    expect(visibleState({ ...state, eliminated: ['A'] }, 'A', fogged)).toEqual({
      ...state,
      eliminated: ['A'],
    });
    expect(visibleState({ ...state, winner: 'B' }, 'A', fogged).tiles['5,0']?.owner).toBe('B');
  });
});

describe('visibleMoves', () => {
  const before = board([
    { q: 0, r: 0, owner: 'A' },
    { q: 5, r: 0, owner: 'B' },
  ]);
  const near = { player: 'B', from: { q: 1, r: 0 }, to: { q: 0, r: 0 }, troops: 3 };
  const away = { player: 'B', from: { q: 5, r: 0 }, to: { q: 4, r: 0 }, troops: 3 };

  it('shows moves with an end in full view, and hides the rest', () => {
    expect(visibleMoves([near, away], 'A', before, before, fogged)).toEqual([near]);
    expect(visibleMoves([near, away], 'A', before, before, clear)).toEqual([near, away]);
  });
});

describe('scoresOf', () => {
  it('counts tiles, troops and the troops per tick the producers make', () => {
    const state = board([
      { q: 0, r: 0, owner: 'A', type: 'city' },
      { q: 1, r: 0, owner: 'A' },
      { q: 4, r: 0, owner: 'B', type: 'village' },
    ]);
    const [a, b] = scoresOf(state, clear);
    expect(a).toMatchObject({ player: 'A', tiles: 2, troops: 10 });
    // A city with one owned farm next to it makes a troop every 7 ticks.
    expect(a!.capacity).toBeCloseTo(1 / 7);
    // A village with no farms of its own around it makes one every 12.
    expect(b).toMatchObject({ player: 'B', tiles: 1, troops: 5 });
    expect(b!.capacity).toBeCloseTo(1 / 12);
  });
});
