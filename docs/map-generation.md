# Map generation

`packages/shared/src/generate.ts` builds boards in two flavors. `createDuelMatch` makes the fair two-player boards (games use it for duels); `createFreeForAllMatch` makes random boards for any number of players (battle royales). Given the same options and seed, both always produce the same board. Cities, villages and farmland follow the same rules in both (see Tile types), and the code for placing them is shared. Both draw their land the same way, from a **blueprint** of round chambers ("blobs") joined by corridors, which `royale/` and `duel/` lay out and rasterize onto hexes.

## Duel boards

A duel board is **exactly symmetric**, in one of two ways, picked by the seed (or by the `symmetry` option): a **mirror** (left to right), or a **half turn** (180 degrees about the middle). The code is in `packages/shared/src/duel/`.

The board is split into **orbits**: a tile and its twin (a tile on the line or point of symmetry is alone). Every tile in an orbit gets the same type, so each player sees the same surroundings, mirrored or turned. The two players start on twin cities.

- **Size:** `tiles` is about how many tiles the board has (`DUEL_TILES`: 36, 100 and 160 at small, normal and large; about 18, 50 and 80 tiles for each of the two players). There is no radius.
- **Blobs:** one starting blob (and its twin across the board) and a few extra blobs. An extra blob is either on the line (mirror) or at the middle (half turn), where it has no twin, or off it, where it comes with a twin. Only one blob can be at the middle of a half-turn board. Bigger boards have both more blobs (about one extra for every 2.2 tiles of board radius) and slightly bigger ones (radius 1.2 plus a tenth of the board's radius, at most 2.4).
- **Corridors** join the blobs. Each corridor is added together with its twin (a mirror turns a corridor's bend the other way), so the whole layout maps onto itself. A spanning tree makes everything reachable, a few more short corridors make loops, and the rule from battle royales applies: no tail or peninsula longer than one corridor.
- **Drawing:** the blueprint is drawn onto hexes with noise (the same as battle royales: see below). Noise is not symmetric, so the land is what was drawn together with its image, then tidied with rules that look at the board as it was before each step, so the result stays exactly symmetric. Only the piece with the starts is kept. The city and the ring of land round it in each start blob are never removed.
- **Area:** blob sizes and counts come from the board's size, so only the distance between blobs changes as the layout is stretched to the right area. The land is then grown or shrunk by a fraction of a tile everywhere until the tile count is within 3% of the target (boards more than 8% off are thrown away and drawn again; the first try nearly always passes).
- **No fallback:** if no board can be made in 200 attempts, generation throws (it did not happen in testing), and the room tries another seed.

## Tile types

1. **Starting cities** as above (on duel boards the two twin cities; on battle royale boards one in each spawn chamber).
2. **Other cities** are rare: about one per 50 tiles, not counting the starting cities. Orbits are tried in random order, and one is added only if it brings the number of extra cities closer to that target. Cities are never closer than **3 tiles** to any other city, starting cities included, and are never placed on the edge of the board.
3. **Villages** are placed randomly wherever they fit. Each legal spot gets one with the village chance (40% by default); at 100% the board is filled until nowhere legal is left. A village never touches another village or a city. Edge tiles are only considered once no interior tile can take a village. Placing a village only removes options, so a single random pass over the orbits leaves a board where no further village fits.
4. **Farmland** is everything else.

Neutral tiles start with their type's base garrison.

## Battle Royale boards

A battle royale board has no symmetry. It is drawn from a **blueprint** by the code in `packages/shared/src/royale/`, not by `randomShape` (which only duels use).

1. **Blueprint** (`archetypes/`): an archetype lays out round **chambers** and **corridors** between them, in tile units (one unit is the distance between neighboring hex centers), never touching hexes. There is one **spawn chamber** per player, all the same size so no player starts with a roomier bowl, spread out by picking the best of several random spots for each. Neutral chambers (round rooms with no city) are supported by the layout code but the `scattered` archetype asks for none: the starting bowls fill the land, so such rooms only fit on a few boards, and look like a start with nobody in it. Corridors get a random width (1, 2, 3 or 4 hexes; about 85% are narrow enough to count as chokes) and a slight bend. Chamber and corridor sizes are absolute: only the distances between chambers scale with the board, so a 1-wide choke is 1 wide on every map size. Only one archetype exists so far, `scattered` (chambers at random, joined by a spanning tree plus a few extra loops).

   **Topology rules** (`topology.ts`): no **tail or peninsula longer than one corridor**. A dead-end chamber may hang straight off a junction, but a dead end reached through a chain of chambers that each have only two corridors (a snake, or a dead end behind a dead end) is not allowed. The archetype fixes a tail by joining its end to the nearest chamber it is not yet joined to, which closes it into a loop, and the validator rejects any layout that still has one. Loops themselves are not required.

   **Peninsulas** are dead-end chambers: one corridor, off a junction (the rule above keeps them from being any longer). Nothing adds them on purpose. They come up where the spanning tree has a leaf, and a player's starting chamber can be one. Not every board has one (with 6 or more players, about 55% to 85% do, usually one or two; boards for 3 players rarely do). Loops come from the extra corridors beyond the spanning tree and from the tails that are closed up; boards typically have 2 to 5.

2. **Rasterize** (`rasterize.ts`): every hex center is tested against a field that is positive inside the chambers and corridors (blended smoothly where they meet) and bent by seeded noise, so rooms are lumpy and the coast is natural. The hexes along every corridor's centerline, and the city and the ring around it in every spawn chamber, are land whatever the noise says.
3. **Area:** the same blueprint is redrawn at a corrected scale (up to 6 times) until the land is within 6% of the target. A candidate more than 12% off is thrown away.
4. **Cleanup:** one-tile bays are filled, one-tile spurs trimmed, and everything but the biggest connected piece removed. The board is then recentered on the origin.
5. **Analyze** (`analyze.ts`): the finished board is measured, not the blueprint. For each corridor, the land is measured at right angles to its centerline along its middle stretch; the narrowest cross section is its width (a **choke** if at most 3 hexes) and it is a **cut** if closing it splits the board in two pieces.
6. **Validate:** a candidate must have every city on a non-edge tile (so a full ring of neighbors), cities at least `minStartDistance` apart, at least 2 chokes, no more than 40% of its land deeper than 4 tiles inland (that would be a blob), and a fairness score of at most 0.8 (below). Otherwise the next seed is tried, up to 80 times in total. The reasons candidates are thrown away are in the report that `createFreeForAllMatch` returns, which the map previewer shows.

- **Size:** the target is the number of players times `tilesPerPlayer` (or `minTilesPerPlayer`, a floor that is off by default). A map size sets both `tilesPerPlayer` (15, 25 or 45 at 6 players; fewer per player for more players, see `royaleTilesPerPlayer`) and `minStartDistance` (3, 4 or 5 on small, normal and large, see `ROYALE_START_DISTANCE`). Cities that far apart need about that distance squared in tiles each, so small boards could not hold their players with the large spacing. Spawn chambers shrink with the spacing (radius 1.2 to 2), and so does the open ground required between chambers.
- **Starting cities:** one per player, at the center of its spawn chamber, never on the edge. Players are assigned to them at random. There are no cities except the starting ones, and villages are placed as on duel boards.

### Fairness

**Switched off for now** (`checkFairness`, off by default; the previewer has a checkbox for it), to see how boards turn out without it. The score is still measured and shown. When it is on:

- **By construction:** every spawn chamber gets the same number of ways out (two, or three on some boards with room; the longest extra ones are dropped, as long as that leaves no long tail, or one is added to the nearest chamber), all of one width on a board. This also means no starting chamber is a peninsula. Spawn chambers are all the same size either way.
- **Territories:** the land is split between the players by walking distance from their cities. Each player's **reach** is the number of tiles within 5 steps of their city.
- **Score:** how much territory sizes and reaches differ, each as a standard deviation over the mean, added up. 0 is perfectly even; boards over 0.8 are thrown away.
- **Best of several:** `fairnessCandidates` (4) valid boards are drawn and the one with the lowest score is used. Boards with more players are inherently less even, since the players' land overlaps.

### Villages

Villages use the same placement as duel boards (see Tile types), with each tile its own group: a random pass over the interior tiles, then the edge tiles, each place getting a village with the village chance (40%) if it does not touch a city or another village. Nothing makes the villages even between players, only the evenness of the land itself.

The map previewer (`/?maps`) draws each board with the game's own board drawing (`Board` in the client), with a panel of generation settings beside it. The panel shows the numbers for each board, can draw the blueprint or tint the board by territory over it, and collects statistics over 100 seeds. The address can set where it starts: `/?maps&mode=ffa&size=large&players=8&seed=123&archetype=scattered&blueprint&territories`, which also gets back to a particular board.

## Settings

Every number above is a generation setting (`GenerationParams` in `packages/shared/src/params.ts`, with the defaults in `DEFAULT_GENERATION_PARAMS`): city density and spacing, village chance and spacing, the battle royale tile and spacing settings, and the coast settings that both kinds of board share. Matches use the defaults, except that the map size picks the number of tiles of a duel board and the battle royale tiles per player and city spacing (which also depend on the number of players). The generators take a `params` option with overrides, which tests use.
