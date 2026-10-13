import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_GENERATION_PARAMS, DUEL_TILES, MAP_SIZES } from '../params.js';
import { generateDuelLayout } from './layout.js';
import type { DuelSymmetry } from './symmetry.js';

// Each test draws hundreds of whole boards.
vi.setConfig({ testTimeout: 60000 });

const board = (symmetry: DuelSymmetry, seed: number, tiles: number) =>
  generateDuelLayout({ seed, symmetry, targetTiles: tiles, params: DEFAULT_GENERATION_PARAMS });

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

  it('only sometimes joins blobs on the centerline of a mirror board to each other', () => {
    let boards = 0;
    let spines = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const { chambers, corridors } = board('mirror', seed, DUEL_TILES.normal).report.blueprint;
      const line = chambers.flatMap((c, i) => (c.center.x === 0 ? [i] : []));
      if (line.length < 2) continue;
      boards++;
      if (corridors.some((c) => line.includes(c.from) && line.includes(c.to))) spines++;
    }
    expect(boards).toBeGreaterThan(50);
    // Allowed on 30% of boards, and nearly always there when it is allowed.
    expect(spines / boards).toBeGreaterThan(0.15);
    expect(spines / boards).toBeLessThan(0.45);
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
