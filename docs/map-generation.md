# Map generation

`createSymmetricMatch` (`packages/shared/src/generate.ts`) builds fair boards for 2, 3, 4 or 6 players. Given the same options and seed it always produces the same board.

## Symmetry

The board is split into **orbits**: sets of tiles that map onto each other under the board's symmetry. Every tile in an orbit gets the same type, so each player sees the same surroundings, rotated or mirrored.

- **Rotational** (3 or 6 players, or 2): 6-fold rotation.
- **Mirror** (2 or 4 players, the default for both). With 4 players: left-right and top-bottom mirrors, plus the 180 degree turn they imply. With 2 players: only the left-right mirror, so the two halves face each other but neither half is symmetric itself.
- 5 players is unsupported, and mirror boards are rejected for 3 and 6 players (and rotational for 4).

Starting positions are matching spots on the rim: the left and right corners for 2 players, and one per quadrant for 4. Every image of a start tile is a city, owned by a player if there is one for it (with 4 players and 2-player rotational boards that is every image; with a 2-player mirror there are exactly two). Start cities are at least 4 tiles apart.

## Tile types

1. **Starting cities** as above.
2. **Other cities** are rare: about one per 50 tiles, not counting the starting cities. Orbits are tried in random order, and one is added only if it brings the number of extra cities closer to that target. Cities are never closer than **4 tiles** to any other city, starting cities included.
3. **Villages** are placed randomly until nowhere legal is left. A village never touches another village or a city. Placing a village only removes options, so a single random pass over the orbits leaves a board where no further village fits.
4. **Farmland** is everything else.

Neutral tiles start with their type's base garrison.

## Previewing maps

While this is being tuned, the client has a temporary **Generate new map** button. It generates a map locally with the current match's player count and board size and shows it in place of the live match; **Back to match** returns. Neither affects the server.
