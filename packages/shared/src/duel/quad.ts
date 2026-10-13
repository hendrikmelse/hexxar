import { hexDistance, hexFlipHorizontal, hexFlipVertical, hexRotate } from '../hex.js';
import type { Rng } from '../rng.js';
import {
  hexToPoint,
  pointToHex,
  type Blueprint,
  type Chamber,
  type Corridor,
  type Point,
} from '../royale/blueprint.js';
import { blocked, distance } from '../royale/archetypes/common.js';
import {
  between,
  blobRadius,
  CORRIDOR_WIDTHS,
  CROSSOVERS,
  GAP,
  ON_AXIS_CHANCE,
  pickWeighted,
  PLACE_TRIES,
  SPINE_CHANCE,
} from './common.js';

/**
 * How many sets of extra blobs a board of this size gets. A set is four blobs (one in each
 * quarter of the board), two if it sits on one of the two mirror lines, or the one blob at the
 * middle, so there are fewer sets than a duel board has pairs.
 */
const extraSets = (size: number): number => Math.max(1, Math.round(size / 5));
/**
 * Boards smaller than this (a radius, in tiles) may have nothing but the four starts. Bigger ones
 * must have another blob, or the layout is stretched until one fits.
 */
const SMALL_SIZE = 5;
const EPSILON = 1e-6;

/**
 * The four things a board can be done to that leave it as it was: nothing, a mirror across the
 * vertical line, a mirror across the horizontal line, and both (a half turn). A mirror turns a
 * corridor's bend the other way round; a half turn leaves it as it is.
 */
const ELEMENTS: readonly { map: (p: Point) => Point; mirrors: boolean }[] = [
  { map: (p) => p, mirrors: false },
  { map: (p) => ({ x: -p.x, y: p.y }), mirrors: true },
  { map: (p) => ({ x: p.x, y: -p.y }), mirrors: true },
  { map: (p) => ({ x: -p.x, y: -p.y }), mirrors: false },
];
const HEX_ELEMENTS = [
  hexFlipHorizontal,
  hexFlipVertical,
  (hex: { q: number; r: number }) => hexRotate(hex, 3),
];

export interface QuadBlueprintInput {
  /**
   * Roughly the radius of a board with the wanted number of tiles. It decides how big the blobs
   * are and how many there are, so those stay the same as the layout is stretched to fit.
   */
  readonly size: number;
  /** How far apart the blobs are spread, in tiles: around `size`, and adjusted to get the area right. */
  readonly scale: number;
  readonly rng: Rng;
  /** The four starting cities are at least this many tiles apart. */
  readonly minCityDistance: number;
}

/**
 * A layout of blobs and corridors that maps onto itself under two mirrors at right angles (and
 * the half turn they make together): a starting blob in each quarter of the board (chambers 0 to
 * 3: the first, then its mirror image across the vertical line, across the horizontal line, and
 * through the middle), sets of extra blobs, some on one of the two lines (two blobs) and some off
 * them (four), and perhaps one blob at the middle.
 *
 * Corridors are made for one quarter of the board (with the blobs on the lines at its edges) and
 * copied into the others: a spanning tree and loops over that quarter, then crossovers into the
 * neighboring quarters.
 */
