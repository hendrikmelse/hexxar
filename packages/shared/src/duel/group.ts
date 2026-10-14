import { hexFlipHorizontal, hexFlipVertical, hexRotate, type Hex } from '../hex.js';
import type { Rng } from '../rng.js';
import {
  hexToPoint,
  pointToHex,
  type Blueprint,
  type Chamber,
  type Corridor,
  type Point,
} from '../royale/blueprint.js';
import {
  assignWidths,
  blocked,
  bridgeLengths,
  distance,
  SPAWN_GAP,
  SPAWN_START_RADIUS,
} from '../royale/archetypes/common.js';
import { hexImage, mirrorFrame, pointImage, rotatePoint, type DuelAxis } from './symmetry.js';

const EPSILON = 1e-6;

/** Chance that a set of extra blobs sits on a mirror line, and that there is a blob at the middle. */
export const ON_AXIS_CHANCE = 0.4;
/**
 * Chance that blobs on the same mirror line may be joined to each other. Such a corridor runs dead
 * straight along the line, so it is allowed on only some boards.
 */
export const SPINE_CHANCE = 0.3;
/**
 * How many sets of extra blobs a board gets when it is not told: `round(2 × radius / elements)`, so
 * bigger bowls mean more sets, and a set (one blob for each symmetry) is fewer sets the more
 * symmetries there are. A set is always as many blobs as there are symmetries.
 */
export const EXTRA_SETS_PER_RADIUS = 2;
/** The most rounds of relaxing in each of the two stages. */
const RELAX_ROUNDS = 2000;
/** Each round, every blob moves this share of the way the others push and pull it. */
const RELAX_STEP = 0.5;
/**
 * Two starts are never closer than their two radii plus this much open ground: one typical bridge
 * (the average of the bridge lengths), even though they are not joined to each other. That also
 * keeps their cities, once each is snapped to a hex, at least 3 hexes apart.
 */
const START_BRIDGE = 4;

/**
 * A group of symmetries of a board: everything that can be done to it (turn it, mirror it) that
 * leaves it as it was. Fair boards for as many players as the group has elements are all built the
 * same way, whatever the group is, from this description of it.
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
  /** The direction (length 1) of each mirror line, through the middle. None for turns alone. */
  readonly lines: readonly Point[];
}

export interface GroupBlueprintInput {
  /** The radius of every start bowl, in tiles. This is what sets the size of the board. */
  readonly radius: number;
  /** How many sets of extra blobs; by default `round(2 × radius / elements)`. */
  readonly extraSets?: number;
  readonly rng: Rng;
}

// -- The groups

const IDENTITY = { map: (p: Point): Point => p, mirrors: false };

/** The two ways a two-player board can be symmetric: a mirror, or a half turn. */
export const duelGroup = (symmetry: 'mirror' | 'rotational', axis: DuelAxis): FairGroup =>
  symmetry === 'rotational'
    ? {
        elements: [IDENTITY, { map: (p) => ({ x: -p.x, y: -p.y }), mirrors: false }],
        hexMaps: [(hex) => hexRotate(hex, 3)],
        lines: [],
      }
    : {
        elements: [IDENTITY, { map: pointImage('mirror', axis), mirrors: true }],
        hexMaps: [hexImage('mirror', axis)],
        lines: [mirrorFrame(axis).along],
      };

/** Turns by a third of a turn, and nothing else: three players. */
export const TRIO_GROUP: FairGroup = {
  elements: [0, 1, 2].map((k) => ({ map: (p: Point) => rotatePoint(p, 2 * k), mirrors: false })),
  hexMaps: [1, 2].map((k) => (hex: Hex) => hexRotate(hex, 2 * k)),
  lines: [],
};

/** Two mirrors at right angles, and the half turn they make together: four players. */
export const QUAD_GROUP: FairGroup = {
  elements: [
    IDENTITY,
    { map: (p) => ({ x: -p.x, y: p.y }), mirrors: true },
    { map: (p) => ({ x: p.x, y: -p.y }), mirrors: true },
    { map: (p) => ({ x: -p.x, y: -p.y }), mirrors: false },
  ],
  hexMaps: [hexFlipHorizontal, hexFlipVertical, (hex) => hexRotate(hex, 3)],
  lines: [
    { x: 0, y: 1 },
    { x: 1, y: 0 },
  ],
};

