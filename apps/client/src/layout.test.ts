import { describe, expect, it } from 'vitest';
import { hexagonalBoard } from '@hexxar/shared';
import { HEX_SIZE, hexToPixel, pixelToHex } from './layout.js';

describe('hex layout', () => {
  it('maps every hex center back to itself', () => {
    for (const hex of hexagonalBoard(8)) {
      expect(pixelToHex(hexToPixel(hex))).toEqual(hex);
    }
  });

  it('maps points near a hex center to that hex', () => {
    const hex = { q: 2, r: -3 };
    const c = hexToPixel(hex);
    const nudge = HEX_SIZE * 0.4;
    for (const [dx, dy] of [
      [nudge, 0],
      [-nudge, 0],
      [0, nudge],
      [0, -nudge],
    ] as const) {
      expect(pixelToHex({ x: c.x + dx, y: c.y + dy })).toEqual(hex);
    }
  });
});
