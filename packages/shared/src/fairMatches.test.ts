import { describe, expect, it, vi } from 'vitest';
import { hexDistance, hexKey, hexNeighbors, type Hex } from './hex.js';
import {
  createDuelMatch,
  createQuadMatch,
  createSextetMatch,
  createTrioMatch,
} from './generate.js';
import { hexImage, quadHexImages, sextetGroup, trioHexImages } from './duel/index.js';
import { TILE_TYPES } from './tiles.js';
import {
  DEFAULT_GENERATION_PARAMS,
  extraSetsFor,
  FAIR_BOWL_RADIUS,
  MAP_SIZES,
  type GenerationParams,
  type MapSize,
} from './params.js';
import type { GameState } from './state.js';
import type { Blueprint } from './royale/blueprint.js';
import type { MatchConfig } from './config.js';

// Many of these tests make dozens of whole boards.
vi.setConfig({ testTimeout: 60000 });

/** What a room asks for at a map size. */
const sized = (size: MapSize, players: number): Partial<GenerationParams> => ({
  bowlRadius: FAIR_BOWL_RADIUS[size],
  extraSets: extraSetsFor(size, players),
});

interface Made {
  readonly state: GameState;
  readonly config: MatchConfig;
  readonly blueprint: Blueprint;
  /** Where each tile goes under every symmetry except doing nothing, for this very board. */
  readonly images: readonly ((hex: Hex) => Hex)[];
}

/** One way a fair board can be symmetric, with how to make it and how to tell what its symmetries are. */
interface Kind {
  readonly name: string;
  readonly players: string[];
  readonly make: (seed: number, params?: Partial<GenerationParams>) => Made;
}

const pair = ['A', 'B'];
const three = ['A', 'B', 'C'];
const four = ['A', 'B', 'C', 'D'];
const six = ['A', 'B', 'C', 'D', 'E', 'F'];

const kinds: Kind[] = [
  {
    name: 'duel, mirror through tile corners',
    players: pair,
    make: (seed, params) => {
      const { state, config, duel } = createDuelMatch({
        players: pair,
        seed,
        symmetry: 'mirror',
        axis: 'points',
        params,
      });
      return {
        state,
        config,
        blueprint: duel.blueprint,
        images: [hexImage('mirror', 'points', duel.turns)],
      };
    },
  },
  {
    name: 'duel, mirror through tile edges',
    players: pair,
    make: (seed, params) => {
      const { state, config, duel } = createDuelMatch({
        players: pair,
        seed,
        symmetry: 'mirror',
        axis: 'edges',
        params,
      });
      return {
        state,
        config,
        blueprint: duel.blueprint,
        images: [hexImage('mirror', 'edges', duel.turns)],
      };
    },
  },
  {
    name: 'duel, half turn',
    players: pair,
    make: (seed, params) => {
      const { state, config, duel } = createDuelMatch({
        players: pair,
        seed,
        symmetry: 'rotational',
        params,
      });
      return { state, config, blueprint: duel.blueprint, images: [hexImage('rotational')] };
    },
  },
  {
    name: 'trio, turns of 120 degrees',
    players: three,
    make: (seed, params) => {
      const { state, config, trio } = createTrioMatch({ players: three, seed, params });
      return { state, config, blueprint: trio.blueprint, images: trioHexImages };
    },
  },
  {
    name: 'quad, two mirrors',
    players: four,
    make: (seed, params) => {
      const { state, config, quad } = createQuadMatch({ players: four, seed, params });
      return {
        state,
        config,
        blueprint: quad.blueprint,
        images: quadHexImages(quad.turns),
      };
    },
  },
  ...(
    [
      ['rotational', 'points', 'sextet, turns of 60 degrees'],
      ['mirror', 'points', 'sextet, turns of 120 degrees and mirrors through tile corners'],
      ['mirror', 'edges', 'sextet, turns of 120 degrees and mirrors through tile edges'],
    ] as const
  ).map(([symmetry, axis, name]): Kind => ({
    name,
    players: six,
    make: (seed, params) => {
      const { state, config, sextet } = createSextetMatch({
        players: six,
        seed,
        symmetry,
        axis,
        params,
      });
      return {
        state,
        config,
        blueprint: sextet.blueprint,
        images: sextetGroup(symmetry, sextet.axis).hexMaps,
      };
    },
  })),
];

