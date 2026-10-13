import { hexDistance, hexFlipHorizontal, hexFlipVertical, hexRotate, type Hex } from '../hex.js';
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
import { hexImage, pointImage, rotatePoint, type DuelAxis } from './symmetry.js';

const EPSILON = 1e-6;
/**
 * Boards smaller than this (a radius, in tiles) may have nothing but the starts. Bigger ones must
 * have another blob, or the layout is stretched until one fits.
 */
const SMALL_SIZE = 5;

/**
 * A group of symmetries of a board: everything that can be done to it (turn it, mirror it) that
 * leaves it as it was. The blueprint of a fair board for as many players as the group has elements
 * is built the same way whatever the group is, from this description of it.
 */
export interface FairGroup {
  /**
   * Every element of the group, the one that does nothing first. The starting blobs are the first
   * start moved by each element, in this order. A mirror turns a corridor's bend the other way
   * round; a turn leaves it as it is.
   */
  readonly elements: readonly { map: (point: Point) => Point; mirrors: boolean }[];
  /** The same elements (without the one that does nothing) on hexes, in the same order. */
  readonly hexMaps: readonly ((hex: Hex) => Hex)[];
  /** Is this point in the part of the board that has exactly one blob from each set? */
  readonly inDomain: (point: Point) => boolean;
  /** A random place for the first start, in that part, for a board of this scale. */
  readonly startCandidate: (rng: Rng, scale: number, radius: number) => Point;
  /** A random place for a set of extra blobs: on a mirror line or not. */
  readonly extraCandidate: (rng: Rng, scale: number) => Point;
  /** Do both points lie on one mirror line (so a corridor between them runs dead straight)? */
  readonly alongLine: (p: Point, q: Point) => boolean;
  /** How many sets of extra blobs a board of this size gets. */
  readonly extraSets: (size: number) => number;
}

export interface GroupBlueprintInput {
  /**
   * Roughly the radius of a board with the wanted number of tiles. It decides how big the blobs
   * are and how many there are, so those stay the same as the layout is stretched to fit.
   */
  readonly size: number;
  /** How far apart the blobs are spread, in tiles: around `size`, and adjusted to get the area right. */
  readonly scale: number;
  readonly rng: Rng;
  /** The starting cities are at least this many tiles apart. */
  readonly minCityDistance: number;
}

const angleOf = (p: Point): number => Math.atan2(p.y, p.x);
const normalized = (angle: number): number => {
  const turn = Math.PI * 2;
  return ((angle % turn) + turn) % turn;
};
const inDisc = (rng: Rng, radius: number): Point => {
  const angle = rng.next() * Math.PI * 2;
  const out = radius * Math.sqrt(rng.next());
  return { x: Math.cos(angle) * out, y: Math.sin(angle) * out };
};

// -- The groups

/** Two mirrors at right angles, and the half turn they make together: four players. */
export const QUAD_GROUP: FairGroup = {
  elements: [
    { map: (p) => p, mirrors: false },
    { map: (p) => ({ x: -p.x, y: p.y }), mirrors: true },
    { map: (p) => ({ x: p.x, y: -p.y }), mirrors: true },
    { map: (p) => ({ x: -p.x, y: -p.y }), mirrors: false },
  ],
  hexMaps: [hexFlipHorizontal, hexFlipVertical, (hex) => hexRotate(hex, 3)],
  inDomain: (p) => p.x >= -EPSILON && p.y >= -EPSILON,
  startCandidate: (rng, scale, radius) => {
    const least = radius + GAP / 2 + 0.2;
    return {
      x: Math.max(least, scale * between(rng, 0.3, 0.85)),
      y: Math.max(least, scale * between(rng, 0.3, 0.85)),
    };
  },
  extraCandidate: (rng, scale) => {
    const kind = rng.next();
    if (kind < ON_AXIS_CHANCE / 2) return { x: 0, y: scale * between(rng, 0.2, 1.1) };
    if (kind < ON_AXIS_CHANCE) return { x: scale * between(rng, 0.2, 1.1), y: 0 };
    return { x: scale * 1.2 * Math.sqrt(rng.next()), y: scale * 1.2 * Math.sqrt(rng.next()) };
  },
  alongLine: (p, q) =>
    (Math.abs(p.x) <= EPSILON && Math.abs(q.x) <= EPSILON) ||
    (Math.abs(p.y) <= EPSILON && Math.abs(q.y) <= EPSILON),
  extraSets: (size) => Math.max(1, Math.round(size / 5)),
};

