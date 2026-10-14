import { describe, expect, it, vi } from 'vitest';
import { hexDistance, hexKey, hexNeighbors } from './hex.js';
import { createFreeForAllMatch } from './generate.js';
import { createRng } from './rng.js';
import { parseMatchConfig } from './config.js';

// Many of these tests make dozens of whole boards.
vi.setConfig({ testTimeout: 60000 });

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
  it('takes overrides and refuses ones that are out of range', () => {
    expect(parseMatchConfig({ tickMs: 500 }).tickMs).toBe(500);
    expect(() => parseMatchConfig({ tickMs: 5 })).toThrow();
  });
});

describe('battle royale boards', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `P${i + 1}`);
  const board = (n: number, seed: number) =>
    createFreeForAllMatch({ players: ids(n), seed, params: { villageChance: 100 } }).state;
  const counts = [3, 5, 8, 12];
  /** The spawn bowls are kept about this far apart. */
  const minDistance = 4;

  it('is deterministic for a seed and different for different seeds', () => {
    expect(board(8, 5)).toEqual(board(8, 5));
    expect(board(8, 5).tiles).not.toEqual(board(8, 6).tiles);
  });

  it('scales the board with the number of players', () => {
    // The default bowls give about 20 tiles per player, whatever the number of players.
    for (const n of counts) {
      let tiles = 0;
      for (let seed = 1; seed <= 6; seed++) tiles += Object.keys(board(n, seed).tiles).length;
      expect(tiles / 6 / n).toBeGreaterThan(14);
      expect(tiles / 6 / n).toBeLessThan(28);
    }
  });

  it('gives every player exactly one starting city, spread out and away from the edge', () => {
    for (const n of counts) {
      for (let seed = 1; seed <= 4; seed++) {
        const state = board(n, seed);
        const owned = Object.values(state.tiles).filter((t) => t.owner !== null);
        expect(owned).toHaveLength(n);
        expect(new Set(owned.map((t) => t.owner)).size).toBe(n);
        for (const start of owned) {
          expect(start.type).toBe('city');
          expect(start.troops).toBe(10);
          for (const nb of hexNeighbors(start)) expect(state.tiles[hexKey(nb)]).toBeDefined();
        }
        for (const a of owned) {
          for (const b of owned)
            if (a !== b) expect(hexDistance(a, b)).toBeGreaterThanOrEqual(minDistance);
        }
      }
    }
  });

  it('assigns players to starting spots at random', () => {
    const spots = new Set(
      [1, 2, 3, 4, 5, 6].map((seed) => {
        const mine = Object.values(board(6, seed).tiles).find((t) => t.owner === 'P1')!;
        return hexKey(mine);
      }),
    );
    expect(spots.size).toBeGreaterThan(1);
  });

  it('follows the same city and village rules as symmetric boards', () => {
    for (const n of [3, 8, 12]) {
      for (let seed = 1; seed <= 3; seed++) {
        const state = board(n, seed);
        const tiles = Object.values(state.tiles);
        const cities = tiles.filter((t) => t.type === 'city');
        for (const a of cities) {
          for (const nb of hexNeighbors(a)) expect(state.tiles[hexKey(nb)]).toBeDefined();
          for (const b of cities)
            if (a !== b) expect(hexDistance(a, b)).toBeGreaterThanOrEqual(minDistance);
        }
        for (const village of tiles.filter((t) => t.type === 'village')) {
          for (const nb of hexNeighbors(village)) {
            const type = state.tiles[hexKey(nb)]?.type;
            expect(type === 'village' || type === 'city').toBe(false);
          }
        }
        // No farmland tile could still become a village.
        for (const farm of tiles.filter((t) => t.type === 'farmland')) {
          const blocked = hexNeighbors(farm).some((nb) => {
            const type = state.tiles[hexKey(nb)]?.type;
            return type === 'village' || type === 'city';
          });
          expect(blocked).toBe(true);
        }
        // Battle Royale boards have no cities beyond the starting ones.
        expect(cities).toHaveLength(n);
      }
    }
  });

  it('rejects matches with fewer than two players', () => {
    expect(() => createFreeForAllMatch({ players: ids(1), seed: 1 })).toThrow();
  });
});