describe.each(kinds)('fair board: $name', (kind) => {
  it('is deterministic for a seed', () => {
    expect(kind.make(7).state).toEqual(kind.make(7).state);
    expect(kind.make(7).state.tiles).not.toEqual(kind.make(8).state.tiles);
  });

  it('is exactly symmetric under every one of its symmetries', () => {
    for (const size of MAP_SIZES) {
      for (let seed = 1; seed <= 8; seed++) {
        const { state, images } = kind.make(seed, sized(size, kind.players.length));
        for (const image of images) {
          for (const tile of Object.values(state.tiles)) {
            const twin = state.tiles[hexKey(image(tile))];
            expect(twin).toBeDefined();
            expect(twin!.type).toBe(tile.type);
            // Neutral tiles match in garrison too; the starting cities are checked below.
            if (tile.owner === null && twin!.owner === null) expect(twin!.troops).toBe(tile.troops);
          }
        }
      }
    }
  });

  it('gives each player one starting city, all twins of one another, each with a full ring of land', () => {
    for (const size of MAP_SIZES) {
      for (let seed = 1; seed <= 10; seed++) {
        const { state, config, images } = kind.make(seed, sized(size, kind.players.length));
        const cities = kind.players.map((p) =>
          Object.values(state.tiles).filter((t) => t.owner === p),
        );
        for (const owned of cities) {
          expect(owned).toHaveLength(1);
          expect(owned[0]).toMatchObject({ type: 'city', troops: config.startingTroops });
          for (const n of hexNeighbors(owned[0]!)) expect(state.tiles[hexKey(n)]).toBeDefined();
        }
        // Each is the first moved by one of the other symmetries, so all sit apart.
        images.forEach((image, n) => {
          expect(hexKey(image(cities[0]![0]!))).toBe(hexKey(cities[n + 1]![0]!));
        });
        expect(new Set(cities.map((c) => hexKey(c[0]!))).size).toBe(kind.players.length);
      }
    }
  });

  it('starts neutral tiles at their base garrison', () => {
    const { state } = kind.make(3);
    for (const t of Object.values(state.tiles)) {
      if (t.owner === null) expect(t.troops).toBe(TILE_TYPES[t.type].baseGarrison);
    }
  });

  it('has more blobs on bigger boards', () => {
    const average = (size: MapSize): number => {
      let blobs = 0;
      for (let seed = 1; seed <= 20; seed++) {
        blobs += kind.make(seed, sized(size, kind.players.length)).blueprint.chambers.length;
      }
      return blobs / 20;
    };
    // Some kinds of board get their first extra blobs only at the large size.
    expect(average('normal')).toBeGreaterThanOrEqual(average('small'));
    expect(average('large')).toBeGreaterThanOrEqual(average('normal'));
    expect(average('large')).toBeGreaterThan(average('small'));
  });

  it('has more land on bigger boards', () => {
    const average = (size: MapSize): number => {
      let tiles = 0;
      for (let seed = 1; seed <= 20; seed++) {
        tiles += Object.keys(kind.make(seed, sized(size, kind.players.length)).state.tiles).length;
      }
      return tiles / 20;
    };
    expect(average('normal')).toBeGreaterThan(average('small'));
    expect(average('large')).toBeGreaterThan(average('normal'));
  });

  describe('terrain rules', () => {
    const boards = [...MAP_SIZES].flatMap((size) =>
      Array.from({ length: 10 }, (_, i) => {
        // Fully packed with villages, so the "nowhere legal is left" check means something.
        const { state, images } = kind.make(i + 1, {
          ...sized(size, kind.players.length),
          villageChance: 100,
        });
        const all = Object.values(state.tiles);
        return {
          tiles: all,
          byKey: state.tiles,
          images,
          cities: all.filter((t) => t.type === 'city'),
          villages: all.filter((t) => t.type === 'village'),
        };
      }),
    );

    it('never puts cities too close together, or on the edge of the board', () => {
      for (const { cities, byKey } of boards) {
        for (const a of cities) {
          for (const nb of hexNeighbors(a)) expect(byKey[hexKey(nb)]).toBeDefined();
          for (const b of cities) {
            if (a !== b) {
              expect(hexDistance(a, b)).toBeGreaterThanOrEqual(
                DEFAULT_GENERATION_PARAMS.minCityDistance,
              );
            }
          }
        }
      }
    });

    it('never lets villages touch each other or a city', () => {
      for (const { villages, byKey } of boards) {
        for (const v of villages) {
          for (const n of hexNeighbors(v)) {
            const type = byKey[hexKey(n)]?.type;
            expect(type === 'village' || type === 'city').toBe(false);
          }
        }
      }
    });

    it('places villages until nowhere legal is left', () => {
      for (const { tiles, byKey, images } of boards) {
        for (const tile of tiles.filter((t) => t.type === 'farmland')) {
          const orbit: Hex[] = [tile, ...images.map((image) => image(tile))];
          const blocked = orbit.some(
            (hex, i) =>
              hexNeighbors(hex).some((n) => {
                const type = byKey[hexKey(n)]?.type;
                return type === 'village' || type === 'city';
              }) || orbit.slice(i + 1).some((other) => hexDistance(hex, other) === 1),
          );
          expect(blocked).toBe(true);
        }
      }
    });
  });
});

