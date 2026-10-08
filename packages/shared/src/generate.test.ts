import { describe, expect, it } from 'vitest';
import {
  hexDistance,
  hexFlipHorizontal,
  hexFlipVertical,
  hexKey,
  hexNeighbors,
  hexRotate,
  hexagonalBoard,
  type Hex,
} from './hex.js';
import {
  MIN_CITY_DISTANCE,
  TILES_PER_CITY,
  createFreeForAllMatch,
  createSymmetricMatch,
  recommendedRadius,
  type Symmetry,
} from './generate.js';
import { TILE_TYPES } from './tiles.js';
import { DEFAULT_GENERATION_PARAMS } from './params.js';
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
    const { state } = createSymmetricMatch({
      players,
      seed: 1234,
      radius: 5,
      symmetry: 'rotational',
    });
    expect(Object.keys(state.tiles)).toHaveLength(hexagonalBoard(5).length);
    for (const tile of Object.values(state.tiles)) {
      // A turn of 360 / players degrees (180 for 2, 120 for 3, 60 for 6) maps the board onto itself.
      const image = state.tiles[hexKey(hexRotate(tile, 6 / n))]!;
      expect(image.type).toBe(tile.type);
      // Neutral tiles must match in garrison too; start tiles are checked below.
      if (tile.owner === null && image.owner === null) expect(image.troops).toBe(tile.troops);
    }
  });

  it('only needs as much rotational symmetry as there are players', () => {
    // Under one 60 degree step the board changes, unless there are 6 players.
    const rotatesBy60 = (n: number, seed: number) => {
      const players = Array.from({ length: n }, (_, i) => `P${i}`);
      const { state } = createSymmetricMatch({ players, seed, radius: 8, symmetry: 'rotational' });
      return Object.values(state.tiles).every(
        (t) => state.tiles[hexKey(hexRotate(t, 1))]!.type === t.type,
      );
    };
    const seeds = [1, 2, 3, 4, 5];
    expect(seeds.every((s) => !rotatesBy60(2, s))).toBe(true);
    expect(seeds.every((s) => !rotatesBy60(3, s))).toBe(true);
    expect(seeds.every((s) => rotatesBy60(6, s))).toBe(true);
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
    // Two players are only mirrored left-right; four are mirrored both ways.
    const maps: ((h: Hex) => Hex)[] =
      n === 2 ? [hexFlipHorizontal] : [hexFlipVertical, hexFlipHorizontal];
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

  it('defaults to mirror symmetry for 2 and 4 players, rotational for 3 and 6', () => {
    const mirrored = (n: number) => {
      const players = Array.from({ length: n }, (_, i) => `P${i}`);
      const { state } = createSymmetricMatch({ players, seed: 11 });
      const flip = n === 2 ? hexFlipHorizontal : hexFlipVertical;
      return Object.values(state.tiles).every((t) => state.tiles[hexKey(flip(t))]!.type === t.type);
    };
    expect(mirrored(2)).toBe(true);
    expect(mirrored(4)).toBe(true);
    expect(mirrored(3)).toBe(false);
    expect(mirrored(6)).toBe(false);
  });

  it('does not mirror two-player boards top to bottom', () => {
    const topBottomDiffers = (seed: number) => {
      const { state } = createSymmetricMatch({ players: ['A', 'B'], seed, radius: 8 });
      return Object.values(state.tiles).some(
        (t) => state.tiles[hexKey(hexFlipVertical(t))]!.type !== t.type,
      );
    };
    expect([1, 2, 3, 4, 5].every(topBottomDiffers)).toBe(true);
  });

  it('puts two players on opposite sides, one tile in from the edge', () => {
    const { state } = createSymmetricMatch({ players: ['A', 'B'], seed: 4, radius: 6 });
    const owned = Object.values(state.tiles).filter((t) => t.owner !== null);
    expect(owned.map((t) => [t.q, t.r]).sort()).toEqual([
      [-5, 0],
      [5, 0],
    ]);
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

describe('terrain rules', () => {
  const setups: { players: number; symmetry: Symmetry; radius: number }[] = [
    { players: 2, symmetry: 'mirror', radius: 6 },
    { players: 2, symmetry: 'rotational', radius: 8 },
    { players: 3, symmetry: 'rotational', radius: 7 },
    { players: 4, symmetry: 'mirror', radius: 10 },
    { players: 6, symmetry: 'rotational', radius: 9 },
  ];

  /** The symmetry group the generator uses, for finding a tile's orbit. */
  const group = (symmetry: Symmetry, players: number): ((h: Hex) => Hex)[] => {
    if (symmetry === 'rotational') {
      return Array.from({ length: players }, (_, i) => (h) => hexRotate(h, (i * 6) / players));
    }
    return players === 2
      ? [(h) => h, hexFlipHorizontal]
      : [(h) => h, hexFlipVertical, hexFlipHorizontal, (h) => hexRotate(h, 3)];
  };

  const forEachBoard = (
    check: (
      board: ReturnType<typeof boardFor>,
      symmetry: Symmetry,
      players: number,
      radius: number,
    ) => void,
  ) => {
    for (const { players, symmetry, radius } of setups) {
      for (let seed = 1; seed <= 25; seed++)
        check(boardFor(players, symmetry, radius, seed), symmetry, players, radius);
    }
  };

  const boardFor = (n: number, symmetry: Symmetry, radius: number, seed: number) => {
    const ids = Array.from({ length: n }, (_, i) => `P${i}`);
    // Fully packed with villages, so the "nowhere legal is left" check means something.
    const { state } = createSymmetricMatch({
      players: ids,
      seed,
      radius,
      symmetry,
      params: { villageChance: 100 },
    });
    const tiles = Object.values(state.tiles);
    return {
      tiles,
      byKey: state.tiles,
      cities: tiles.filter((t) => t.type === 'city'),
      villages: tiles.filter((t) => t.type === 'village'),
      startCities: tiles.filter((t) => t.owner !== null),
    };
  };

  it('never puts cities closer than 4 tiles apart', () => {
    forEachBoard(({ cities }) => {
      for (const a of cities) {
        for (const b of cities) {
          if (a !== b) expect(hexDistance(a, b)).toBeGreaterThanOrEqual(MIN_CITY_DISTANCE);
        }
      }
    });
  });

  it('never puts a city on the edge of the board', () => {
    forEachBoard(({ cities }, _symmetry, _players, radius) => {
      for (const city of cities) {
        expect(hexDistance(city, { q: 0, r: 0 })).toBeLessThan(radius);
      }
    });
  });

  it('keeps extra cities near one per 50 tiles', () => {
    forEachBoard(({ tiles, cities, startCities }) => {
      // The whole start orbit counts as starting cities, owned or not.
      const startOrbit = cities.filter((c) =>
        startCities.some(
          (s) =>
            s.owner !== null && hexDistance(s, { q: 0, r: 0 }) === hexDistance(c, { q: 0, r: 0 }),
        ),
      );
      const extra = cities.length - startOrbit.length;
      const target = tiles.length / TILES_PER_CITY;
      expect(extra).toBeGreaterThanOrEqual(0);
      expect(extra).toBeLessThanOrEqual(Math.ceil(target) + 6);
    });
  });

  it('never lets villages touch', () => {
    forEachBoard(({ villages, byKey }) => {
      for (const v of villages) {
        for (const n of hexNeighbors(v)) expect(byKey[hexKey(n)]?.type).not.toBe('village');
      }
    });
  });

  it('never lets villages border cities', () => {
    forEachBoard(({ villages, byKey }) => {
      for (const v of villages) {
        for (const n of hexNeighbors(v)) expect(byKey[hexKey(n)]?.type).not.toBe('city');
      }
    });
  });

  it('places villages until nowhere legal is left', () => {
    forEachBoard(({ tiles, byKey }, symmetry, players) => {
      const images = group(symmetry, players);
      for (const tile of tiles.filter((t) => t.type === 'farmland')) {
        const orbit = images.map((f) => f(tile));
        const blocked = orbit.some(
          (hex, i) =>
            hexNeighbors(hex).some((n) => {
              const type = byKey[hexKey(n)]?.type;
              return type === 'village' || type === 'city';
            }) || orbit.slice(i + 1).some((other) => hexDistance(hex, other) === 1),
        );
        expect(blocked).toBe(true);
      }
    });
  });
});

describe('free-for-all boards', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `P${i + 1}`);
  const board = (n: number, seed: number, radius?: number) =>
    createFreeForAllMatch({ players: ids(n), seed, radius, params: { villageChance: 100 } }).state;
  const radiusOf = (hexes: { q: number; r: number }[]) =>
    Math.max(...hexes.map((h) => hexDistance(h, { q: 0, r: 0 })));
  const counts = [2, 3, 5, 8, 20, 100];

  it('is deterministic for a seed and different for different seeds', () => {
    expect(board(8, 5)).toEqual(board(8, 5));
    expect(board(8, 5).tiles).not.toEqual(board(8, 6).tiles);
  });

  it('scales the board with the number of players', () => {
    let previous = 0;
    for (const n of counts) {
      const radius = recommendedRadius(n, 'freeForAll');
      expect(radius).toBeGreaterThanOrEqual(previous);
      previous = radius;
      const tiles = 3 * radius * (radius + 1) + 1;
      expect(tiles / n).toBeGreaterThanOrEqual(DEFAULT_GENERATION_PARAMS.tilesPerPlayer);
      expect(radiusOf(Object.values(board(n, 1).tiles))).toBe(radius);
    }
    expect(recommendedRadius(2, 'symmetric')).toBe(7);
  });

  it('gives every player exactly one starting city, spread out and away from the edge', () => {
    for (const n of counts) {
      for (let seed = 1; seed <= 4; seed++) {
        const state = board(n, seed);
        const radius = radiusOf(Object.values(state.tiles));
        const owned = Object.values(state.tiles).filter((t) => t.owner !== null);
        expect(owned).toHaveLength(n);
        expect(new Set(owned.map((t) => t.owner)).size).toBe(n);
        for (const start of owned) {
          expect(start.type).toBe('city');
          expect(start.troops).toBe(10);
          expect(hexDistance(start, { q: 0, r: 0 })).toBeLessThan(radius);
        }
        for (const a of owned) {
          for (const b of owned)
            if (a !== b) expect(hexDistance(a, b)).toBeGreaterThanOrEqual(MIN_CITY_DISTANCE);
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
    for (const n of [3, 8, 40]) {
      for (let seed = 1; seed <= 3; seed++) {
        const state = board(n, seed);
        const tiles = Object.values(state.tiles);
        const radius = radiusOf(tiles);
        const cities = tiles.filter((t) => t.type === 'city');
        for (const a of cities) {
          expect(hexDistance(a, { q: 0, r: 0 })).toBeLessThan(radius);
          for (const b of cities)
            if (a !== b) expect(hexDistance(a, b)).toBeGreaterThanOrEqual(MIN_CITY_DISTANCE);
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
        // Free-for-all boards have no cities beyond the starting ones.
        expect(cities).toHaveLength(n);
      }
    }
  });

  it('rejects boards that are too small, and matches with fewer than two players', () => {
    expect(() => createFreeForAllMatch({ players: ids(100), seed: 1, radius: 6 })).toThrow(
      /too small/,
    );
    expect(() => createFreeForAllMatch({ players: ids(1), seed: 1 })).toThrow();
    expect(() => createFreeForAllMatch({ players: ids(3), seed: 1, radius: 3 })).toThrow();
  });
});
