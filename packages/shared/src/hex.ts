/** Axial hex coordinates (pointy-top layout). */
export interface Hex {
  readonly q: number;
  readonly r: number;
}

export const HEX_DIRECTIONS: readonly Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export const hexAdd = (a: Hex, b: Hex): Hex => ({ q: a.q + b.q, r: a.r + b.r });

export const hexEquals = (a: Hex, b: Hex): boolean => a.q === b.q && a.r === b.r;

export const hexKey = (h: Hex): string => `${h.q},${h.r}`;

export const hexNeighbors = (h: Hex): Hex[] => HEX_DIRECTIONS.map((d) => hexAdd(h, d));

/** Rotate around the origin by `steps` * 60 degrees. */
export function hexRotate(h: Hex, steps: number): Hex {
  let { q, r } = h;
  for (let i = 0; i < ((steps % 6) + 6) % 6; i++) {
    [q, r] = [-r, q + r];
  }
  return { q, r };
}

export function hexDistance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

/** All hexes within `radius` of the origin, forming a hexagonal board. */
export function hexagonalBoard(radius: number): Hex[] {
  const hexes: Hex[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
      hexes.push({ q, r });
    }
  }
  return hexes;
}
