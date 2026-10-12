/** Seeded 2D noise, roughly in [-1, 1]. */
export type Noise = (x: number, y: number) => number;

/** A repeatable pseudo-random number in [0, 1) for a lattice point. */
function hash(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Smooth value noise: random values on a unit lattice, blended between lattice points. */
export function createNoise(seed: number): Noise {
  return (x, y) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = smooth(x - x0);
    const ty = smooth(y - y0);
    const a = hash(x0, y0, seed);
    const b = hash(x0 + 1, y0, seed);
    const c = hash(x0, y0 + 1, seed);
    const d = hash(x0 + 1, y0 + 1, seed);
    const top = a + (b - a) * tx;
    const bottom = c + (d - c) * tx;
    return (top + (bottom - top) * ty) * 2 - 1;
  };
}

/** Two octaves of noise, the second at twice the detail and half the weight. */
export function fbm(noise: Noise, x: number, y: number): number {
  return (noise(x, y) + 0.5 * noise(x * 2 + 17.3, y * 2 - 9.1)) / 1.5;
}
