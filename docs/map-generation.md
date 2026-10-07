# Map generation

`packages/shared/src/generate.ts` builds boards in two flavors. `createSymmetricMatch` makes fair boards for 2, 3, 4 or 6 players; `createFreeForAllMatch` makes random boards for any number of players. Given the same options and seed, both always produce the same board. Cities, villages and farmland follow the same rules in both (see Tile types), and the code for placing them is shared.

## Symmetry

The board is split into **orbits**: sets of tiles that map onto each other under the board's symmetry. Every tile in an orbit gets the same type, so each player sees the same surroundings, rotated or mirrored.

- **Rotational** (3 or 6 players, or 2): 6-fold rotation.
- **Mirror** (2 or 4 players, the default for both). With 4 players: left-right and top-bottom mirrors, plus the 180 degree turn they imply. With 2 players: only the left-right mirror, so the two halves face each other but neither half is symmetric itself.
- 5 players is unsupported, and mirror boards are rejected for 3 and 6 players (and rotational for 4).

Starting positions are matching spots one tile in from the edge of the board: left and right for 2 players, and one per quadrant for 4. Every image of a start tile is a city, owned by a player if there is one for it (with 4 players and 2-player rotational boards that is every image; with a 2-player mirror there are exactly two). Start cities are at least 4 tiles apart, which is why boards need a radius of at least 5.

## Tile types

1. **Starting cities** as above.
2. **Other cities** are rare: about one per 50 tiles, not counting the starting cities. Orbits are tried in random order, and one is added only if it brings the number of extra cities closer to that target. Cities are never closer than **4 tiles** to any other city, starting cities included, and are never placed on the edge of the board.
3. **Villages** are placed randomly until nowhere legal is left. A village never touches another village or a city. Edge tiles are only considered once no interior tile can take a village. Placing a village only removes options, so a single random pass over the orbits leaves a board where no further village fits.
4. **Farmland** is everything else.

Neutral tiles start with their type's base garrison.

## Free-for-all boards

A free-for-all board has no symmetry; the terrain is simply random, within the tile rules above.

- **Size:** `recommendedRadius` picks a board with about 50 tiles per player (radius 6 for 3 players, 12 for 8, 41 for 100). Boards for symmetric games have fixed recommended sizes (radius 7 for a duel up to 10 for 6 players).
- **Starting cities:** one per player, at least 4 tiles apart and at least one tile in from the edge, spread as evenly as the board allows. The generator tries many random layouts, each time putting the next player as far as it can from the ones already placed, and keeps the layout whose closest pair of players is furthest apart. It rejects boards too small to hold everyone 4 tiles apart.
- **Who starts where:** players are assigned to the starting cities at random.
- **Other cities and villages:** as above, with each tile its own group instead of a symmetry orbit. Extra cities are about one per 50 tiles on top of the starting cities.

Because nothing about the layout is symmetric, free-for-all boards are not perfectly fair. The spacing and the farm rings around every producer keep it close, and we can tune it further as we play.

## Previewing maps

The menu's **Preview generated maps (dev)** link shows boards locally without a server. It can generate a 2, 3, 4 or 6 player symmetric board, or a free-for-all with 3 to 100 players, at the recommended size or a chosen radius. Changing an option generates a new map, and the line under the buttons shows the seed and the numbers of tiles, cities and villages. Very large boards (the 100-player one has over 5,000 tiles) take a few seconds to draw.
