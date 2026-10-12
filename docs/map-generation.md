# Map generation

`packages/shared/src/generate.ts` builds boards in two flavors. `createSymmetricMatch` makes fair boards for 2, 3, 4 or 6 players (games use it for duels); `createFreeForAllMatch` makes random boards for any number of players (battle royales). Given the same options and seed, both always produce the same board. Cities, villages and farmland follow the same rules in both (see Tile types), and the code for placing them is shared.

## Symmetry

The board is split into **orbits**: sets of tiles that map onto each other under the board's symmetry. Every tile in an orbit gets the same type, so each player sees the same surroundings, rotated or mirrored.

- **Rotational** (3 or 6 players, or 2): the board maps onto itself when turned by 360 / players degrees: 180 degrees for 2 players, 120 for 3, 60 for 6. It is never more symmetric than the player count needs.
- **Mirror** (2 or 4 players, the default for both). With 4 players: left-right and top-bottom mirrors, plus the 180 degree turn they imply. With 2 players: only the left-right mirror, so the two halves face each other but neither half is symmetric itself.
- 5 players is unsupported, and mirror boards are rejected for 3 and 6 players (and rotational for 4).

Starting positions are matching spots one tile in from the edge of the board: left and right for 2 players, and one per quadrant for 4. Every image of a start tile under the board's symmetry is a starting city, and the symmetry groups are exactly as big as the player count, so every starting city belongs to a player and there are no spare ones. Start cities are at least 3 tiles apart (the same minimum as for any two cities). Symmetric boards need a radius of at least 4.

## Board shape

Every board has a random outline, so you never see a plain hexagon. `randomShape` (`packages/shared/src/shape.ts`) builds it:

- **Outline:** a circle bent by a few random waves, so the board has lobes and bays instead of six straight sides, with each tile's edge position jittered for a rough coast. A circle with the radius of the hexagon it stands in for holds about the same number of tiles, so "radius" below means the size of that stand-in hexagon.
- **Tidying:** tiles that stick out as spurs (two or fewer neighbors) are removed and one-tile bays are filled, and tiny islands are dropped, so the coast is jagged but never noisy.
- **Cutouts:** a few lakes are carved out of the inside. Each is one big blob of contiguous tiles (at least 6, up to about 8% of the board), grown compactly, and kept at least 3 tiles from the coast (so there is always room to walk around), from every starting city, and from other lakes.
- **Checks:** the board must be one connected piece, within 50% to 130% of the hexagon's area, keep the room around every starting city, and not be the plain hexagon itself, otherwise another outline is tried (up to 500 times; small boards fail most attempts, but a few hundred are cheap). If none passes, generation fails rather than hand back a hexagon.
- **Symmetry:** symmetric boards keep their symmetry. A tile is land if it or any of its images would be, and lakes are carved out along with all of their images, so the whole board maps onto itself.
- **Starting cities:** protected, with a ring of land around each one.

"Edge" means a tile with a missing neighbor, whether at the coast or beside a lake. Cities never go on edge tiles, so every city has a full ring of six neighbors, and villages fill the interior before the edge.

## Tile types

1. **Starting cities** as above.
2. **Other cities** are rare: about one per 50 tiles, not counting the starting cities. Orbits are tried in random order, and one is added only if it brings the number of extra cities closer to that target. Cities are never closer than **3 tiles** to any other city, starting cities included, and are never placed on the edge of the board.
3. **Villages** are placed randomly wherever they fit. Each legal spot gets one with the village chance (40% by default); at 100% the board is filled until nowhere legal is left. A village never touches another village or a city. Edge tiles are only considered once no interior tile can take a village. Placing a village only removes options, so a single random pass over the orbits leaves a board where no further village fits.
4. **Farmland** is everything else.

Neutral tiles start with their type's base garrison.

## Battle Royale boards

A battle royale board has no symmetry. It is drawn from a **blueprint** by the code in `packages/shared/src/royale/`, not by `randomShape` (which only duels use).

