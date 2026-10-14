# Lobby and rooms

Everything before and after a match happens in a **room**. A room owns its match and its timers; the `Lobby` (`apps/server/src/lobby.ts`) only creates, finds and forgets rooms, and handles the main menu.

## Room life cycle

`lobby` (gathering players) → `running` (the match) → `finished` (the result stays up) → closed.

There is no countdown screen: the match is created the moment the room starts, and everyone goes straight to the board. The first tick comes `PREP_MS` (6.5 seconds) later: 1.5 seconds go on the client's loading screen, leaving 5 seconds of **planning period** with the board in view. During that **planning period** players can look at the map, queue orders (the server accepts them as soon as the match exists) and see a quick animation marking their starting tile; the timer in the HUD counts down to the first tick.

- **Public rooms** (from Quick play) start by themselves when they are full, after a short pause (5 seconds, `FULL_WAIT_MS`; a duel's lobby shows the countdown, paused at 5 until the opponent joins) so everyone sees the full lobby first. If someone leaves during the pause, the room goes back to waiting. A public battle royale can also start early (see below).
- **Private rooms** (Create a private game) have a host, who chooses the settings and presses Start once the room is full. If the host leaves, the next player becomes host.
- **Spectators:** once a private room is full, or its game has begun, anyone who opens the invite link joins as a spectator (up to 20). They do not count toward the players, cannot start or change the game, and see the whole board, every player's queue and every generation ring. The room closes when the host leaves with no player left to take over, whoever is still watching; a host who is only watching keeps it open. Places are never filled for anyone: in the lobby, a player can press **Spectate** to step out (the host stays the host), and a spectator can press **Join as player** whenever there is a free place. When the host changes the kind of game, the players who arrived last (never the host) become spectators of a duel, and the places a battle royale opens up stay empty. In a duel, everyone sees the two players in the same order, with their own box highlighted.
- A duel needs exactly 2 players. A battle royale takes 3 to 12, and **never starts with more than 12 players**, in public or private games. The cap is enforced when players join, and a room's size is fixed by its mode, so even a host cannot raise it.
- A finished room stays open for ten minutes or until everyone has left, so players can look at the result. Players leave with the "Main menu" button.

## Ways in

1. **Quick play:** join an open public room of the chosen mode (duel or battle royale), or open one.
2. **Create a private game:** get a short code and an invite link (`/?join=CODE`). Opening the link joins that game.
3. **Join with a code:** codes are 5 characters and ignore case.

## Battle Royale rooms

- **Size:** a room holds up to 12 players and needs at least 3 to start. The board is generated for however many are playing (sized at about 20 tiles per player), and everyone is placed at random on a starting city.
- **Early start (public rooms):** when the room reaches 3 players, a countdown starts at 60 seconds (`EARLY_START_MS`). When it ends, the match starts with whoever is there. A player joining doesn't reset it, but tops it up to at least 10 seconds (`JOIN_WAIT_MS`) so newcomers have time to settle in. A player leaving doesn't reset it either; only dropping below 3 players cancels it, and it starts again at 60 seconds when the room gets back to 3. A full room (12) starts after the short pause above.
- **Private rooms:** no early start. The host starts the game whenever at least 3 players are in, with however many there are.
- **Voting to start early (public rooms):** the lobby shows a head count ("7 / 12 players") instead of a player list, then the big countdown, then a **Vote to start early (votes/needed)** button, which only appears once there are 3 players. When at least two thirds of the players in the room (rounded up) have voted, the wait drops to 5 seconds (`VOTE_START_MS`; a wait that is already shorter is left alone) and the room stops taking newcomers. Votes can be taken back until the vote passes; players who leave have their vote removed, and fewer than 3 players calls the early start off.
- **Late joiners:** once the vote has passed, the room is closed; anyone arriving through Quick play goes to a new room.

## Duel lobbies

A duel lobby shows you and your opponent side by side ("VS"), with a pulsing placeholder and "Waiting for an opponent..." until someone joins.

## Settings

A private room's host can change the game mode (duel or battle royale), the **map size** (small, normal or large), the **tick length** (any value from 0.1 to 60 seconds in steps of 0.1; the slider covers 0.1 to 5), **fog of war** (on or off) and starting troops, while the room is still gathering players. Everyone else sees the same information as plain text, not as disabled controls. Everything is a `MatchConfig` field or a room setting, validated on the server (`applySettingsPatch`), so more settings are just more fields in the form. Public rooms use fixed defaults. The troop production speed is no longer offered in the lobby (it is still a match setting).

## Leaving, disconnecting and coming back

- **Leaving a lobby** just removes you. **Leaving a running match** is a surrender.
- **Disconnecting** during a match keeps your slot and your queue running. If you are still gone after two minutes (`AFK_MS`), your army surrenders. Reconnecting in time puts you back in the match. A disconnect in a lobby removes you straight away.
- Other players see who is disconnected in the room's player list (`connected` on each player).
- Your guest token (kept per browser tab for now) is what ties a new connection to your old slot.

## Identity and ids

- Guests have a `userId` that lasts for their session and a token that proves it. Accounts will replace this; a room will get a `ranked` flag that rejects guests.
- **Room ids are random UUIDs and are never reused**, even across server restarts, so replays can be saved under them. The match uses its room's id. The short join code is only unique among open rooms and is freed when the room closes.
- Who starts where is decided randomly when the match starts.

## Chat

There is one chat per room, and who may read and write in it depends on where the room is (`chatChannelOf` in `apps/server/src/room.ts`):

| Room state                    | Players                | Spectators                     |
| ----------------------------- | ---------------------- | ------------------------------ |
| Lobby (public and private)    | **lobby chat**, shared | **lobby chat**, shared         |
| Running match                 | no chat                | **spectator chat**, among them |
| Finished (reading the result) | no chat                | no chat                        |

- **Players never see spectator chat**, and cannot write during a match. When the match starts the lobby's log is thrown away for everyone (the server sends an empty `replace`), so players do not keep reading it and spectators start a fresh chat. The next lobby (`returnToRoom`) starts empty too.
- When a player is knocked out or surrenders, the spectators' chat gets a line about it ("Ann was eliminated" / "Ann surrendered", a `system` message about that player, in their color), as well as the toast the players still in the match see.
- A player who is knocked out of the match (beaten, or gave up) joins the spectators' chat from then on, and keeps the color they played in; people who came only to watch have no color (their names are light grey). Players still in the match cannot read it.
- Messages are at most 200 characters (`CHAT_MAX_LENGTH`); control characters (line breaks) are turned into spaces, empty messages are ignored, and one person can send one message every 0.4 seconds (`CHAT_GAP_MS`). The last 50 are kept (`CHAT_HISTORY`) so someone arriving late is caught up.
- `RoomView.canChat` says whether the receiver may chat right now; the client shows the panel only then. The server sends a `chat` message with `replace: true` and the whole log whenever the chat someone may read changes (joining, becoming a spectator, the match starting) and with `replace: false` for each new message.
- There is no moderation yet (no mute, no word filter), and chat in public lobbies is between strangers.

## Protocol

- Client: `hello`, `setName`, `quickPlay` (with a mode), `voteStart`, `createRoom`, `joinRoom`, `updateRoom`, `startGame`, `leaveRoom`, `chat`, plus the in-match `order` and `surrender`.
- Server: `welcome`, `denied` (see below), `room` (your room, or `null` for the menu; sent on every change), `stats` (online counts for the menu), `snapshot`, `tick`, `queued`, `chat` (see above), `rejected`.

## Beta access code

When the server has a `BETA_CODE`, `hello` must carry it (`code`). Without the right one the server answers `denied` (`code required` or `wrong code`) and nothing else works on that connection; a connection that guesses wrong five times is dropped. The client shows an access screen, remembers the code in the browser, and forgets it if the server later refuses it. The comparison is constant-time. With no `BETA_CODE` the server is open.

## Not built yet

A public game list, bots, ranked rooms and reconnecting after a server restart.

## Map sizes

| Size   | Duel (board radius) | Battle royale (tiles per player) |
| ------ | ------------------- | -------------------------------- |
| Small  | 4                   | 14                               |
| Normal | 5                   | 20                               |
| Large  | 7                   | 30                               |

Normal is what quick play uses. The radius is that of the hexagon the random outline stands in for, so real boards are a little ragged around it (see `docs/map-generation.md`). A battle royale board is sized from the number of players, with a minimum radius of 5.
