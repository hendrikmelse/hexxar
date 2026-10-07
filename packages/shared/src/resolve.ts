import { tileRules, type MatchConfig } from './config.js';
import { hexKey } from './hex.js';
import { checkOrder, type OrdersByPlayer } from './orders.js';
import { settlePlayers, type GameState, type PlayerId, type Tile } from './state.js';

/** Attackers fight at face value; defenders get their tile's percentage. */
const ATTACKER_PERCENT = 100;

type MutableTile = { -readonly [K in keyof Tile]: Tile[K] };

interface Arrival {
  readonly player: PlayerId;
  readonly amount: number;
}

interface Participant {
  readonly owner: PlayerId | null;
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

  const tiles: Record<string, MutableTile> = {};
  for (const [key, tile] of Object.entries(state.tiles)) tiles[key] = { ...tile };

  // Phase 1: every commanded army departs, leaving one troop behind.
  const arrivals = new Map<string, Arrival[]>();
  for (const player of [...state.players].sort()) {
    const order = orders[player];
    if (!order || checkOrder(state, player, order) !== null) continue;
    const from = tiles[hexKey(order.from)];
    if (!from) continue;
    const amount = from.troops - 1;
    from.troops = 1;
    const key = hexKey(order.to);
    const list = arrivals.get(key) ?? [];
    list.push({ player, amount });
    arrivals.set(key, list);
  }

  // Phases 2-4 are independent per destination tile, since all departures are done.
  for (const key of [...arrivals.keys()].sort()) {
    const tile = tiles[key];
    const list = arrivals.get(key);
    if (!tile || !list) continue;

    // Phase 2: reinforce.
    const hostile: Arrival[] = [];
    for (const arrival of list) {
      if (arrival.player === tile.owner) tile.troops += arrival.amount;
      else hostile.push(arrival);
    }

    // Phases 3-4: attack and battle.
    if (hostile.length > 0)
      resolveBattle(tile, hostile, tileRules(config, tile.type).defensePercent);
  }

  // Generation (owned tiles, up to a cap) and decay (oversized neutral armies).
  const tick = state.tick + 1;
  for (const tile of Object.values(tiles)) {
    const rules = tileRules(config, tile.type);
    if (tile.owner === null) {
      if (tile.troops > rules.baseGarrison && tick % config.neutralDecayEveryTicks === 0) {
        tile.troops -= 1;
      }
      continue;
    }
    const { everyTicks, amount, cap } = rules.generation;
    const interval = Math.max(1, Math.round((everyTicks * 100) / config.generationSpeedPercent));
    if (tile.troops < cap && tick % interval === 0) tile.troops += amount;
  }

  const next: GameState = { ...state, tick, tiles };
  return { ...next, ...settlePlayers(next) };
}

/**
 * The strongest participant fights the second strongest and everyone else is
 * removed. The winner keeps the difference. A battle needs a survivor to change
 * ownership: if nobody is left standing the tile keeps its owner and is empty.
 */
function resolveBattle(
  tile: MutableTile,
  hostile: readonly Arrival[],
  defensePercent: number,
): void {
  const participants: Participant[] = hostile.map((a) => ({
    owner: a.player,
    strength: a.amount * ATTACKER_PERCENT,
    defender: false,
  }));
  if (tile.troops > 0) {
    participants.push({
      owner: tile.owner,
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
    tile.troops = top.strength / ATTACKER_PERCENT;
    return;
  }

  const percent = top.defender ? defensePercent : ATTACKER_PERCENT;
  const survivors = Math.floor((top.strength - second.strength) / percent);
  tile.troops = survivors;
  if (survivors > 0 && !top.defender) tile.owner = top.owner;
}

/**
 * A player gives up: their tiles turn neutral and they are eliminated. Their
 * armies stay as defensive-only garrisons that shrink back to each tile's base size.
 */
export function surrender(state: GameState, player: PlayerId): GameState {
  if (state.winner !== null || !state.players.includes(player)) return state;
  const tiles: Record<string, Tile> = {};
  for (const [key, tile] of Object.entries(state.tiles)) {
    tiles[key] = tile.owner === player ? { ...tile, owner: null } : tile;
  }
  const next: GameState = { ...state, tiles };
  return { ...next, ...settlePlayers(next, [player]) };
}
