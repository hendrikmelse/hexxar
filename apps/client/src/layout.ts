import { hexRound, type Hex } from '@hexxar/shared';

/** Distance from a hex's center to its corners, in world units. */
export const HEX_SIZE = 32;

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Axial -> world position of a hex's center (pointy-top layout). */
export function hexToPixel({ q, r }: Hex): Point {
  return { x: HEX_SIZE * Math.sqrt(3) * (q + r / 2), y: HEX_SIZE * 1.5 * r };
}

/** World position -> the hex containing it. */
export function pixelToHex({ x, y }: Point): Hex {
  const q = ((Math.sqrt(3) / 3) * x - y / 3) / HEX_SIZE;
  const r = ((2 / 3) * y) / HEX_SIZE;
  return hexRound(q, r);
}

/** Flat array of corner coordinates for a hex centered at `center`, shrunk by `inset`. */
export function hexCorners(center: Point, inset = 0): number[] {
  const points: number[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    points.push(
      center.x + (HEX_SIZE - inset) * Math.cos(angle),
      center.y + (HEX_SIZE - inset) * Math.sin(angle),
    );
  }
  return points;
}
