# Tick resolution

How the server turns the current state plus every player's next queued order into the next state. This is the spec for `packages/shared`'s `resolveTick(state, orders)`.

**Hard requirement:** the result must not depend on player ordering, iteration order, or connection timing. Same state + same orders = same result, always.

## Phases

Each tick, the head of every player's queue is popped and validated against the current state. Invalid orders are dropped (the player simply gets no action this tick). Then:

1. **Depart.** Every commanded army leaves its current tile. It is now "in transit" and not on any tile. Tile _ownership_ is unchanged: a tile stays yours until someone else captures it.
2. **Reinforce.** An in-transit army whose destination is a tile **owned by its own player** joins whatever friendly army is on that tile (sums strength). If the tile is empty, it simply occupies it. Several friendly armies arriving at once all merge.
3. **Attack.** An in-transit army whose destination is **not** owned by its player is an attacker. Attackers from the same player arriving at the same tile first merge into one force.
4. **Battle.** For each contested tile, the participants are the arriving attackers (one force per player) plus the defending army if there is one. The strongest participant fights the second strongest; everyone else is removed.
   - The winner survives with `strength = first - second`, and takes ownership of the tile.
   - If the top two are tied, both are removed, and the tile keeps its previous owner (and is left empty).
   - A lone attacker on an undefended tile just captures it.
   - Phases 2 to 4 are computed purely from the post-departure state, so none of them depends on the order in which armies are processed.

## Consequences worth knowing

- **Reinforce before attack:** a tile you own that's about to be attacked can be reinforced in the same tick, and the reinforcements fight.
- **Leaving a tile undefended:** moving your only army off a tile in the same tick an enemy moves onto it means they capture it without a fight.
- **Chains work:** `A -> B` and `B -> C` in the same tick both succeed, because B's army has left before A's arrives. That makes conga-line movement possible.
- **Swaps pass through each other:** two enemy armies moving onto each other's tiles don't fight in transit; each simply attacks the other's now-empty tile.

## Open details (assumptions in progress)

- **Move size:** does an order move the whole army, or a chosen amount (e.g. "all but 1")?
- **Move distance:** does one order move one adjacent hex (so long paths are many queued orders), or can an order name a distant target that the sim walks?
- **Neutral tiles:** are unowned tiles treated like hostile empty tiles, or do they have a garrison?
- **Defender bonus:** does a defending army get a strength multiplier or terrain bonus in battle?
- **Surrender:** a player may surrender at any time. It is an immediate message, not a queued order. Their armies and tiles are removed (or become neutral).
