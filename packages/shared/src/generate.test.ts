import { describe, expect, it } from 'vitest';
import { hexKey, hexRotate, hexagonalBoard } from './hex.js';
import { createSymmetricMatch } from './generate.js';
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

  it('rejects unsupported player counts', () => {
    expect(() => createSymmetricMatch({ players: ['A', 'B', 'C', 'D'], seed: 1 })).toThrow();
  });
});
