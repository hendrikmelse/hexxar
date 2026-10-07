import { tileRules, type MatchConfig } from './config.js';
import { stepTile } from './generation.js';
import { hexKey } from './hex.js';
import { checkOrder, type Order, type OrdersByPlayer } from './orders.js';
import { settlePlayers, type GameState, type PlayerId, type Tile } from './state.js';

/** Attackers fight at face value; defenders get their tile's percentage. */
const ATTACKER_PERCENT = 100;

type Move = Extract<Order, { type: 'move' }>;

type MutableTile = { -readonly [K in keyof Tile]: Tile[K] };

interface Arrival {
  readonly player: PlayerId;
  readonly amount: number;
}

interface Participant {
  readonly owner: PlayerId | null;
  readonly troops: number;
  /** Strength in percent-troops (troops * percent), keeps the math integer. */
  readonly strength: number;
  readonly defender: boolean;
}

/**
 * Advance the match by one tick. Pure: never mutates `state` and never depends
 * on the iteration order of `orders`. See docs/tick-resolution.md.
 */
export function resolveTick(
  state: GameState,
  orders: OrdersByPlayer,
  config: MatchConfig,
): GameState {
  if (state.winner !== null) return state;

  const tick = state.tick + 1;
  const tiles: Record<string, MutableTile> = {};
  for (const [key, tile] of Object.entries(state.tiles)) tiles[key] = { ...tile };

  // Phase 1: generation and decay, per tile. Troops generated this tick can fight and move this tick.
  for (const tile of Object.values(tiles)) {
    const { troops, progress } = stepTile(config, tile);
    tile.troops = troops;
    tile.progress = progress;
  }

  // Phase 2: every commanded army departs, leaving one troop behind.
  // Orders are checked against the post-generation state, before anyone moves.
  const generated: GameState = { ...state, tiles };
  const moves: { player: PlayerId; order: Move }[] = [];
  for (const player of [...state.players].sort()) {
    const order = orders[player];
    if (order && checkOrder(generated, player, order) === null) moves.push({ player, order });
  }
  const arrivals = new Map<string, Arrival[]>();
  for (const { player, order } of moves) {
    const from = tiles[hexKey(order.from)];
    if (!from) continue;
    const amount = from.troops - 1;
    from.troops = 1;
    const key = hexKey(order.to);
    const list = arrivals.get(key) ?? [];
    list.push({ player, amount });
    arrivals.set(key, list);
  }

  // Phases 3-5 are independent per destination tile, since all departures are done.
  for (const key of [...arrivals.keys()].sort()) {
    const tile = tiles[key];
    const list = arrivals.get(key);
    if (!tile || !list) continue;

    // Phase 3: reinforce.
    const hostile: Arrival[] = [];
    for (const arrival of list) {
      if (arrival.player === tile.owner) tile.troops += arrival.amount;
      else hostile.push(arrival);
    }

    // Phases 4-5: attack and battle.
    if (hostile.length > 0)
      resolveBattle(tile, hostile, tileRules(config, tile.type).defensePercent);
  }

  const next: GameState = { ...state, tick, tiles };
  return { ...next, ...settlePlayers(next) };
}

/**
 * The strongest participant fights the second strongest and everyone else is
 * removed. A battle needs a survivor to change
 * ownership: if nobody is left standing the tile keeps its owner and is empty.
 */
function resolveBattle(
  tile: MutableTile,
  hostile: readonly Arrival[],
  defensePercent: number,
): void {
  const participants: Participant[] = hostile.map((a) => ({
    owner: a.player,
    troops: a.amount,
    strength: a.amount * ATTACKER_PERCENT,
    defender: false,
  }));
  if (tile.troops > 0) {
    participants.push({
      owner: tile.owner,
      troops: tile.troops,
      strength: tile.troops * defensePercent,
      defender: true,
    });
  }
  participants.sort((a, b) => b.strength - a.strength);

  const [top, second] = participants;
  if (!top) return;
  if (!second) {
    // Unopposed: walk onto an empty tile.
    tile.owner = top.owner;
    tile.progress = 0;
    tile.troops = top.strength / ATTACKER_PERCENT;
    return;
  }

  // The loser is wiped out. The winner loses troops worth the loser's strength at the
  // winner's own rate, so a defender's bonus makes each of its troops cost more to kill
  // and each attacker troop cost one full troop to lose. Rounding favors the defense:
  // defender losses round down, attacker losses round up.
  const percent = top.defender ? defensePercent : ATTACKER_PERCENT;
  const loss = top.defender
    ? Math.floor(second.strength / percent)
    : Math.ceil(second.strength / percent);
  const tied = top.strength === second.strength;
  const survivors = tied ? 0 : Math.max(0, top.troops - loss);
  tile.troops = survivors;
  if (survivors > 0 && !top.defender) {
    tile.owner = top.owner;
    tile.progress = 0;
  }
}

/**
 * A player gives up: their tiles turn neutral and they are eliminated. Their
 * armies stay as defensive-only garrisons that shrink back to each tile's base size.
 */
export function surrender(state: GameState, player: PlayerId): GameState {
  if (state.winner !== null || !state.players.includes(player)) return state;
  const tiles: Record<string, Tile> = {};
  for (const [key, tile] of Object.entries(state.tiles)) {
    tiles[key] = tile.owner === player ? { ...tile, owner: null, progress: 0 } : tile;
  }
  const next: GameState = { ...state, tiles };
  return { ...next, ...settlePlayers(next, [player]) };
}
