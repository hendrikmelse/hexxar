# Lobby and rooms

Everything before and after a match happens in a **room**. A room owns its match and its timers; the `Lobby` (`apps/server/src/lobby.ts`) only creates, finds and forgets rooms, and handles the main menu.

## Room life cycle

`lobby` (gathering players) → `starting` (countdown) → `running` (the match) → `finished` (the result stays up) → closed.

- **Public rooms** (from Quick play) start by themselves: when the room is full, a countdown begins. If someone leaves during the countdown, it is cancelled.
- **Private rooms** (Create a private game) have a host, who chooses the settings and presses Start once the room is full. Everyone then sees the same countdown. If the host leaves, the next player becomes host.
- The board needs exactly as many players as the chosen game size (the symmetric generator supports 2, 3, 4 and 6), so a room starts when it is full, not before.
- A finished room stays open for ten minutes or until everyone has left, so players can look at the result. Players leave with the "Main menu" button.

## Ways in

1. **Quick play:** join an open public room of that size, or open one.
2. **Create a private game:** get a short code and an invite link (`/?join=CODE`). Opening the link joins that game.
3. **Join with a code:** codes are 5 characters and ignore case.

Only duels (size 2) are enabled for now. Free-for-all sizes arrive with the random board generator; the room model and protocol already handle any size the generator supports.

## Settings

A private room's host can change board size, tick length, troop production speed and starting troops while the room is still gathering players. Everything is a `MatchConfig` field, validated on the server (`applySettingsPatch`), so more settings are just more fields in the form. Public rooms use fixed defaults.

## Leaving, disconnecting and coming back

- **Leaving a lobby** just removes you. **Leaving a running match** is a surrender.
- **Disconnecting** during a match keeps your slot and your queue running. If you are still gone after two minutes (`AFK_MS`), your army surrenders. Reconnecting in time puts you back in the match. A disconnect in a lobby removes you straight away.
- Other players see who is disconnected in the room's player list (`connected` on each player), which the in-match sidebar will use.
- Your guest token (kept per browser tab for now) is what ties a new connection to your old slot.

## Identity and ids

- Guests have a `userId` that lasts for their session and a token that proves it. Accounts will replace this; a room will get a `ranked` flag that rejects guests.
- **Room ids are random UUIDs and are never reused**, even across server restarts, so replays can be saved under them. The match uses its room's id. The short join code is only unique among open rooms and is freed when the room closes.
- Who starts where is decided randomly when the match starts.

## Protocol

- Client: `hello`, `setName`, `quickPlay`, `createRoom`, `joinRoom`, `updateRoom`, `startGame`, `leaveRoom`, plus the in-match `order` and `surrender`.
- Server: `welcome`, `room` (your room, or `null` for the menu; sent on every change), `snapshot`, `tick`, `queued`, `rejected`.

## Not built yet

A public game list, spectators, bots, ranked rooms and reconnecting after a server restart.