/** Turns by a sixth of a turn, and nothing else: six players. */
export const SIXFOLD_GROUP: FairGroup = {
  elements: Array.from({ length: 6 }, (_, k) => ({
    map: (p: Point) => rotatePoint(p, k),
    mirrors: false,
  })),
  hexMaps: [1, 2, 3, 4, 5].map((k) => (hex: Hex) => hexRotate(hex, k)),
  lines: [],
};

/**
 * Turns by a third of a turn and a mirror (so three mirror lines, 60 degrees apart): six players.
 * On a hex grid the three lines are all of one kind: through tile corners, or through the middles
 * of tile edges, as `axis` says.
 */
export function mirroredThirdsGroup(axis: DuelAxis): FairGroup {
  const mirror = pointImage('mirror', axis);
  const hexMirror = hexImage('mirror', axis);
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
    lines: thirds.map((k) => ({
      x: Math.cos(lineAngle + k * (Math.PI / 3)),
      y: Math.sin(lineAngle + k * (Math.PI / 3)),
    })),
  };
}

/** The two ways a board for six players can be symmetric. */
export type SextetSymmetry = 'rotational' | 'mirror';

/**
 * The group of a board for six players: turns by a sixth of a turn (`rotational`), or turns by a
 * third of a turn together with a mirror (`mirror`, whose lines are the kind `axis` says).
 */
export const sextetGroup = (symmetry: SextetSymmetry, axis: DuelAxis): FairGroup =>
  symmetry === 'rotational' ? SIXFOLD_GROUP : mirroredThirdsGroup(axis);

// -- The blobs

/** One blob that stands for all its images under the group (its orbit). */
interface Rep {
  /** Free to move anywhere; kept on a mirror line; or fixed at the middle. */
  readonly kind: 'free' | 'line' | 'middle';
  /** The direction of the line, for a blob kept on one. */
  readonly direction: Point | null;
  readonly radius: number;
  readonly spawn: boolean;
  point: Point;
}

const inDisc = (rng: Rng, radius: number): Point => {
  const angle = rng.next() * Math.PI * 2;
  const out = radius * Math.sqrt(rng.next());
  return { x: Math.cos(angle) * out, y: Math.sin(angle) * out };
};

/** A way to join two blobs: the corridors are all its copies under the group. */
interface EdgeOrbit {
  /** The first corridor and its copies, as indexes of blobs, with whether the copy is mirrored. */
  readonly copies: readonly { a: number; b: number; mirrors: boolean }[];
  /** True if the group maps the corridor onto itself, so it has to run straight. */
  readonly selfImage: boolean;
}

/**
 * A layout of blobs and corridors that maps onto itself under every element of `group`, built the
 * way a battle royale layout is, but symmetrically: only one blob of each set is placed, and its
 * images follow it, so everything that moves, moves in step.
 *
 * 1. **The blobs.** One start blob (and, once the group has moved it, a start for every player), a
 *    blob at the middle some of the time, and sets of extra blobs, some of them on a mirror line.
 *    All start inside a disc of radius 4 and are pushed apart until every pair is
 *    `2 × (the two radii) + 1.4` apart.
 * 2. **The joining.** A minimum spanning structure, shortest corridors first, over those far apart
 *    blobs, in whole sets of copies: so any blob on a line or at the middle, or a corridor to an
 *    image, joins the parts of the board together where it has to.
 * 3. **The pulling together.** Every corridor gets a target length (a bridge of about 4 tiles of
 *    open ground, mostly 3 to 5), and the blobs are pulled in along the corridors to those lengths,
 *    while blobs that are not joined are kept at least `radii + 1.4` apart.
 * 4. **The loops and the widths.** A few extra short corridors for loops, and then every
 *    corridor's width, a fixed set that is balanced to keep the area the bridges cover steady.
 *
 * The first `elements.length` chambers are the starts, in the order of the group's elements.
 */
