import { describe, expect, it } from 'vitest';
import {
  MIN_CITY_DISTANCE,
  createFreeForAllMatch,
  createSymmetricMatch,
  type Symmetry,
} from './generate.js';
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
import { createRng } from './rng.js';
import { randomShape } from './shape.js';
import type { Tile } from './state.js';

const identity = (h: Hex): Hex => h;
const seeds = Array.from({ length: 25 }, (_, i) => i + 1);

const keysOf = (hexes: readonly { q: number; r: number }[]) => new Set(hexes.map(hexKey));

/** The connected groups of the given hexes. */
function pieces(hexes: readonly Hex[]): Hex[][] {
  const present = keysOf(hexes);
  const seen = new Set<string>();
  const result: Hex[][] = [];
  for (const start of hexes) {
    if (seen.has(hexKey(start))) continue;
    const piece: Hex[] = [];
    const stack = [start];
    seen.add(hexKey(start));
    while (stack.length > 0) {
      const hex = stack.pop()!;
      piece.push(hex);
      for (const n of hexNeighbors(hex)) {
        if (present.has(hexKey(n)) && !seen.has(hexKey(n))) {
          seen.add(hexKey(n));
          stack.push(n);
        }
      }
    }
    result.push(piece);
  }
  return result;
}

/** Missing tiles that are enclosed by the board, grouped into lakes. */
function lakes(shape: readonly Hex[], radius: number): Hex[][] {
  const present = keysOf(shape);
  const missing = hexagonalBoard(radius + 6).filter((h) => !present.has(hexKey(h)));
  // Anything missing that connects to the outer ring of the bounding area is open sea.
  const groups = pieces(missing);
  return groups.filter((group) => !group.some((h) => hexDistance(h, { q: 0, r: 0 }) >= radius + 6));
}

describe('randomShape', () => {
  const radius = 12;
  const shapeFor = (seed: number, group: ((h: Hex) => Hex)[] = [identity], protect: Hex[] = []) =>
    randomShape({ radius, rng: createRng(seed), group, protect });

  it('is deterministic for a seed and different for different seeds', () => {
    expect(shapeFor(7)).toEqual(shapeFor(7));
    expect(shapeFor(7)).not.toEqual(shapeFor(8));
  });

  it('makes one connected piece of roughly the right size', () => {
    const size = hexagonalBoard(radius).length;
    for (const seed of seeds) {
      const shape = shapeFor(seed);
      expect(pieces(shape)).toHaveLength(1);
      expect(shape.length).toBeGreaterThan(size * 0.7);
      expect(shape.length).toBeLessThan(size * 1.35);
    }
  });

  it('is not a hexagon, and has a rough coast', () => {
    const hexagon = keysOf(hexagonalBoard(radius));
    for (const seed of seeds) {
      const shape = shapeFor(seed);
      const same = shape.length === hexagon.size && shape.every((h) => hexagon.has(hexKey(h)));
      expect(same).toBe(false);
      // Tiles stick out past the hexagon, and the hexagon has bites taken out of it.
      expect(shape.some((h) => !hexagon.has(hexKey(h)))).toBe(true);
    }
  });

  it('has no spurs and no one-tile bays', () => {
    for (const seed of seeds) {
      const shape = shapeFor(seed);
      const present = keysOf(shape);
      for (const hex of shape) {
        expect(hexNeighbors(hex).filter((n) => present.has(hexKey(n))).length).toBeGreaterThan(1);
      }
      // Bays of the open sea (lakes are checked separately).
      const lakeTiles = keysOf(lakes(shape, radius).flat());
      for (const hex of hexagonalBoard(radius + 3)) {
        if (present.has(hexKey(hex)) || lakeTiles.has(hexKey(hex))) continue;
        expect(hexNeighbors(hex).filter((n) => present.has(hexKey(n))).length).toBeLessThan(5);
      }
    }
  });

  it('cuts out lakes made of several contiguous tiles, never single tiles', () => {
    let boardsWithLakes = 0;
    for (const seed of seeds) {
      const found = lakes(shapeFor(seed), radius);
      if (found.length > 0) boardsWithLakes++;
      for (const lake of found) expect(lake.length).toBeGreaterThanOrEqual(3);
      expect(found.length).toBeLessThanOrEqual(6);
    }
    // Most boards have one, but not every board.
    expect(boardsWithLakes).toBeGreaterThan(seeds.length / 3);
    expect(boardsWithLakes).toBeLessThan(seeds.length);
  });

  it('keeps lakes away from the coast so there is always room to walk around them', () => {
    for (const seed of seeds) {
      const shape = shapeFor(seed);
      const present = keysOf(shape);
      for (const lake of lakes(shape, radius)) {
        for (const hex of lake) {
          // Every tile next to the lake has all of its own neighbors, apart from lake tiles.
          for (const n of hexNeighbors(hex)) {
            if (!present.has(hexKey(n))) continue;
            const open = hexNeighbors(n).filter((m) => !present.has(hexKey(m)));
            const lakeKeys = keysOf(lake);
            expect(open.every((m) => lakeKeys.has(hexKey(m)))).toBe(true);
          }
        }
      }
    }
  });

  it('always keeps the protected hexes and the room around them', () => {
    const protect: Hex[] = [
      { q: 9, r: 0 },
      { q: -9, r: 0 },
    ];
    for (const seed of seeds) {
      const present = keysOf(shapeFor(seed, [identity], protect));
      for (const start of protect) {
        for (const hex of hexagonalBoard(2)) {
          expect(present.has(hexKey({ q: start.q + hex.q, r: start.r + hex.r }))).toBe(true);
        }
      }
    }
  });

  it('keeps the symmetry it is given', () => {
    const groups: [string, ((h: Hex) => Hex)[]][] = [
      ['180', [identity, (h) => hexRotate(h, 3)]],
      ['120', [identity, (h) => hexRotate(h, 2), (h) => hexRotate(h, 4)]],
      ['mirror', [identity, hexFlipHorizontal]],
      ['klein', [identity, hexFlipVertical, hexFlipHorizontal, (h) => hexRotate(h, 3)]],
    ];
    for (const [, group] of groups) {
      for (const seed of seeds) {
        const shape = shapeFor(seed, group);
        const present = keysOf(shape);
        for (const hex of shape) {
          for (const image of group) expect(present.has(hexKey(image(hex)))).toBe(true);
        }
      }
    }
  });
});

