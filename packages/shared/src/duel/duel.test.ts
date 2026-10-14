import { describe, expect, it, vi } from 'vitest';
import { createRng } from '../rng.js';
import type { Blueprint } from '../royale/blueprint.js';
import { extraSetsFor, FAIR_BOWL_RADIUS, MAP_SIZES, type MapSize } from '../params.js';
import {
  buildGroupBlueprint,
  duelGroup,
  QUAD_GROUP,
  sextetGroup,
  TRIO_GROUP,
  type FairGroup,
} from './group.js';

// Each test draws hundreds of blueprints.
vi.setConfig({ testTimeout: 60000 });

const groups: { name: string; group: FairGroup }[] = [
  { name: 'duel, mirror through tile corners', group: duelGroup('mirror', 'points') },
  { name: 'duel, mirror through tile edges', group: duelGroup('mirror', 'edges') },
  { name: 'duel, half turn', group: duelGroup('rotational', 'points') },
  { name: 'trio', group: TRIO_GROUP },
  { name: 'quad', group: QUAD_GROUP },
  { name: 'sextet, turns of 60 degrees', group: sextetGroup('rotational', 'points') },
  { name: 'sextet, mirrors through tile corners', group: sextetGroup('mirror', 'points') },
  { name: 'sextet, mirrors through tile edges', group: sextetGroup('mirror', 'edges') },
];

const blueprint = (group: FairGroup, size: MapSize, seed: number): Blueprint =>
  buildGroupBlueprint(group, {
    radius: FAIR_BOWL_RADIUS[size],
    extraSets: extraSetsFor(size, group.elements.length),
    rng: createRng(seed),
  }).blueprint;

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

describe.each(groups)('blueprint: $name', ({ group }) => {
  const players = group.elements.length;

  it('maps onto itself under every symmetry, corridors and widths included', () => {
    for (const size of MAP_SIZES) {
      for (let seed = 1; seed <= 30; seed++) {
        const { chambers, corridors } = blueprint(group, size, seed);
        const where = (point: { x: number; y: number }, radius: number): number =>
          chambers.findIndex(
            (c) => near(c.center.x, point.x) && near(c.center.y, point.y) && near(c.radius, radius),
          );
        for (const { map } of group.elements) {
          const index = chambers.map((c) => where(map(c.center), c.radius));
          expect(index.every((i) => i >= 0)).toBe(true);
          // Spawn blobs go to spawn blobs, and every corridor goes to a corridor of the same width.
          chambers.forEach((c, i) => expect(chambers[index[i]!]!.spawn).toBe(c.spawn));
          for (const c of corridors) {
            const [from, to] = [index[c.from]!, index[c.to]!];
            const copy = corridors.find(
              (k) => (k.from === from && k.to === to) || (k.from === to && k.to === from),
            );
            expect(copy?.width).toBe(c.width);
          }
        }
      }
    }
  });

  it('puts the starts first, one for each player, and no other spawn blobs', () => {
    for (const size of MAP_SIZES) {
      for (let seed = 1; seed <= 20; seed++) {
        const { chambers } = blueprint(group, size, seed);
        expect(chambers.slice(0, players).every((c) => c.spawn)).toBe(true);
        expect(chambers.slice(players).some((c) => c.spawn)).toBe(false);
      }
    }
  });

  it('never joins two starts by a corridor of their own, unless the starts are the only blobs', () => {
    for (const size of MAP_SIZES) {
      for (let seed = 1; seed <= 40; seed++) {
        const { chambers, corridors } = blueprint(group, size, seed);
        const amongStarts = corridors.filter((c) => c.from < players && c.to < players);
        if (chambers.length > players) expect(amongStarts).toHaveLength(0);
        else expect(amongStarts.length).toBeGreaterThan(0);
      }
    }
  });

  it('is all one piece, and gives every corridor a width of 1, 2 or 3', () => {
    for (const size of MAP_SIZES) {
      for (let seed = 1; seed <= 40; seed++) {
        const { chambers, corridors } = blueprint(group, size, seed);
        // The blobs joined by the corridors make one piece.
        const parent = chambers.map((_, i) => i);
        const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
        for (const c of corridors) parent[find(c.from)] = find(c.to);
        expect(new Set(chambers.map((_, i) => find(i))).size).toBe(1);
        for (const c of corridors) expect([1, 2, 3]).toContain(c.width);
      }
    }
  });

  it('only has a blob at the middle some of the time, and extra blobs by map size', () => {
    let middles = 0;
    const boards = 100;
    for (let seed = 1; seed <= boards; seed++) {
      const { chambers } = blueprint(group, 'normal', seed);
      if (chambers.some((c) => Math.hypot(c.center.x, c.center.y) < 1e-6)) middles++;
    }
    expect(middles).toBeGreaterThan(boards * 0.2);
    expect(middles).toBeLessThan(boards * 0.6);
    // Small boards have nothing but the starts (and perhaps the middle blob).
    for (let seed = 1; seed <= 20; seed++) {
      const { chambers } = blueprint(group, 'small', seed);
      expect(chambers.length).toBeLessThanOrEqual(players + 1);
    }
  });

  it('is the same for the same seed', () => {
    expect(blueprint(group, 'normal', 5)).toEqual(blueprint(group, 'normal', 5));
    expect(blueprint(group, 'normal', 5)).not.toEqual(blueprint(group, 'normal', 6));
  });
});

describe('blobs on a mirror line', () => {
  it.each(groups.filter(({ group }) => group.lines.length > 0))(
    'are only sometimes joined to each other ($name)',
    ({ group }) => {
      let boards = 0;
      let spines = 0;
      for (let seed = 1; seed <= 400; seed++) {
        const { chambers, corridors } = blueprint(group, 'large', seed);
        const sameLine = (a: number, b: number): boolean =>
          group.lines.some((d) =>
            [a, b].every(
              (i) =>
                Math.abs(chambers[i]!.center.x * d.y - chambers[i]!.center.y * d.x) < 1e-6 &&
                Math.hypot(chambers[i]!.center.x, chambers[i]!.center.y) > 1e-6,
            ),
          );
        const lineBlobs = chambers.map((_, i) => i).filter((i) => sameLine(i, i));
        const hasPair = lineBlobs.some((a) => lineBlobs.some((b) => a < b && sameLine(a, b)));
        if (!hasPair) continue;
        boards++;
        if (corridors.some((c) => sameLine(c.from, c.to))) spines++;
      }
      expect(boards).toBeGreaterThan(20);
      expect(spines / boards).toBeLessThan(0.6);
    },
  );
});
