import { describe, expect, it } from 'vitest';
import { hexagonalBoard, hexKey, hexNeighbors, type Hex } from '../hex.js';
import { hexToPoint } from '../royale/blueprint.js';
import { hexImage, mirrorFrame, pointImage, type DuelAxis } from './symmetry.js';

const board = hexagonalBoard(8);

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
