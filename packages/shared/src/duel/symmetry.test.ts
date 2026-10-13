import { describe, expect, it } from 'vitest';
import { hexagonalBoard, hexKey, hexNeighbors, type Hex } from '../hex.js';
import { hexToPoint } from '../royale/blueprint.js';
import { sextetGroup } from './group.js';
import {
  hexImage,
  mirrorFrame,
  pointImage,
  quadHexImages,
  rotatePoint,
  trioHexImages,
  type DuelAxis,
} from './symmetry.js';

const board = hexagonalBoard(8);

describe('turned mirror boards', () => {
  it('give the six hex mirror lines between them, and agree on hexes and on points', () => {
    const maps = new Set<string>();
    for (const axis of ['points', 'edges'] as const) {
      for (let turns = 0; turns < 6; turns++) {
        const ofHex = hexImage('mirror', axis, turns);
        const ofPoint = pointImage('mirror', axis, turns);
        for (const hex of board) {
          const expected = ofPoint(hexToPoint(hex));
          const actual = hexToPoint(ofHex(hex));
          expect(actual.x).toBeCloseTo(expected.x, 9);
          expect(actual.y).toBeCloseTo(expected.y, 9);
          expect(hexKey(ofHex(ofHex(hex)))).toBe(hexKey(hex));
        }
        maps.add(
          board
            .slice(0, 12)
            .map((hex) => hexKey(ofHex(hex)))
            .join('|'),
        );
      }
    }
    // Twelve ways to ask for it, six different mirrors.
    expect(maps.size).toBe(6);
  });
});

describe('duel symmetries', () => {
  const kinds: ['mirror' | 'rotational', DuelAxis][] = [
    ['mirror', 'points'],
    ['mirror', 'edges'],
    ['rotational', 'points'],
  ];

  it.each(kinds)('%s (%s) is the same on hexes and on points, and undoes itself', (kind, axis) => {
    const ofHex = hexImage(kind, axis);
    const ofPoint = pointImage(kind, axis);
    for (const hex of board) {
      const image = ofHex(hex);
      // The hex's twin is where the point's twin is.
      const expected = ofPoint(hexToPoint(hex));
      const actual = hexToPoint(image);
      expect(actual.x).toBeCloseTo(expected.x, 9);
      expect(actual.y).toBeCloseTo(expected.y, 9);
      // Doing it twice is doing nothing, and it keeps neighbors next to each other.
      expect(hexKey(ofHex(image))).toBe(hexKey(hex));
      const near = new Set(hexNeighbors(image).map(hexKey));
      for (const neighbor of hexNeighbors(hex))
        expect(near.has(hexKey(ofHex(neighbor)))).toBe(true);
    }
  });

  it('the two mirror lines are 30 degrees apart: one through tile corners, one through edge middles', () => {
    const onLine = (axis: DuelAxis): Hex[] =>
      board.filter((hex) => hexKey(hexImage('mirror', axis)(hex)) === hexKey(hex));
    const distanceFromLine = (axis: DuelAxis, hex: Hex): number => {
      const { along } = mirrorFrame(axis);
      const p = hexToPoint(hex);
      return Math.abs(p.x * -along.y + p.y * along.x);
    };
    for (const axis of ['points', 'edges'] as const) {
      const fixed = onLine(axis);
      expect(fixed.length).toBeGreaterThan(8);
      for (const hex of fixed) expect(distanceFromLine(axis, hex)).toBeLessThan(1e-9);
    }
    // The angle between the two lines, from their directions.
    const a = mirrorFrame('points').along;
    const b = mirrorFrame('edges').along;
    const degrees = (Math.acos(a.x * b.x + a.y * b.y) * 180) / Math.PI;
    expect(degrees).toBeCloseTo(30, 6);

    // Through the center tile, the first line leaves through corners (it is at 90 degrees, and the
    // corners of a pointy-topped tile are at 30, 90 and 150); the second leaves through the middle of
    // an edge (a neighbor is straight along it).
    const edgeDirection = mirrorFrame('edges').along;
    const neighborPoints = hexNeighbors({ q: 0, r: 0 }).map(hexToPoint);
    expect(
      neighborPoints.some(
        (p) => Math.abs(p.x - edgeDirection.x) < 1e-9 && Math.abs(p.y - edgeDirection.y) < 1e-9,
      ),
    ).toBe(true);
    const cornerDirection = mirrorFrame('points').along;
    expect(
      neighborPoints.some(
        (p) => Math.abs(p.x - cornerDirection.x) < 1e-9 && Math.abs(p.y - cornerDirection.y) < 1e-9,
      ),
    ).toBe(false);
  });
});