/** Turns by a sixth of a turn, and nothing else: six players. */
export const SIXFOLD_GROUP: FairGroup = {
  elements: Array.from({ length: 6 }, (_, k) => ({
    map: (p: Point) => rotatePoint(p, k),
    mirrors: false,
  })),
  hexMaps: [1, 2, 3, 4, 5].map((k) => (hex: Hex) => hexRotate(hex, k)),
  // One sixth of the board, from the line to the right (counted in) to the next one (not), and the
  // middle, which has no angle. The tiny shift keeps a blob that lies exactly on the first line in,
  // whatever rounding does to it.
  inDomain: (p) =>
    Math.hypot(p.x, p.y) <= EPSILON || normalized(angleOf(p) + EPSILON) < Math.PI / 3,
  startCandidate: (rng, scale) => {
    const angle = between(rng, 0.15, 0.85) * (Math.PI / 3);
    const out = scale * between(rng, 0.5, 0.85);
    return { x: Math.cos(angle) * out, y: Math.sin(angle) * out };
  },
  extraCandidate: (rng, scale) => inDisc(rng, scale * 1.2),
  alongLine: () => false,
  extraSets: (size) => Math.max(1, Math.round(size / 9)),
};

/**
 * Turns by a third of a turn and a mirror (so three mirror lines, 60 degrees apart): six players.
 * On a hex grid the three lines are all of one kind: through tile corners, or through the middles
 * of tile edges, as `axis` says.
 */
export function mirroredThirdsGroup(axis: DuelAxis): FairGroup {
  const mirror = pointImage('mirror', axis);
  const hexMirror = hexImage('mirror', axis);
  /** The direction of the first mirror line (down for corners, 60 degrees for edges). */
  const lineAngle = axis === 'points' ? Math.PI / 2 : Math.PI / 3;
  const thirds = [0, 1, 2];
  return {
    elements: [
      ...thirds.map((k) => ({ map: (p: Point) => rotatePoint(p, 2 * k), mirrors: false })),
      ...thirds.map((k) => ({
        map: (p: Point) => mirror(rotatePoint(p, 2 * k)),
        mirrors: true,
      })),
    ],
    hexMaps: [
      ...[1, 2].map((k) => (hex: Hex) => hexRotate(hex, 2 * k)),
      ...thirds.map((k) => (hex: Hex) => hexMirror(hexRotate(hex, 2 * k))),
    ],
    // The sixth of the board between one mirror line and the next, both lines counted in, and the
    // middle, which has no angle. The tiny shift keeps a blob on the first line in, whatever
    // rounding does to it.
    inDomain: (p) =>
      Math.hypot(p.x, p.y) <= EPSILON ||
      normalized(angleOf(p) - lineAngle + EPSILON) <= Math.PI / 3 + 2 * EPSILON,
    startCandidate: (rng, scale) => {
      const angle = lineAngle + between(rng, 0.15, 0.85) * (Math.PI / 3);
      const out = scale * between(rng, 0.5, 0.85);
      return { x: Math.cos(angle) * out, y: Math.sin(angle) * out };
    },
    extraCandidate: (rng, scale) => {
      if (rng.next() < ON_AXIS_CHANCE) {
        // On one of the three lines, on either side of the middle.
        const angle = lineAngle + rng.int(3) * (Math.PI / 3);
        const out = scale * between(rng, 0.2, 1.1) * (rng.next() < 0.5 ? 1 : -1);
        return { x: Math.cos(angle) * out, y: Math.sin(angle) * out };
      }
      return inDisc(rng, scale * 1.2);
    },
    alongLine: (p, q) =>
      [0, 1, 2].some((k) => {
        const angle = lineAngle + k * (Math.PI / 3);
        const off = (point: Point): number =>
          Math.abs(point.x * Math.sin(angle) - point.y * Math.cos(angle));
        return off(p) <= EPSILON && off(q) <= EPSILON;
      }),
    extraSets: (size) => Math.max(1, Math.round(size / 9)),
  };
}