export function buildGroupBlueprint(
  group: FairGroup,
  { radius, extraSets: wantedSets, rng }: GroupBlueprintInput,
): { blueprint: Blueprint; starts: Hex[] } {
  const { elements } = group;

  // -- 1. The blobs
  const reps: Rep[] = [
    { kind: 'free', direction: null, radius, spawn: true, point: inDisc(rng, SPAWN_START_RADIUS) },
  ];
  if (rng.next() < ON_AXIS_CHANCE) {
    reps.push({
      kind: 'middle',
      direction: null,
      radius: radius * (0.8 + rng.next() * 0.3),
      spawn: false,
      point: { x: 0, y: 0 },
    });
  }
  const extraSets = wantedSets ?? Math.round((EXTRA_SETS_PER_RADIUS * radius) / elements.length);
  for (let set = 0; set < extraSets; set++) {
    const blobRadius = radius * (0.8 + rng.next() * 0.45);
    if (group.lines.length > 0 && rng.next() < ON_AXIS_CHANCE) {
      // A set on the mirror lines: a blob on a line has half as many images as one off the lines,
      // so two of them make up a set, and every set has as many blobs as there are symmetries.
      for (let blob = 0; blob < 2; blob++) {
        const direction = group.lines[rng.int(group.lines.length)]!;
        const along = (rng.next() * 2 - 1) * SPAWN_START_RADIUS;
        reps.push({
          kind: 'line',
          direction,
          radius: blobRadius,
          spawn: false,
          point: { x: direction.x * along, y: direction.y * along },
        });
      }
    } else {
      reps.push({
        kind: 'free',
        direction: null,
        radius: blobRadius,
        spawn: false,
        point: inDisc(rng, SPAWN_START_RADIUS),
      });
    }
  }

  // Every blob the group makes from a rep: one for each element, except that a blob on a line or
  // at the middle is the same blob under several elements.
  const owner: number[] = [];
  const element: number[] = [];
  const first: number[] = [];
  reps.forEach((rep, r) => {
    first.push(owner.length);
    const placed: Point[] = [];
    elements.forEach(({ map }, g) => {
      const image = map(rep.point);
      if (placed.some((other) => distance(image, other) <= EPSILON)) return;
      placed.push(image);
      owner.push(r);
      element.push(g);
    });
  });
  const count = owner.length;
  const positions = (): Point[] => owner.map((r, i) => elements[element[i]!]!.map(reps[r]!.point));
  const radiusOf = (i: number): number => reps[owner[i]!]!.radius;
  /** Where each blob goes under each element (as the index of the blob it lands on). */
  const act: number[][] = [];
  {
    const at = positions();
    for (let i = 0; i < count; i++) {
      const row: number[] = [];
      for (const { map } of elements) {
        const target = map(at[i]!);
        const j = at.findIndex(
          (other, k) => owner[k] === owner[i] && distance(other, target) <= EPSILON,
        );
        row.push(j);
      }
      act.push(row);
    }
  }

  // -- Relaxing: push apart (and, in the second stage, pull along the corridors).
  const relax = (
    spacing: (a: number, b: number) => number,
    springs: readonly { a: number; b: number; target: number }[],
    joined: ReadonlySet<number>,
  ): void => {
    for (let round = 0; round < RELAX_ROUNDS; round++) {
      const at = positions();
      let worst = 0;
      const moves = reps.map((rep, r) => {
        if (rep.kind === 'middle') return null;
        const self = first[r]!;
        const here = at[self]!;
        let x = 0;
        let y = 0;
        for (const { a, b, target } of springs) {
          if (a !== self && b !== self) continue;
          const there = at[a === self ? b : a]!;
          const gap = distance(here, there);
          const error = gap - target;
          worst = Math.max(worst, Math.abs(error));
          const dx = gap === 0 ? 1 : (there.x - here.x) / gap;
          const dy = gap === 0 ? 0 : (there.y - here.y) / gap;
          x += (dx * error) / 4;
          y += (dy * error) / 4;
        }
        for (let j = 0; j < count; j++) {
          if (j === self || joined.has(self * count + j)) continue;
          const there = at[j]!;
          const gap = distance(here, there);
          const need = spacing(self, j);
          if (gap >= need) continue;
          worst = Math.max(worst, need - gap);
          const push = (need - gap) / 2 + 0.01;
          const dx = gap === 0 ? (rep.direction?.x ?? 1) : (there.x - here.x) / gap;
          const dy = gap === 0 ? (rep.direction?.y ?? 0) : (there.y - here.y) / gap;
          x -= dx * push;
          y -= dy * push;
        }
        if (rep.direction) {
          const along = x * rep.direction.x + y * rep.direction.y;
          x = rep.direction.x * along;
          y = rep.direction.y * along;
        }
        return { x, y };
      });
      if (worst < 0.02) return;
      moves.forEach((move, r) => {
        if (!move) return;
        reps[r]!.point = {
          x: reps[r]!.point.x + move.x * RELAX_STEP,
          y: reps[r]!.point.y + move.y * RELAX_STEP,
        };
      });
    }
  };

  const startsBoth = (a: number, b: number): boolean => owner[a] === 0 && owner[b] === 0;
  /** The least distance between two blobs that are not joined by a corridor. */
  const near = (a: number, b: number): number =>
    radiusOf(a) + radiusOf(b) + (startsBoth(a, b) ? START_BRIDGE : SPAWN_GAP);
  // First, far apart: twice the distance the blobs need, plus a gap (and never nearer than they
  // will have to be in the end).
  relax((a, b) => Math.max(2 * (radiusOf(a) + radiusOf(b)) + SPAWN_GAP, near(a, b)), [], new Set());

  // -- 2. The joining
  const far = positions();
  const normalized = (a: number, b: number): number => Math.min(a, b) * count + Math.max(a, b);
  const lineOf = (i: number): number => {
    const p = far[i]!;
    return group.lines.findIndex((d) => Math.abs(p.x * d.y - p.y * d.x) <= EPSILON);
  };
  const onlyStarts = reps.length === 1;
  const spine = rng.next() < SPINE_CHANCE;
  /** Is a corridor between these two blobs one the rules leave out? */
  const ruledOut = (a: number, b: number): boolean => {
    // Starts are only joined through other blobs, unless there are no other blobs.
    if (!onlyStarts && owner[a] === 0 && owner[b] === 0) return true;
    // Two blobs on one mirror line: the corridor would run straight along it.
    if (!spine && group.lines.length > 0) {
      const line = lineOf(a);
      if (line >= 0 && line === lineOf(b)) return true;
    }
    return false;
  };
  const makeOrbit = (a: number, b: number): EdgeOrbit => {
    const copies: { a: number; b: number; mirrors: boolean }[] = [];
    const seen = new Set<number>();
    let selfImage = false;
    elements.forEach(({ mirrors }, g) => {
      const from = act[a]![g]!;
      const to = act[b]![g]!;
      const key = normalized(from, to);
      if (g > 0 && key === normalized(a, b)) selfImage = true;
      if (seen.has(key)) return;
      seen.add(key);
      copies.push({ a: from, b: to, mirrors });
    });
    return { copies, selfImage };
  };
  const orbitKey = (orbit: EdgeOrbit): number =>
    Math.min(...orbit.copies.map((copy) => normalized(copy.a, copy.b)));

  const farChambers = (): Chamber[] =>
    far.map((center, i) => ({ center, radius: radiusOf(i), spawn: owner[i] === 0 }));
  const farBlobs = farChambers();
  const candidates: { orbit: EdgeOrbit; length: number; blocked: boolean; ruledOut: boolean }[] =
    [];
  const known = new Set<number>();
  for (let a = 0; a < count; a++) {
    for (let b = a + 1; b < count; b++) {
      const orbit = makeOrbit(a, b);
      const key = orbitKey(orbit);
      if (known.has(key)) continue;
      known.add(key);
      candidates.push({
        orbit,
        length: distance(far[a]!, far[b]!),
        blocked: blocked(farBlobs, a, b),
        ruledOut: ruledOut(a, b),
      });
    }
  }
  candidates.sort((x, y) => x.length - y.length);

  const parent = Array.from({ length: count }, (_, i) => i);
  const find = (i: number): number => {
    if (parent[i] !== i) parent[i] = find(parent[i]!);
    return parent[i]!;
  };
  let pieces = count;
  const tree: EdgeOrbit[] = [];
  const inTree = new Set<number>();
  for (const [useBlocked, useRules] of [
    [false, true],
    [true, true],
    [true, false],
  ] as const) {
    for (const candidate of candidates) {
      if (pieces === 1) break;
      if (candidate.blocked && !useBlocked) continue;
      if (candidate.ruledOut && useRules) continue;
      const key = orbitKey(candidate.orbit);
      if (inTree.has(key)) continue;
      // Add it (with all its copies) if some copy joins two pieces.
      if (!candidate.orbit.copies.some((copy) => find(copy.a) !== find(copy.b))) continue;
      for (const copy of candidate.orbit.copies) {
        if (find(copy.a) !== find(copy.b)) {
          parent[find(copy.a)] = find(copy.b);
          pieces--;
        }
      }
      tree.push(candidate.orbit);
      inTree.add(key);
    }
  }

  // -- 3. The pulling together
  const bridges = bridgeLengths(tree.length, rng);
  const springs = tree.flatMap((orbit, k) =>
    orbit.copies.map(({ a, b }) => ({
      a,
      b,
      target: radiusOf(a) + radiusOf(b) + bridges[k]!,
    })),
  );
  const joined = new Set<number>();
  for (const { a, b } of springs) {
    joined.add(a * count + b);
    joined.add(b * count + a);
  }
  relax(near, springs, joined);
  // The corridors of a symmetric board can ask for lengths that cannot all be had at once (they
  // form loops through the copies). The spacing is the hard rule: push apart whatever is too close,
  // with no corridors pulling, so no two blobs end up on top of each other.
  relax(near, [], joined);

  // Each start is snapped to a hex, so its city is exactly on a hex center; the others follow.
  const startHex = pointToHex(reps[0]!.point);
  const starts = [startHex, ...group.hexMaps.map((map) => map(startHex))];
  const final = positions();
  const chambers: Chamber[] = final.map((center, i) => ({
    center: owner[i] === 0 ? hexToPoint(starts[element[i]!]!) : center,
    radius: radiusOf(i),
    spawn: owner[i] === 0,
  }));

  // -- 4. The loops and the widths
  const lengthOf = (orbit: EdgeOrbit): number =>
    distance(chambers[orbit.copies[0]!.a]!.center, chambers[orbit.copies[0]!.b]!.center);
  const treeLengths = tree.map(lengthOf).sort((x, y) => x - y);
  const reach = 1.4 * (treeLengths[Math.floor(treeLengths.length / 2)] ?? 0);
  const extras: { orbit: EdgeOrbit; length: number; tie: number }[] = [];
  const knownLoops = new Set<number>(inTree);
  for (let a = 0; a < count; a++) {
    for (let b = a + 1; b < count; b++) {
      const orbit = makeOrbit(a, b);
      const key = orbitKey(orbit);
      if (knownLoops.has(key)) continue;
      knownLoops.add(key);
      const length = distance(chambers[a]!.center, chambers[b]!.center);
      if (length > reach || ruledOut(a, b) || blocked(chambers, a, b)) continue;
      extras.push({ orbit, length, tie: rng.next() });
    }
  }
  extras.sort((x, y) => x.length - y.length || x.tie - y.tie);
  const loops: EdgeOrbit[] = [];
  let loopCorridors = 0;
  const wanted = Math.round(count * 0.3);
  for (const { orbit } of extras) {
    if (loopCorridors >= wanted) break;
    loops.push(orbit);
    loopCorridors += orbit.copies.length;
  }

  const all = [...tree, ...loops];
  const bridgeOf = (orbit: EdgeOrbit): number =>
    Math.max(
      0,
      lengthOf(orbit) - chambers[orbit.copies[0]!.a]!.radius - chambers[orbit.copies[0]!.b]!.radius,
    );
  const widths = assignWidths(
    all.map(bridgeOf),
    rng,
    all.map((orbit) => orbit.copies.length),
  );
  const corridors: Corridor[] = all.flatMap((orbit, k) => {
    const length = lengthOf(orbit);
    const bend = orbit.selfImage ? 0 : (rng.next() - 0.5) * 0.3 * length;
    return orbit.copies.map(({ a, b, mirrors }) => ({
      from: a,
      to: b,
      width: widths[k]!,
      bend: mirrors ? -bend : bend,
    }));
  });
  return { blueprint: { chambers, corridors }, starts };
}
