import { tileRules, type MatchConfig } from './config.js';
import { ownedFarmNeighbors, stepTile } from './generation.js';
import { hexKey, type Hex } from './hex.js';
import { checkOrder, type Order, type OrdersByPlayer } from './orders.js';
import { settle, type GameState, type PlayerId, type Tile } from './state.js';

/** Attackers fight at face value; defenders get their tile's percentage. */
const ATTACKER_PERCENT = 100;

type Move = Extract<Order, { type: 'move' }>;

type MutableTile = { -readonly [K in keyof Tile]: Tile[K] };

interface Arrival {
  readonly player: PlayerId;
  readonly amount: number;
  /** The army this is the arrival of, which is told how its battle went. */
  readonly departure: Departure;
}

interface Participant {
  /** Set for an attacking army; the defenders (the tile's garrison) have none. */
  readonly arrival?: Arrival;
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
  return playTick(state, orders, config).state;
}

/**
 * `resolveTick`, together with the moves it carried out and how each battle went for the armies
 * in it, for clients to animate. The state is exactly what `resolveTick` gives.
 */
export function playTick(
  state: GameState,
  orders: OrdersByPlayer,
  config: MatchConfig,
): { state: GameState; moves: ExecutedMove[] } {
  if (state.winner !== null) return { state, moves: [] };

  const tick = state.tick + 1;
  const tiles = generate(state, config);

  // Phase 2: every commanded army departs, leaving one troop behind. Armies that march into
  // each other fight halfway, and only the survivors go on to their destination.
  const departures = depart({ ...state, tiles }, orders);
  const arrivals = new Map<string, Arrival[]>();
  for (const departure of departures) {
    const { player, order, amount, clash } = departure;
    const delivered = clash ? clash.survivors : amount;
    if (delivered <= 0) continue;
    const key = hexKey(order.to);
    const list = arrivals.get(key) ?? [];
    list.push({ player, amount: delivered, departure });
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
    if (hostile.length === 0) continue;
    const defenderOwner = tile.owner;
    const report = resolveBattle(tile, hostile, tileRules(config, tile.type).defensePercent);
    if (!report) continue;
    for (const { arrival, lost } of report.attackers) {
      arrival.departure.fight = {
        lost,
        ...(report.defenderLost === null
          ? {}
          : { defender: { owner: defenderOwner, lost: report.defenderLost } }),
      };
    }
  }

  return {
    state: settle({ ...state, tick, tiles }),
    moves: departures.map(({ player, order, amount, clash, fight }) => ({
      player,
      from: order.from,
      to: order.to,
      troops: amount,
      ...(clash ? { clash } : {}),
      ...(fight ? { fight } : {}),
    })),
  };
}

/** Phase 1: generation, per tile. Troops generated this tick can fight and move this tick. */
function generate(state: GameState, config: MatchConfig): Record<string, MutableTile> {
  const tiles: Record<string, MutableTile> = {};
  for (const [key, tile] of Object.entries(state.tiles)) tiles[key] = { ...tile };
  for (const tile of Object.values(tiles)) {
    const { troops, progress } = stepTile(config, tile, ownedFarmNeighbors(tiles, tile));
    tile.troops = troops;
    tile.progress = progress;
  }
  return tiles;
}

/** The orders that will be carried out, checked against the post-generation state before anyone moves. */
function validMoves(
  generated: GameState,
  orders: OrdersByPlayer,
): { player: PlayerId; order: Move }[] {
  const moves: { player: PlayerId; order: Move }[] = [];
  for (const player of [...generated.players].sort()) {
    const order = orders[player];
    if (order && checkOrder(generated, player, order) === null) moves.push({ player, order });
  }
  return moves;
}

/** An army setting off: what leaves its tile, and what became of it if it met another on the way. */
interface Departure {
  readonly player: PlayerId;
  readonly order: Move;
  readonly amount: number;
  /** Set when this army and one marching the other way ran into each other (a swap). */
  clash?: { readonly survivors: number };
  /** Set when what is left of this army fought at the tile it was sent to. */
  fight?: Fight;
}

