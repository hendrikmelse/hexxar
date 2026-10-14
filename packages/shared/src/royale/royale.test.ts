import { describe, expect, it, vi } from 'vitest';
import { hexKey, hexNeighbors } from '../hex.js';
import { DEFAULT_GENERATION_PARAMS, MAP_SIZES, BOWL_RADIUS, bowlRadiusFor } from '../params.js';
import { createNoise, fbm } from './noise.js';
import { ARCHETYPE_IDS } from './archetypes/index.js';
import { hexToPoint, pointToHex } from './blueprint.js';
import { components } from './grid.js';
import { topologyIssues } from './topology.js';
import { generateRoyaleLayout } from './generate.js';

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

  it('is one connected piece', () => {
    for (const players of playerCounts) {
      for (const seed of seeds) {
        const { hexes } = layout(players, seed);
        expect(components(new Map(hexes.map((h) => [hexKey(h), h])))).toHaveLength(1);
      }
    }
  });

  it('keeps every start city and the ring around it, whatever the size and player count', () => {
    for (const size of MAP_SIZES) {
      for (const players of [3, 7, 12]) {
        for (let seed = 1; seed <= 20; seed++) {
          const sizeParams = { ...params, bowlRadius: bowlRadiusFor(size, players) };
          const { hexes, starts } = generateRoyaleLayout({ players, seed, params: sizeParams });
          const land = new Set(hexes.map(hexKey));
          expect(starts).toHaveLength(players);
          // Every player has a city of their own.
          expect(new Set(starts.map(hexKey)).size).toBe(players);
          for (const start of starts) {
            // Never on the edge: the city and all six neighbors are land.
            expect(land.has(hexKey(start))).toBe(true);
            for (const neighbor of hexNeighbors(start))
              expect(land.has(hexKey(neighbor))).toBe(true);
          }
        }
      }
    }
  });

  it('makes boards of about the size each map size stands for', () => {
    // What a map size used to be asked for: tiles per player at 6 players, falling with more players.
    const wanted = { small: 15, normal: 25, large: 45 };
    for (const size of MAP_SIZES) {
      for (const players of [3, 6, 12]) {
        let tiles = 0;
        const runs = 12;
        for (let seed = 1; seed <= runs; seed++) {
          const sizeParams = { ...params, bowlRadius: bowlRadiusFor(size, players) };
          tiles += generateRoyaleLayout({ players, seed, params: sizeParams }).hexes.length;
        }
        const old = wanted[size] * (6 / players) ** 0.25;
        // Small boards cannot get down to the old numbers (the corridors alone cover about 15 tiles
        // per player), so they are allowed to be a little bigger.
        expect(tiles / runs / players / old).toBeGreaterThan(0.8);
        expect(tiles / runs / players / old).toBeLessThan(size === 'small' ? 1.4 : 1.2);
      }
    }
  });

  it('has smaller bowls for more players and bigger bowls for bigger maps', () => {
    for (const size of MAP_SIZES) {
      expect(bowlRadiusFor(size, 12)).toBeLessThan(bowlRadiusFor(size, 6));
      expect(bowlRadiusFor(size, 6)).toBeLessThan(bowlRadiusFor(size, 3));
      expect(bowlRadiusFor(size, 6)).toBe(BOWL_RADIUS[size]);
    }
    expect(BOWL_RADIUS.small).toBeLessThan(BOWL_RADIUS.normal);
    expect(BOWL_RADIUS.normal).toBeLessThan(BOWL_RADIUS.large);
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
      if (degree.some((d) => d === 1)) withPeninsula++;
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
