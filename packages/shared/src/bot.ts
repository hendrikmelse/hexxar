import { tileRules, type MatchConfig } from './config.js';
import { hexKey, hexNeighbors, type Hex } from './hex.js';
import type { Order } from './orders.js';
import type { GameState, PlayerId, Tile } from './state.js';
import type { TileTypeId } from './tiles.js';

/**
 * Computer-controlled players. A bot is a function from what its player may see to the orders to
 * queue: it gets `visibleState` (the same fogged board a person gets) and nothing else, and its
 * orders go through the same queue and the same one-order-per-tick limit as anyone's.
 */
export interface BotContext {
  /** The board as the bot's player sees it. */
  readonly view: GameState;
  readonly me: PlayerId;
  readonly config: MatchConfig;
}

/** Called whenever the bot has nothing queued; returns the orders to append (possibly none). */
export type Bot = (context: BotContext) => Order[];

/**
 * How good the bots in a room are. Only the setting exists so far: every level plays like the easy
 * bot until the others are written.
 */
export const BOT_LEVELS = ['easy', 'medium', 'hard'] as const;
export type BotLevel = (typeof BOT_LEVELS)[number];

/** Names for bots in a room (no two bots in a room share one). Clients add a [BOT] tag to them. */
export const BOT_NAMES: readonly string[] = [
  'Ada',
  'Bram',
  'Cleo',
  'Dax',
  'Edda',
  'Finn',
  'Gus',
  'Hana',
  'Ivo',
  'Juno',
  'Kai',
  'Lux',
];

/** How many bots "Play against bots" adds: the one opponent of a duel, or a battle royale's worth. */
export const BOT_GAME_BOTS = { duel: 1, ffa: 5 } as const;

/** What taking a tile is worth to the easy bot, before the cost of the fight. */
export const TILE_VALUE: Record<TileTypeId, number> = { city: 12, village: 7, farmland: 2 };
/** Taking a tile from another player is worth this much more than taking a neutral one. */
const ENEMY_BONUS = 3;
/** A farm next to one of the bot's own producers makes that producer faster. */
const FARM_RING_BONUS = 1.5;
/**
 * A target's value is divided by `1 + troops needed * this`: big fights are worth less, but never
 * worth nothing (an army of hundreds still has to go for the last city).
 */
const COST_PER_TROOP = 0.05;
/** Waiting to gather a force is worth a little less than a fight it can win right now. */
const GATHER_FACTOR = 0.8;

/** A tile the bot could go for: a tile next to one of its own that it does not own. */
interface Target {
  readonly tile: Tile;
  /** The bot's own tiles next to it. */
  readonly stagers: Tile[];
  /** How many troops must be sent to win with something to spare. */
  readonly need: number;
  readonly score: number;
}

/**
 * Troops an army must send to take `tile` with a little to spare. Defenders fight at their tile's
 * bonus, rounding favors them, and another player's tile may make a troop before the army arrives.
 */
export function troopsNeeded(config: MatchConfig, tile: Tile): number {
  const margin = tile.owner === null ? 0 : 1;
  const strength = ((tile.troops + margin) * tileRules(config, tile.type).defensePercent) / 100;
  return Math.ceil(strength) + 1;
}

/**
 * The simplest bot. It looks at every tile next to its territory, values them (cities over
 * villages over farms, a farm by its own producers, other players' tiles over neutral ones) and
 * discounts them by what the fight would cost, and goes for the best one: attacking if some tile of its own has
 * enough troops next to it, otherwise marching its biggest army nearby toward that tile to
 * join up. It never plans more than one step ahead and has no idea how to defend.
 */
export function createEasyBot(): Bot {
  return ({ view, me, config }) => {
    const mine = Object.values(view.tiles).filter((tile) => tile.owner === me);
    if (mine.length === 0) return [];
    const army = mine.reduce((sum, tile) => sum + Math.max(0, tile.troops - 1), 0);

    const targets = findTargets(view, me, config, mine);
    let best: { target: Target; now: boolean; score: number } | null = null;
    for (const target of targets) {
      const now = target.stagers.some((tile) => tile.troops - 1 >= target.need);
      // Out of reach even with every troop it has: wait for production.
      if (!now && target.need > army) continue;
      const score = target.score * (now ? 1 : GATHER_FACTOR);
      if (best === null || score > best.score) best = { target, now, score };
    }
    if (!best) return [];

    if (best.now) {
      // Send the smallest army that is enough, so the big ones stay together.
      const from = best.target.stagers
        .filter((tile) => tile.troops - 1 >= best.target.need)
        .reduce((a, b) => (b.troops < a.troops ? b : a));
      return [move(from, best.target.tile)];
    }
    return gather(view, me, mine, best.target);
  };
}

function findTargets(
  view: GameState,
  me: PlayerId,
  config: MatchConfig,
  mine: readonly Tile[],
): Target[] {
  const stagers = new Map<string, Tile[]>();
  for (const tile of mine) {
    for (const hex of hexNeighbors(tile)) {
      const other = view.tiles[hexKey(hex)];
      if (!other || other.owner === me) continue;
      const list = stagers.get(hexKey(other)) ?? [];
      list.push(tile);
      stagers.set(hexKey(other), list);
    }
  }
  const targets: Target[] = [];
  for (const [key, from] of stagers) {
    const tile = view.tiles[key]!;
    const need = troopsNeeded(config, tile);
    let value = TILE_VALUE[tile.type] + (tile.owner === null ? 0 : ENEMY_BONUS);
    if (tile.type === 'farmland') {
      for (const hex of hexNeighbors(tile)) {
        const next = view.tiles[hexKey(hex)];
        if (next && next.owner === me && next.type !== 'farmland') value += FARM_RING_BONUS;
      }
    }
    targets.push({ tile, stagers: from, need, score: value / (1 + need * COST_PER_TROOP) });
  }
  // A stable order, so the same board always gets the same answer.
  return targets.sort((a, b) => hexKey(a.tile).localeCompare(hexKey(b.tile)));
}

/**
 * One step of an army toward the best staging tile for `target`: among the bot's tiles, the one
 * with the most troops for its distance walks one tile closer, over the bot's own territory.
 */
function gather(view: GameState, me: PlayerId, mine: readonly Tile[], target: Target): Order[] {
  // The staging tile is the neighbor of the target with the most troops.
  const staging = target.stagers.reduce((a, b) => (b.troops > a.troops ? b : a));
  const next = new Map<string, Tile>();
  const distance = new Map<string, number>([[hexKey(staging), 0]]);
  const queue: Tile[] = [staging];
  for (let i = 0; i < queue.length; i++) {
    const tile = queue[i]!;
    for (const hex of hexNeighbors(tile)) {
      const key = hexKey(hex);
      const other = view.tiles[key];
      if (!other || other.owner !== me || distance.has(key)) continue;
      distance.set(key, distance.get(hexKey(tile))! + 1);
      next.set(key, tile);
      queue.push(other);
    }
  }
  let from: Tile | null = null;
  let bestWeight = 0;
  for (const tile of mine) {
    if (tile.troops < 2 || hexKey(tile) === hexKey(staging)) continue;
    const away = distance.get(hexKey(tile));
    if (away === undefined) continue;
    const weight = (tile.troops - 1) / (1 + away);
    if (weight > bestWeight) {
      bestWeight = weight;
      from = tile;
    }
  }
  const to = from && next.get(hexKey(from));
  return from && to ? [move(from, to)] : [];
}

const move = (from: Hex, to: Hex): Order => ({
  type: 'move',
  from: { q: from.q, r: from.r },
  to: { q: to.q, r: to.r },
});
