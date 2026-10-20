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

Every board is made the same way, in three stages (the same recipe for all five kinds: see below):

1. **Blueprint:** a layout of round **chambers** ("blobs") joined by **corridors**, in "tile units" (never touching hexes). Battle royale blueprints come from `royale/archetypes/`; fair board blueprints from `duel/`.
2. **Drawing:** the blueprint is drawn onto hexes with noise (`royale/rasterize.ts`) and tidied. There is no target size, no check and no retry for any kind of board: a board is drawn once, and its area is whatever the settings come to.
3. **Terrain:** every land tile becomes a city, a village or farmland (`placeTerrain` in `generate.ts`), shared by all five kinds of board.

**Determinism.** Given the same options and seed, a generator always makes the same board. All randomness comes from `createRng(seed)` (`rng.ts`, mulberry32), and from `createNoise(seed)` (`royale/noise.ts`) for the coast. Every board is drawn once, from the seed itself.

**Rooms** (`apps/server/src/room.ts`): a duel room calls `createDuelMatch` with `bowlRadius = FAIR_BOWL_RADIUS[mapSize]` and `extraSets = extraSetsFor(mapSize, 2)`; a battle royale room calls `createFreeForAllMatch` with `bowlRadius = bowlRadiusFor(mapSize, players)` and nothing else overridden. The seed is random per match. If generation throws, the room tries up to 100 more seeds (`seed + attempt`), for at most 2 seconds; if none works the room is closed with "the game could not be set up, please try again". Players are shuffled before being given ids `P1 … Pn` (so who starts where is random), and board generation then gives the player with id `Pk` the k-th start.

## Shared machinery

### Units

Hexes are pointy-top, in axial coordinates `(q, r)`. Blueprints are drawn in **tile units** where the distance between neighboring hex centers is 1: a hex `(q, r)` is at `x = q + r/2`, `y = r·√3/2` (y points down). `hexToPoint` and `pointToHex` convert (`royale/blueprint.ts`). A corridor 2 wide is 2 hexes wide on any board.

### Blueprints (`royale/blueprint.ts`)

- A **chamber** is a circle: `center`, `radius`, and `spawn` (true for a start chamber, which holds a player's city at its center).
- A **corridor** joins chamber `from` to `to` with a `width` (in hexes) and a `bend`. Its centerline is a polyline of two straight segments `from → middle → to`, where `middle` is the midpoint pushed sideways by `bend` tile units (positive to one side, negative to the other).

### Drawing a blueprint onto hexes (`royale/rasterize.ts`)

`rasterize(blueprint, { noise, coastRoughness, coastDetail, warpStrength })` tests the center of every hex in the blueprint's bounding box (each chamber's circle, plus a margin of `warpStrength + coastRoughness + 2`):

1. **Corridor core:** if the point is within **0.58** of any corridor centerline, it is land, whatever the noise says. A corridor therefore never has a gap in it.
2. Otherwise a field is computed and the hex is land if `field > 0`:
   - `bump = fbm(noise, x / coastDetail, y / coastDetail)`.
   - The point is **warped** for chambers only: `(wx, wy) = (x + warpStrength·n₁, y + warpStrength·n₂)`, where `n₁`, `n₂` are two other noise samples at lattice scale `1.7 × coastDetail` (with different offsets). This bends round rooms out of round.
   - Each chamber gives a term `radius − |(wx, wy) − center| + coastRoughness · bump`.
   - Each corridor gives a term `width/2 − distance(point, centerline) + coastRoughness · 0.4 · bump` (corridors follow the blueprint closer than rooms do).
   - The terms are combined with a **smooth max** with blend 1.5: `smoothMax(a, b) = max(a, b) + h² · 1.5 / 4` where `h = max(1.5 − |a − b|, 0) / 1.5`. Where two shapes meet they merge smoothly instead of leaving a crease.
3. **Protected hexes:** the city hex of every start chamber and its six neighbors are land whatever the field says, and are returned as `protectedKeys` so nothing removes them.