describe('the number of players', () => {
  it('has to be exactly right, and the players different', () => {
    expect(() => createDuelMatch({ players: ['A'], seed: 1 })).toThrow();
    expect(() => createDuelMatch({ players: ['A', 'B', 'C'], seed: 1 })).toThrow();
    expect(() => createDuelMatch({ players: ['A', 'A'], seed: 1 })).toThrow();
    expect(() => createTrioMatch({ players: ['A', 'B'], seed: 1 })).toThrow();
    expect(() => createTrioMatch({ players: ['A', 'A', 'B'], seed: 1 })).toThrow();
    expect(() => createQuadMatch({ players: ['A', 'B', 'C'], seed: 1 })).toThrow();
    expect(() => createQuadMatch({ players: ['A', 'A', 'B', 'C'], seed: 1 })).toThrow();
    expect(() => createSextetMatch({ players: ['A', 'B', 'C', 'D'], seed: 1 })).toThrow();
    expect(() => createSextetMatch({ players: [...six, 'G'], seed: 1 })).toThrow();
    expect(() => createSextetMatch({ players: ['A', 'A', 'B', 'C', 'D', 'E'], seed: 1 })).toThrow();
  });
});

describe('createDuelMatch', () => {
  it('makes both kinds of board by default', () => {
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 30; seed++)
      kinds.add(createDuelMatch({ players: pair, seed }).duel.symmetry);
    expect(kinds).toEqual(new Set(['mirror', 'rotational']));
  });

  it('mirrors half the mirror boards across a line through tile corners and half through edge middles', () => {
    const axes = new Map<string, number>();
    for (let seed = 1; seed <= 60; seed++) {
      const { duel } = createDuelMatch({ players: pair, seed, symmetry: 'mirror' });
      axes.set(duel.axis, (axes.get(duel.axis) ?? 0) + 1);
      // Half-turn boards have no line, and are not told otherwise.
      expect(createDuelMatch({ players: pair, seed, symmetry: 'rotational' }).duel.axis).toBe(
        'points',
      );
    }
    expect(axes.get('points')).toBeGreaterThan(15);
    expect(axes.get('edges')).toBeGreaterThan(15);
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
});

describe('createQuadMatch', () => {
  it('turns the board by 0, 1 or 2 steps of 60 degrees, and can be told which', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      seen.add(createQuadMatch({ players: four, seed }).quad.turns);
    }
    expect(seen).toEqual(new Set([0, 1, 2]));
    for (let turns = 0; turns < 3; turns++) {
      expect(createQuadMatch({ players: four, seed: 4, turns }).quad.turns).toBe(turns);
    }
  });
});

describe('createSextetMatch', () => {
  it('makes both groups by default, and both kinds of mirror line, or as told', () => {
    const symmetries = new Set<string>();
    const mirrorLines = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const { sextet } = createSextetMatch({ players: six, seed });
      symmetries.add(sextet.symmetry);
      if (sextet.symmetry === 'mirror') mirrorLines.add(sextet.axis);
    }
    expect(symmetries).toEqual(new Set(['rotational', 'mirror']));
    expect(mirrorLines).toEqual(new Set(['points', 'edges']));
    expect(
      createSextetMatch({ players: six, seed: 3, symmetry: 'rotational' }).sextet.symmetry,
    ).toBe('rotational');
    expect(
      createSextetMatch({ players: six, seed: 3, symmetry: 'mirror', axis: 'edges' }).sextet.axis,
    ).toBe('edges');
  });
});
