# Lobby and rooms

Everything before and after a match happens in a **room**. A room owns its match and its timers; the `Lobby` (`apps/server/src/lobby.ts`) only creates, finds and forgets rooms, and handles the main menu.

## Room life cycle

`lobby` (gathering players) → `running` (the match) → `finished` (the result stays up) → closed.

There is no countdown screen: the match is created the moment the room starts, and everyone goes straight to the board. The first tick comes `PREP_MS` (5 seconds) later. During that **planning period** players can look at the map, queue orders (the server accepts them as soon as the match exists) and see a quick animation marking their starting tile; the timer in the HUD counts down to the first tick.

- **Public rooms** (from Quick play) start by themselves as soon as they are full. A public battle royale can also start early (see below).
- **Private rooms** (Create a private game) have a host, who chooses the settings and presses Start once the room is full. If the host leaves, the next player becomes host.
- A duel needs exactly 2 players. A battle royale takes 3 to 12, and **never starts with more than 12 players**, in public or private games. The cap is enforced when players join, and a room's size is fixed by its mode, so even a host cannot raise it.
- A finished room stays open for ten minutes or until everyone has left, so players can look at the result. Players leave with the "Main menu" button.

## Ways in

1. **Quick play:** join an open public room of the chosen mode (duel or battle royale), or open one.
2. **Create a private game:** get a short code and an invite link (`/?join=CODE`). Opening the link joins that game.
3. **Join with a code:** codes are 5 characters and ignore case.

## Battle Royale rooms

- **Size:** a room holds up to 12 players and needs at least 3 to start. The board is generated for however many are playing (sized at about 20 tiles per player), and everyone is placed at random on a starting city.
- **Early start (public rooms):** when the room reaches 3 players, a countdown starts at 60 seconds (`EARLY_START_MS`). When it ends, the match starts with whoever is there. A player joining doesn't reset it, but tops it up to at least 10 seconds (`JOIN_WAIT_MS`) so newcomers have time to settle in. A player leaving doesn't reset it either; only dropping below 3 players cancels it, and it starts again at 60 seconds when the room gets back to 3. A full room (12) starts at once.
- **Private rooms:** no early start. The host starts the game whenever at least 3 players are in, with however many there are.
- **Voting to start early (public rooms):** the lobby shows a head count ("7 / 12 players") instead of a player list, then the big countdown, then a **Vote to start early (votes/needed)** button, which only appears once there are 3 players. When at least two thirds of the players in the room (rounded up) have voted, the wait drops to 5 seconds (`VOTE_START_MS`; a wait that is already shorter is left alone) and the room stops taking newcomers. Votes can be taken back until the vote passes; players who leave have their vote removed, and fewer than 3 players calls the early start off.
- **Late joiners:** once the vote has passed, the room is closed; anyone arriving through Quick play goes to a new room.

## Duel lobbies

A duel lobby shows you and your opponent side by side ("VS"), with a pulsing placeholder and "Waiting for an opponent..." until someone joins.

## Settings

A private room's host can change the game mode (duel or battle royale), the **map size** (small, normal or large), the **tick length** (any value from 0.1 to 60 seconds in steps of 0.1; the slider covers 0.1 to 5) and starting troops, while the room is still gathering players. Everyone else sees the same information as plain text, not as disabled controls. Everything is a `MatchConfig` field or a room setting, validated on the server (`applySettingsPatch`), so more settings are just more fields in the form. Public rooms use fixed defaults. The troop production speed is no longer offered in the lobby (it is still a match setting).

## Leaving, disconnecting and coming back

- **Leaving a lobby** just removes you. **Leaving a running match** is a surrender.
- **Disconnecting** during a match keeps your slot and your queue running. If you are still gone after two minutes (`AFK_MS`), your army surrenders. Reconnecting in time puts you back in the match. A disconnect in a lobby removes you straight away.
- Other players see who is disconnected in the room's player list (`connected` on each player).
- Your guest token (kept per browser tab for now) is what ties a new connection to your old slot.

## Identity and ids

- Guests have a `userId` that lasts for their session and a token that proves it. Accounts will replace this; a room will get a `ranked` flag that rejects guests.
- **Room ids are random UUIDs and are never reused**, even across server restarts, so replays can be saved under them. The match uses its room's id. The short join code is only unique among open rooms and is freed when the room closes.
- Who starts where is decided randomly when the match starts.

## Protocol

- Client: `hello`, `setName`, `quickPlay` (with a mode), `voteStart`, `createRoom`, `joinRoom`, `updateRoom`, `startGame`, `leaveRoom`, plus the in-match `order` and `surrender`.
- Server: `welcome`, `denied` (see below), `room` (your room, or `null` for the menu; sent on every change), `stats` (online counts for the menu), `snapshot`, `tick`, `queued`, `rejected`.

## Beta access code

When the server has a `BETA_CODE`, `hello` must carry it (`code`). Without the right one the server answers `denied` (`code required` or `wrong code`) and nothing else works on that connection; a connection that guesses wrong five times is dropped. The client shows an access screen, remembers the code in the browser, and forgets it if the server later refuses it. The comparison is constant-time. With no `BETA_CODE` the server is open.

## Not built yet

A public game list, spectators, bots, ranked rooms and reconnecting after a server restart.

## Map sizes

| Size   | Duel (board radius) | Battle royale (tiles per player) |
| ------ | ------------------- | -------------------------------- |
| Small  | 4                   | 14                               |
| Normal | 5                   | 20                               |
| Large  | 7                   | 30                               |

Normal is what quick play uses. The radius is that of the hexagon the random outline stands in for, so real boards are a little ragged around it (see `docs/map-generation.md`). A battle royale board is sized from the number of players, with a minimum radius of 5.