1. **Blueprint** (`archetypes/`): an archetype lays out round **chambers** and **corridors** between them, in tile units (one unit is the distance between neighboring hex centers), never touching hexes. There is one **spawn chamber** per player, all the same size so no player starts with a roomier bowl, spread out by picking the best of several random spots for each. Neutral chambers vary in size, and corridors get a random width (1, 2, 3 or 4 hexes; about 85% are narrow enough to count as chokes) and a slight bend. Chamber and corridor sizes are absolute: only the distances between chambers scale with the board, so a 1-wide choke is 1 wide on every map size. Only one archetype exists so far, `scattered` (chambers at random, joined by a spanning tree plus a few extra loops).
2. **Rasterize** (`rasterize.ts`): every hex center is tested against a field that is positive inside the chambers and corridors (blended smoothly where they meet) and bent by seeded noise, so rooms are lumpy and the coast is natural. The hexes along every corridor's centerline, and the city and the ring around it in every spawn chamber, are land whatever the noise says.
3. **Area:** the same blueprint is redrawn at a corrected scale (up to 6 times) until the land is within 6% of the target. A candidate more than 12% off is thrown away.
4. **Cleanup:** one-tile bays are filled, one-tile spurs trimmed, and everything but the biggest connected piece removed. The board is then recentered on the origin.
5. **Analyze** (`analyze.ts`): the finished board is measured, not the blueprint. For each corridor, the land is measured at right angles to its centerline along its middle stretch; the narrowest cross section is its width (a **choke** if at most 3 hexes) and it is a **cut** if closing it splits the board in two pieces.
6. **Validate:** a candidate must have every city on a non-edge tile (so a full ring of neighbors), cities at least `minStartDistance` apart, at least 2 chokes, no more than 40% of its land deeper than 4 tiles inland (that would be a blob), and a fairness score of at most 0.8 (below). Otherwise the next seed is tried, up to 80 times in total. The reasons candidates are thrown away are in the report that `createFreeForAllMatch` returns, which the map previewer shows.

- **Size:** the target is the number of players times `tilesPerPlayer` (or `minTilesPerPlayer`, a floor that is off by default). A map size sets both `tilesPerPlayer` (15, 25 or 45 at 6 players; fewer per player for more players, see `royaleTilesPerPlayer`) and `minStartDistance` (3, 4 or 5 on small, normal and large, see `ROYALE_START_DISTANCE`). Cities that far apart need about that distance squared in tiles each, so small boards could not hold their players with the large spacing. Spawn chambers shrink with the spacing (radius 1.2 to 2), and so does the open ground required between chambers.
- **Starting cities:** one per player, at the center of its spawn chamber, never on the edge. Players are assigned to them at random. There are no cities except the starting ones, and villages are placed as on symmetric boards.

### Fairness

Nothing about a battle royale layout is symmetric, so fairness is built in and measured (`fairness.ts`):

- **By construction:** every spawn chamber gets the same number of ways out (two, where the layout allows it; the longest extra ones are dropped, or one is added to the nearest chamber), and all passages leaving a spawn chamber have the same width on a board. Spawn chambers are all the same size.
- **Territories:** the land is split between the players by walking distance from their cities. Each player's **reach** is the number of tiles within 5 steps of their city.
- **Score:** how much territory sizes and reaches differ, each as a standard deviation over the mean, added up. 0 is perfectly even; boards over 0.8 are thrown away.
- **Best of several:** `fairnessCandidates` (4) valid boards are drawn and the one with the lowest score is used. Boards with more players are inherently less even, since the players' land overlaps.

### Villages

Villages use the same placement as symmetric boards (see Tile types), with each tile its own group: a random pass over the interior tiles, then the edge tiles, each place getting a village with the village chance (40%) if it does not touch a city or another village. Nothing makes the villages even between players, only the evenness of the land itself.

The map previewer (`/?maps`) shows the numbers for each board, can tint the board by territory, and collects statistics over 100 seeds.

## Settings

Every number above is a generation setting (`GenerationParams` in `packages/shared/src/params.ts`, with the defaults in `DEFAULT_GENERATION_PARAMS`): outline size and waves, lake frequency and size, city density and spacing, village chance and spacing, start inset and room, tiles per player, and the battle royale coast and spacing settings. Matches use the defaults, except that the map size picks the duel radius and the battle royale tiles per player (which also depends on the number of players). The generators take a `params` option with overrides, which tests use.
