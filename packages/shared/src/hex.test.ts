import { describe, expect, it } from 'vitest';
import {
  hexDistance,
  hexFlipHorizontal,
  hexFlipVertical,
  hexNeighbors,
  hexLine,
  hexRotate,
  hexagonalBoard,
} from './hex.js';

describe('hex math', () => {
  it('has 6 neighbors, all at distance 1', () => {
    const origin = { q: 0, r: 0 };
    const neighbors = hexNeighbors(origin);
    expect(neighbors).toHaveLength(6);
    for (const n of neighbors) expect(hexDistance(origin, n)).toBe(1);
  });

  it('computes distance across the board', () => {
    expect(hexDistance({ q: 0, r: 0 }, { q: 3, r: -3 })).toBe(3);
    expect(hexDistance({ q: -2, r: 1 }, { q: 2, r: -1 })).toBe(4);
  });

  it('builds a hexagonal board with 3r(r+1)+1 tiles', () => {
    for (const radius of [0, 1, 2, 5]) {
      expect(hexagonalBoard(radius)).toHaveLength(3 * radius * (radius + 1) + 1);
    }
  });

  it('rotations and mirrors preserve distance and are consistent', () => {
    const origin = { q: 0, r: 0 };
    for (const h of hexagonalBoard(4)) {
      for (const t of [hexFlipVertical, hexFlipHorizontal, (x: typeof h) => hexRotate(x, 1)]) {
        expect(hexDistance(origin, t(h))).toBe(hexDistance(origin, h));
      }
      expect(hexFlipVertical(hexFlipVertical(h))).toEqual(h);
      expect(hexFlipHorizontal(hexFlipHorizontal(h))).toEqual(h);
      expect(hexFlipVertical(hexFlipHorizontal(h))).toEqual(hexRotate(h, 3));
    }
  });

  it('draws a line of adjacent hexes between two hexes', () => {
    const a = { q: -3, r: 2 };
    const b = { q: 4, r: -3 };
    const line = hexLine(a, b);
    expect(line[0]).toEqual(a);
    expect(line.at(-1)).toEqual(b);
    expect(line).toHaveLength(hexDistance(a, b) + 1);
    for (let i = 1; i < line.length; i++) expect(hexDistance(line[i - 1]!, line[i]!)).toBe(1);
    expect(hexLine(a, a)).toEqual([a]);
  });
});
