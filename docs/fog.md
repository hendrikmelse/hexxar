# Fog of war

Fog is on by default (`MatchConfig.fog`, `'on'` or `'off'`). Private games can switch it off in the lobby; quick play always uses it.

## What a player sees

| Distance from your tiles | What you see                                                                     |
| ------------------------ | -------------------------------------------------------------------------------- |
| Your own tiles           | Everything                                                                       |
| 1 tile away              | Everything (type, owner, troops)                                                 |
| 2 tiles away             | The **owner and type** of the tile, but not its troops                           |
| Further                  | Nothing: clouds. The board's outline is public, so you know where the tiles are. |

Players who are out of the game, and everybody once the match is over, see the whole board.

## Where it is enforced

The server never sends what a player may not see. `visibleState(state, player, config)` (`packages/shared/src/visibility.ts`) turns the real state into that player's view: tiles out of sight become blank (`farmland`, no owner, no troops), tiles two steps away lose their troops. Every snapshot and every tick diff is computed from it per player, so tiles entering and leaving view are sent like any other change. `visibleMoves` does the same for the armies shown walking: a move is only sent if one of its ends is in full view.

`visionOf(tiles, player)` (`vision.ts`) works out the levels. The client runs the same function over its own tiles to know where to draw clouds (it cannot be told: out-of-sight tiles are blank, indistinguishable from real empty ones).

## The scoreboard is not fogged

Every snapshot and tick carries `scores` (tiles, troops and generation capacity per player, from `scoresOf`). The list on the left and the production pie are drawn from those, so you can always see how strong everyone is, including a player you have only just found.

## Drawing it

`apps/client/src/clouds.ts` keeps a bank of soft cloud sprites over each tile that is not in full view, drifting slowly and fading in or out as vision changes. A tile hidden entirely gets a thick bank. A tile seen from two steps away gets a smaller bank pushed to its far side, so the edge facing your territory stays clear: its owner colour and the border graphics (which tell cities from villages) still show there. A tile an army is still walking onto keeps its old vision until the army lands, so the fog does not lift early.