/**
 * A layout of blobs and corridors that maps onto itself under every element of `group`: a starting
 * blob for each element (chambers 0 to the group's size minus one: the first start, then its image
 * under each element), sets of extra blobs (as many blobs as the group has elements, or fewer if the
 * set sits on a mirror line), and perhaps one blob at the middle, which every element leaves in place.
 *
 * Corridors are made for the part of the board that has one blob from each set (the domain), and
 * copied by every element into the rest: a spanning tree and loops over the domain, then crossovers
 * from it into the other parts. The starts are never joined by a corridor of their own unless they
 * are the only blobs, and a corridor that would run dead straight along a mirror line is allowed on
 * only some boards.
 */
export function buildGroupBlueprint(
  group: FairGroup,
  { size, scale, rng, minCityDistance }: GroupBlueprintInput,
): Blueprint | null {
  const { elements } = group;
  const radius = blobRadius(size);
  const chambers: Chamber[] = [];

  /** Add a blob and every place the group puts it (without repeats). */
  const addBlob = (center: Point, blobSize: number, spawn: boolean): void => {
    const placed: Point[] = [];
    for (const { map } of elements) {
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
    const clearOfBlobs = chambers.every(
      (other) => distance(center, other.center) >= blobSize + other.radius + GAP,
    );
    const clearOfImages = elements.every(({ map }, i) => {
      if (i === 0) return true;
      const gap = distance(center, map(center));
      return gap <= EPSILON || gap >= 2 * blobSize + GAP;
    });
    return clearOfBlobs && clearOfImages;
  };

  // A blob at the middle is decided first, because it needs room between the starts: they are put
  // far enough out for it to fit.
  const middleSize = rng.next() < ON_AXIS_CHANCE ? radius * between(rng, 0.8, 1.1) : null;
  const leastOut = middleSize === null ? 0 : middleSize + radius + GAP + 0.3;

  // The first start, snapped to a hex so its city is exactly on a hex center; the others are its
  // images. If there is not room, the next try is a little further out.
  let started = false;
  for (let attempt = 0; attempt < 50 && !started; attempt++) {
    const candidate = group.startCandidate(rng, scale * (1 + 0.03 * attempt), radius);
    const out = Math.hypot(candidate.x, candidate.y);
    const stretch = out > 0 && out < leastOut ? leastOut / out : 1;
    const hex = pointToHex({ x: candidate.x * stretch, y: candidate.y * stretch });
    const center = hexToPoint(hex);
    if (group.hexMaps.some((image) => hexDistance(hex, image(hex)) < minCityDistance)) continue;
    if (!room(center, radius)) continue;
    addBlob(center, radius, true);
    started = true;
  }
  if (!started || chambers.length !== elements.length) return null;
  if (middleSize !== null) addBlob({ x: 0, y: 0 }, middleSize, false);

  // Extra sets of blobs, wherever they fit.
  for (let set = 0; set < group.extraSets(size); set++) {
    const blobSize = radius * between(rng, 0.8, 1.25);
    for (let attempt = 0; attempt < PLACE_TRIES; attempt++) {
      const center = group.extraCandidate(rng, scale);
      if (!room(center, blobSize)) continue;
      addBlob(center, blobSize, false);
      break;
    }
  }
  if (chambers.length === elements.length && size >= SMALL_SIZE) return null;

  // Where each chamber goes under each element.
  const act: number[][] = [];
  for (const chamber of chambers) {
    const row: number[] = [];
    for (const { map } of elements) {
      const target = map(chamber.center);
      const j = chambers.findIndex(
        (other) => distance(other.center, target) <= EPSILON && other.radius === chamber.radius,
      );
      if (j < 0) return null;
      row.push(j);
    }
    act.push(row);
  }

  // The part of the board with one blob from each set.
  const domain = chambers.map((_, i) => i).filter((i) => group.inDomain(chambers[i]!.center));
  const sets = new Set(act.map((row) => Math.min(...row))).size;
  if (domain.length !== sets) return null;

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
    const copies = elements.map(({ mirrors }, g) => ({
      from: act[a]![g]!,
      to: act[b]![g]!,
      mirrors,
    }));
    // A corridor that is its own image under one of the elements has to run straight.
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

  // The starts are never joined by a corridor of their own, unless they are the only blobs: then
  // there is no other way to join them.
  const onlyStarts = chambers.length === elements.length;
  const betweenStarts = (a: number, b: number): boolean =>
    !onlyStarts && chambers[a]!.spawn && chambers[b]!.spawn;
  // A corridor along a mirror line runs dead straight, so it is allowed on only some boards.
  const spine = rng.next() < SPINE_CHANCE;
  const alongLine = (a: number, b: number): boolean =>
    group.alongLine(chambers[a]!.center, chambers[b]!.center);
  // Lengths are shaken up a little, so the nearest blob is not always the one that gets joined.
  const shaken = (a: number, b: number): number =>
    distance(chambers[a]!.center, chambers[b]!.center) * between(rng, 0.8, 1.3);

  // The domain: joined by a spanning tree (first without corridors that run through another blob,
  // then, if need be, with them), and a few more short corridors for loops.
  const pairs: { a: number; b: number; weight: number }[] = [];
  for (const [n, a] of domain.entries()) {
    for (const b of domain.slice(n + 1)) {
      if (!spine && alongLine(a, b)) continue;
      pairs.push({ a, b, weight: shaken(a, b) });
    }
  }
  pairs.sort((x, y) => x.weight - y.weight);
  const domainParent = new Map(domain.map((i) => [i, i]));
  const domainFind = (i: number): number => {
    const up = domainParent.get(i)!;
    if (up === i) return i;
    const root = domainFind(up);
    domainParent.set(i, root);
    return root;
  };
  const chosen: { a: number; b: number }[] = [];
  for (const allowBlocked of [false, true]) {
    for (const { a, b } of pairs) {
      if (!allowBlocked && blocked(chambers, a, b)) continue;
      if (domainFind(a) === domainFind(b)) continue;
      domainParent.set(domainFind(a), domainFind(b));
      chosen.push({ a, b });
    }
    if (new Set(domain.map(domainFind)).size === 1) break;
  }
  if (new Set(domain.map(domainFind)).size !== 1) return null;
  const isChosen = new Set(chosen.map(({ a, b }) => keyOf(a, b)));
  const loops = pairs.filter(({ a, b }) => !isChosen.has(keyOf(a, b)) && !blocked(chambers, a, b));
  for (const pair of loops.slice(0, Math.round(domain.length * 0.35))) chosen.push(pair);
  for (const { a, b } of chosen) addEdge(a, b);

  // Crossovers: corridors from a blob in the domain to an image of a blob in it, which lies in
  // another part of the board. If the parts are not already joined (through blobs on the lines, or
  // the middle one), enough have to cross over to join them; after that, a random number more do
  // (none is the most likely).
  const across: { a: number; b: number; weight: number }[] = [];
  for (const a of domain) {
    for (const b of domain) {
      for (let g = 1; g < elements.length; g++) {
        const target = act[b]![g]!;
        if (target === a || target === b || betweenStarts(a, target)) continue;
        if (!spine && alongLine(a, target)) continue;
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

/** The two ways a board for six players can be symmetric. */
export type SextetSymmetry = 'rotational' | 'mirror';

/**
 * The group of a board for six players: turns by a sixth of a turn (`rotational`), or turns by a
 * third of a turn together with a mirror (`mirror`, whose lines are the kind `axis` says).
 */
export const sextetGroup = (symmetry: SextetSymmetry, axis: DuelAxis): FairGroup =>
  symmetry === 'rotational' ? SIXFOLD_GROUP : mirroredThirdsGroup(axis);
