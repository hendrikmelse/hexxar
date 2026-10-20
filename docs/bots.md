# Bots

Computer-controlled players, for practice and for games when nobody else is around. This page covers what they are, how they plug into the game, and (in detail) how the one bot that exists decides what to do.

## The rules of the product

- **Bots are only available in private games.** Quick play never contains a bot. A public lobby that is short of players offers a **Play against bots** button instead (see [Getting into a bot game](#getting-into-a-bot-game)).
- **Bots are always labelled.** A bot is named `Ada`, `Bram`, ... and wherever its name is shown (lobby, standings, the "is out" notice, the result card, the spectators' chat) a grey **[BOT]** comes before it, in the name's own font but not its color (`RoomPlayer.bot` and `ChatMessage.bot` in the protocol). Nothing in the game ever presents a bot as a person.
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

There are two bots. `createEasyBot()` is the **original** bot, kept unchanged as the one new bots are measured against. `createSmartBot(options)` (`packages/shared/src/smartBot.ts`) is the **improved** bot, the original with a few habits added, each of them a switch; the rooms use it with the settings that measured best (`SMART_BEST`). `BOT_NAMES` holds the names rooms hand out: a new bot takes one at random, skipping any a bot in the room already has.

### In a room: `apps/server/src/room.ts`

A bot is a `Member` of the room, like a person, with two differences: `member.bot` holds its decision function, and its `Session` is a stand-in (`userId` like `bot-ada`, no token, a connection that discards everything sent to it). Because it is a member, everything that already works for players works for it: it has a color, a match player id, a place in the player list and the scoreboard, and the chat announces when it is eliminated.

- **`settings.bots`** is the number of bots the host wants (0 to 12; a duel holds at most 2). Every bot is the improved bot (`SMART_BEST`); there is no difficulty setting. The room keeps the real number of bots equal to `min(settings.bots, capacity - people)` and writes the result back, in `syncBots()`. It runs whenever the room's makeup changes: someone joins, leaves, spectates, the host changes a setting, or the room goes back to its lobby after a match. So a person arriving in a full room pushes the last bot out, and the setting follows (the bot does not come back by itself when the person leaves). Adding bots never moves anyone: the number is capped by the places people are not playing in, and the lobby's **+** is switched off at that cap. A host who wants all twelve places for bots steps out with **Spectate** first (then watches a 12-bot game); taking a place again with **Join as player** makes the last bot give way.
- **When bots think** (`thinkBots()`): once when the match is created, so they plan their opening during the planning period like everyone else, and after every tick. A bot is asked for orders only when its queue is **empty**, so it queues at most one tick ahead. Its orders go through `queueOrder()`, the same path as a person's orders, so `Match.enqueue` validates them and anyone watching sees them.
- **Costs.** A bot decision is a pass over the tiles it can see, plus one breadth-first search over its own. Bots are skipped when messages are built and sent (ticks, snapshots, room views), since nobody is there to receive them.
- **Unwatched games end.** Bots would play on for ever, so a match with bots in it (or its result card) is closed **immediately** once nobody is left to see it: no person playing, and no one watching, whether a spectator or someone who is out of the match, with a live connection (`Room.endIfUnwatched()`). Someone who is still playing but whose connection has dropped counts until their army surrenders for being away (`afkMs`, two minutes), so a page reload does not end the game; as soon as it surrenders, the room closes. A match with a person watching it, even one beaten long ago, goes on.
- **Leaving.** A room closes when the last person is gone, bots or no bots. Bots never disconnect, never go AFK, and are never the host. When a match ends, a bot has no result card to read, so it stays in the room and takes part in the next game the host starts.

### In the protocol: `packages/shared/src/protocol.ts`

- `RoomSettings.bots` (and the optional `bots` in `RoomSettingsPatch`), so the host changes it with the usual `updateRoom`, and `createRoom` can open a room with bots already selected.
- `RoomPlayer.bot`, so every client can label the player.

There are no bot-specific messages.

### On the client

- The host's settings list is two to a line where the options are short: game mode beside fog of war, and tick length beside starting troops. Game mode, fog of war and map size are each one button that shows the current option and goes to the next on every click (`Cycle` in `Lobby.tsx`; every label sits in the button, so it never changes size). Numbers are a **−** button, the value and a **+** button (`Stepper`; starting troops goes 1, 5, 10, 15 and so on, and tick length and starting troops can also be typed). Bots is a stepper for how many bots (0 up to the places no person is playing in). Everyone else sees the numbers in the read-only settings.
- `BotTag` renders the grey [BOT] inside the element that holds the name, so it shrinks and is cut off together with it. The in-match standings (plain DOM) do the same in `hud.ts`.
- `playWithBots(mode)` in `apps/client/src/main.ts` leaves the quick game, and once the server has let go (the room becomes `null`) it sends `createRoom` with the mode and `BOT_GAME_BOTS[mode]` bots. The host presses **Start game** as in any private game and can still change anything first.

## Getting into a bot game

1. **Create game** from the menu, then use the Bots stepper.
2. **From a lobby that cannot start:** in a lobby with too few players to start (a duel with no opponent, a battle royale with fewer than three players), a card at the bottom of the screen says "Tired of waiting?" with a **Play against bots** button. It is for quick play lobbies only (never a private game, where the host has the Bots setting). It fades in after 3 seconds of waiting (any change in who is in the lobby starts the 3 seconds over) and fades out again at once when the match can start. The button takes the player to a new private game of the same mode with bots already added (`BOT_GAME_BOTS`: 1 for a duel, 5 for a battle royale).

## The original algorithm (the "easy" bot)

This is `createEasyBot()` in `bot.ts`, kept exactly as it was, because it is the opponent new bots are tested against. The improved bot below starts from it.

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

## The improved bot

`createSmartBot(options)` makes the same kind of decision as the original (one target, one step, every time it is asked; sections 1 to 5 above) and adds habits that a beginner picks up, each a switch in `SmartOptions`. With every switch off it makes **exactly** the original's decisions (a test plays whole games and compares every one), which is what makes the measurements below fair. `SMART_V1` is the first round's winners (habits 1 to 3), and `SMART_BEST` adds habits 4 and 5 on top of it; the rooms use `SMART_BEST`.

### Habit 1: finish the ring around cities and villages (`ring`)

The original gives a farm next to one of its producers a flat +1.5 value per producer. The improved bot values a farm by how much faster it would make the producers beside it:

```
for each of my cities and villages next to the farm, with f farms of mine around it already:
    value += 60 * (1 / ticksPerTroop(f + 1)  -  1 / ticksPerTroop(f))
```

(`ticksPerTroop` is the production table in [tick resolution](tick-resolution.md), scaled by the match's production speed.) The gains grow as the ring fills, so the last farms are worth the most, and a city is worth far more than a village:

| Farm number | 1st | 2nd | 3rd | 4th | 5th | 6th |
| ----------- | --- | --- | --- | --- | --- | --- |
| City        | 1.1 | 1.4 | 2.0 | 3.0 | 5.0 | 10  |
| Village     | 0.5 | 0.5 | 0.7 | 0.8 | 1.1 | 1.4 |

Added to the farm's own value of 2 and divided by the fight's cost like any target, the sixth farm of a city outranks a neutral village, and the first one does not.

### Habit 2: never sit on a capped army (`uncap`)

A city or village stops producing while its army is at its cap (50 and 20), so an army parked there is a wasted tile. A producer counts as capped when it holds at least `cap - 1` troops (and at least 2). Before it makes its normal choice, the bot takes the biggest capped army and does the first of these that applies:

1. **Attack from where it stands:** if the army can win a fight with a neighboring tile, it does (the best-scoring one).
2. **March to the front:** otherwise it walks toward the staging tile of its best target (habit 3 applies on the way).
3. **Just move off:** otherwise it steps onto its least crowded neighboring tile, so the producer starts producing again.

### Habit 3: pick up armies on the way (`pickup`)

When the original gathers an army, it walks along the first shortest route its search found. The improved bot looks at **every** shortest route from a tile back to the staging tile and takes the one past the most spare troops:

```
gain(tile)  = troops on the tile - 1         (the army leaves one behind; the staging tile counts for 0)
carry(tile) = max over neighbors n one step closer:  gain(n) + carry(n)      carry(staging) = 0
weight(tile) = (troops - 1 + carry(tile)) / (1 + distance to staging)
```

The tile with the highest weight is the one that moves, and it moves onto the neighbor, one step closer, that has the highest `gain + carry`. A march therefore collects the small armies that are lying around its route, instead of leaving them behind. It is the same single step, asked again next tick, so it still reacts to changes. (An experiment that also let the army step sideways onto a stack, `detour`, made no difference and is off.)

### Habit 4: defend what an enemy could take (`homeGuard`, `reinforce`, `defendUntil`)

A city or village is **threatened** when a tile of another player next to it could send at least 70% of what the producer defends with (`threatRatio`; its troops times its defense bonus). Two habits use that:

- `homeGuard`: a threatened producer does not send its troops anywhere. It is left out of every attack and every march, so it stays full.
- `reinforce`: if an attack that can be made now would hit the tile that threatens a producer, it is made. Otherwise the army nearest to the most valuable threatened producer (counting what it picks up on the way, habit 3) takes a step toward it, ahead of anything else except that.

**Only while two players are left (`defendUntil: 2`).** Defending all the time was a clear win in duels and a loss in battle royales. In a royale a city usually borders several players, so something is always threatened, and the bot spent its one order per tick reinforcing and keeping troops at home instead of expanding: it won 15 royales in 60 where the same bot without defence won 27, and it survived less often. With the limit it defends in every duel and in the endgame of a royale, and plays like `SMART_V1` before that (27 of 60 either way).

### Habit 5: only count troops that can get there (`components`, `componentsUntil`, `idleRepair`)

The bots sometimes sat idle with plenty to do. `Trace` (below) showed why: the bot picks a target, and gathers an army at the target's **staging tile**, the one of its own tiles beside the target that holds the most troops. When that tile is a **cut-off outpost** (one or two tiles of its own land that no longer touch the rest, because the middle was lost or the land is split by water), no troop can walk to it over the bot's own land. The bot still counted its whole army as available for that target, so the target looked like the best thing to do, the gather found nothing to move, and it passed the tick, again and again (a dozen ticks in a row, with 100 to 1200 troops elsewhere).

- `components`: split the bot's land into connected pieces and count, for each target, only the troops in the pieces the target can be attacked from. Gather at a stager in the piece that has the troops. If a gather still finds nothing, try the next best targets.
- `componentsUntil: 2`: apply that only while two players are left (see below for why).
- `idleRepair`: when `components` is not in force, change nothing unless the bot is about to pass the tick; then look for the best target its troops can walk to, and do that. Every other decision stays exactly as it was.

### Habits that did not help (`neutralFirst`, `ignoreEnemyFarms`)

The idea was to put neutral villages and cities ahead of skirmishes with other players. Two ways of doing it were measured, and neither helped:

- `neutralFirst` multiplies a neutral city's or village's value (by 1.25, 1.5 or 2.5 in the tests).
- `ignoreEnemyFarms` stops valuing another player's farmland above neutral farmland.

Both are still in the code, off. (Taking an enemy's farms is how its production rings are broken and how an army gets to its cities, so the "petty skirmishes" are worth more than they look.)

### How it was measured

`apps/server/src/botExperiment.test.ts` plays a candidate against an opponent and writes the result (see the comment at the top of the file for how to run it; it does nothing unless `BOT_EXPERIMENT` is set). Every game is played with fog of war on and one order per bot per tick.

- **Duels:** the candidate on both sides of every board, 16 boards (32 games), 3000 ticks at most.
- **Battle royales:** one candidate and three opponents, the candidate taking each of the four starting positions in turn, 40 games.

Results against the original bot (duels: candidate wins - losses; royale: candidate wins out of 40, where chance is 10 and the original against itself got 11):

| Candidate                       | Duels | Average win | Royales |
| ------------------------------- | ----- | ----------- | ------- |
| original (as a check)           | 11-11 | 1305 ticks  | 11      |
| `ring` alone                    | 19-10 | 1498        | 12      |
| `pickup` alone                  | 31-1  | 1025        | 12      |
| `uncap` alone                   | 32-0  | 1290        | 14      |
| `pickup` + `uncap`              | 31-1  | 844         | 16      |
| **`pickup` + `uncap` + `ring`** | 31-1  | **818**     | **19**  |
| the above + the two that failed | 29-1  | 1001        | 15      |

Tuning, against `pickup` + `uncap` (32 duels): adding `ring` won 26-5. Of its strength, 30, 60 and 120 won 22-10, 26-5 and 24-8, and 40, 90 and 120 against the finished bot (60) came out 19-13, 19-13 and 18-14, so anything from about 40 to 120 is as good and 60 was kept. Moving the cap margin to 0 or 5, and the `detour` (3 or 6), changed nothing (13-18 for margins 0 and 5, and 13-18 and 12-20 for the detours, against `pickup` + `uncap`). Against the finished bot, the two failed habits lost 12-20 and 13-19 (`neutralFirst`), 9-23 (`ignoreEnemyFarms`) and 10-22 (both).

The numbers are from fixed boards and a few dozen games, so a difference of a few games is noise; the large ones (a win rate of 90% against the original, and `ring` on top of the other two) are not.

### Second round: defence, more habits, tuning, cost

The same harness, this time against `SMART_V1` (and, for each step, against the best bot so far). Duels: 20 boards from both sides (40 games). Royales: the candidate against three of the opponent, 16 games to start with and 60 to 80 where the answer was close. The first row of each table is the bot against an identical copy, which shows how much luck there is: **20-20 every time, with differences of up to 5 games either way being noise**.

**Defence and the other habits, each added to `SMART_V1`** (duels against `SMART_V1`; idle ticks are the share of decisions that gave no order):

| Added                      | Duels    | Avg win    | Idle ticks |
| -------------------------- | -------- | ---------- | ---------- |
| nothing (identical copy)   | 20-20    | 1111 ticks | 18%        |
| `homeGuard`                | 27-13    | 1058       | 18%        |
| `reinforce`                | 29-11    | 785        | 14%        |
| **both**                   | **32-8** | **793**    | 13%        |
| `exact` (production timer) | 20-20    | 936        | 18%        |
| `strike` (tiles just left) | 22-17    | 959        | 18%        |
| `pool` (fill idle ticks)   | 17-22    | 957        | 16%        |
| `sticky` (keep the target) | 17-22    | 1079       | 20%        |

**More, on top of defence** (against the bot with defence; none of them clears the noise, so none was kept): `sim` (play the attack through the rules first) 20-20, exactly the same as without it, which means the heuristic is never wrong in a way the rules would catch; `exact` 22-17, `sim` + `exact` 22-17, `strike` 21-17, `weakest` (prefer weak players) 20-18, `edge` (discount producers at the board's edge) 19-21; `threatRatio` 0.5, 0.85 and 1.0: 16-23, 19-20 and 21-18.

**Tuning the numbers** I had guessed, one at a time (duels against the same bot): cost per troop 0.025 and 0.1: 18-21, 17-22; gather factor 1.0, 0.6 and 0.4: 16-24, 23-16, 16-22; enemy bonus 0, 6 and 10: 13-26, 23-16, 21-19; city value 18 and 8: 21-19, 21-19; village value 10: 20-20; farm value 4 and 1: 19-21, 19-21; enemy bonus 6 with gather factor 0.6: 20-20. The two that looked better did not hold up when combined; the values are on a flat peak, and the one clear result is that taking nothing extra for another player's tile (enemy bonus 0) is worse. They were left alone.

**Battle royales** (the candidate against three originals; chance is 25%):

| Candidate                                           | Wins           |
| --------------------------------------------------- | -------------- |
| `SMART_V1`                                          | 27 / 60        |
| + `homeGuard`                                       | 20 / 60        |
| + `reinforce`                                       | 16 / 60        |
| + both, always                                      | 15 / 60        |
| + both, `threatRatio` 1.0 and 1.5                   | 20 and 22 / 60 |
| **+ both, only with 2 players left (`SMART_BEST`)** | **27 / 60**    |
| + both, with 3 players or fewer                     | 22 / 60        |

`SMART_BEST` against three `SMART_V1` bots won 15 of 60 (an identical copy: 14 of 60), so in a royale it plays as well as `SMART_V1`; its gain is in duels (32-8 against `SMART_V1`, 32-0 against the original, taking about 740 ticks to win; two originals playing each other take about 1300). The habits that failed in duels were tried again in royales (80 games each, base 34 of 80): `strike` 33, `neutralFirst` 32, `pool` 29, `edge` 26, `sticky` 25, `exact` 24, `ignoreEnemyFarms` 24. None helped.

**Cost.** A decision (`SMART_BEST`) takes **0.37 ms on average, and 99% take under 2.4 ms** (the worst, about 20 ms, are the engine warming up). A battle royale of twelve of them costs the server **1.5 ms per tick on average, 5.6 ms at the 99th percentile**, for all twelve bots together, out of the one second a tick lasts. Always-on defence cost about 60% more (0.61 ms per decision) and was worse in royales, which is another reason for `defendUntil`. `sim` costs another 0.2 ms per decision for nothing. Running `BOT_BENCH=1 BOT_EXPERIMENT=1` (see `botExperiment.test.ts`) measures this on any bot.

### Third round: idle ticks and piles of troops

Two things were noticed when watching games: bots that sit idle with things to do, and winning bots that leave big piles of troops around. `botDiagnose.test.ts` plays games and records, for each decision of the candidate, **why** it decided as it did (the bot can say: `createSmartBotWithTrace`), how many troops it had, and where its biggest stack was.

**Idle.** The share of decisions that gave no order, and why:

| Bot                               | Duels | Royales | Reason found                                                                                                 |
| --------------------------------- | ----- | ------- | ------------------------------------------------------------------------------------------------------------ |
| `SMART_BEST` before this round    | 11%   | 24%     | 3% to 16%: "no troops can reach the staging tile" (the cut-off outpost); the rest: every target out of reach |
| with `components`, the whole game | 3%    | 5%      |                                                                                                              |
| **`SMART_BEST` now**              | 3%    | 6%      | what is left is waiting for production                                                                       |

In duels against the previous best (40 games) the fix won **27-12**; against the original, **32-0**, finishing in 630 ticks instead of 737. It matters most when ahead: idle decisions while winning went from 3% to 0.1%.

**In a royale it has a small possible cost.** `components` for the whole game, or `idleRepair`, won fewer royales against three originals than the bot without them: 63 of 160 and 61 of 160, against 74 of 160; on 160 further boards it was 53 against 61, so over 320 boards 116 against 135 (36% against 42%), which is about 1.5 standard errors, so it may be luck. Head to head against the previous best the two are equal (15 and 14 wins of 80, where chance is 20). It stays because the passing was the problem being fixed, and because in duels it clearly helps; `componentsUntil: 2` keeps the whole-game version out of royales.

**Piles.** While a bot was winning (at least 65% of all production), about half of its mobile troops were in stacks of 25 or more, on four to six tiles, and the biggest was usually **at the front** (about one step from it, on farmland, touching an enemy tile in about half the decisions), not parked at home. Five ways of using them were measured, and none made the bot win more, or finish faster (it took about 300 ticks after getting a big lead to win, with or without):

- `deploy` (march piles toward the best city or village): 17-21 on its own, 26-13 with `components` (against 32-8 without `deploy`); at a lower size it stalled the game (6-23).
- `spendPiles` (a pile that is enough attacks, rather than the smallest army that is enough): 18-21, and 32-8 with `components` (the same as without).
- `pileFirst` (a pile beside a target it can win takes it, rather than waiting while an army gathers for a better one), at 0.2, 0.35 and 0.5 of the best target's value, and also over an attack that is possible now: 20-20, 20-20, 19-20.

The reason, as far as the data goes: a winning side owns many cities and villages, each making a troop every few ticks, and the game allows **one order per tick**. Production grows faster than one order a tick can spend it, so the surplus piles up wherever it was last left. Moving the pile or spending it first does not change that. It is not a bug in what a bot decides; it is the rule of one order per tick showing.

**Cost.** The final bot: **0.53 ms per decision on average, 99% under 2.0 ms**; twelve of them on one board cost **1.6 ms per tick on average, 4.2 ms at the 99th percentile** (out of the one second a tick lasts). The connected pieces add about 0.2 ms per decision.

### What it still does not do

- **No defence in a royale until two players are left.** The habit that works in duels hurts when there are several fronts. A defence that picks which threat to answer (the one that is real, not every neighbor) is the open problem.
- **Waiting.** About 3% of its decisions in a duel and 6% in a royale give no order now; those are waiting for production, with nothing in reach that is worth doing.
- **Troops pile up when it is winning.** One order a tick cannot spend a big economy (see above). A bot that took whole stacks along (one army walking through the enemy's land, capturing a tile a tick) rather than one capture at a time might finish sooner; it was not tried.
- **One order at a time, from the board as it is.** No memory of where enemies were last seen, no scouting beyond the next ring, no plan more than one step ahead.
- **Ideas not tried:** gathering only when the troops that could arrive in time are enough (`mass`), valuing farms around a neutral producer before it is captured, looking ahead with rollouts (a few milliseconds per decision, which is the cost to weigh), personalities, and reading what the other players are doing in a royale.

## Testing

- `packages/shared/src/bot.test.ts`: unit tests of single decisions (attack a tile it can beat, wait when everything is out of reach, march toward a fight it cannot win from one tile), and a headless harness that plays bots against each other under fog of war, checking that **every order a bot returns is legal** (`checkOrder`), that a battle royale between bots finishes, and that a bot beats an opponent who never plays.
- `packages/shared/src/smartBotHabits.test.ts`: single boards for the second round's habits: a threatened city stays home (and only while two players are left), troops are sent to a producer in danger, the production timer decides whether an attack is enough, spare troops march when nothing can be attacked, and the target stays chosen.
- `packages/shared/src/smartBot.test.ts`: the improved bot with every switch off agrees with the original on every decision of whole games; with the best switches on it only gives legal orders; and single boards for each habit (an army at its cap moves, the last farm of a city's ring beats a neutral village, an army takes the route with the troops on it).
- `packages/shared/src/smartBotConnected.test.ts`: the cut-off outpost board: the bot without the fix passes the tick (and the trace says why), with `components` or `idleRepair` it takes the farm that can be taken, and the limit to two players.
- `apps/server/src/botExperiment.test.ts`: the harness above (also `BOT_SEED_START`, to play boards that an earlier run did not, and `BOT_BENCH`, for the cost of twelve bots). Skipped unless `BOT_EXPERIMENT` is set.
- `apps/server/src/botDiagnose.test.ts`: plays games and reports why the candidate passed its ticks, where its army was, and what it went for while winning. Skipped unless `BOT_DIAGNOSE` is set.
- `apps/server/src/bots.test.ts`: bots in rooms. Labelling, names and colors, the limits on the count, bots yielding to people, no bots in public games, the bot playing a real match through the lobby, a person out of the game seeing its orders, rematches, closing the room, and the admin counts.

## Changing the bot

A better bot is another `Bot` function. To use it:

1. Write it in `packages/shared/src/` (pure, `visibleState` in, orders out), and measure it with `botExperiment.test.ts` against `createEasyBot()` and against `createSmartBot(SMART_BEST)`.
2. Make `Room.makeBot()` return it.
3. Update this page.

A bot that wants to plan further ahead than one step can return several orders; the room appends all of them, and asks again only when its queue has run dry.
