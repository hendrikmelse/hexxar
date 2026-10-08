# Tick resolution

How the server turns the current state plus every player's next queued order into the next state. Implemented by `resolveTick` in `packages/shared/src/resolve.ts`.

**Hard requirement:** the result must not depend on player ordering, iteration order, or connection timing. Same state + same orders = same result, always.

## Model

- A **tile** has a type, an owner (a player, or nobody for neutral) and a **troop count**. The troops on a tile are its army, and they belong to the tile's owner. Neutral tiles hold a neutral garrison.
- A **move order** is `move(from, to)`: send all but one troop from your tile `from` to the **adjacent** tile `to`. One step per tick; a long march is several queued orders.
- Each tick, the head of every player's queue is popped and checked against the current state. Invalid orders (not your tile, fewer than 2 troops, not adjacent, off the board) are dropped; the player just gets no action that tick.

## Tile types

Tile types are data (`packages/shared/src/tiles.ts`). Each defines:

| Property         | Meaning                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `defensePercent` | Defender strength multiplier in percent (100 = no bonus)                                   |
| `baseGarrison`   | Size of the defensive army when neutral; neutral tiles start here and shrink back to it    |
| `generation`     | `null` for farmland. Otherwise ticks per troop by owned farm neighbors, `amount` and `cap` |

| Type     | Base garrison | Defense | Effective defense | Produces troops | Cap |
| -------- | ------------- | ------- | ----------------- | --------------- | --- |
| Farmland | 1             | 100%    | 1                 | never           | n/a |
| Village  | 4             | 125%    | 5                 | see below       | 20  |
| City     | 10            | 150%    | 15                | see below       | 50  |

### Production and farms

Only cities and villages produce troops. Farmland produces nothing; owning the farms next to a city or village makes it produce faster. Ticks per troop, by how many of the tile's six neighbors are farmland owned by the same player:

| Owned farms | 0   | 1   | 2   | 3   | 4   | 5   | 6   |
| ----------- | --- | --- | --- | --- | --- | --- | --- |
| City        | 8   | 7   | 6   | 5   | 4   | 3   | 2   |
| Village     | 12  | 11  | 10  | 9   | 8   | 7   | 6   |

Gains get bigger as the ring fills: a full ring makes a city four times faster than a bare one. A farm next to two of your producers counts for both. Map generation keeps cities and villages away from each other, so every interior producer has six farmland neighbors and the same maximum; edge villages have fewer neighbors and are weaker producers.

Adding a type means adding an entry to the table; the sim reads everything from it. A match can override any value through `tileOverrides` in its config, and scale all production and decay with `generationSpeedPercent`. Production stops at the cap but armies can exceed it through reinforcement.

## Phases

1. **Generate and decay.** Every tile keeps its own **progress** counter.
   - An owned city or village gains one progress per tick. It produces `amount` troops once its progress reaches the number of ticks for its **current** owned-farm count (see above, scaled by the match's generation speed), and its progress then resets. So capturing a farm can complete a cycle early, and losing one makes the tile wait longer. The farm count is taken from the state before the tick. Progress starts at zero when a tile is captured, so tiles taken on different ticks produce on different ticks.
   - A producer at or above its `cap` is **paused**: it keeps its progress but does not advance until its army drops below the cap. A big army passing through a chain of full producers just delays each one by a tick, rather than resetting its timer.
   - Farmland never produces, and neutral tiles never produce.
   - Neutral armies above their tile's base garrison use the same counter to lose one troop every `neutralDecayEveryTicks` ticks (default 12, the same for every tile type, scaled by generation speed). A depleted neutral army does not regrow.
   - This happens first, so a troop produced this tick can defend, and can be sent by a move order this tick. Orders are checked against the state after generation.
2. **Depart.** Every commanded army leaves its tile, leaving **one troop behind**. Tile ownership is unchanged.
3. **Reinforce.** An arriving army whose destination is owned by its own player adds its troops to the tile.
4. **Attack.** An arriving army whose destination is not owned by its player (hostile or neutral) is an attacker.
5. **Battle.** On each contested tile, the participants are the arriving attackers plus the tile's current troops as the defender, if any. Attackers fight at face value; the defender's strength is multiplied by the tile type's `defensePercent`. The strongest participant fights the second strongest; everyone else is removed. If their strengths are equal, both are wiped out.
   - The loser is wiped out. The winner loses troops equal to the loser's strength divided by the winner's own percentage: a defender with a 150% bonus loses one troop for every 1.5 attacking troops, and an attacker loses one troop for every troop it kills.
   - **Rounding favors the defense.** A winning defender's losses are rounded down; a winning attacker's losses are rounded up. So 1-troop attacks cannot dent a city (they would need 1.5 troops to kill one defender), and a narrow attacking win can leave nobody alive.
   - A battle only changes ownership if an attacker survives. If nobody is left standing (a tie, or the winner's losses use up all its troops) the tile keeps its owner and is left empty.
   - An attacker arriving on an empty tile simply captures it.
6. **Settle.** A player is beaten once they own no cities or villages and every tile they have left is farmland with exactly one troop on it: nobody has to take those last farms one by one, it is enough to capture the producers and destroy every army that can still move. A beaten player's remaining tiles turn neutral. (A player with a producer, or any tile holding more than one troop, is still in.) When exactly one player remains, they win and the match stops resolving.

Phases 3 to 5 are computed from the state after all departures, independently per destination tile, so none depends on the order armies are processed in.

Because each player has one order per tick, a player's own armies can never arrive at the same tile together.

## Consequences worth knowing

- **Reinforce before attack:** a tile that is about to be attacked can be reinforced in the same tick, and the reinforcements fight.
- **Leaving a tile weakly held:** when your army moves out, only one troop stays behind, so an enemy arriving that tick meets just that troop.
- **Swaps fight halfway:** two enemy armies that move onto each other's tiles meet in the middle and battle there, with no defensive bonus for either side (each troop kills one troop). The bigger army survives with the difference and carries on in the same tick to the tile it was sent to (which now holds one troop, and still gets its tile bonus); a tie wipes out both armies, and both tiles keep their one troop.
- **Piecemeal attacks fail:** an attack must beat the defender's boosted strength in one go. Many small armies arriving one tick at a time each lose everything and kill nothing.
- **Third wheels are wasted:** in a three-way fight the weakest attacker is removed without affecting the outcome.

## Surrender

A player may surrender at any time. It is an immediate action, not a queued order (`surrender(state, player)`). Their tiles become neutral and defensive-only. Their armies stay in place but shrink one troop at a time back to each tile type's base garrison, then stop. The player is eliminated.

## Open details

- Whether a draw should be possible (everyone eliminated simultaneously). Currently no winner is declared if nobody is left.