describe('random board shapes in matches', () => {
  const hasFullRing = (tiles: Record<string, Tile>, hex: Hex) =>
    hexNeighbors(hex).every((n) => tiles[hexKey(n)] !== undefined);

  const setups: { players: number; symmetry: Symmetry }[] = [
    { players: 2, symmetry: 'mirror' },
    { players: 2, symmetry: 'rotational' },
    { players: 3, symmetry: 'rotational' },
    { players: 4, symmetry: 'mirror' },
    { players: 6, symmetry: 'rotational' },
  ];

  it('keeps symmetric boards symmetric, with tile types too', () => {
    for (const { players, symmetry } of setups) {
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const ids = Array.from({ length: players }, (_, i) => `P${i}`);
        const { state } = createSymmetricMatch({
          players: ids,
          seed,
          radius: 10,
          symmetry,
          shape: 'random',
        });
        const group: ((h: Hex) => Hex)[] =
          symmetry === 'rotational'
            ? Array.from({ length: players }, (_, i) => (h) => hexRotate(h, (i * 6) / players))
            : players === 2
              ? [identity, hexFlipHorizontal]
              : [identity, hexFlipVertical, hexFlipHorizontal, (h) => hexRotate(h, 3)];
        for (const tile of Object.values(state.tiles)) {
          for (const image of group) {
            const other = state.tiles[hexKey(image(tile))];
            expect(other?.type).toBe(tile.type);
          }
        }
      }
    }
  });

  it('gives every player a starting city with a full ring of tiles around it', () => {
    for (const { players, symmetry } of setups) {
      for (const seed of [1, 2, 3]) {
        const ids = Array.from({ length: players }, (_, i) => `P${i}`);
        const { state } = createSymmetricMatch({
          players: ids,
          seed,
          radius: 10,
          symmetry,
          shape: 'random',
        });
        const starts = Object.values(state.tiles).filter((t) => t.owner !== null);
        expect(starts).toHaveLength(players);
        for (const start of starts) {
          expect(start.type).toBe('city');
          expect(hasFullRing(state.tiles, start)).toBe(true);
        }
      }
    }
  });

  it('puts cities and villages only where their neighbors exist, with villages maximal', () => {
    for (const seed of [1, 2, 3, 4]) {
      const { state } = createSymmetricMatch({
        players: ['A', 'B'],
        seed,
        radius: 10,
        shape: 'random',
      });
      const tiles = Object.values(state.tiles);
      const cities = tiles.filter((t) => t.type === 'city');
      for (const city of cities) {
        expect(hasFullRing(state.tiles, city)).toBe(true);
        for (const other of cities) {
          if (city !== other)
            expect(hexDistance(city, other)).toBeGreaterThanOrEqual(MIN_CITY_DISTANCE);
        }
      }
      for (const village of tiles.filter((t) => t.type === 'village')) {
        for (const n of hexNeighbors(village)) {
          const type = state.tiles[hexKey(n)]?.type;
          expect(type === 'village' || type === 'city').toBe(false);
        }
      }
    }
  });

  it('works for free-for-all boards, with interior starts spread apart', () => {
    for (const count of [3, 8, 20, 100]) {
      for (const seed of [1, 2]) {
        const ids = Array.from({ length: count }, (_, i) => `P${i}`);
        const { state } = createFreeForAllMatch({ players: ids, seed, shape: 'random' });
        const tiles = Object.values(state.tiles);
        const hexagon = hexagonalBoard(
          Math.max(...tiles.map((t) => hexDistance(t, { q: 0, r: 0 }))),
        );
        expect(tiles.length).toBeLessThan(hexagon.length * 1.4);
        const starts = tiles.filter((t) => t.owner !== null);
        expect(starts).toHaveLength(count);
        for (const a of starts) {
          expect(hasFullRing(state.tiles, a)).toBe(true);
          for (const b of starts) {
            if (a !== b) expect(hexDistance(a, b)).toBeGreaterThanOrEqual(MIN_CITY_DISTANCE);
          }
        }
        // Everything is reachable.
        expect(pieces(tiles)).toHaveLength(1);
      }
    }
  });

  it('is deterministic, and leaves hexagon boards exactly as they were', () => {
    const options = { players: ['A', 'B'], seed: 9, radius: 8 };
    const a = createSymmetricMatch({ ...options, shape: 'random' }).state;
    const b = createSymmetricMatch({ ...options, shape: 'random' }).state;
    expect(a).toEqual(b);
    const hexagon = createSymmetricMatch(options).state;
    expect(createSymmetricMatch({ ...options, shape: 'hexagon' }).state).toEqual(hexagon);
    expect(Object.keys(hexagon.tiles)).toHaveLength(hexagonalBoard(8).length);
  });
});
