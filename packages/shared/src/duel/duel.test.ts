import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GENERATION_PARAMS,
  DUEL_TILES,
  MAP_SIZES,
  QUAD_TILES,
  SEXTET_TILES,
  TRIO_TILES,
} from '../params.js';
import {
  generateDuelLayout,
  generateQuadLayout,
  generateSextetLayout,
  generateTrioLayout,
} from './layout.js';
import { pointImage, type DuelAxis, type DuelSymmetry } from './symmetry.js';

// Each test draws hundreds of whole boards.
vi.setConfig({ testTimeout: 60000 });

const board = (symmetry: DuelSymmetry, seed: number, tiles: number, axis?: DuelAxis) =>
  generateDuelLayout({
    seed,
    symmetry,
    axis,
    targetTiles: tiles,
    params: DEFAULT_GENERATION_PARAMS,
  });

/** The blobs on the line of a mirror board (they have no twin). */
const onLine = (layout: ReturnType<typeof board>): number[] => {
  const image = pointImage('mirror', layout.report.axis, layout.report.turns);
  return layout.report.blueprint.chambers.flatMap((c, i) => {
    const twin = image(c.center);
    return Math.abs(twin.x - c.center.x) < 1e-9 && Math.abs(twin.y - c.center.y) < 1e-9 ? [i] : [];
  });
};

describe('duel layouts', () => {
  const straight = (corridors: readonly { from: number; to: number }[]) =>
    corridors.filter((c) => c.from + c.to === 1 && c.from * c.to === 0);

  it('never has a corridor straight from one start to the other, unless the starts are the only blobs', () => {
    for (const symmetry of ['mirror', 'rotational'] as const) {
      for (const size of MAP_SIZES) {
        for (let seed = 1; seed <= 60; seed++) {
          const { chambers, corridors } = board(symmetry, seed, DUEL_TILES[size]).report.blueprint;
          expect(chambers[0]!.spawn && chambers[1]!.spawn).toBe(true);
          // With other blobs, the starts are joined only through them. With none, the one
          // corridor between the starts is the only way to join them.
          expect(straight(corridors)).toHaveLength(chambers.length > 2 ? 0 : 1);
        }
      }
    }
  });

  it('can have a board with nothing but the two starts, and it is a small one', () => {
    const only = (size: keyof typeof DUEL_TILES): number => {
      let count = 0;
      for (let seed = 1; seed <= 100; seed++) {
        if (board('mirror', seed, DUEL_TILES[size]).report.blueprint.chambers.length === 2) count++;
      }
      return count;
    };
    expect(only('small')).toBeGreaterThan(0);
    expect(only('large')).toBe(0);
  });

  it.each(['points', 'edges'] as const)(
    'only sometimes joins blobs on the line of a mirror board (%s) to each other',
    (axis) => {
      let boards = 0;
      let spines = 0;
      for (let seed = 1; seed <= 300; seed++) {
        const layout = board('mirror', seed, DUEL_TILES.normal, axis);
        const line = onLine(layout);
        if (line.length < 2) continue;
        boards++;
        if (
          layout.report.blueprint.corridors.some(
            (c) => line.includes(c.from) && line.includes(c.to),
          )
        ) {
          spines++;
        }
      }
      expect(boards).toBeGreaterThan(50);
      // Allowed on 30% of boards, and nearly always there when it is allowed.
      expect(spines / boards).toBeGreaterThan(0.15);
      expect(spines / boards).toBeLessThan(0.45);
    },
  );

  it('has blobs on the line of a mirror board across either line, and some off it', () => {
    for (const axis of ['points', 'edges'] as const) {
      let on = 0;
      let off = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const layout = board('mirror', seed, DUEL_TILES.large, axis);
        const line = onLine(layout);
        on += line.length;
        off += layout.report.blueprint.chambers.length - line.length;
      }
      expect(on).toBeGreaterThan(0);
      expect(off).toBeGreaterThan(on / 4);
    }
  });

  it('can join the halves of a half-turn board through the blob at the middle alone', () => {
    const side = (x: number, y: number): number => Math.sign(y === 0 ? x : y);
    let throughMiddle = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const { chambers, corridors } = board('rotational', seed, DUEL_TILES.large).report.blueprint;
      const middle = chambers.findIndex((c) => c.center.x === 0 && c.center.y === 0);
      if (middle < 0) continue;
      const sideOf = (i: number): number => side(chambers[i]!.center.x, chambers[i]!.center.y);
      const crossing = corridors.filter((c) => sideOf(c.from) * sideOf(c.to) < 0);
      if (crossing.length > 0) continue;
      // Nothing crosses directly, and the board is still in one piece (it was made, so it is):
      // the middle blob links a blob on each side.
      const neighbors = corridors.flatMap((c) =>
        c.from === middle ? [c.to] : c.to === middle ? [c.from] : [],
      );
      expect(neighbors.some((i) => sideOf(i) > 0)).toBe(true);
      expect(neighbors.some((i) => sideOf(i) < 0)).toBe(true);
      throughMiddle++;
    }
    expect(throughMiddle).toBeGreaterThan(0);
  });
});