/**
 * Phase 2: every valid order sends all but one troop off its tile (the tile in `generated.tiles`
 * is left with one). Two armies that swap places meet in the middle and fight with no defensive
 * bonus on either side: the bigger one survives with the difference (troops lost one for one),
 * and a tie wipes out both. The survivors carry on to the tile they were sent to.
 */
function depart(generated: GameState, orders: OrdersByPlayer): Departure[] {
  const tiles = generated.tiles as Record<string, MutableTile>;
  const departures: Departure[] = [];
  for (const { player, order } of validMoves(generated, orders)) {
    const from = tiles[hexKey(order.from)];
    if (!from) continue;
    departures.push({ player, order, amount: from.troops - 1 });
    from.troops = 1;
  }
  for (const a of departures) {
    for (const b of departures) {
      if (a === b || a.clash || b.clash) continue;
      const swapped =
        hexKey(a.order.from) === hexKey(b.order.to) && hexKey(a.order.to) === hexKey(b.order.from);
      if (!swapped) continue;
      const difference = Math.abs(a.amount - b.amount);
      a.clash = { survivors: a.amount > b.amount ? difference : 0 };
      b.clash = { survivors: b.amount > a.amount ? difference : 0 };
    }
  }
  return departures;
}

/** An army that set off this tick, for clients to animate: who, from where to where, and how many. */
export interface ExecutedMove {
  readonly player: PlayerId;
  readonly from: Hex;
  readonly to: Hex;
  readonly troops: number;
  /** Set when it met an army coming the other way: how many of this one were left to go on. */
  readonly clash?: { readonly survivors: number };
  /** Set when what was left of it fought at its destination (after any clash on the way). */
  readonly fight?: Fight;
}

/** How a battle at an army's destination went for it. */
export interface Fight {
  /** The troops this army lost; all of those it brought, unless it won. */
  readonly lost: number;
  /**
   * The tile's defenders, if it had any: its garrison together with any reinforcements that
   * arrived the same tick, as one force. `owner` is whose they were (`null`: neutral).
   */
  readonly defender?: { readonly owner: PlayerId | null; readonly lost: number };
}

/**
 * The moves `resolveTick` will carry out for these orders (invalid ones are left out), with the
 * number of troops each sends and how its battles went. Purely informational: the resulting state
 * comes from `resolveTick`.
 */
export function executedMoves(
  state: GameState,
  orders: OrdersByPlayer,
  config: MatchConfig,
): ExecutedMove[] {
  return playTick(state, orders, config).moves;
}

/** What each side lost in a battle. */
interface BattleReport {
  readonly attackers: { readonly arrival: Arrival; readonly lost: number }[];
  /** `null` when the tile had no defenders. */
  readonly defenderLost: number | null;
}

/**
 * The strongest participant fights the second strongest and everyone else is
 * removed. A battle needs a survivor to change
 * ownership: if nobody is left standing the tile keeps its owner and is empty.
 * Returns what everyone lost, or `null` when there was nobody to fight.
 */
function resolveBattle(
  tile: MutableTile,
  hostile: readonly Arrival[],
  defensePercent: number,
): BattleReport | null {
  const participants: Participant[] = hostile.map((a) => ({
    arrival: a,
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
  if (!top) return null;
  if (!second) {
    // Unopposed: walk onto an empty tile.
    tile.owner = top.owner;
    tile.progress = 0;
    tile.troops = top.strength / ATTACKER_PERCENT;
    return null;
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

  // Everyone but the winner is wiped out; the winner lost what it took to beat the runner-up.
  const lostBy = (p: Participant) => (p === top && !tied ? Math.min(loss, p.troops) : p.troops);
  const defenders = participants.find((p) => p.defender);
  return {
    attackers: participants.flatMap((p) =>
      p.arrival ? [{ arrival: p.arrival, lost: lostBy(p) }] : [],
    ),
    defenderLost: defenders ? lostBy(defenders) : null,
  };
}

/**
 * A player gives up: their tiles turn neutral and they are eliminated. Their
 * armies stay as defensive-only garrisons that shrink back to each tile's base size.
 */
export function surrender(state: GameState, player: PlayerId): GameState {
  if (state.winner !== null || !state.players.includes(player)) return state;
  return settle(state, [player]);
}
