# Map generation

This document describes exactly how boards are generated: every step, every number. **It is kept in step with the code. Whenever a generation rule or constant changes, this file changes in the same commit.** Numbers marked "measured" come from running the generators over many seeds and drift when settings change; re-measure them when they do.

## Contents

1. [Overview](#overview)
2. [Shared machinery](#shared-machinery): units, blueprints, drawing onto hexes, noise, tidying
3. [Battle royale boards](#battle-royale-boards): random, no symmetry, any number of players
4. [Fair boards](#fair-boards): symmetric boards for 2, 3, 4 and 6 players
5. [Terrain: cities, villages, farmland](#terrain-cities-villages-farmland)
6. [Settings](#settings)
7. [The map previewer](#the-map-previewer)
8. [Tests](#tests)

## Overview

All the generators live in `packages/shared/src/`. `generate.ts` has the entry points; each returns a `GameState` (the tiles, the players, who owns what), the match config, and a report about how the board was made.

| Function                | Board                                                  | Players                    | Used by rooms?      |
| ----------------------- | ------------------------------------------------------ | -------------------------- | ------------------- |
| `createFreeForAllMatch` | random, no symmetry                                    | 2 or more (rooms: 3 to 12) | yes: battle royale  |
| `createDuelMatch`       | symmetric: mirror or half turn                         | exactly 2                  | yes: duel           |
| `createTrioMatch`       | symmetric under turns of 120°                          | exactly 3                  | no (previewer only) |
| `createQuadMatch`       | symmetric under two mirrors at right angles            | exactly 4                  | no (previewer only) |
| `createSextetMatch`     | symmetric: turns of 60°, or turns of 120° plus mirrors | exactly 6                  | no (previewer only) |

Every board is made the same way, in three stages:

1. **Blueprint:** a layout of round **chambers** ("blobs") joined by **corridors**, in "tile units" (never touching hexes). Battle royale blueprints come from `royale/archetypes/`; fair board blueprints from `duel/`.
2. **Drawing:** the blueprint is drawn onto hexes with noise (`royale/rasterize.ts`) and tidied. Fair boards are also checked against a target size and drawn again until they pass; battle royale boards have no target size and no checks, and are drawn once.
3. **Terrain:** every land tile becomes a city, a village or farmland (`placeTerrain` in `generate.ts`), shared by all five kinds of board.

**Determinism.** Given the same options and seed, a generator always makes the same board. All randomness comes from `createRng(seed)` (`rng.ts`, mulberry32), and from `createNoise(seed)` (`royale/noise.ts`) for the coast. Fair boards are drawn again when a candidate fails; attempt `k` uses the seed `seed + k × 0x9e3779b1` (as an unsigned 32-bit number). Battle royale boards are drawn once, from the seed itself.

**Rooms** (`apps/server/src/room.ts`): a duel room calls `createDuelMatch({ players, seed, tiles: DUEL_TILES[mapSize] })`; a battle royale room calls `createFreeForAllMatch` with `bowlRadius = royaleBowlRadius(mapSize, players)` and nothing else overridden. The seed is random per match. If generation throws, the room tries up to 100 more seeds (`seed + attempt`), for at most 2 seconds; if none works the room is closed with "the game could not be set up, please try again". Players are shuffled before being given ids `P1 … Pn` (so who starts where is random), and board generation then gives the player with id `Pk` the k-th start.

## Shared machinery

### Units

Hexes are pointy-top, in axial coordinates `(q, r)`. Blueprints are drawn in **tile units** where the distance between neighboring hex centers is 1: a hex `(q, r)` is at `x = q + r/2`, `y = r·√3/2` (y points down). `hexToPoint` and `pointToHex` convert (`royale/blueprint.ts`). A corridor 2 wide is 2 hexes wide on any board.

### Blueprints (`royale/blueprint.ts`)

- A **chamber** is a circle: `center`, `radius`, and `spawn` (true for a start chamber, which holds a player's city at its center).
- A **corridor** joins chamber `from` to `to` with a `width` (in hexes) and a `bend`. Its centerline is a polyline of two straight segments `from → middle → to`, where `middle` is the midpoint pushed sideways by `bend` tile units (positive to one side, negative to the other).

### Drawing a blueprint onto hexes (`royale/rasterize.ts`)

`rasterize(blueprint, { noise, coastRoughness, coastDetail, warpStrength, offset })` tests the center of every hex in the blueprint's bounding box (each chamber's circle, plus a margin of `warpStrength + coastRoughness + 2`):

1. **Corridor core:** if the point is within **0.58** of any corridor centerline, it is land, whatever the noise says. A corridor therefore never has a gap in it.
2. Otherwise a field is computed and the hex is land if `field + offset > 0`:
   - `bump = fbm(noise, x / coastDetail, y / coastDetail)`.
   - The point is **warped** for chambers only: `(wx, wy) = (x + warpStrength·n₁, y + warpStrength·n₂)`, where `n₁`, `n₂` are two other noise samples at lattice scale `1.7 × coastDetail` (with different offsets). This bends round rooms out of round.
   - Each chamber gives a term `radius − |(wx, wy) − center| + coastRoughness · bump`.
   - Each corridor gives a term `width/2 − distance(point, centerline) + coastRoughness · 0.4 · bump` (corridors follow the blueprint closer than rooms do).
   - The terms are combined with a **smooth max** with blend 1.5: `smoothMax(a, b) = max(a, b) + h² · 1.5 / 4` where `h = max(1.5 − |a − b|, 0) / 1.5`. Where two shapes meet they merge smoothly instead of leaving a crease.
3. **Protected hexes:** the city hex of every start chamber and its six neighbors are land whatever the field says, and are returned as `protectedKeys` so nothing removes them.

`offset` (default 0) grows (positive) or shrinks (negative) the land by that many tiles everywhere. Fair boards use it to tune the area; battle royale boards do not.

**Noise** (`royale/noise.ts`): smooth 2D value noise in roughly [−1, 1] (a hash of integer lattice points, blended with smoothstep), seeded. `fbm` is two octaves: `(noise(x, y) + 0.5·noise(2x + 17.3, 2y − 9.1)) / 1.5`.

### Tidying the drawn land

Two rules, applied for 3 passes (`royale/rasterize.ts: cleanup`, `duel/layout.ts: tidy`):

- **Fill bays:** every water hex with 5 or more land neighbors becomes land.
- **Trim spurs:** every non-protected land hex with 1 or fewer land neighbors is removed.

In each pass both rules look at the board as it was before the step, never hex by hex, so the result does not depend on the order hexes are visited in. That is what keeps a symmetric board exactly symmetric.

Then only one connected piece is kept: for battle royale boards the biggest (always the whole board, see below); for fair boards the one holding the starts (all starts must be in it). An **edge** tile is a land tile with a neighbor that is not on the board; cities never stand on edge tiles.

### Map sizes (`params.ts`)

`MAP_SIZES` are `small`, `normal` and `large`. Fair boards are asked for a number of tiles; each kind of board has a table:

| Board      | Tiles per player (small / normal / large) | Whole board (small / normal / large) |
| ---------- | ----------------------------------------- | ------------------------------------ |
| Duel (2)   | 18 / 50 / 80                              | 36 / 100 / 160                       |
| Trio (3)   | 16 / 40 / 70                              | 48 / 120 / 210                       |
| Quad (4)   | 15 / 35 / 60                              | 60 / 140 / 240                       |
| Sextet (6) | 15 / 30 / 50                              | 90 / 180 / 300                       |

Battle royale boards are not asked for any number of tiles: the map size sets the size of the players' starting bowls instead (see below), and the area is whatever comes out.

## Battle royale boards

A battle royale board has no symmetry. `createFreeForAllMatch` calls `generateRoyaleLayout` (`royale/generate.ts`), then places terrain. **There is no target size, no check and no retry.** A board is drawn once, from the seed, and its area is whatever the settings come to. Every setting is the same for every map size and every number of players, except the bowl radius, which is the one thing that tells map sizes apart (and shrinks a little with more players).

### The settings

| Setting                                                            | Value                                                                             | Where                                          |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ---------------------------------------------- |
| Start bowl radius                                                  | `bowlRadius`: 1.6 by default; rooms use `royaleBowlRadius(size, players)` (below) | `params.ts`                                    |
| Start bowls are first placed inside a disc of radius               | 4 tiles                                                                           | `SPAWN_START_RADIUS` in `archetypes/common.ts` |
| First relaxing: start bowl centers pushed apart to                 | `4 × radius + 1.4` tiles                                                          | `SPAWN_GAP`, `spreadSpawns` in `scattered.ts`  |
| Tree corridor bridge (open ground between two bowls)               | `3 + (U + U − 1) × 2`: 1 to 5, about 3 in 4 between 2 and 4                       | `bridgeLength` in `scattered.ts`               |
| Second relaxing: pairs not joined by a tree corridor kept at least | `2 × radius + 1.4` tiles                                                          | `tighten` in `scattered.ts`                    |
| Most relaxing rounds (each of the two)                             | 2000                                                                              | `RELAX_ROUNDS` in `scattered.ts`               |
| Neutral chambers                                                   | none (the code is kept for another archetype)                                     | `neutralRooms()`                               |
| Corridor widths and weights                                        | 1: 3, 2: 3, 3: 2.5, 4: 1.5 (30%, 30%, 25%, 15%)                                   | `CORRIDOR_WIDTHS`                              |
| Corridor bend                                                      | uniform in ±0.15 × the corridor's length                                          | `connect` in `scattered.ts`                    |
| Extra "loop" corridors                                             | `round(0.3 × chambers)`                                                           | `connect`                                      |
| Coast roughness / detail / warp                                    | 1 / 5 / 1.5                                                                       | `DEFAULT_GENERATION_PARAMS`                    |

There is one **archetype**, `scattered` (`royale/archetypes/scattered.ts`); the code allows more.

### The bowl radius, which sets the size

`royaleBowlRadius(size, players) = ROYALE_BOWL_RADIUS[size] × (6 / max(players, 2)) ^ 0.17`, with `ROYALE_BOWL_RADIUS` = small 1.15, normal 2.0, large 3.1 (the radius at 6 players). It has the same form as the tiles-per-player formula it replaced (a base per map size, times a power of `6 / players`), and the numbers were fitted so that boards come out about as big as the old targets did: 15, 25 and 45 tiles per player at 6 players, falling with the player count as `(6 / players) ^ 0.25`. (Area grows faster than the radius, so the exponent on the radius is smaller.)

| Players | Radius (small / normal / large) | Tiles per player now (small / normal / large) | Old targets (small / normal / large) |
| ------- | ------------------------------- | --------------------------------------------- | ------------------------------------ |
| 3       | 1.29 / 2.25 / 3.49              | 17 / 28 / 53                                  | 18 / 30 / 54                         |
| 4       | 1.23 / 2.14 / 3.32              | 15 / 26 / 49                                  | 17 / 28 / 50                         |
| 6       | 1.15 / 2.00 / 3.10              | 15 / 25 / 45                                  | 15 / 25 / 45                         |
| 8       | 1.10 / 1.90 / 2.95              | 14 / 23 / 42                                  | 14 / 23 / 42                         |
| 12      | 1.02 / 1.78 / 2.76              | 13 / 22 / 38                                  | 13 / 21 / 38                         |

(Measured: the average over 40 seeds per cell, **before the corridor lengths were varied (the two-stage relaxing above); not re-measured since, so the tiles per player will have shifted.**) Individual boards vary a lot, since nothing controls the area: for example normal boards with 3 players have between 19 and 38 tiles per player, and with 12 players between 19 and 25.

### Step by step

**1. Setup.** The archetype is picked by `createRng(seed ^ 0xa11ce)` (there is only one). A noise field is created from `createRng(seed)`, and a `layoutSeed` is drawn from the same rng.

**2. Blueprint** (`buildScattered`), using `createRng(layoutSeed)`.

_Start chambers_, one per player, in three steps (`spreadSpawns`, `spanningTree`, `tighten` in `scattered.ts`):

- **Spread far apart.** Every player's point starts at a uniformly random place inside a disc of radius 4 around the origin (`SPAWN_START_RADIUS`), so they all start piled up in the middle. The points are then **relaxed**: for up to 2000 rounds, every pair closer than `4 × radius + 1.4` is pushed apart by half the shortfall each (plus 0.01), the pairs taken in order, until a round moves nothing. Two points on exactly the same place are pushed apart along the x axis. Nothing keeps the points inside any disc.
- **Spanning tree.** Prim's algorithm from point 0 over these far apart points: the nearest unlinked point first. These are the tree corridors, and they are chosen here, before the points move again.
- **Pull together along the tree.** Each tree corridor gets a target length: `2 × radius + bridge`, where the bridge is `3 + (U₁ + U₂ − 1) × 2` tiles of open ground between the two bowls (`U` are uniform random numbers in [0, 1); so between 1 and 5, and about 3 in 4 are between 2 and 4). Then for up to 2000 rounds: each tree corridor moves its two points a quarter of its error each toward (or away from) the target distance, and every pair of points that is _not_ joined by a tree corridor and is closer than `2 × radius + 1.4` is pushed apart as before; it stops when no corridor is more than 0.02 off and nobody had to be pushed. So how far apart neighbors end up varies from corridor to corridor.
- Each point is then snapped to the nearest hex center, so the city sits exactly on a hex, and becomes a chamber of the bowl radius.

_Corridors_ (`connect`):

- **Spanning tree:** the tree chosen above, so every chamber is reachable. Its corridors are added first.
- **Loops:** (after the points have been pulled together) let `reach = 1.4 ×` the median tree corridor length. Candidate extra corridors are all pairs that are not already joined, are at most `reach` long, and whose straight line does not run through another chamber (within that chamber's radius + 0.5). The shortest `round(0.3 × chambers)` of them are added (ties broken randomly).
- **Widths and bend:** each corridor gets a random width from the weights above and a random bend.
- **Long tails are repaired** (`royale/topology.ts`; this is a repair, there is no check afterwards, so a rare layout can keep one): a dead-end chamber (one corridor) may hang off a junction, but not at the end of a chain of chambers that each have exactly two corridors ("snakes", or a dead end behind a dead end). Up to `4 × chambers` times, the worst remaining tail end is joined to the nearest chamber it is not yet joined to (a straight line through another chamber costs 1000 extra, so is only a last resort), which closes a loop. Dead-end chambers at a junction ("peninsulas", which can be a player's start) are fine, and nothing adds them on purpose.

**3. Draw and tidy** (`rasterize` and `cleanup`, see Shared machinery): once, with no offset and no correction.

**4. Recenter.** The board and its blueprint are moved so the middle of the land (the centroid, rounded to a hex) is on the origin. The start hexes are the spawn chambers' centers, in the order of the chambers.

**5. Terrain.** The starts are shuffled with the match's rng and given to the players in that order. The starts are cities with the starting troops, there are no other cities, and villages use the standard rules with every hex its own group (see Terrain).

That is all: `generateRoyaleLayout` always returns a board.

### Why the starts are always safe

Nothing checks the starts, because nothing can remove what they need:

- **The city and its six neighbors are land.** `rasterize` sets them as land after drawing everything else, and lists them as protected. Tidying only ever _adds_ land when filling bays, and never removes a protected hex when trimming spurs.
- **They stay in the one piece that is kept.** Cleanup keeps the biggest connected piece. Every chamber has at least one corridor (the spanning tree), and a corridor's core, every hex within 0.58 of its centerline (more than the 0.5774 a hex can be from a line that crosses it), is land whatever the noise says. That makes an unbroken chain of land from each chamber's center to the next chamber's center, so all the chambers and their rings are one piece, and the piece kept is the whole board.
- **A start is never on the edge**, because all six neighbors of the city are land.
- **Two starts are never on one hex**, because the second relaxing keeps every pair that is not joined by a tree corridor at least `2 × radius + 1.4` apart, and a pair that is joined is pulled to `2 × radius + bridge` (at least about `2 × radius + 1`, which is 3 tiles even for the smallest bowl), far more than the half-tile rounding to a hex can close. The tests draw 180 boards across sizes and player counts and check every ring, and that the starts are all different.

### Measured

Over 40 seeds per cell, before the two-stage relaxing (not re-measured since), the average open ground between two chambers along a corridor ("bridge"):

| Board                   | Bridge (tiles)  |
| ----------------------- | --------------- |
| small, 3 to 12 players  | 2.4 down to 1.4 |
| normal, 3 to 12 players | 2.2 down to 1.5 |
| large, 3 to 12 players  | 2.6 down to 1.5 |

Boards are compact at every size and player count (the old, fixed bowl size gave bridges of 6 to 15 tiles on boards with few players or on large maps). A small board with many players has bowls that touch or overlap slightly.

## Fair boards

Fair boards are **exactly symmetric**, so every player sees the same board from their side. They are drawn from blueprints made of blobs and corridors, like battle royale boards, but laid out by `duel/` and with different rules: blob size and count come from the tile target, only the spacing is stretched to fit, and the land is finally grown or shrunk a fraction of a tile to hit the target within 3%.

### Symmetry groups (`duel/symmetry.ts`, `duel/group.ts`)

| Board                | Symmetries (besides doing nothing)                                                                                                                  | Starts |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Duel, mirror         | one mirror                                                                                                                                          | 2      |
| Duel, half turn      | turn by 180°                                                                                                                                        | 2      |
| Trio                 | turns by 120° and 240° (no mirror: a mirror cannot treat three players alike)                                                                       | 3      |
| Quad                 | mirror across a line through tile corners, mirror across the line at right angles (through tile edge middles), and the half turn they make together | 4      |
| Sextet, `rotational` | the five turns by 60°                                                                                                                               | 6      |
| Sextet, `mirror`     | turns by 120° and 240°, and three mirrors (three lines 60° apart)                                                                                   | 6      |

A hex has two kinds of mirror line through its center: through tile corners and along tile edges (**`points`**: up and down, the "points" of the center tile), and through the middles of tile edges (**`edges`**, 30° round from the first). Any two perpendicular lines are one of each kind. The three lines of a sextet mirror board are all the same kind. Mirrors and turns map hex centers to hex centers exactly (`hexFlipHorizontal`, `hexFlipVertical`, `hexRotate`). The `edges` mirror is a flip followed by a 120° turn.

**Turning afterwards.** So the lines can lie any of the ways a hex mirror line can, a finished board is turned by a random number of 60° steps: duel mirror boards by 0 to 5 (`turns`, picked by the seed); quad boards by 0 to 2 (a turn by 180° changes nothing). The blueprint is turned with it. Half-turn duels, trios and sextets are not turned, because their symmetry looks the same whichever way they are turned.

**Picking the kind.** If not given: a duel is `mirror` or `rotational` by `createRng(seed ^ 0x2b1d)` (below 0.5 is mirror); a sextet is `rotational` or `mirror` by the same rng (below 0.5 is rotational); the mirror line kind is `points` or `edges` by `createRng(seed ^ 0x6a09)` (below 0.5 is points); duel turns from `createRng(seed ^ 0x5bd1).int(6)`, quad turns from `createRng(seed ^ 0x51ad).int(3)`.

### The target and the sizes of things

Common constants are in `duel/common.ts`.

- **Size:** `size = sqrt(tiles × (√3/2) / π)`: the radius of a disc with the target's area. For example a duel on a normal board (100 tiles) has `size` 5.25.
- **Blob radius:** `min(2.4, 1.2 + 0.1 × size)`: 1.73 for that duel and 1.52 for a 36-tile small duel, at most 2.4 on the biggest boards. Bigger boards have somewhat bigger blobs. An extra blob's radius is the blob radius × a random 0.8 to 1.25; a blob at the middle is × 0.8 to 1.1.
- **Blob count:** how many sets of extra blobs depends on `size`: duel `max(1, round(size / 2.2))`; trio `max(1, round(size / 4.4))`; quad `max(1, round(size / 5))`; sextet `max(1, round(size / 9))`. A _set_ is the blob together with its images (so a duel "set" is a pair).
- **Gap:** blobs are never closer than 2.2 tiles of open ground (`GAP`).
- **Corridor widths:** 1, 2 or 3 hexes, weights 5, 3, 1 (56%, 33%, 11%).
- **Corridor bend:** uniform in ±0.15 × the length; a corridor that is its own image under some symmetry has to run dead straight (bend 0).
- **Crossovers** (corridors from one part of the board to another, beyond the ones that have to): 0, 1, 2 or 3 extra, weights 4, 3, 2, 1 (40%, 30%, 20%, 10%).
- **Spine chance:** a corridor between two blobs on the same mirror line runs straight along the line, so it is allowed on only 30% of boards (`SPINE_CHANCE`).
- **Middle blob chance:** 40% (`ON_AXIS_CHANCE`). It sits at the center, has no images, and is decided first, because the starts are then pushed out far enough to leave it room (`middle radius + blob radius + 2.2 + 0.3`).

### Making the blueprint

Common to all, in order:

1. **Middle blob** decision (above), where the symmetry has a middle.
2. **The first start**, then its images. A random place in the part of the board the layout builder is told to use (below), snapped to a hex. It must be at least `minCityDistance` (3) hexes from each of its own images, and have room: its blob and each image of it are at least `2 × radius + 2.2` apart. Up to 50 tries (groups: each try looks a little further out, `scale × (1 + 0.03 × try)`). The images are the other starts, in the order of the symmetries.
3. **Extra sets.** Up to 200 random places per set. A blob needs open ground of `radius + other.radius + 2.2` to every existing blob (and the existing blobs map onto themselves, so that is room for its images too), and a blob with images needs `2 × radius + 2.2` between it and each image (blobs on a mirror line or at the middle coincide with their image, which is allowed). Blobs may be on a mirror line (40% of sets, where the symmetry has lines) or off it.
4. If a board that is not small (`size ≥ 5`) has only the starts, the layout is rejected so that it is stretched (small boards may be only starts).
5. **Corridors** are made for one **domain**: the part of the board that holds exactly one blob from each set (a half of a duel, a third of a trio, a quarter of a quad, a sixth of a sextet; blobs on a line or at the middle are included in every domain they touch), then copied by every symmetry:
   - Candidate pairs in the domain are sorted by `distance × U(0.8, 1.3)` ("shaken", so the nearest blob is not always the one joined). A pair of blobs both on the same mirror line is excluded unless the 30% spine chance came up. A **start-to-start pair is excluded** (below).
   - A spanning tree over the domain (Kruskal on the sorted pairs), first without pairs whose line runs through another blob, then, if that did not join everything, allowing them. If still not joined, the layout fails.
   - Then loops: the next `round(0.35 × blobs in the domain)` shortest remaining pairs whose line does not run through another blob.
   - Every corridor is added together with its images: same width, bend flipped by a mirror (a mirror turns a bend the other way; a turn leaves it as it is). If a corridor is its own image, it is straight.
6. **Crossovers.** Pairs from a blob in the domain to an image of a blob in the domain (so, in another part of the board), also shaken and sorted. The first pass skips pairs that run through other blobs. While the parts of the board are not all joined, crossovers are added as needed (these are the "required" ones; a blob on a line or at the middle can do the joining instead, so none may be required). When all is joined, up to the random extra count (0 to 3) more are added, each with its images. The second pass (pairs through another blob) is only for a corridor that is still needed to join the board. If the board is still not joined, the layout fails.
7. **Starts never joined directly.** A corridor whose two ends are both starts is never added, so starts join the rest of the board only through other blobs (the land may still happen to run together, which is fine). The exception is a board with no other blobs (only small boards can be), where the starts have no other way to be joined, so they are joined to each other.

The blueprint is then drawn: see below.

### Duel (`duel/blueprint.ts`)

Chambers 0 and 1 are the two starts. Mirror starts: a point at `scale × U(−0.5, 0.5)` along the line and `scale × U(0.45, 0.85)` out from it; half-turn starts: a random angle, `scale × U(0.5, 0.85)` from the middle (or, if there is a middle blob, at least `middle radius + blob radius + 2.5 + scale × U(0, 0.2)` out, whichever is more). Extra blobs: for a mirror board, 40% of them are on the line (at `scale × U(−1.1, 1.1)` along it, so several can be on the line); the others are anywhere in a disc of radius `1.2 × scale`, with a twin across the line. A half-turn board has no extra blob on its point except the middle blob decided first; the others come with a twin. A mirror board's domain is one side of the line (chosen at random, `keepSide`), plus the blobs on it. A half-turn board's domain is one half-plane (the blobs with `y > 0`, or `y < 0`, chosen at random; by `x` for a blob exactly on `y = 0`), plus the middle blob.

### Trio (`duel/trio.ts`)

Its own builder (slot-based, not the generic one), with turns of 120°. Start: random angle, `scale × U(0.5, 0.85)` out (more if there is a middle blob), snapped to a hex at least 3 from its image under the turn, with blob and image at least `2 × radius + 2.2` apart. Sets of three extra blobs are anywhere in a disc of radius `1.2 × scale` (`out = 1.2 × scale × sqrt(U)`). Domain: one blob from each set (the first of each three, "slot 0") and the middle blob. Corridors in the domain: tree and loops as above, then **crossovers** are corridors from a blob in one third to the twin of a blob in the next third (one or two turns on): never to the middle blob, and not from a start to a start unless they are the only blobs (which makes a triangle of three corridors). A bend is the same for all three copies.

### Quad and sextet (`duel/group.ts`)

A generic builder. A group (`FairGroup`) says: its symmetries (as maps on points, and whether each is a mirror, and the same maps on hexes), which part of the board is the domain, where to try to put the first start and extra sets, when two points are on one mirror line, and how many extra sets a board has. `QUAD_GROUP`, `SIXFOLD_GROUP` and `mirroredThirdsGroup(axis)` are the three.

|                      | Quad                                                                                | Sextet `rotational`                                     | Sextet `mirror`                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Domain               | the quarter `x ≥ 0, y ≥ 0`                                                          | the sixth from angle 0 (counted in) to 60° (not)        | the sixth between two neighbouring mirror lines (both counted in)                                     |
| First start          | `x = max(least, scale × U(0.3, 0.85))`, same for `y` (`least = radius + 1.1 + 0.2`) | angle `U(0.15, 0.85) × 60°`, `scale × U(0.5, 0.85)` out | angle `lineAngle + U(0.15, 0.85) × 60°`, `scale × U(0.5, 0.85)` out                                   |
| Extra set candidates | 20% on the `y` axis, 20% on the `x` axis, 60% in the quadrant                       | anywhere in a disc of radius `1.2 × scale`              | 40% on one of the three lines (either side of the middle, `scale × U(0.2, 1.1)` out), 60% in the disc |
| Blobs in a set       | 4 off the lines, 2 on one, 1 at the middle                                          | 6 (1 at the middle)                                     | 6 off the lines, 3 on a line, 1 at the middle                                                         |
| Extra sets           | `max(1, round(size / 5))`                                                           | `max(1, round(size / 9))`                               | `max(1, round(size / 9))`                                                                             |
| Spine                | corridors along an axis                                                             | none (no mirror lines)                                  | corridors along a line                                                                                |

`lineAngle` is 90° for `points` and 60° for `edges`. A middle blob counts as a set of one. After placing blobs, the builder works out where every blob goes under every symmetry and fails if some image does not land on a blob of the same size (a rounding guard); it also fails if the number of blobs in the domain is not the number of sets.

Quad boards are turned by `turns` (0 to 2) afterwards; sextets are not.

### Drawing and checking (`duel/layout.ts`)

For one attempt (`drawBoard`):

1. **Scale loop** (up to 8 passes): build the blueprint at the current `scale` (starting at `size`), rasterize with `offset 0`, and **symmetrize**: the land is the drawn land together with its images under every symmetry (noise is not symmetric), then tidied (3 passes) and the piece with all the starts kept. If the blueprint cannot be made, or the starts are not in one piece, `scale *= 1.1` and try again. Otherwise the best pass so far (closest to the target) is kept; if it is within 20% of the target, the loop stops; if not, `scale *= clamp(sqrt(target / area), 0.8, 1.25)`.
2. **Fine tune** (up to 9 steps, until within 3%): bisect `offset` in [−1.5, 1.5] (grow or shrink the land by a fraction of a tile everywhere), keeping the closest result.
3. **Checks**, rejecting the attempt if one fails (the reason names the check):

| Reason      | Check                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------ |
| `blueprint` | no blueprint could be built in any pass                                                    |
| `split`     | the starts were never all in one piece                                                     |
| `area`      | the best board is more than 8% from the target                                             |
| `symmetry`  | some hex's image is not land (never seen)                                                  |
| `starts`    | a start is not the first start moved by the symmetry, or a start hex lacks a land neighbor |

Up to 200 attempts (`seed + attempt × 0x9e3779b1`); if none passes the generator throws ("could not make a … board of about N tiles"). In testing 100% of boards succeed, almost always on the first or second attempt, with areas within about 3%. Minimum sizes: a duel needs at least 20 tiles, a trio 30, a quad 40, a sextet 60 (`createXMatch` throws below that).

## Terrain: cities, villages, farmland

`placeTerrain` in `generate.ts`. Land tiles are first put in **groups that must share a type**: on fair boards the **orbit** of each tile (the tile and its images under every symmetry; a tile on a mirror line or at the middle is in a smaller orbit; an orbit is dropped if some member is not on the board), so every player sees the same terrain; on battle royale boards every hex is its own group. The start tiles are all cities already.

1. **Starting cities:** one per player, at the center of its start chamber, never on the edge, with the starting troops of the match config (10 by default), owned by that player. On fair boards the start orbit is exactly the set of starts.
2. **Other cities** (fair boards only; battle royale boards have none): the target is `tiles / 50` extra cities (`tilesPerCity`). Interior groups are tried in random order, and one becomes cities if that brings the count closer to the target and every member is at least **3** tiles (`minCityDistance`) from every other city (starting cities included) and from the other members. Never on the edge.
3. **Villages:** the groups are taken in random order, interior first, then edge groups. A group that is not already a city becomes villages if every member is not touching another village, is not touching a city (unless `villagesNextToCities`), and is at least `minVillageDistance` (2: never touching) from the other members; and a random roll passes (**40%**, `villageChance`; at 100 the board is filled until nowhere legal is left). Placing a village only ever removes options, so one pass leaves a board where no further village fits (when the chance is 100).
4. **Farmland** is everything else.

Neutral tiles start with their type's base garrison: farmland 1, village 4, city 10. Fair boards use `createRng(seed)` for this; battle royale boards continue the match's rng (the one that also shuffled the starts).

## Settings

`GenerationParams` in `params.ts`, with the defaults in `DEFAULT_GENERATION_PARAMS`. Matches use the defaults, except for the size, which follows the map size (the tile target `DUEL_TILES[size]` and so on, or `royaleBowlRadius(size, players)`). The generators take a `params` option with overrides, which the tests and the previewer use.

| Setting                | Default | Meaning                                                                                                             |
| ---------------------- | ------- | ------------------------------------------------------------------------------------------------------------------- |
| `tilesPerCity`         | 50      | about one extra city per this many tiles (fair boards)                                                              |
| `minCityDistance`      | 3       | cities are never closer than this to each other; the starts of a fair board are at least this far from their images |
| `villageChance`        | 40      | percent chance a village is placed where one fits                                                                   |
| `minVillageDistance`   | 2       | villages are never closer than this (2: never touching)                                                             |
| `villagesNextToCities` | false   | may villages touch cities                                                                                           |
| `bowlRadius`           | 1.6     | battle royale start bowl radius, which sets the board size (rooms override it by map size and player count)         |
| `coastRoughness`       | 1       | how far noise pushes the coast in and out, in tiles                                                                 |
| `coastDetail`          | 5       | size of the coast's bumps, in tiles                                                                                 |
| `warpStrength`         | 1.5     | how far noise bends the chambers out of round, in tiles                                                             |

Constants that are not settings (blob size, spacing, corridor widths and weights, relaxing rounds, retry limits of fair boards, and so on) are named constants in the code, listed in the sections above.

## The map previewer

`/?maps` (code in `apps/client/src/ui/MapsPage.tsx`, bridge in `apps/client/src/preview.ts`) draws boards with the game's own `Board`, with a panel of generation settings on the left. It has modes **Duel**, **Trio**, **Quad**, **Sextet** and **Royale**, a map size bar, the options that kind of board has (duel and sextet: symmetry and mirror line; royale: player count and archetype), and a **Generate new map** button (a new random seed).

- **Show blueprint** draws the chambers and corridors over the board.
- **Show fog** draws the board as one random player sees it, covered in fog: the viewer is `players[floor(createRng(seed).next() × count)]`.
- **Generation parameters** shows and edits the settings above. Changed ones are marked.
- The report line under the controls says how the board was made: tiles, seed, symmetry, attempts, blobs for fair boards; for royale boards the archetype and the bowl radius.

The address sets where it starts: `/?maps&mode=ffa&size=large&players=8&seed=123&archetype=scattered&blueprint&fog`. `mode` is `duel`, `trio`, `quad`, `six` or `ffa`; fair boards also take `tiles`; duels and sextets take `symmetry` and `axis`; duels and quads take `turns`. A seed in the address reproduces a board exactly.

## Tests

- `royale/royale.test.ts`: topology (the tail finder), royale layouts (determinism, one connected piece, every start city and its ring kept at every size and player count, the starts all different, about the old size per player at each map size, the bowl radius formula, peninsulas now and then).
- `duel/duel.test.ts`, `duel/symmetry.test.ts`: the symmetry groups (closed, distinct, hex and point maps agree), blueprint rules (starts never joined directly, only small boards are only starts, middle blobs, blobs on lines).
- `generate.test.ts`: the five match functions: determinism, exact symmetry of the finished boards, one start city per player and twin starts, about the right number of tiles, terrain rules (cities never too close or on the edge, villages never touching, villages placed until nowhere is left), and rejecting the wrong number of players.