export function buildQuadBlueprint({
  size,
  scale,
  rng,
  minCityDistance,
}: QuadBlueprintInput): Blueprint | null {
  const radius = blobRadius(size);
  const chambers: Chamber[] = [];

  /** Add a blob and every place the mirrors put it (one, two or four, without repeats). */
  const addBlob = (center: Point, blobSize: number, spawn: boolean): void => {
    const placed: Point[] = [];
    for (const { map } of ELEMENTS) {
      const image = map(center);
      if (placed.every((other) => distance(image, other) > EPSILON)) placed.push(image);
    }
    for (const placedCenter of placed) {
      chambers.push({ center: placedCenter, radius: blobSize, spawn });
    }
  };
  const room = (center: Point, blobSize: number): boolean => {
    // Room for the blob and its images: the existing blobs map onto themselves, so room for this
    // one is room for them all, as long as the images are clear of one another.
    const images = ELEMENTS.map(({ map }) => map(center));
    const clearOfBlobs = chambers.every(
      (other) => distance(center, other.center) >= blobSize + other.radius + GAP,
    );
    const clearOfImages = images.every(
      (image, i) =>
        i === 0 ||
        distance(center, image) <= EPSILON ||
        distance(center, image) >= 2 * blobSize + GAP,
    );
    return clearOfBlobs && clearOfImages;
  };

  // A blob at the middle is decided first, because it needs room between the four starts: they
  // are put far enough out for it to fit.
  const middleSize = rng.next() < ON_AXIS_CHANCE ? radius * between(rng, 0.8, 1.1) : null;
  const leastOut = middleSize === null ? 0 : middleSize + radius + GAP + 0.3;

  // The starting blob, in one quarter and snapped to a hex so its city is exactly on a hex center.
  // The other three are its mirror images.
  const least = radius + GAP / 2 + 0.2;
  let started = false;
  for (let attempt = 0; attempt < 50 && !started; attempt++) {
    const x = Math.max(least, scale * between(rng, 0.3, 0.85));
    const y = Math.max(least, scale * between(rng, 0.3, 0.85));
    const out = Math.hypot(x, y);
    const stretch = out < leastOut ? leastOut / out : 1;
    const hex = pointToHex({ x: x * stretch, y: y * stretch });
    const center = hexToPoint(hex);
    // In a quarter of its own, a good way from each of the others.
    if (center.x < least || center.y < least) continue;
    if (HEX_ELEMENTS.some((image) => hexDistance(hex, image(hex)) < minCityDistance)) continue;
    if (!room(center, radius)) continue;
    addBlob(center, radius, true);
    started = true;
  }
  if (!started || chambers.length !== 4) return null;
  if (middleSize !== null) addBlob({ x: 0, y: 0 }, middleSize, false);

  // Extra sets of blobs: on the vertical line, on the horizontal line, or off them (in a quarter).
  for (let set = 0; set < extraSets(size); set++) {
    const blobSize = radius * between(rng, 0.8, 1.25);
    for (let attempt = 0; attempt < PLACE_TRIES; attempt++) {
      const kind = rng.next();
      let center: Point;
      if (kind < ON_AXIS_CHANCE / 2) {
        center = { x: 0, y: scale * between(rng, 0.2, 1.1) };
      } else if (kind < ON_AXIS_CHANCE) {
        center = { x: scale * between(rng, 0.2, 1.1), y: 0 };
      } else {
        center = { x: scale * 1.2 * Math.sqrt(rng.next()), y: scale * 1.2 * Math.sqrt(rng.next()) };
      }
      if (!room(center, blobSize)) continue;
      addBlob(center, blobSize, false);
      break;
    }
  }
  if (chambers.length === 4 && size >= SMALL_SIZE) return null;

  // Where each chamber goes under each of the four things done to the board.
  const act: number[][] = [];
  for (const chamber of chambers) {
    const row: number[] = [];
    for (const { map } of ELEMENTS) {
      const target = map(chamber.center);
      const j = chambers.findIndex(
        (other) => distance(other.center, target) <= EPSILON && other.radius === chamber.radius,
      );
      if (j < 0) return null;
      row.push(j);
    }
    act.push(row);
  }

  // -- Corridors. Every one is added together with its images, so the layout maps onto itself.
  const corridors: Corridor[] = [];
  const keyOf = (a: number, b: number): number => Math.min(a, b) * 1000 + Math.max(a, b);
  const linked = new Set<number>();
  const parent = chambers.map((_, i) => i);
  const find = (i: number): number => {
    if (parent[i] !== i) parent[i] = find(parent[i]!);
    return parent[i]!;
  };
  const components = (): number => new Set(chambers.map((_, i) => find(i))).size;
  const addEdge = (a: number, b: number): void => {
    const length = distance(chambers[a]!.center, chambers[b]!.center);
    const width = pickWeighted(rng, CORRIDOR_WIDTHS);
    const copies = ELEMENTS.map(({ mirrors }, g) => ({
      from: act[a]![g]!,
      to: act[b]![g]!,
      mirrors,
    }));
    // A corridor that is its own image under one of the mirrors has to run straight.
    const selfImage = copies.some(
      (copy, g) => g > 0 && keyOf(copy.from, copy.to) === keyOf(copies[0]!.from, copies[0]!.to),
    );
    const bend = selfImage ? 0 : (rng.next() - 0.5) * 0.3 * length;
    for (const { from, to, mirrors } of copies) {
      if (linked.has(keyOf(from, to))) continue;
      corridors.push({ from, to, width, bend: mirrors ? -bend : bend });
      linked.add(keyOf(from, to));
      parent[find(from)] = find(to);
    }
  };

  // The four starts are never joined by a corridor of their own, unless they are the only blobs:
  // then there is no other way to join them.
  const onlyStarts = chambers.length === 4;
  const betweenStarts = (a: number, b: number): boolean =>
    !onlyStarts && chambers[a]!.spawn && chambers[b]!.spawn;
  // Blobs on the same mirror line: a corridor between them runs dead straight along the line, so
  // it is allowed on only some boards.
  const spine = rng.next() < SPINE_CHANCE;
  const onLine = (a: number, b: number): boolean => {
    const [p, q] = [chambers[a]!.center, chambers[b]!.center];
    return (
      (Math.abs(p.x) <= EPSILON && Math.abs(q.x) <= EPSILON) ||
      (Math.abs(p.y) <= EPSILON && Math.abs(q.y) <= EPSILON)
    );
  };
  // Lengths are shaken up a little, so the nearest blob is not always the one that gets joined.
  const shaken = (a: number, b: number): number =>
    distance(chambers[a]!.center, chambers[b]!.center) * between(rng, 0.8, 1.3);

  // One quarter of the board: one blob from each set, and the blobs on the lines at its edges,
  // joined by a spanning tree (first without corridors that run through another blob, then, if
  // need be, with them), and a few more short corridors for loops.
  const quarter = chambers
    .map((_, i) => i)
    .filter((i) => chambers[i]!.center.x >= -EPSILON && chambers[i]!.center.y >= -EPSILON);
  const pairs: { a: number; b: number; weight: number }[] = [];
  for (const [n, a] of quarter.entries()) {
    for (const b of quarter.slice(n + 1)) {
      if (!spine && onLine(a, b)) continue;
      pairs.push({ a, b, weight: shaken(a, b) });
    }
  }
  pairs.sort((x, y) => x.weight - y.weight);
  const quarterParent = new Map(quarter.map((i) => [i, i]));
  const quarterFind = (i: number): number => {
    const up = quarterParent.get(i)!;
    if (up === i) return i;
    const root = quarterFind(up);
    quarterParent.set(i, root);
    return root;
  };
  const chosen: { a: number; b: number }[] = [];
  for (const allowBlocked of [false, true]) {
    for (const { a, b } of pairs) {
      if (!allowBlocked && blocked(chambers, a, b)) continue;
      if (quarterFind(a) === quarterFind(b)) continue;
      quarterParent.set(quarterFind(a), quarterFind(b));
      chosen.push({ a, b });
    }
    if (new Set(quarter.map(quarterFind)).size === 1) break;
  }
  if (new Set(quarter.map(quarterFind)).size !== 1) return null;
  const isChosen = new Set(chosen.map(({ a, b }) => keyOf(a, b)));
  const loops = pairs.filter(({ a, b }) => !isChosen.has(keyOf(a, b)) && !blocked(chambers, a, b));
  for (const pair of loops.slice(0, Math.round(quarter.length * 0.35))) chosen.push(pair);
  for (const { a, b } of chosen) addEdge(a, b);

  // Crossovers: corridors from a blob in this quarter to an image of a blob in another. If the
  // quarters are not already joined (through blobs on the lines, or the middle one), enough have to
  // cross over to join them; after that, a random number more do (none is the most likely).
  const across: { a: number; b: number; weight: number }[] = [];
  for (const a of quarter) {
    for (const b of quarter) {
      for (const g of [1, 2, 3]) {
        const target = act[b]![g]!;
        if (target === a || target === b || betweenStarts(a, target)) continue;
        if (!spine && onLine(a, target)) continue;
        across.push({ a, b: target, weight: shaken(a, target) });
      }
    }
  }
  across.sort((x, y) => x.weight - y.weight);
  let extraCrossovers = pickWeighted(rng, CROSSOVERS);
  for (const allowBlocked of [false, true]) {
    for (const { a, b } of across) {
      const needed = components() !== 1;
      if (!needed && extraCrossovers === 0) break;
      // Only one that has to cross over may run through another blob.
      if (allowBlocked && !needed) break;
      if (!allowBlocked && blocked(chambers, a, b)) continue;
      if (linked.has(keyOf(a, b))) continue;
      addEdge(a, b);
      if (!needed) extraCrossovers--;
    }
  }
  if (components() !== 1) return null;
  return { chambers, corridors };
}