**Noise** (`royale/noise.ts`): smooth 2D value noise in roughly [−1, 1] (a hash of integer lattice points, blended with smoothstep), seeded. `fbm` is two octaves: `(noise(x, y) + 0.5·noise(2x + 17.3, 2y − 9.1)) / 1.5`.

### Tidying the drawn land

Two rules, applied for 3 passes (`royale/rasterize.ts: cleanup`, `duel/layout.ts: tidy`):

- **Fill bays:** every water hex with 5 or more land neighbors becomes land.
- **Trim spurs:** every non-protected land hex with 1 or fewer land neighbors is removed.

In each pass both rules look at the board as it was before the step, never hex by hex, so the result does not depend on the order hexes are visited in. That is what keeps a symmetric board exactly symmetric.

Then only one connected piece is kept: for battle royale and fair boards alike the biggest (always the whole board, see below). An **edge** tile is a land tile with a neighbor that is not on the board; cities never stand on edge tiles.

### Map sizes (`params.ts`)

`MAP_SIZES` are `small`, `normal` and `large`. No board is asked for a number of tiles: the map size sets the size of the players' starting bowls instead, and the area is whatever comes out. Battle royale boards use `bowlRadiusFor(size, players)` (below); fair boards use `FAIR_BOWL_RADIUS[size]` and `extraSetsFor(size, players)` (see Fair boards).

## Battle royale boards

A battle royale board has no symmetry. `createFreeForAllMatch` calls `generateRoyaleLayout` (`royale/generate.ts`), then places terrain. **There is no target size, no check and no retry.** A board is drawn once, from the seed, and its area is whatever the settings come to. Every setting is the same for every map size and every number of players, except the bowl radius, which is the one thing that tells map sizes apart (and shrinks a little with more players).

### The settings

| Setting                                                            | Value                                                                                          | Where                                          |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Start bowl radius                                                  | `bowlRadius`: 1.6 by default; rooms use `bowlRadiusFor(size, players)` (below)                 | `params.ts`                                    |
| Start bowls are first placed inside a disc of radius               | 4 tiles                                                                                        | `SPAWN_START_RADIUS` in `archetypes/common.ts` |
| First relaxing: start bowl centers pushed apart to                 | `4 × radius + 1.4` tiles                                                                       | `SPAWN_GAP`, `spreadSpawns` in `scattered.ts`  |
| Tree corridor bridge (open ground between two bowls)               | `4 + (U + U − 1) × 2`: 2 to 6, about 3 in 4 between 3 and 5; evenly spaced quantiles, shuffled | `bridgeLengths` in `scattered.ts`              |
| Second relaxing: pairs not joined by a tree corridor kept at least | `2 × radius + 1.4` tiles                                                                       | `tighten` in `scattered.ts`                    |
| Most relaxing rounds (each of the two)                             | 2000                                                                                           | `RELAX_ROUNDS` in `scattered.ts`               |
| Neutral chambers                                                   | none (the code is kept for another archetype)                                                  | `neutralRooms()`                               |
| Corridor widths and weights                                        | 1: 30, 2: 45, 3: 25 (30%, 45%, 25%; no 4-wide); a fixed set per board, see below               | `CORRIDOR_WIDTHS`, `assignWidths`              |
| Corridor bend                                                      | uniform in ±0.15 × the corridor's length                                                       | `connect` in `scattered.ts`                    |
| Extra "loop" corridors                                             | `round(0.3 × chambers)`                                                                        | `connect`                                      |
| Coast roughness / detail / warp                                    | 1 / 5 / 1.5                                                                                    | `DEFAULT_GENERATION_PARAMS`                    |

There is one **archetype**, `scattered` (`royale/archetypes/scattered.ts`); the code allows more.

### The bowl radius, which sets the size

