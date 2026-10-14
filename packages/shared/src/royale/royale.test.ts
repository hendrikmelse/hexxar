import { describe, expect, it, vi } from 'vitest';
import { hexKey } from '../hex.js';
import { DEFAULT_GENERATION_PARAMS, MAP_SIZES, royaleTilesPerPlayer } from '../params.js';
import { createNoise, fbm } from './noise.js';
import { ARCHETYPE_IDS } from './archetypes/index.js';
import { CHOKE_MAX_WIDTH } from './analyze.js';
import { hexToPoint, pointToHex } from './blueprint.js';
import { components, depthFromCoast } from './grid.js';
import { topologyIssues } from './topology.js';
import { generateRoyaleLayout, royaleTargetTiles } from './generate.js';

// Each test draws dozens of whole boards.
vi.setConfig({ testTimeout: 60000 });

const params = DEFAULT_GENERATION_PARAMS;
const layout = (players: number, seed: number, archetype?: (typeof ARCHETYPE_IDS)[number]) =>
  generateRoyaleLayout({ players, seed, params, archetype });
const playerCounts = [3, 4, 6, 9, 12];
const seeds = [1, 2, 3, 4, 5, 6];

describe('noise', () => {
  it('is deterministic, bounded and smooth', () => {
    const a = createNoise(7);
    const b = createNoise(7);
    expect(a(1.3, 4.7)).toBe(b(1.3, 4.7));
    expect(createNoise(8)(1.3, 4.7)).not.toBe(a(1.3, 4.7));
    for (let i = 0; i < 200; i++) {
      const value = fbm(a, i * 0.37, i * 0.91);
      expect(Math.abs(value)).toBeLessThanOrEqual(1);
      expect(Math.abs(fbm(a, i * 0.37 + 0.01, i * 0.91) - value)).toBeLessThan(0.1);
    }
  });
});

describe('blueprint coordinates', () => {
  it('turns hexes into points and back', () => {
    for (const hex of [
      { q: 0, r: 0 },
      { q: 3, r: -7 },
      { q: -5, r: 2 },
    ]) {
      expect(pointToHex(hexToPoint(hex))).toEqual(hex);
    }
    // Neighboring hexes are one tile unit apart.
    const a = hexToPoint({ q: 0, r: 0 });
    for (const n of [
      { q: 1, r: 0 },
      { q: 0, r: 1 },
      { q: -1, r: 1 },
    ]) {
      const b = hexToPoint(n);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(1);
    }
  });
});

describe('topology', () => {
  const path = (n: number) => Array.from({ length: n - 1 }, (_, i) => ({ from: i, to: i + 1 }));

  it('flags snakes and long tails, but not dead ends that hang off a junction', () => {
    // A path is all tail.
    expect(topologyIssues(4, path(4)).tails).toEqual([0, 3]);
    // A star: every dead end is one corridor from the hub.
    const star = [1, 2, 3, 4].map((to) => ({ from: 0, to }));
    expect(topologyIssues(5, star).tails).toEqual([]);
    // A cycle has no dead ends; a dead end off it is fine; a second chamber on that dead end is not.
    const cycle = [
      { from: 0, to: 1 },
      { from: 1, to: 2 },
      { from: 2, to: 0 },
    ];
    expect(topologyIssues(3, cycle).tails).toEqual([]);
    expect(topologyIssues(4, [...cycle, { from: 2, to: 3 }]).tails).toEqual([]);
    expect(topologyIssues(5, [...cycle, { from: 2, to: 3 }, { from: 3, to: 4 }]).tails).toEqual([
      4,
    ]);
  });
});

describe('royale layouts', () => {
  it('is deterministic for a seed', () => {
    expect(layout(6, 11).hexes).toEqual(layout(6, 11).hexes);
    expect(layout(6, 11).hexes).not.toEqual(layout(6, 12).hexes);
  });

  it('is one connected piece with about the wanted area', () => {
    for (const players of playerCounts) {
      for (const seed of seeds) {
        const { hexes, report } = layout(players, seed);
        expect(components(new Map(hexes.map((h) => [hexKey(h), h])))).toHaveLength(1);
        const target = royaleTargetTiles(players, params);
        expect(hexes.length / target).toBeGreaterThan(0.85);
        expect(hexes.length / target).toBeLessThan(1.15);
        expect(report.targetTiles).toBe(target);
      }
    }
  });

  it('puts one city per player inside the board and well apart', () => {
    for (const players of playerCounts) {
      for (const seed of seeds) {
        const { hexes, starts } = layout(players, seed);
        const land = new Map(hexes.map((h) => [hexKey(h), h]));
        const depth = depthFromCoast(land);
        expect(starts).toHaveLength(players);
        for (const start of starts) {
          // Never on the edge: every neighbor is land.
          expect(depth.get(hexKey(start))).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it('measures its chokes on the finished board', () => {
    for (const players of playerCounts) {
      for (const seed of seeds) {
        const { report } = layout(players, seed);
        for (const choke of report.metrics.chokes) {
          expect(choke.width).toBeGreaterThanOrEqual(1);
          expect(choke.width).toBeLessThanOrEqual(CHOKE_MAX_WIDTH);
        }
      }
    }
  });

  it('hits the intended size at every map size', () => {
    for (const size of MAP_SIZES) {
      for (const players of [3, 7, 12]) {
        for (const seed of [1, 2]) {
          const sizeParams = {
            ...params,
            tilesPerPlayer: royaleTilesPerPlayer(size, players),
          };
          const { hexes, starts } = generateRoyaleLayout({ players, seed, params: sizeParams });
          const target = royaleTargetTiles(players, sizeParams);
          expect(hexes.length / target).toBeGreaterThan(0.85);
          expect(hexes.length / target).toBeLessThan(1.15);
          const depth = depthFromCoast(new Map(hexes.map((h) => [hexKey(h), h])));
          for (const start of starts) {
            expect(depth.get(hexKey(start))).toBeGreaterThanOrEqual(2);
          }
        }
      }
    }
  });

  it('can be told which archetype to draw', () => {
    for (const archetype of ARCHETYPE_IDS) {
      expect(layout(5, 3, archetype).report.archetype).toBe(archetype);
    }
  });

  it('sometimes has a peninsula, a starting city included, but not always', () => {
    let withPeninsula = 0;
    let startOnPeninsula = 0;
    const seedCount = 30;
    for (let seed = 1; seed <= seedCount; seed++) {
      const { report } = layout(8, seed);
      const { chambers, corridors } = report.blueprint;
      const degree = chambers.map(
        (_, i) => corridors.filter((c) => c.from === i || c.to === i).length,
      );
      if (report.metrics.deadEnds >= 1) withPeninsula++;
      if (chambers.some((c, i) => c.spawn && degree[i] === 1)) startOnPeninsula++;
    }
    expect(withPeninsula).toBeGreaterThanOrEqual(3);
    expect(withPeninsula).toBeLessThan(seedCount);
    expect(startOnPeninsula).toBeGreaterThanOrEqual(1);
  });

  it('is centered on the origin', () => {
    const { hexes } = layout(8, 5);
    const q = hexes.reduce((sum, h) => sum + h.q, 0) / hexes.length;
    const r = hexes.reduce((sum, h) => sum + h.r, 0) / hexes.length;
    expect(Math.abs(q)).toBeLessThan(1);
    expect(Math.abs(r)).toBeLessThan(1);
  });
});
