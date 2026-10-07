import type { Hex } from '@hexxar/shared';

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

/** Round fractional axial coordinates to the nearest hex (via cube coordinates). */
function hexRound(q: number, r: number): Hex {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq + 0, r: rr + 0 };
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