describe('three-player symmetry', () => {
  it('is turns of 120 and 240 degrees: three turns of 120 make no turn, and points agree with hexes', () => {
    const [third, twoThirds] = trioHexImages as [(h: Hex) => Hex, (h: Hex) => Hex];
    for (const hex of board) {
      expect(hexKey(third(third(third(hex))))).toBe(hexKey(hex));
      expect(hexKey(third(third(hex)))).toBe(hexKey(twoThirds(hex)));
      expect(hexKey(third(twoThirds(hex)))).toBe(hexKey(hex));
      for (const [image, steps] of [
        [third, 2],
        [twoThirds, 4],
      ] as const) {
        const expected = rotatePoint(hexToPoint(hex), steps);
        const actual = hexToPoint(image(hex));
        expect(actual.x).toBeCloseTo(expected.x, 9);
        expect(actual.y).toBeCloseTo(expected.y, 9);
      }
    }
  });
});

describe('four-player symmetry', () => {
  it.each([0, 1, 2, 3, 4, 5])(
    'is two mirrors and their half turn, however far the board is turned (%i)',
    (turns) => {
      const [first, second, both] = quadHexImages(turns) as [
        (h: Hex) => Hex,
        (h: Hex) => Hex,
        (h: Hex) => Hex,
      ];
      for (const hex of board) {
        // Each undoes itself, they commute, and doing both is the third (a half turn).
        for (const image of [first, second, both])
          expect(hexKey(image(image(hex)))).toBe(hexKey(hex));
        expect(hexKey(first(second(hex)))).toBe(hexKey(second(first(hex))));
        expect(hexKey(first(second(hex)))).toBe(hexKey(both(hex)));
        // The half turn is the same for every turn of the board.
        expect(hexKey(both(hex))).toBe(hexKey(quadHexImages(0)[2]!(hex)));
        // And neighbors stay neighbors.
        const near = new Set(hexNeighbors(first(hex)).map(hexKey));
        for (const n of hexNeighbors(hex)) expect(near.has(hexKey(first(n)))).toBe(true);
      }
    },
  );

  it('has one mirror line through tile corners and one through edge middles, at right angles', () => {
    const [vertical, horizontal] = quadHexImages(0) as [(h: Hex) => Hex, (h: Hex) => Hex];
    const fixedBy = (image: (h: Hex) => Hex): Hex[] =>
      board.filter((hex) => hexKey(image(hex)) === hexKey(hex));
    for (const hex of fixedBy(vertical)) expect(Math.abs(hexToPoint(hex).x)).toBeLessThan(1e-9);
    for (const hex of fixedBy(horizontal)) expect(Math.abs(hexToPoint(hex).y)).toBeLessThan(1e-9);
    expect(fixedBy(vertical).length).toBeGreaterThan(8);
    expect(fixedBy(horizontal).length).toBeGreaterThan(8);
  });
});

describe('six-player symmetry groups', () => {
  const groups = [
    ['rotational', 'points'],
    ['mirror', 'points'],
    ['mirror', 'edges'],
  ] as const;
  const sample = board.slice(0, 40);
  const fingerprint = (image: (h: Hex) => Hex): string =>
    sample.map((h) => hexKey(image(h))).join('|');

  it.each(groups)(
    '%s (%s) is six symmetries that make a group, agreeing on hexes and points',
    (symmetry, axis) => {
      const group = sextetGroup(symmetry, axis);
      expect(group.elements).toHaveLength(6);
      expect(group.hexMaps).toHaveLength(5);
      const maps: ((h: Hex) => Hex)[] = [(h) => h, ...group.hexMaps];
      // Six different ones, closed under doing one after another.
      const prints = new Set(maps.map(fingerprint));
      expect(prints.size).toBe(6);
      for (const first of maps) {
        for (const second of maps) {
          expect(prints.has(fingerprint((h) => second(first(h))))).toBe(true);
        }
      }
      // The blueprint's elements are the same maps, on points.
      group.hexMaps.forEach((image, n) => {
        for (const hex of sample) {
          const expected = group.elements[n + 1]!.map(hexToPoint(hex));
          const actual = hexToPoint(image(hex));
          expect(actual.x).toBeCloseTo(expected.x, 9);
          expect(actual.y).toBeCloseTo(expected.y, 9);
        }
      });
      // Mirrors are the elements that turn a corridor's bend the other way.
      const mirrorCount = group.elements.filter((e) => e.mirrors).length;
      expect(mirrorCount).toBe(symmetry === 'mirror' ? 3 : 0);
    },
  );

  it('are three different groups of six', () => {
    const prints = groups.map(([symmetry, axis]) => {
      const group = sextetGroup(symmetry, axis);
      return new Set(group.hexMaps.map(fingerprint));
    });
    for (const [i, a] of prints.entries()) {
      for (const b of prints.slice(i + 1))
        expect([...a].filter((p) => b.has(p)).length).toBeLessThan(5);
    }
  });
});
