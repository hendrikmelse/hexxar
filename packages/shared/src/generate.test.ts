import { describe, expect, it } from 'vitest';
import { hexDistance, hexKey, hexNeighbors, type Hex } from './hex.js';
import { createDuelMatch, createFreeForAllMatch } from './generate.js';
import { hexImage, pointImage, type DuelAxis, type DuelSymmetry } from './duel/index.js';
import { TILE_TYPES } from './tiles.js';
import { DEFAULT_GENERATION_PARAMS, DUEL_TILES, MAP_SIZES } from './params.js';
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
  it('takes overrides and refuses ones that are out of range', () => {
    expect(parseMatchConfig({ tickMs: 500 }).tickMs).toBe(500);
    expect(() => parseMatchConfig({ tickMs: 5 })).toThrow();
  });
});

const pair = ['A', 'B'];
const image = (symmetry: DuelSymmetry, axis: DuelAxis, turns: number): ((hex: Hex) => Hex) =>
  hexImage(symmetry, axis, turns);

describe('createDuelMatch', () => {
  it('is deterministic for a seed', () => {
    const options = { players: pair, seed: 7 };
    expect(createDuelMatch(options).state).toEqual(createDuelMatch(options).state);
    expect(createDuelMatch(options).state.tiles).not.toEqual(
      createDuelMatch({ players: pair, seed: 8 }).state.tiles,
    );
  });

  it.each(['mirror', 'rotational'] as const)('is exactly %s symmetric', (symmetry) => {
    for (let seed = 1; seed <= 20; seed++) {
      const { state, duel } = createDuelMatch({ players: pair, seed, symmetry });
      for (const tile of Object.values(state.tiles)) {
        const twin = state.tiles[hexKey(image(symmetry, duel.axis, duel.turns)(tile))];
        expect(twin).toBeDefined();
        expect(twin!.type).toBe(tile.type);
        // Neutral tiles match in garrison too; the starting cities are checked below.
        if (tile.owner === null && twin!.owner === null) expect(twin!.troops).toBe(tile.troops);
      }
    }
  });

  it('makes both kinds of board by default', () => {
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const { duel } = createDuelMatch({ players: pair, seed });
      kinds.add(duel.symmetry);
    }
    expect(kinds).toEqual(new Set(['mirror', 'rotational']));
  });

  it('gives each player one starting city, and the two are twins', () => {
    for (const symmetry of ['mirror', 'rotational'] as const) {
      for (let seed = 1; seed <= 10; seed++) {
        const { state, config, duel } = createDuelMatch({ players: pair, seed, symmetry });
        const [a, b] = pair.map((p) => Object.values(state.tiles).filter((t) => t.owner === p));
        expect(a).toHaveLength(1);
        expect(b).toHaveLength(1);
        expect(a![0]).toMatchObject({ type: 'city', troops: config.startingTroops });
        expect(b![0]).toMatchObject({ type: 'city', troops: config.startingTroops });
        expect(hexKey(image(symmetry, duel.axis, duel.turns)(a![0]!))).toBe(hexKey(b![0]!));
      }
    }
  });

  it('mirrors half the mirror boards across a line through tile corners and half through edge middles', () => {
    const axes = new Map<string, number>();
    for (let seed = 1; seed <= 60; seed++) {
      const { state, duel } = createDuelMatch({ players: pair, seed, symmetry: 'mirror' });
      axes.set(duel.axis, (axes.get(duel.axis) ?? 0) + 1);
      // Half-turn boards have no line, and are not told otherwise.
      expect(createDuelMatch({ players: pair, seed, symmetry: 'rotational' }).duel.axis).toBe(
        'points',
      );
      void state;
    }
    expect(axes.get('points')).toBeGreaterThan(15);
    expect(axes.get('edges')).toBeGreaterThan(15);
  });

  it('can be told which line to mirror across', () => {
    for (const axis of ['points', 'edges'] as const) {
      for (let seed = 1; seed <= 5; seed++) {
        const { state, duel } = createDuelMatch({
          players: pair,
          seed,
          symmetry: 'mirror',
          axis,
          turns: 0,
        });
        expect(duel.axis).toBe(axis);
        for (const tile of Object.values(state.tiles)) {
          expect(state.tiles[hexKey(hexImage('mirror', axis)(tile))]?.type).toBe(tile.type);
        }
      }
    }
  });

  it('turns mirror boards by a random multiple of 60 degrees, so the line lies any of the six ways', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 120; seed++) {
      const { state, duel } = createDuelMatch({ players: pair, seed, symmetry: 'mirror' });
      expect(duel.turns).toBeGreaterThanOrEqual(0);
      expect(duel.turns).toBeLessThan(6);
      // The finished board is symmetric across its (turned) line, exactly.
      const mirror = hexImage('mirror', duel.axis, duel.turns);
      for (const tile of Object.values(state.tiles)) {
        expect(state.tiles[hexKey(mirror(tile))]?.type).toBe(tile.type);
      }
      // Which of the six mirror lines it is, told by where a few tiles go.
      seen.add(
        [
          { q: 1, r: 0 },
          { q: 0, r: 1 },
          { q: 2, r: 3 },
        ]
          .map((h) => hexKey(mirror(h)))
          .join('|'),
      );
    }
    expect(seen.size).toBe(6);
  });

  it('can be told how far to turn a mirror board, and leaves half-turn boards alone', () => {
    for (let turns = 0; turns < 6; turns++) {
      const { duel } = createDuelMatch({ players: pair, seed: 4, symmetry: 'mirror', turns });
      expect(duel.turns).toBe(turns);
    }
    for (let seed = 1; seed <= 10; seed++) {
      expect(createDuelMatch({ players: pair, seed, symmetry: 'rotational' }).duel.turns).toBe(0);
    }
  });

  it('starts neutral tiles at their base garrison', () => {
    const { state } = createDuelMatch({ players: pair, seed: 3 });
    for (const t of Object.values(state.tiles)) {
      if (t.owner === null) expect(t.troops).toBe(TILE_TYPES[t.type].baseGarrison);
    }
  });

  it('has about the number of tiles asked for', () => {
    for (const size of MAP_SIZES) {
      for (let seed = 1; seed <= 10; seed++) {
        const tiles = Object.keys(
          createDuelMatch({ players: pair, seed, tiles: DUEL_TILES[size] }).state.tiles,
        ).length;
        expect(tiles / DUEL_TILES[size]).toBeGreaterThan(0.9);
        expect(tiles / DUEL_TILES[size]).toBeLessThan(1.1);
      }
    }
  });

  it('has more blobs on bigger boards, and slightly bigger ones', () => {
    const average = (size: keyof typeof DUEL_TILES) => {
      let blobs = 0;
      let radius = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const { duel } = createDuelMatch({ players: pair, seed, tiles: DUEL_TILES[size] });
        blobs += duel.blueprint.chambers.length;
        radius += duel.blueprint.chambers[0]!.radius;
      }
      return { blobs: blobs / 20, radius: radius / 20 };
    };
    const [small, normal, large] = [average('small'), average('normal'), average('large')];
    expect(normal.blobs).toBeGreaterThan(small.blobs);
    expect(large.blobs).toBeGreaterThan(normal.blobs);
    expect(large.radius).toBeGreaterThan(small.radius);
  });

  it('puts extra blobs on the line or point of symmetry sometimes, and off it sometimes', () => {
    for (const symmetry of ['mirror', 'rotational'] as const) {
      let onAxis = 0;
      let offAxis = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const { duel } = createDuelMatch({
          players: pair,
          seed,
          symmetry,
          tiles: DUEL_TILES.large,
        });
        for (const chamber of duel.blueprint.chambers.filter((c) => !c.spawn)) {
          const { x, y } = chamber.center;
          const twin = pointImage(symmetry, duel.axis, duel.turns)(chamber.center);
          const middle = Math.abs(twin.x - x) < 1e-9 && Math.abs(twin.y - y) < 1e-9;
          if (middle) onAxis++;
          else offAxis++;
        }
      }
      expect(onAxis).toBeGreaterThan(0);
      expect(offAxis).toBeGreaterThan(0);
    }
  });

  it('rejects anything but two different players', () => {
    expect(() => createDuelMatch({ players: ['A'], seed: 1 })).toThrow();
    expect(() => createDuelMatch({ players: ['A', 'B', 'C'], seed: 1 })).toThrow();
    expect(() => createDuelMatch({ players: ['A', 'A'], seed: 1 })).toThrow();
  });
});

