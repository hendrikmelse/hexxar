import { describe, expect, it } from 'vitest';
import {
  hexFlipHorizontal,
  hexFlipVertical,
  hexKey,
  hexRotate,
  hexagonalBoard,
  type Hex,
} from './hex.js';
import { createSymmetricMatch, type Symmetry } from './generate.js';
import { TILE_TYPES } from './tiles.js';
import { createRng } from './rng.js';
import { parseMatchConfig } from './config.js';

describe('rng', () => {
  it('is deterministic for a seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    expect(Array.from({ length: 5 }, () => a.next())).toEqual(
      Array.from({ length: 5 }, () => b.next()),
    );
  });
});

describe('match config', () => {
  it('fills defaults and validates overrides', () => {
    expect(parseMatchConfig({}).tickMs).toBe(2000);
    expect(parseMatchConfig({ tickMs: 500 }).tickMs).toBe(500);
    expect(() => parseMatchConfig({ tickMs: 5 })).toThrow();
  });
});

describe('createSymmetricMatch', () => {
  it('is deterministic for a seed', () => {
    const opts = { players: ['A', 'B'], seed: 7 };
    expect(createSymmetricMatch(opts).state).toEqual(createSymmetricMatch(opts).state);
  });

  it.each([2, 3, 6])('is rotationally symmetric for %i players', (n) => {
    const players = Array.from({ length: n }, (_, i) => `P${i}`);
    const { state } = createSymmetricMatch({ players, seed: 1234, radius: 5 });
    expect(Object.keys(state.tiles)).toHaveLength(hexagonalBoard(5).length);
    for (const tile of Object.values(state.tiles)) {
      const image = state.tiles[hexKey(hexRotate(tile, 1))]!;
      expect(image.type).toBe(tile.type);
      // Neutral tiles must match in garrison too; start tiles are checked below.
      if (tile.owner === null && image.owner === null) expect(image.troops).toBe(tile.troops);
    }
  });

  it('gives every player an identical starting city', () => {
    const { state, config } = createSymmetricMatch({ players: ['A', 'B', 'C'], seed: 9 });
    for (const p of state.players) {
      const owned = Object.values(state.tiles).filter((t) => t.owner === p);
      expect(owned).toHaveLength(1);
      expect(owned[0]).toMatchObject({ type: 'city', troops: config.startingTroops });
    }
  });

  const mirrorSymmetries: [number, Symmetry][] = [
    [2, 'mirror'],
    [4, 'mirror'],
  ];
  it.each(mirrorSymmetries)('is mirror symmetric for %i players', (n, symmetry) => {
    const players = Array.from({ length: n }, (_, i) => `P${i}`);
    const { state } = createSymmetricMatch({ players, seed: 99, radius: 6, symmetry });
    const maps: ((h: Hex) => Hex)[] = [hexFlipVertical, hexFlipHorizontal];
    for (const tile of Object.values(state.tiles)) {
      for (const map of maps) {
        const image = state.tiles[hexKey(map(tile))]!;
        expect(image.type).toBe(tile.type);
        if (tile.owner === null && image.owner === null) expect(image.troops).toBe(tile.troops);
      }
    }
    for (const p of players) {
      const owned = Object.values(state.tiles).filter((t) => t.owner === p);
      expect(owned).toHaveLength(1);
      expect(owned[0]!.type).toBe('city');
    }
  });

  it('spreads four players around the board', () => {
    const players = ['A', 'B', 'C', 'D'];
    const { state } = createSymmetricMatch({ players, seed: 5 });
    const starts = Object.values(state.tiles).filter((t) => t.owner !== null);
    const quadrants = new Set(starts.map((t) => `${Math.sign(t.q + t.r / 2)},${Math.sign(t.r)}`));
    expect(quadrants.size).toBe(4);
  });

  it('starts neutral tiles at their base garrison', () => {
    const { state } = createSymmetricMatch({ players: ['A', 'B'], seed: 3 });
    for (const t of Object.values(state.tiles)) {
      if (t.owner === null) expect(t.troops).toBe(TILE_TYPES[t.type].baseGarrison);
    }
  });

  it('rejects unsupported combinations', () => {
    const make = (players: string[], symmetry?: Symmetry) =>
      createSymmetricMatch({ players, seed: 1, symmetry });
    expect(() => make(['A', 'B', 'C', 'D', 'E'])).toThrow();
    expect(() => make(['A', 'B', 'C', 'D'], 'rotational')).toThrow();
    expect(() => make(['A', 'B', 'C'], 'mirror')).toThrow();
    expect(() => make(['A'])).toThrow();
  });
});
