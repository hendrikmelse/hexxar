# Tick resolution

How the server turns the current state plus every player's next queued order into the next state. Implemented by `resolveTick` in `packages/shared/src/resolve.ts`.

**Hard requirement:** the result must not depend on player ordering, iteration order, or connection timing. Same state + same orders = same result, always.

## Model

- A **tile** has a type, an owner (a player, or nobody for neutral) and a **troop count**. The troops on a tile are its army, and they belong to the tile's owner. Neutral tiles hold a neutral garrison.
- A **move order** is `move(from, to)`: send all but one troop from your tile `from` to the **adjacent** tile `to`. One step per tick; a long march is several queued orders.
- Each tick, the head of every player's queue is popped and checked against the current state. Invalid orders (not your tile, fewer than 2 troops, not adjacent, off the board) are dropped; the player just gets no action that tick.

## Tile types

Tile types are data (`packages/shared/src/tiles.ts`). Each defines:

| Property          | Meaning                                                   |
| ----------------- | --------------------------------------------------------- |
| `defensePercent`  | Defender strength multiplier in percent (100 = no bonus)  |
| `neutralGarrison` | Troops on the tile at match start if neutral              |
| `generation`      | Owned tiles gain `amount` troops every `everyTicks` ticks |

Current types: **farmland**, **village**, **city** (numbers are placeholders until balancing). Adding a type means adding an entry to the table; the sim reads everything from it. Generation speed is scaled per match by `generationSpeedPercent`.

## Phases

1. **Depart.** Every commanded army leaves its tile, leaving **one troop behind**. Tile ownership is unchanged.
2. **Reinforce.** An arriving army whose destination is owned by its own player adds its troops to the tile.
3. **Attack.** An arriving army whose destination is not owned by its player (hostile or neutral) is an attacker.
4. **Battle.** On each contested tile, the participants are the arriving attackers plus the tile's current troops as the defender, if any. Attackers fight at face value; the defender's strength is multiplied by the tile type's `defensePercent`. The strongest participant fights the second strongest; everyone else is removed.
   - The winner keeps the difference, converted back to troops (rounded down).
   - If nobody is left standing (a tie, or rounding down to zero), the tile keeps its owner and is left empty. A battle only changes ownership if an attacker survives.
   - An attacker arriving on an empty tile simply captures it.
5. **Generate.** Owned tiles gain troops according to their type and the match's generation speed.
6. **Settle.** Players who own no tiles are eliminated. When exactly one player remains, they win and the match stops resolving.

Phases 2 to 4 are computed from the state after all departures, independently per destination tile, so none depends on the order armies are processed in.

Because each player has one order per tick, a player's own armies can never arrive at the same tile together.

## Consequences worth knowing

- **Reinforce before attack:** a tile that is about to be attacked can be reinforced in the same tick, and the reinforcements fight.
- **Leaving a tile weakly held:** when your army moves out, only one troop stays behind, so an enemy arriving that tick meets just that troop.
- **Swaps pass through each other:** two enemy armies moving onto each other's tiles don't fight in transit; each attacks the other's now thinly held tile.
- **Third wheels are wasted:** in a three-way fight the weakest attacker is removed without affecting the outcome.

## Surrender

A player may surrender at any time. It is an immediate action, not a queued order (`surrender(state, player)`). Their tiles become neutral and keep their troops, and they are eliminated.

## Open details

- Whether eliminated players' armies should vanish instead of becoming neutral garrisons.
- Whether a draw should be possible (everyone eliminated simultaneously). Currently no winner is declared if nobody is left.