describe('terrain rules', () => {
  const setups: { symmetry: DuelSymmetry; tiles: number }[] = [
    { symmetry: 'mirror', tiles: DUEL_TILES.normal },
    { symmetry: 'rotational', tiles: DUEL_TILES.normal },
    { symmetry: 'mirror', tiles: DUEL_TILES.large },
    { symmetry: 'rotational', tiles: DUEL_TILES.large },
  ];

  const forEachBoard = (
    check: (board: ReturnType<typeof boardFor>, symmetry: DuelSymmetry) => void,
  ) => {
    for (const { symmetry, tiles } of setups) {
      for (let seed = 1; seed <= 25; seed++) check(boardFor(symmetry, tiles, seed), symmetry);
    }
  };

  const boardFor = (symmetry: DuelSymmetry, tiles: number, seed: number) => {
    // Fully packed with villages, so the "nowhere legal is left" check means something.
    const { state, duel } = createDuelMatch({
      players: pair,
      seed,
      tiles,
      symmetry,
      params: { villageChance: 100 },
    });
    const all = Object.values(state.tiles);
    return {
      axis: duel.axis,
      turns: duel.turns,
      tiles: all,
      byKey: state.tiles,
      cities: all.filter((t) => t.type === 'city'),
      villages: all.filter((t) => t.type === 'village'),
    };
  };

  it('never puts cities closer than the minimum apart', () => {
    forEachBoard(({ cities }) => {
      for (const a of cities) {
        for (const b of cities) {
          if (a !== b) {
            expect(hexDistance(a, b)).toBeGreaterThanOrEqual(
              DEFAULT_GENERATION_PARAMS.minCityDistance,
            );
          }
        }
      }
    });
  });

  it('never puts a city on the edge of the board', () => {
    forEachBoard(({ cities, byKey }) => {
      for (const city of cities) {
        for (const n of hexNeighbors(city)) expect(byKey[hexKey(n)]).toBeDefined();
      }
    });
  });

  it('keeps extra cities near one per 50 tiles', () => {
    forEachBoard(({ tiles, cities }) => {
      const extra = cities.length - 2;
      expect(extra).toBeGreaterThanOrEqual(0);
      expect(extra).toBeLessThanOrEqual(
        Math.ceil(tiles.length / DEFAULT_GENERATION_PARAMS.tilesPerCity) + 6,
      );
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
    forEachBoard(({ tiles, byKey, axis, turns }, symmetry) => {
      for (const tile of tiles.filter((t) => t.type === 'farmland')) {
        const orbit: Hex[] = [tile, image(symmetry, axis, turns)(tile)];
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

describe('battle royale boards', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `P${i + 1}`);
  const board = (n: number, seed: number) =>
    createFreeForAllMatch({ players: ids(n), seed, params: { villageChance: 100 } }).state;
  const counts = [3, 5, 8, 12];
  const minDistance = DEFAULT_GENERATION_PARAMS.minStartDistance;

  it('is deterministic for a seed and different for different seeds', () => {
    expect(board(8, 5)).toEqual(board(8, 5));
    expect(board(8, 5).tiles).not.toEqual(board(8, 6).tiles);
  });

  it('scales the board with the number of players', () => {
    for (const n of counts) {
      const perPlayer = Math.max(
        DEFAULT_GENERATION_PARAMS.tilesPerPlayer,
        DEFAULT_GENERATION_PARAMS.minTilesPerPlayer,
      );
      for (let seed = 1; seed <= 3; seed++) {
        const tiles = Object.keys(board(n, seed).tiles).length;
        expect(tiles / (n * perPlayer)).toBeGreaterThan(0.85);
        expect(tiles / (n * perPlayer)).toBeLessThan(1.15);
      }
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
