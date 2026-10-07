import { describe, expect, it } from 'vitest';
import { hexDistance, hexNeighbors, hexagonalBoard } from './hex.js';

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
});