`bowlRadiusFor(size, players) = BOWL_RADIUS[size] × (6 / max(players, 2)) ^ 0.27`, with `BOWL_RADIUS` = small 0.8, normal 1.5, large 2.8 (the radius at 6 players). It has the same form as the tiles-per-player formula it replaced (a base per map size, times a power of `6 / players`). The numbers were fitted so that boards come out about as big as the old targets did, which were 15, 25 and 45 tiles per player at 6 players, falling with the player count as `(6 / players) ^ 0.25`. How the fit went:

- **Normal and large** came out within about 10% of the old numbers at every player count. The best exponent for normal alone is about 0.4 and for large about 0.23 (the corridors cover the same land whatever the bowl radius, so the radius matters less on big boards); 0.27 is a compromise.
- **Small cannot reach the old numbers.** The corridors alone (bridges of 2 to 6 tiles) cover about 15 tiles per player, whatever the bowls, so small boards come out 10% to 25% above the old targets even with small bowls. The small base of 0.8 is about the smallest that still makes sense: the city and the ring of six land hexes around it are always land, so a bowl is never really smaller than about 1.

| Players | Radius (small / normal / large) | Tiles per player now (small / normal / large) | Old targets (small / normal / large) |
| ------- | ------------------------------- | --------------------------------------------- | ------------------------------------ |
| 3       | 0.96 / 1.81 / 3.38              | 19 / 28 / 58                                  | 18 / 30 / 54                         |
| 4       | 0.89 / 1.67 / 3.12              | 17 / 25 / 48                                  | 17 / 28 / 50                         |
| 6       | 0.80 / 1.50 / 2.80              | 18 / 25 / 45                                  | 15 / 25 / 45                         |
| 8       | 0.74 / 1.39 / 2.59              | 16 / 23 / 41                                  | 14 / 23 / 42                         |
| 12      | 0.66 / 1.24 / 2.32              | 16 / 23 / 38                                  | 13 / 21 / 38                         |

(Measured: the average over 150 seeds per cell.) Individual boards still vary, but much less than they did: the standard deviation of tiles per player is 5% to 10% of the mean (the full range is about ±25%); for example normal boards with 6 players have between 18 and 31 tiles per player.

### Step by step

**1. Setup.** The archetype is picked by `createRng(seed ^ 0xa11ce)` (there is only one). A noise field is created from `createRng(seed)`, and a `layoutSeed` is drawn from the same rng.

**2. Blueprint** (`buildScattered`), using `createRng(layoutSeed)`.

_Start chambers_, one per player, in three steps (`spreadSpawns`, `spanningTree`, `tighten` in `scattered.ts`):

- **Spread far apart.** Every player's point starts at a uniformly random place inside a disc of radius 4 around the origin (`SPAWN_START_RADIUS`), so they all start piled up in the middle. The points are then **relaxed**: for up to 2000 rounds, every pair closer than `4 × radius + 1.4` is pushed apart by half the shortfall each (plus 0.01), the pairs taken in order, until a round moves nothing. Two points on exactly the same place are pushed apart along the x axis. Nothing keeps the points inside any disc.
- **Spanning tree.** Prim's algorithm from point 0 over these far apart points: the nearest unlinked point first. These are the tree corridors, and they are chosen here, before the points move again.
- **Pull together along the tree.** Each tree corridor gets a target length: `2 × radius + bridge`, where the bridge is `4 + (U₁ + U₂ − 1) × 2` tiles of open ground between the two bowls (`U` are uniform random numbers in [0, 1); so between 2 and 6, and about 3 in 4 are between 3 and 5). The lengths are not drawn independently: for a tree of `k` corridors they are the `k` evenly spaced quantiles of that distribution (the `(i + 0.5) / k`-th, using the inverse of the triangle distribution of `U₁ + U₂`), shuffled among the corridors, so the average bridge of a board is always 4. Then for up to 2000 rounds: each tree corridor moves its two points a quarter of its error each toward (or away from) the target distance, and every pair of points that is _not_ joined by a tree corridor and is closer than `2 × radius + 1.4` is pushed apart as before; it stops when no corridor is more than 0.02 off and nobody had to be pushed. So how far apart neighbors end up varies from corridor to corridor.
- Each point is then snapped to the nearest hex center, so the city sits exactly on a hex, and becomes a chamber of the bowl radius.

