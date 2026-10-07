# Map generation

`packages/shared/src/generate.ts` builds boards in two flavors. `createSymmetricMatch` makes fair boards for 2, 3, 4 or 6 players; `createFreeForAllMatch` makes random boards for any number of players. Given the same options and seed, both always produce the same board. Cities, villages and farmland follow the same rules in both (see Tile types), and the code for placing them is shared.

## Symmetry

The board is split into **orbits**: sets of tiles that map onto each other under the board's symmetry. Every tile in an orbit gets the same type, so each player sees the same surroundings, rotated or mirrored.

- **Rotational** (3 or 6 players, or 2): the board maps onto itself when turned by 360 / players degrees: 180 degrees for 2 players, 120 for 3, 60 for 6. It is never more symmetric than the player count needs.
- **Mirror** (2 or 4 players, the default for both). With 4 players: left-right and top-bottom mirrors, plus the 180 degree turn they imply. With 2 players: only the left-right mirror, so the two halves face each other but neither half is symmetric itself.
- 5 players is unsupported, and mirror boards are rejected for 3 and 6 players (and rotational for 4).

Starting positions are matching spots one tile in from the edge of the board: left and right for 2 players, and one per quadrant for 4. Every image of a start tile under the board's symmetry is a starting city, and the symmetry groups are exactly as big as the player count, so every starting city belongs to a player and there are no spare ones. Start cities are at least 3 tiles apart (the same minimum as for any two cities). Boards need a radius of at least 5.

## Board shape

Both generators take a `shape`: `hexagon` (the default, a regular hexagonal board) or `random`. `randomShape` (`packages/shared/src/shape.ts`) builds the random outline:

- **Outline:** a circle bent by three random waves, so the board has lobes and bays instead of six straight sides, with each tile's edge position jittered for a rough coast. A circle with the radius of the hexagon it stands in for holds about the same number of tiles.
- **Tidying:** tiles that stick out as spurs (two or fewer neighbors) are removed and one-tile bays are filled, and tiny islands are dropped, so the coast is jagged but never noisy.
- **Cutouts:** a few lakes are carved out of the inside. Each is one big blob of contiguous tiles (at least 5, up to about a thirtieth of the board), grown compactly, and kept at least 3 tiles from the coast (so there is always room to walk around), from every starting city, and from other lakes.
- **Checks:** the board must be one connected piece, within about 70% to 130% of the hexagon's area, and keep the room around every starting city, otherwise another shape is tried.
- **Symmetry:** symmetric boards keep their symmetry. A tile is land if it or any of its images would be, and lakes are carved out along with all of their images, so the whole board maps onto itself.
- **Starting cities:** protected, with two rings of land around each one.

"Edge" now means a tile with a missing neighbor, whether at the coast or beside a lake. Cities never go on edge tiles, so every city has a full ring of six neighbors, and villages fill the interior before the edge.

## Tile types

1. **Starting cities** as above.
2. **Other cities** are rare: about one per 50 tiles, not counting the starting cities. Orbits are tried in random order, and one is added only if it brings the number of extra cities closer to that target. Cities are never closer than **3 tiles** to any other city, starting cities included, and are never placed on the edge of the board.
3. **Villages** are placed randomly until nowhere legal is left. A village never touches another village or a city. Edge tiles are only considered once no interior tile can take a village. Placing a village only removes options, so a single random pass over the orbits leaves a board where no further village fits.
4. **Farmland** is everything else.

Neutral tiles start with their type's base garrison.

## Free-for-all boards

A free-for-all board has no symmetry; the terrain is simply random, within the tile rules above.

- **Size:** the board is always the smallest that gives each player their share, 36 tiles per player (radius 6 for 3 players, 10 for 8, 35 for 100), so starting cities end up around 6 tiles apart. The size is not a setting; `recommendedRadius` decides it. Symmetric games have fixed recommended sizes (radius 7 for a duel up to 10 for 6 players).
- **Starting cities:** one per player, at least 3 tiles apart and at least one tile in from the edge, spread as evenly as the board allows. The generator tries many random layouts, each time putting the next player as far as it can from the ones already placed, and keeps the layout whose closest pair of players is furthest apart. It rejects boards too small to hold everyone 3 tiles apart.
- **Who starts where:** players are assigned to the starting cities at random.
- **Cities and villages:** there are no cities except the starting ones, so each player's start is the only city nearby. Villages follow the rules above, with each tile its own group instead of a symmetry orbit.

Because nothing about the layout is symmetric, free-for-all boards are not perfectly fair. The spacing and the farm rings around every producer keep it close, and we can tune it further as we play.

## Previewing maps

The menu's **Preview generated maps (dev)** link shows boards locally without a server, with a random shape or a plain hexagon. It can generate a 2, 3, 4 or 6 player symmetric board, or a free-for-all with 3 to 100 players, at the recommended size or a chosen radius. For 2 players there is a symmetry toggle (mirror or rotational); the other counts have it fixed and the control is locked. Changing an option generates a new map, and the line under the buttons shows the seed and the numbers of tiles, cities and villages. Very large boards (the 100-player one has over 5,000 tiles) take a few seconds to draw.
