# Bots

Computer-controlled players, for practice and for games when nobody else is around. This page covers what they are, how they plug into the game, and (in detail) how the one bot that exists decides what to do.

## The rules of the product

- **Bots are only available in private games.** Quick play never contains a bot. A public lobby that is short of players offers a **Play against bots** button instead (see [Getting into a bot game](#getting-into-a-bot-game)).
- **Bots are always labelled.** A bot is named `Bot Ada`, `Bot Bram`, ... and carries a **BOT** tag in the lobby (`RoomPlayer.bot` in the protocol). Nothing in the game ever presents a bot as a person.
- **Bots play by the same rules as people.** They see only what their player may see (fog of war applies), they queue orders into the same append-only queue, and the tick resolves at most one order per player. They get no extra troops, vision, or speed.
- **People come first.** Bots only fill places nobody else wants: a person who joins a full private room takes a bot's place.
- **Bots are not people in the numbers.** They are left out of the online counts, the admin panel's player counts and the room's "empty" check. Analytics' `match_start` events carry a `bots` count.

## How it works technically

### The bot: `packages/shared/src/bot.ts`

A bot is a pure function from what its player can see to the orders to queue:

```ts
type Bot = (context: { view: GameState; me: PlayerId; config: MatchConfig }) => Order[];
```

- `view` is the output of `visibleState(state, me, config)`, the same fogged board a client receives. A bot is never handed the full state.
- It returns the orders to **append** to its queue (an empty list means "do nothing for now").
- It has no memory between calls and no randomness: the same view always gives the same answer. Everything it needs is on the board.
- `packages/shared` has no Node or DOM dependencies, so a bot runs anywhere (a future tutorial opponent, a headless test harness, the server).

`createEasyBot()` returns the one bot there is. `BOT_NAMES` holds the names rooms hand out.

### In a room: `apps/server/src/room.ts`

A bot is a `Member` of the room, like a person, with two differences: `member.bot` holds its decision function, and its `Session` is a stand-in (`userId` like `bot-ada`, no token, a connection that discards everything sent to it). Because it is a member, everything that already works for players works for it: it has a color, a match player id, a place in the player list and the scoreboard, and the chat announces when it is eliminated.

- **`settings.bots`** is the number of bots the host wants (0 to 11; a duel holds at most 1). The room keeps the real number of bots equal to `min(settings.bots, capacity - people)` and writes the result back, in `syncBots()`. It runs whenever the room's makeup changes: someone joins, leaves, spectates, the host changes a setting, or the room goes back to its lobby after a match. So a person arriving in a full room pushes the last bot out, and the setting follows (the bot does not come back by itself when the person leaves).
- **When bots think** (`thinkBots()`): once when the match is created, so they plan their opening during the planning period like everyone else, and after every tick. A bot is asked for orders only when its queue is **empty**, so it queues at most one tick ahead. Its orders go through `queueOrder()`, the same path as a person's orders, so `Match.enqueue` validates them and anyone watching sees them.
- **Costs.** A bot decision is a pass over the tiles it can see, plus one breadth-first search over its own. Bots are skipped when messages are built and sent (ticks, snapshots, room views), since nobody is there to receive them.
- **Leaving.** A room closes when the last person is gone, bots or no bots. Bots never disconnect, never go AFK, and are never the host. When a match ends, a bot has no result card to read, so it stays in the room and takes part in the next game the host starts.

### In the protocol: `packages/shared/src/protocol.ts`

- `RoomSettings.bots` (and the optional `bots` in `RoomSettingsPatch`), so the host changes it with the usual `updateRoom`, and `createRoom` can open a room with bots already selected.
- `RoomPlayer.bot`, so every client can label the player.

There are no bot-specific messages.

### On the client

- The lobby's host settings have a **Bots** slider (0 to the room size minus one). Everyone else sees the number in the read-only settings.
- Player boxes show a **BOT** tag.
- `playWithBots(mode)` in `apps/client/src/main.ts` leaves the quick game, and once the server has let go (the room becomes `null`) it sends `createRoom` with the mode and `BOT_GAME_BOTS[mode]` bots. The host presses **Start game** as in any private game and can still change anything first.

## Getting into a bot game

1. **Create game** from the menu, then use the Bots slider.
2. **From a lobby that cannot start:** in a lobby with too few players to start (a duel with no opponent, a battle royale with fewer than three players), a card at the bottom of the screen says "Tired of waiting?" with a **Play against bots** button. It fades in after 3 seconds of waiting (any change in who is in the lobby starts the 3 seconds over) and fades out again at once when the match can start. In a public lobby the button takes the player to a new private game of the same mode with bots already added (`BOT_GAME_BOTS`: 1 for a duel, 5 for a battle royale). In a private lobby only the host sees it, and it adds those bots to the room they are in. Spectators never see it.

## The algorithm (the "easy" bot)

The easy bot is deliberately simple. Each time it is asked, it picks **one** target and takes **one** step toward it: either an attack, or a move that brings troops closer to where an attack could happen. It never plans a route more than one step at a time, and it has no model of its opponents.

Throughout: a **target** is a tile the bot does not own that is next to one of its tiles. Only these are considered; they are always in full view even under fog. A **stager** of a target is one of the bot's own tiles next to it.

### 1. How many troops does a target take?

```
margin   = 0 if the tile is neutral, 1 if another player owns it
strength = (troops + margin) * defensePercent / 100
need     = ceil(strength) + 1
```

The rules favor defenders (see [tick resolution](tick-resolution.md)): they fight at their tile's defense bonus, and rounding goes their way. The bot therefore asks for the defender's effective strength rounded up, plus one troop to survive with. For another player's tile, it assumes the defender will produce one more troop before the army arrives. Neutral armies never change.

`need` is what an army must **send**. A tile with `t` troops sends `t - 1`, since one troop always stays behind, so a stager can attack when `troops - 1 >= need`.

### 2. How much is a target worth?

```
value = base value of the tile type            city 12, village 7, farmland 2
      + 3                                      if another player owns it
      + 1.5 per producer of the bot's own      (farmland only)
            next to it

score = value / (1 + need * 0.05)
```

- Cities and villages are what win games: they make troops. Farmland is cheap and slightly useful, and mostly worth taking when it sits next to one of the bot's own cities or villages, because owned farms around a producer make it faster.
- Taking from another player is worth more than taking from nobody, because it weakens an opponent too.
- Dividing by the cost makes expensive fights less attractive without ever making them worthless (a fixed subtraction would go negative for a 50-troop city and the bot would never attack it, which the first version did). The effect: a neutral village (value 7, need 6, score 5.4) beats the farm beside it (value 2, need 2, score 1.8) as soon as the bot has the troops, and a neutral city (value 12, need 16, score 6.7) beats the village.

### 3. Which target?

For every target, in a fixed order (sorted by coordinates, so the same board always gives the same answer):

- **Now:** some stager can attack immediately. Its score counts in full.
- **Later:** no stager is strong enough yet, but the bot's whole army (every troop above one on every tile it owns) could cover `need`. Its score is multiplied by **0.8**, since waiting to gather a force is worth a little less than a fight it can have right now.
- **Out of reach:** `need` is more than the bot's whole army. It is ignored until production catches up.

The target with the highest resulting score wins; the earlier one in the fixed order wins a tie. If there is none, the bot returns no orders this time (it waits for troops to be produced).

### 4a. If the best target can be attacked now

Among the stagers that are strong enough, the bot attacks with the one with the **fewest** troops. A bigger army would win just as well, and keeping the big armies together keeps them useful for harder fights. The order is `move(stager, target)`.

### 4b. If it has to gather first

The bot chooses a **staging tile** (the stager of the target with the most troops) and finds a path over its own territory from there outward (a breadth-first search through the bot's tiles, so every owned tile gets a distance from the staging tile and a next step toward it). Each tile with at least two troops (other than the staging tile itself) is scored:

```
weight = (troops - 1) / (1 + distance to the staging tile)
```

The tile with the highest weight sends its troops one step along the path (`move(tile, next step)`). Big armies close by go first; a distant army of two troops does not drag everyone around. Tiles that cannot reach the staging tile over the bot's own land are ignored.

The next time the bot is asked (one tick later, since its queue is empty), the army has moved and the whole decision is made again from scratch, which is how a gathering army marches across the board one tile at a time, and how it ends up on the staging tile with enough troops to attack. If something changed in the meantime (a better target appeared, or a tile fell), it simply switches.

### 5. Because of how orders work

A move sends **all but one** troop from the tile. So an army that walks across the board leaves a one-troop garrison on every tile it steps on, and an attack that captures a tile leaves the survivors standing on it, ready for the next attack. This is also how the bot expands: it snakes its main army from capture to capture, and production on its cities and villages (which it pulls toward the front with the same gathering step) feeds it.

### What it does not do

These are the known weaknesses of the easy bot, and the first things to improve on:

- **No defense.** It never keeps troops home, never reinforces a threatened tile, and does not notice an enemy army next door. A moving army leaves a single troop on its start tile, even a city.
- **No timing, no deception, no reading of opponents.** It has no use for the fact that orders are queued ahead. It queues one order at a time, just in time, and always acts on the current board.
- **It wastes troops on long marches.** An army that walks deep into enemy farmland loses a troop per tile it takes and can fizzle out. Two easy bots in a duel can go on for a very long time without one of them breaking through.
- **It can be baited.** Every decision is based on this tick's board, and it is a pure function of it, so a human who understands the scoring can lead it around.
- **No fog play.** It sees one tile beyond its own, which is also all it uses, so fog changes nothing about how it plays. It does not scout.

In practice: it expands fast, takes nearby cities and villages, and finishes a passive opponent, but it falls to a player who defends well and counter-attacks.

## Testing

- `packages/shared/src/bot.test.ts`: unit tests of single decisions (attack a tile it can beat, wait when everything is out of reach, march toward a fight it cannot win from one tile), and a headless harness that plays bots against each other under fog of war, checking that **every order a bot returns is legal** (`checkOrder`), that a battle royale between bots finishes, and that a bot beats an opponent who never plays.
- `apps/server/src/bots.test.ts`: bots in rooms. Labelling, names and colors, the limits on the count, bots yielding to people, no bots in public games, the bot playing a real match through the lobby, a person out of the game seeing its orders, rematches, closing the room, and the admin counts.

## Adding another bot

A new difficulty is another `Bot` function. To make it available:

1. Write it in `packages/shared/src/` (pure, `visibleState` in, orders out) and test it in the harness against the easy bot.
2. Give a room a way to say which bot a place gets (a bot level next to `settings.bots`, in `RoomSettings` and the lobby UI), and replace `createEasyBot()` in `Room.newBot()` with a choice.
3. Update this page.

A bot that wants to plan further ahead than one step can return several orders; the room appends all of them, and asks again only when its queue has run dry.
