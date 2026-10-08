import { describe, expect, it } from 'vitest';
import { createFreeForAllMatch, createSymmetricMatch, recommendedRadius } from './generate.js';
import { hexDistance, hexKey, hexNeighbors, hexagonalBoard, type Hex } from './hex.js';
import { DEFAULT_GENERATION_PARAMS, withDefaults, type GenerationParams } from './params.js';
import { lakesOf, randomShape } from './shape.js';
import { createRng } from './rng.js';
import type { Tile } from './state.js';

const seeds = [1, 2, 3, 4, 5, 6, 7, 8];

const duel = (params: Partial<GenerationParams>, seed: number, radius = 10) =>
  createSymmetricMatch({ players: ['A', 'B'], seed, radius, shape: 'random', params }).state;
const ffa = (params: Partial<GenerationParams>, seed: number, players = 8) =>
  createFreeForAllMatch({
    players: Array.from({ length: players }, (_, i) => `P${i}`),
    seed,
    shape: 'random',
    params,
  }).state;
const tilesOf = (state: { tiles: Record<string, Tile> }) => Object.values(state.tiles);
const count = (tiles: Tile[], type: Tile['type']) => tiles.filter((t) => t.type === type).length;

describe('generation parameters', () => {
  it('fills in defaults', () => {
    expect(withDefaults()).toEqual(DEFAULT_GENERATION_PARAMS);
    expect(withDefaults({ minCityDistance: 5 }).tilesPerCity).toBe(50);
  });

  it('leaves boards as they were when nothing is overridden', () => {
    const a = createSymmetricMatch({ players: ['A', 'B'], seed: 3, radius: 8, shape: 'random' });
    const b = createSymmetricMatch({
      players: ['A', 'B'],
      seed: 3,
      radius: 8,
      shape: 'random',
      params: DEFAULT_GENERATION_PARAMS,
    });
    expect(a.state).toEqual(b.state);
  });

  describe('lakes', () => {
    it('can be switched off', () => {
      for (const seed of seeds) {
        expect(lakesOf(tilesOf(duel({ tilesPerLake: 0 }, seed)))).toHaveLength(0);
      }
    });

    it('can be made more common and bigger', () => {
      const lakeTiles = (params: Partial<GenerationParams>) =>
        seeds.reduce((sum, seed) => {
          const found = lakesOf(tilesOf(duel(params, seed, 14)));
          return sum + found.reduce((total, lake) => total + lake.length, 0);
        }, 0);
      expect(lakeTiles({ tilesPerLake: 40 })).toBeGreaterThan(lakeTiles({ tilesPerLake: 400 }));
      expect(lakeTiles({ minLakeSize: 15, maxLakePercent: 8 })).toBeGreaterThan(
        lakeTiles({ minLakeSize: 4, maxLakePercent: 2 }),
      );
    });
  });

  describe('outline', () => {
    it('makes a plain circle without waves or roughness', () => {
      const shape = randomShape({
        radius: 12,
        rng: createRng(1),
        group: [(h) => h],
        protect: [],
        params: { ...DEFAULT_GENERATION_PARAMS, waveCount: 0, jaggedness: 0, tilesPerLake: 0 },
      });
      const present = new Set(shape.map(hexKey));
      // Everything near the middle is land, everything far away is not, with no ragged edge.
      for (const hex of hexagonalBoard(18)) {
        const d = hexDistance(hex, { q: 0, r: 0 });
        if (d <= 8) expect(present.has(hexKey(hex))).toBe(true);
        if (d >= 15) expect(present.has(hexKey(hex))).toBe(false);
      }
    });

    it('still makes valid boards with extreme settings', () => {
      const wild = { waveStrength: 3, jaggedness: 4, waveCount: 6, waveDetail: 8 };
      for (const seed of seeds) {
        const tiles = tilesOf(duel(wild, seed));
        const present = new Set(tiles.map(hexKey));
        // One connected piece.
        const seen = new Set([hexKey(tiles[0]!)]);
        const stack: Hex[] = [tiles[0]!];
        while (stack.length > 0) {
          for (const n of hexNeighbors(stack.pop()!)) {
            const key = hexKey(n);
            if (present.has(key) && !seen.has(key)) {
              seen.add(key);
              stack.push(n);
            }
          }
        }
        expect(seen.size).toBe(tiles.length);
      }
    });
  });

  describe('cities and villages', () => {
    it('keeps cities as far apart as asked', () => {
      for (const seed of seeds) {
        const cities = tilesOf(duel({ minCityDistance: 6 }, seed)).filter((t) => t.type === 'city');
        for (const a of cities) {
          for (const b of cities) if (a !== b) expect(hexDistance(a, b)).toBeGreaterThanOrEqual(6);
        }
      }
    });

    it('places more cities when the density is raised', () => {
      const total = (tilesPerCity: number) =>
        seeds.reduce((sum, seed) => sum + count(tilesOf(duel({ tilesPerCity }, seed)), 'city'), 0);
      expect(total(25)).toBeGreaterThan(total(100));
    });

    it('can add extra cities to free-for-all boards', () => {
      for (const seed of seeds) {
        expect(count(tilesOf(ffa({}, seed)), 'city')).toBe(8);
      }
      const withCities = seeds.map((seed) =>
        count(tilesOf(ffa({ freeForAllCities: true }, seed)), 'city'),
      );
      expect(withCities.every((n) => n > 8)).toBe(true);
    });

    it('places no villages at 0% and fewer at lower chances', () => {
      for (const seed of seeds) {
        expect(count(tilesOf(duel({ villageChance: 0 }, seed)), 'village')).toBe(0);
      }
      const total = (villageChance: number) =>
        seeds.reduce(
          (sum, seed) => sum + count(tilesOf(duel({ villageChance }, seed)), 'village'),
          0,
        );
      expect(total(30)).toBeLessThan(total(100));
      expect(total(30)).toBeGreaterThan(0);
    });

    it('keeps villages as far apart as asked', () => {
      for (const seed of seeds) {
        const villages = tilesOf(duel({ minVillageDistance: 3 }, seed)).filter(
          (t) => t.type === 'village',
        );
        for (const a of villages) {
          for (const b of villages)
            if (a !== b) expect(hexDistance(a, b)).toBeGreaterThanOrEqual(3);
        }
      }
    });

    it('only lets villages touch cities when allowed', () => {
      const touching = (params: Partial<GenerationParams>) =>
        seeds.reduce((sum, seed) => {
          const state = duel(params, seed);
          return (
            sum +
            tilesOf(state).filter(
              (t) =>
                t.type === 'village' &&
                hexNeighbors(t).some((n) => state.tiles[hexKey(n)]?.type === 'city'),
            ).length
          );
        }, 0);
      expect(touching({})).toBe(0);
      expect(touching({ villagesNextToCities: true })).toBeGreaterThan(0);
    });
  });

  describe('starts and size', () => {
    it('puts starting cities further in when asked', () => {
      const starts = (startInset: number) =>
        tilesOf(
          createSymmetricMatch({
            players: ['A', 'B'],
            seed: 1,
            radius: 9,
            params: { startInset },
          }).state,
        ).filter((t) => t.owner !== null);
      expect(starts(1).map((t) => Math.abs(t.q))).toEqual([8, 8]);
      expect(starts(3).map((t) => Math.abs(t.q))).toEqual([6, 6]);
    });

    it('sizes free-for-all boards from the tiles per player', () => {
      expect(recommendedRadius(8, 'freeForAll', 20)).toBeLessThan(
        recommendedRadius(8, 'freeForAll', 60),
      );
      const radius = (tilesPerPlayer: number) =>
        Math.max(
          ...tilesOf(
            createFreeForAllMatch({
              players: Array.from({ length: 8 }, (_, i) => `P${i}`),
              seed: 2,
              params: { tilesPerPlayer },
            }).state,
          ).map((t) => hexDistance(t, { q: 0, r: 0 })),
        );
      expect(radius(60)).toBeGreaterThan(radius(30));
    });
  });
});