const trio = (seed: number, tiles: number) =>
  generateTrioLayout({ seed, targetTiles: tiles, params: DEFAULT_GENERATION_PARAMS });

/** Which third of a three-player blueprint a chamber is in, or -1 for the blob in the middle. */
const thirdOf = (
  index: number,
  chambers: readonly { center: { x: number; y: number } }[],
): number => {
  const middle = chambers.findIndex((c) => c.center.x === 0 && c.center.y === 0);
  if (index === middle) return -1;
  // Chambers come in threes (a blob, then its twins), after the middle blob if there is one.
  const base = middle >= 0 ? 4 : 3;
  return index < 3 ? index : (index - base) % 3;
};

describe('three-player layouts', () => {
  it('never join two starts by a corridor of their own, unless the starts are the only blobs', () => {
    for (const size of MAP_SIZES) {
      for (let seed = 1; seed <= 60; seed++) {
        const { chambers, corridors } = trio(seed, TRIO_TILES[size]).report.blueprint;
        expect(chambers.slice(0, 3).every((c) => c.spawn)).toBe(true);
        expect(chambers.slice(3).some((c) => c.spawn)).toBe(false);
        const amongStarts = corridors.filter((c) => c.from < 3 && c.to < 3);
        if (chambers.length === 3) {
          // Nothing else to go through: the starts form a triangle.
          expect(amongStarts).toHaveLength(3);
        } else {
          expect(amongStarts).toHaveLength(0);
        }
      }
    }
  });

  it('only let the smallest boards be nothing but the three starts', () => {
    const only = (size: keyof typeof TRIO_TILES): number => {
      let count = 0;
      for (let seed = 1; seed <= 60; seed++) {
        if (trio(seed, TRIO_TILES[size]).report.blueprint.chambers.length === 3) count++;
      }
      return count;
    };
    expect(only('small')).toBeGreaterThan(0);
    expect(only('normal')).toBe(0);
    expect(only('large')).toBe(0);
  });

  it('can join the thirds through the blob in the middle alone', () => {
    let withMiddle = 0;
    let throughMiddle = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const { chambers, corridors } = trio(seed, TRIO_TILES.normal).report.blueprint;
      const middle = chambers.findIndex((c) => c.center.x === 0 && c.center.y === 0);
      if (middle < 0) continue;
      withMiddle++;
      const crossing = corridors.filter((c) => {
        const [a, b] = [thirdOf(c.from, chambers), thirdOf(c.to, chambers)];
        return a >= 0 && b >= 0 && a !== b;
      });
      if (crossing.length > 0) continue;
      // Nothing crosses directly, and the board is in one piece (it was made): the middle blob has
      // a corridor to a blob in each of the three thirds.
      const reached = new Set(
        corridors.flatMap((c) =>
          c.from === middle
            ? [thirdOf(c.to, chambers)]
            : c.to === middle
              ? [thirdOf(c.from, chambers)]
              : [],
        ),
      );
      expect([...reached].sort()).toEqual([0, 1, 2]);
      throughMiddle++;
    }
    // About 40% of boards have a middle blob; on those, crossing over is the likelier case but not certain.
    expect(withMiddle).toBeGreaterThan(40);
    expect(throughMiddle).toBeGreaterThan(0);
  });

  it('turn every corridor into three, one in each third', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { chambers, corridors } = trio(seed, TRIO_TILES.large).report.blueprint;
      expect(corridors.length % 3).toBe(0);
      // Corridors turn into corridors of the same width.
      const key = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`;
      const widths = new Map(corridors.map((c) => [key(c.from, c.to), c.width]));
      expect(widths.size).toBe(corridors.length);
      expect(chambers.length).toBeGreaterThan(3);
    }
  });
});

/** A four-player board left as it was drawn (not turned), so its mirror lines are the axes. */
const quad = (seed: number, tiles: number) =>
  generateQuadLayout({ seed, targetTiles: tiles, turns: 0, params: DEFAULT_GENERATION_PARAMS });

describe('four-player layouts', () => {
  it('never join two starts by a corridor of their own, unless the starts are the only blobs', () => {
    for (const size of MAP_SIZES) {
      for (let seed = 1; seed <= 60; seed++) {
        const { chambers, corridors } = quad(seed, QUAD_TILES[size]).report.blueprint;
        expect(chambers.slice(0, 4).every((c) => c.spawn)).toBe(true);
        expect(chambers.slice(4).some((c) => c.spawn)).toBe(false);
        const amongStarts = corridors.filter((c) => c.from < 4 && c.to < 4);
        if (chambers.length === 4) {
          // Nothing else to go through: the four starts have to be joined to one another.
          expect(amongStarts.length).toBeGreaterThanOrEqual(3);
        } else {
          expect(amongStarts).toHaveLength(0);
        }
      }
    }
  });

  it('only let the smallest boards be nothing but the four starts', () => {
    const only = (size: keyof typeof QUAD_TILES): number => {
      let count = 0;
      for (let seed = 1; seed <= 60; seed++) {
        if (quad(seed, QUAD_TILES[size]).report.blueprint.chambers.length === 4) count++;
      }
      return count;
    };
    expect(only('small')).toBeGreaterThan(0);
    expect(only('normal')).toBe(0);
    expect(only('large')).toBe(0);
  });

  it('keep blobs on the two mirror lines sometimes, and a blob in the middle sometimes', () => {
    let onLines = 0;
    let withMiddle = 0;
    let boards = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const { chambers } = quad(seed, QUAD_TILES.large).report.blueprint;
      boards++;
      if (chambers.some((c) => (c.center.x === 0) !== (c.center.y === 0))) onLines++;
      if (chambers.some((c) => c.center.x === 0 && c.center.y === 0)) withMiddle++;
    }
    expect(onLines).toBeGreaterThan(boards * 0.2);
    expect(withMiddle).toBeGreaterThan(boards * 0.2);
    expect(withMiddle).toBeLessThan(boards * 0.7);
  });

  it('only sometimes run a corridor straight along a mirror line', () => {
    let boards = 0;
    let spines = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const { chambers, corridors } = quad(seed, QUAD_TILES.large).report.blueprint;
      const along = (a: number, b: number): boolean =>
        (chambers[a]!.center.x === 0 && chambers[b]!.center.x === 0) ||
        (chambers[a]!.center.y === 0 && chambers[b]!.center.y === 0);
      // Only boards that have two blobs on one line to join.
      const hasPair = chambers.some((_, a) => chambers.some((_, b) => a < b && along(a, b)));
      if (!hasPair) continue;
      boards++;
      if (corridors.some((c) => along(c.from, c.to))) spines++;
    }
    expect(boards).toBeGreaterThan(50);
    expect(spines / boards).toBeLessThan(0.55);
  });
});

const sextet = (
  symmetry: 'rotational' | 'mirror',
  axis: 'points' | 'edges',
  seed: number,
  tiles: number,
) =>
  generateSextetLayout({
    seed,
    symmetry,
    axis,
    targetTiles: tiles,
    params: DEFAULT_GENERATION_PARAMS,
  });

describe('six-player layouts', () => {
  const kinds = [
    ['rotational', 'points'],
    ['mirror', 'points'],
    ['mirror', 'edges'],
  ] as const;

  it.each(kinds)(
    'never join two starts by a corridor of their own, unless the starts are the only blobs (%s, %s)',
    (symmetry, axis) => {
      for (const size of MAP_SIZES) {
        for (let seed = 1; seed <= 40; seed++) {
          const { chambers, corridors } = sextet(symmetry, axis, seed, SEXTET_TILES[size]).report
            .blueprint;
          expect(chambers.slice(0, 6).every((c) => c.spawn)).toBe(true);
          expect(chambers.slice(6).some((c) => c.spawn)).toBe(false);
          const amongStarts = corridors.filter((c) => c.from < 6 && c.to < 6);
          if (chambers.length > 6) expect(amongStarts).toHaveLength(0);
        }
      }
    },
  );

  it.each(kinds)(
    'only let the smallest boards be nothing but the six starts (%s, %s)',
    (symmetry, axis) => {
      const only = (size: keyof typeof SEXTET_TILES): number => {
        let count = 0;
        for (let seed = 1; seed <= 40; seed++) {
          if (
            sextet(symmetry, axis, seed, SEXTET_TILES[size]).report.blueprint.chambers.length === 6
          ) {
            count++;
          }
        }
        return count;
      };
      expect(only('small')).toBeGreaterThan(0);
      expect(only('normal')).toBe(0);
      expect(only('large')).toBe(0);
    },
  );

  it.each(kinds)('have a blob in the middle sometimes (%s, %s)', (symmetry, axis) => {
    let withMiddle = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const { chambers } = sextet(symmetry, axis, seed, SEXTET_TILES.normal).report.blueprint;
      if (chambers.some((c) => Math.hypot(c.center.x, c.center.y) < 1e-6)) withMiddle++;
    }
    expect(withMiddle).toBeGreaterThan(20);
    expect(withMiddle).toBeLessThan(70);
  });

  it('have blobs on the mirror lines of mirror boards, and none can be on a line of turns alone', () => {
    // On a mirror board a set of blobs on one of the three lines is three blobs, not six.
    let threes = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const { chambers } = sextet('mirror', 'points', seed, SEXTET_TILES.large).report.blueprint;
      const extra =
        chambers.length -
        6 -
        (chambers.some((c) => Math.hypot(c.center.x, c.center.y) < 1e-6) ? 1 : 0);
      if (extra % 6 === 3) threes++;
    }
    expect(threes).toBeGreaterThan(0);
  });
});