_Corridors_ (`connect`):

- **Spanning tree:** the tree chosen above, so every chamber is reachable. Its corridors are added first.
- **Loops:** (after the points have been pulled together) let `reach = 1.4 ×` the median tree corridor length. Candidate extra corridors are all pairs that are not already joined, are at most `reach` long, and whose straight line does not run through another chamber (within that chamber's radius + 0.5). The shortest `round(0.3 × chambers)` of them are added (ties broken randomly).
- **Bend:** each corridor gets a random bend.
- **Widths** (`assignWidths` in `archetypes/common.ts`), given last, once every corridor (tree, loops and repairs) is known. The widths are a fixed set in exactly the proportions of the weights above, as far as whole corridors allow (30% 1-wide, 45% 2-wide, 25% 3-wide, the rounding going to the largest remainders), so no board is all narrow or all wide. They start shuffled; then up to `50 × corridors` random pairs of corridors are considered, and two of different widths swap widths if that brings the total area of the bridges (the sum over corridors of bridge length × width, with the bridge being the open ground between the two bowls as placed) closer to the budget, which is the total bridge length times the average width (1.95). The result: long bridges tend to get narrow widths and short bridges wide ones, so the land the bridges cover does not depend on the luck of the draw.
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
- **Two starts are never on one hex**, because the second relaxing keeps every pair that is not joined by a tree corridor at least `2 × radius + 1.4` apart, and a pair that is joined is pulled to `2 × radius + bridge` (at least about `2 × radius + 2`, which is 4 tiles even for the smallest bowl), far more than the half-tile rounding to a hex can close. The tests draw 180 boards across sizes and player counts and check every ring, and that the starts are all different.

### Measured: bridge length

Over 150 seeds per cell, the average open ground between two chambers along a corridor ("bridge"), loop corridors included:

| Board                   | Bridge (tiles)  |
| ----------------------- | --------------- |
| small, 3 to 12 players  | 4.6 down to 3.6 |
| normal, 3 to 12 players | 5.2 down to 4.0 |
| large, 3 to 12 players  | 6.8 down to 4.6 |

The tree corridors average 4 by construction; the rest of the average is the loops and tail repairs, which are chosen after the points have been pulled together and can be longer. (Boards with 3 players have the longest ones, since a few loops are the only extras.)

## Fair boards

Fair boards are **exactly symmetric**, so every player sees the same board from their side. They are made with the same recipe as battle royale boards (see above), in a symmetric form: **no target size, no checks and no retries**. A board is drawn once, from the seed, and its area is whatever the settings come to. One generic builder (`buildGroupBlueprint` in `duel/group.ts`) makes all of them: a **group** describes the symmetries, and everything else is the same whatever the group is. `duel/layout.ts` draws the blueprint onto hexes.

### Symmetry groups (`duel/symmetry.ts`, `duel/group.ts`)

| Board                | Symmetries (besides doing nothing)                                                                                                                  | Starts |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Duel, mirror         | one mirror                                                                                                                                          | 2      |
| Duel, half turn      | turn by 180°                                                                                                                                        | 2      |
| Trio                 | turns by 120° and 240° (no mirror: a mirror cannot treat three players alike)                                                                       | 3      |
| Quad                 | mirror across a line through tile corners, mirror across the line at right angles (through tile edge middles), and the half turn they make together | 4      |
| Sextet, `rotational` | the five turns by 60°                                                                                                                               | 6      |
| Sextet, `mirror`     | turns by 120° and 240°, and three mirrors (three lines 60° apart)                                                                                   | 6      |

A `FairGroup` has: its **elements** (each a map on points, with whether it is a mirror; the one that does nothing first), the same maps on **hexes** (`hexMaps`), and the **lines** (the direction of each mirror line, through the middle; none for turns alone). `duelGroup(symmetry, axis)`, `TRIO_GROUP`, `QUAD_GROUP`, `SIXFOLD_GROUP` and `mirroredThirdsGroup(axis)` (`sextetGroup(symmetry, axis)` picks one of the last two) are the groups.

A hex has two kinds of mirror line through its center: through tile corners and along tile edges (**`points`**: up and down, the "points" of the center tile), and through the middles of tile edges (**`edges`**, 30° round from the first). Any two perpendicular lines are one of each kind. The three lines of a sextet mirror board are all the same kind. Mirrors and turns map hex centers to hex centers exactly (`hexFlipHorizontal`, `hexFlipVertical`, `hexRotate`). The `edges` mirror is a flip followed by a 120° turn.

**Turning afterwards.** So the lines can lie any of the ways a hex mirror line can, a finished board is turned by a random number of 60° steps: duel mirror boards by 0 to 5 (`turns`, picked by the seed); quad boards by 0 to 2 (a turn by 180° changes nothing). The blueprint is turned with it. Half-turn duels, trios and sextets are not turned, because their symmetry looks the same whichever way they are turned.

**Picking the kind.** If not given: a duel is `mirror` or `rotational` by `createRng(seed ^ 0x2b1d)` (below 0.5 is mirror); a sextet is `rotational` or `mirror` by the same rng (below 0.5 is rotational); the mirror line kind is `points` or `edges` by `createRng(seed ^ 0x6a09)` (below 0.5 is points); duel turns come from `createRng(seed ^ 0x5bd1).int(6)`, quad turns from `createRng(seed ^ 0x51ad).int(3)`.

### The size

- **Bowl radius:** the same for every kind of fair board, set by the map size: `FAIR_BOWL_RADIUS` = small 1.05, normal 1.3, large 1.5 (`params.bowlRadius`). Every start blob has this radius; extra blobs have it times a random 0.8 to 1.25, and a blob at the middle times 0.8 to 1.1.
- **Extra sets:** `extraSetsFor(size, players)` (`params.extraSets`). A **set** is as many extra blobs as there are symmetries, so on a duel it is a pair of blobs and on a sextet six. The number of sets is a small table by number of players and map size (small / normal / large): duels 0 / 1 / 2; trios 0 / 1 / 1; quads 0 / 0 / 1; sextets 0 / 0 / 1. More players mean fewer sets, so boards stay about the size they were. Without the setting, the builder uses `round(2 × radius / symmetries)`.
- **The size is the result.** Bigger bowls, more sets and the corridors between them decide how much land there is. Measured over 100 seeds each (mean tiles for the whole board, the old targets in brackets, the standard deviation as a share of the mean):

| Board           | small            | normal            | large             |
| --------------- | ---------------- | ----------------- | ----------------- |
| Duel, mirror    | 38 (36), sd 29%  | 105 (100), sd 22% | 177 (160), sd 15% |
| Duel, half turn | 38 (36), sd 33%  | 108 (100), sd 19% | 174 (160), sd 13% |
| Trio            | 67 (48), sd 15%  | 168 (120), sd 17% | 186 (210), sd 17% |
| Quad            | 102 (60), sd 13% | 111 (140), sd 11% | 251 (240), sd 16% |
| Sextet, turns   | 142 (90), sd 12% | 161 (180), sd 12% | 409 (300), sd 14% |
| Sextet, mirrors | 132 (90), sd 14% | 159 (180), sd 13% | 395 (300), sd 14% |

Duels (the only fair board in rooms) are close to the old sizes. The others come out bigger on small boards and some large ones: with 4-tile bridges, even a board of just the starts has the corridors of its starts to cover. **The spread is larger than for battle royale boards**, mostly because of the blob at the middle: a board with one is about a third bigger than one without (a duel on a normal board averages 90 tiles with 4 blobs and 123 with 5; each group has a spread of 10% to 19% on its own). The number of blobs is otherwise fixed (see below).

### Making the blueprint

`buildGroupBlueprint(group, { radius, extraSets, rng })`. Only one blob of each set is placed, and the group makes its images from it, so everything moves in step and the board stays exactly symmetric all the way through. A blob that stands for its images is a **rep**; it is free to move anywhere, kept on a mirror line (a "line" rep), or fixed at the middle.

**1. The blobs.**

- **The start** rep: the starts are its images, one for each element, in the order of the group's elements. Radius = the bowl radius.
- **The middle blob**, with chance 40% (`ON_AXIS_CHANCE`): a blob at the origin, which every symmetry leaves where it is.
- **The sets of extra blobs.** Each set is, with chance 40% when the group has mirror lines, two line reps (a blob on a line has half as many images as one off the lines, so two make a set; each picks one of the lines at random and a place along it), and otherwise one free rep. So every set is exactly as many blobs as there are symmetries, whether it is on the lines or not.
- Each rep starts at a random place inside a disc of radius 4 (`SPAWN_START_RADIUS`), or along its line within 4 of the middle.
- A blob that is the same under several elements (on a line, or at the middle) is one blob, not several.

**2. Spread far apart** (relaxing, stage one). Rounds, up to 2000: every rep is moved by the sum of pushes from every other blob it is too close to, and the others are the images too, including its own. Two blobs are "too close" if they are less than `2 × (radius of one + radius of the other) + 1.4` apart (`SPAWN_GAP`), and for two starts also if they are less than the radii plus 4 (`START_BRIDGE`): the starts are never nearer than one typical bridge, whichever is more. A blob is pushed away by half the shortfall (plus 0.01) from each one; the sum for a rep is multiplied by 0.5 (`RELAX_STEP`) and applied to the rep only; a line rep only moves along its line, and the middle blob does not move. All reps move at once (from the positions at the start of the round), so the images follow exactly. Stops when no pair is more than 0.02 too close.

**3. The joining** (a symmetric spanning structure over the far apart blobs). Every pair of blobs is a possible corridor, and a corridor comes with all its copies under the group (its **orbit**: a corridor and its images; one that the group maps onto itself is just one corridor and has to run straight). Candidates are sorted by length (true distances). Three passes, each adding an orbit if one of its copies joins two pieces that are not yet joined (and then adding all its copies):

1. corridors that do not run through another blob (within that blob's radius + 0.5), leaving out the corridors the rules rule out;
2. the same, also allowing the ones that do run through another blob;
3. if the board is still not in one piece, everything, rules or not.

The rules: **the starts are never joined by a corridor of their own** unless there are no other blobs (then the starts have no other way to be joined); and **two blobs on the same mirror line are joined only on 30% of boards** (`SPINE_CHANCE`), since the corridor between them would run dead straight along the line. A blob on a line or at the middle joins the parts of the board together where it has to, and where nothing does, a corridor to an image of a blob does (a "crossover"). These are the **tree** corridors.

**4. Pulled together** (relaxing, stages two and three).

- Every tree orbit is given a target bridge, the same for all its copies: `bridgeLengths` is the same as for battle royales, `4 + (U₁ + U₂ − 1) × 2` as evenly spaced quantiles, shuffled over the orbits (so the average is always 4 and 3 in 4 are between 3 and 5). A corridor's target length is the two radii plus its bridge.
- **Stage two:** up to 2000 rounds. Each rep is moved as before, plus each tree corridor that ends at it pulls it a quarter of its error toward (or away from) its target length. Pairs that are not joined by a tree corridor are pushed to at least the two radii plus 1.4 apart (and for starts, plus 4). Stops when nothing is more than 0.02 off.
- **Stage three:** the corridors of a symmetric board go through the copies, so they can ask for lengths that cannot all be had at once, and the pulling can leave blobs too close. So the spacing is made a hard rule: a last relaxing with no corridors pulling, up to 2000 rounds, pushes apart whatever is too close.
- **Snapping.** The start rep is snapped to the nearest hex, so its city is exactly on a hex center; every other start is the hex the group's hex map takes it to (so they are exact). The other blobs keep their places.

**5. The loops and the widths.**

- **Loops:** every other pair, grouped in orbits as before, that is at most `1.4 ×` the median tree corridor length long, not ruled out, and not through another blob, sorted by length (ties broken randomly). Whole orbits are added, shortest first, until the number of loop corridors reaches `round(0.3 × the number of blobs)`.
- **Widths** (`assignWidths`, the same as for battle royales), one for each orbit, counted by its number of copies: a fixed set in exactly the proportions 30% 1-wide, 45% 2-wide, 25% 3-wide, shuffled and then swapped (a pair of orbits of different widths at a time) while that brings the area the corridors cover, bridge length × width × copies, closer to its budget (the total length times the average width 1.95).
- **Bend:** each orbit gets a random bend, uniform in ±0.15 of its length, the same for all its copies except that a mirror flips it (a mirror turns a bend the other way; a turn leaves it); a corridor the group maps onto itself is straight.

The first chambers are the starts (the first start, then its image under each element in order), then the middle blob if there is one, then the extras.

### Drawing (`duel/layout.ts`)

Once: the blueprint is rasterized (see Shared machinery), and because noise is not symmetric the land is the drawn land together with its images under every symmetry. Then it is tidied for 3 passes (rules that look at the board as it was before each step, so it stays exactly symmetric), and the biggest piece is kept (all of it, see below). There is no scale loop, no area bisection and no checks. Mirror duel and quad boards are then turned (see above).

### Why the starts are always safe

As for battle royale boards, nothing checks the starts:

- **The city and its six neighbors are land** in every start (the rasterizer protects them), and the images of land are land, so the board stays exactly symmetric with them in place. Tidying never removes a protected hex.
- **It is all one piece**, because the tree joins every blob (pass three allows any corridor if nothing else will), and every corridor's core is land.
- **The starts are all different hexes, and none is on a mirror line**, because two starts are always at least the two radii plus 4 apart, and a blob is at least that far from its own mirror image: so it is at least 3 from the line, far more than the rounding to a hex can close.

## Terrain: cities, villages, farmland

`placeTerrain` in `generate.ts`. Land tiles are first put in **groups that must share a type**: on fair boards the **orbit** of each tile (the tile and its images under every symmetry; a tile on a mirror line or at the middle is in a smaller orbit; an orbit is dropped if some member is not on the board), so every player sees the same terrain; on battle royale boards every hex is its own group. The start tiles are all cities already.

1. **Starting cities:** one per player, at the center of its start chamber, never on the edge, with the starting troops of the match config (10 by default), owned by that player. On fair boards the start orbit is exactly the set of starts.
2. **Other cities** (fair boards only; battle royale boards have none): the target is `tiles / 50` extra cities (`tilesPerCity`). Interior groups are tried in random order, and one becomes cities if that brings the count closer to the target and every member is at least **3** tiles (`minCityDistance`) from every other city (starting cities included) and from the other members. Never on the edge.
3. **Villages:** the groups are taken in random order, interior first, then edge groups. A group that is not already a city becomes villages if every member is not touching another village, is not touching a city (unless `villagesNextToCities`), and is at least `minVillageDistance` (2: never touching) from the other members; and a random roll passes (**40%**, `villageChance`; at 100 the board is filled until nowhere legal is left). Placing a village only ever removes options, so one pass leaves a board where no further village fits (when the chance is 100).
4. **Farmland** is everything else.

Neutral tiles start with their type's base garrison: farmland 1, village 4, city 10. Fair boards use `createRng(seed)` for this; battle royale boards continue the match's rng (the one that also shuffled the starts).

## Settings

`GenerationParams` in `params.ts`, with the defaults in `DEFAULT_GENERATION_PARAMS`. Matches use the defaults, except for the size, which follows the map size (`bowlRadiusFor(size, players)` for battle royales; `FAIR_BOWL_RADIUS[size]` and `extraSetsFor(size, players)` for fair boards). The generators take a `params` option with overrides, which the tests and the previewer use.

| Setting                | Default | Meaning                                                                                                                                                      |
| ---------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tilesPerCity`         | 50      | about one extra city per this many tiles (fair boards)                                                                                                       |
| `minCityDistance`      | 3       | cities are never closer than this to each other                                                                                                              |
| `villageChance`        | 40      | percent chance a village is placed where one fits                                                                                                            |
| `minVillageDistance`   | 2       | villages are never closer than this (2: never touching)                                                                                                      |
| `villagesNextToCities` | false   | may villages touch cities                                                                                                                                    |
| `bowlRadius`           | 1.6     | the radius of every start bowl, which sets the board size (rooms set it by map size: `bowlRadiusFor` for battle royales, `FAIR_BOWL_RADIUS` for fair boards) |
| `extraSets`            | none    | fair boards: how many sets of extra blobs (rooms set it by map size: `extraSetsFor`); without it, `round(2 × radius / symmetries)`; battle royales have none |
| `coastRoughness`       | 1       | how far noise pushes the coast in and out, in tiles                                                                                                          |
| `coastDetail`          | 5       | size of the coast's bumps, in tiles                                                                                                                          |
| `warpStrength`         | 1.5     | how far noise bends the chambers out of round, in tiles                                                                                                      |

Constants that are not settings (blob size, spacing, corridor widths and weights, relaxing rounds, and so on) are named constants in the code, listed in the sections above.

## The map previewer

`/?maps` (development only: a production build ignores it; code in `apps/client/src/ui/MapsPage.tsx`, bridge in `apps/client/src/preview.ts`) draws boards with the game's own `Board`, with a panel of generation settings on the left. It has modes **Duel**, **Trio**, **Quad**, **Sextet** and **Royale**, a map size bar, the options that kind of board has (duel and sextet: symmetry and mirror line; royale: player count and archetype), and a **Generate new map** button (a new random seed).

- **Show blueprint** draws the chambers and corridors over the board.
- **Show fog** draws the board as one random player sees it, covered in fog: the viewer is `players[floor(createRng(seed).next() × count)]`.
- **Generation parameters** shows and edits the settings above. Changed ones are marked.
- The report line under the controls says how the board was made: tiles, seed, symmetry and blobs for fair boards; for royale boards the archetype and the bowl radius.

The address sets where it starts: `/?maps&mode=ffa&size=large&players=8&seed=123&archetype=scattered&blueprint&fog`. `mode` is `duel`, `trio`, `quad`, `six` or `ffa`; duels and sextets take `symmetry` and `axis`; duels and quads take `turns`. A seed in the address reproduces a board exactly.

## Tests

- `royale/royale.test.ts`: topology (the tail finder), royale layouts (determinism, one connected piece, every start city and its ring kept at every size and player count, the starts all different, about the old size per player at each map size, the bowl radius formula, peninsulas now and then).
- `duel/duel.test.ts`: the blueprints of every kind of fair board (the eight kinds: duel mirror through corners or edges, duel half turn, trio, quad, and the three sextets): the blueprint maps onto itself under every symmetry, corridors and widths included; the starts come first and are never joined directly (unless they are the only blobs); it is all one piece with widths 1 to 3; a blob at the middle some of the time, and none beyond the starts on small boards; blobs on one mirror line joined only sometimes.
- `duel/symmetry.test.ts`: the symmetry groups (closed, distinct, hex and point maps agree).
- `fairMatches.test.ts`: the finished fair boards, for the same eight kinds: determinism, exact symmetry of the tiles under every symmetry, one start city per player (all twins, each with a full ring of land), base garrisons, more blobs and more land on bigger boards, and the terrain rules (cities never too close or on the edge, villages never touching, villages placed until nowhere is left); plus the duel's kinds and turns, the quad's turns, the sextet's groups, and the number of players.
- `generate.test.ts`: battle royale matches: determinism, size with the number of players, one start city per player away from the edge, terrain rules.
