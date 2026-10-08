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

A battle royale board has no symmetry; the terrain is simply random, within the tile rules above.

- **Size:** the board is always the smallest that gives each player their share, 20 tiles per player by default (radius 5 for 3 players, 8 for 8, 26 for 100), so starting cities end up only a few tiles apart. `recommendedRadius` decides it from the number of players and the tiles per player of the chosen map size. A duel's radius comes from the map size (4, 5 or 7).
- **Starting cities:** one per player, at least 3 tiles apart and at least one tile in from the edge, spread as evenly as the board allows. The generator tries many random layouts, each time putting the next player as far as it can from the ones already placed, and keeps the layout whose closest pair of players is furthest apart. It rejects boards too small to hold everyone 3 tiles apart.
- **Who starts where:** players are assigned to the starting cities at random.
- **Cities and villages:** there are no cities except the starting ones, so each player's start is the only city nearby. Villages follow the rules above, with each tile its own group instead of a symmetry orbit.

Because nothing about the layout is symmetric, battle royale boards are not perfectly fair. The spacing and the farm rings around every producer keep it close, and we can tune it further as we play.

## Settings

Every number above is a generation setting (`GenerationParams` in `packages/shared/src/params.ts`, with the defaults in `DEFAULT_GENERATION_PARAMS`): outline size and waves, lake frequency and size, city density and spacing, village chance and spacing, start inset and room, and tiles per player. Matches use the defaults, except that the map size picks the duel radius and the battle royale tiles per player. The generators take a `params` option with overrides, which tests use.
