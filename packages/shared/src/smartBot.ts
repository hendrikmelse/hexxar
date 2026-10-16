import type { Bot } from './bot.js';
import { TILE_VALUE, troopsNeeded } from './bot.js';
import { tileRules, type MatchConfig } from './config.js';
import { generationInterval, ownedFarmNeighbors } from './generation.js';
import { hexKey, hexNeighbors, type Hex } from './hex.js';
import type { Order } from './orders.js';
import type { GameState, PlayerId, Tile } from './state.js';

/**
 * The easy bot (`createEasyBot`) with the habits a beginner picks up, each one a switch so that
 * every one can be measured on its own. With every switch off it makes exactly the easy bot's
 * decisions (a test holds it to that), which keeps the easy bot honest as the one to beat.
 */
export interface SmartOptions {
  /**
   * Value a farm by how much faster it would make the producers next to it, instead of a flat
   * bonus: the last farms of a city's ring are worth far more than the first.
   */
  readonly ring: boolean;
  /** A producer whose army is at its cap has stopped producing: use that army, or at least move it off. */
  readonly uncap: boolean;
  /** An army marching to the front takes the route past the most troops, picking them up on the way. */
  readonly pickup: boolean;
  /** Neutral cities and villages are worth more (by `neutralFactor`) than a fight with another player. */
  readonly neutralFirst: boolean;
  /** Another player's farmland is worth no more than neutral farmland: no skirmishing over it. */
  readonly ignoreEnemyFarms: boolean;

  /** How much a producer's speed-up is worth in value (see `ring`). */
  readonly ringScale: number;
  /** A producer counts as capped when it is within this many troops of its cap. */
  readonly capMargin: number;
  /** What a neutral city or village's value is multiplied by (see `neutralFirst`). */
  readonly neutralFactor: number;
  /** With `pickup`: step sideways onto a tile holding at least this many spare troops (0: never). */
  readonly detour: number;
}

export const SMART_OFF: SmartOptions = {
  ring: false,
  uncap: false,
  pickup: false,
  neutralFirst: false,
  ignoreEnemyFarms: false,
  ringScale: 60,
  capMargin: 1,
  neutralFactor: 1.5,
  detour: 0,
};

/**
 * The habits that measured best (docs/bots.md has the numbers): a bot with these wins about 31 of
 * 32 duels against the easy bot, in about 800 ticks. The other two switches did not help (a bot
 * that favors neutral producers, or ignores other players' farms, lost ground), and are off.
 */
export const SMART_BEST: SmartOptions = { ...SMART_OFF, ring: true, uncap: true, pickup: true };

const FARM_RING_BONUS = 1.5;
const ENEMY_BONUS = 3;
const COST_PER_TROOP = 0.05;
const GATHER_FACTOR = 0.8;

interface Target {
  readonly tile: Tile;
  readonly stagers: Tile[];
  readonly need: number;
  readonly score: number;
}

export function createSmartBot(overrides: Partial<SmartOptions> = {}): Bot {
  const options: SmartOptions = { ...SMART_OFF, ...overrides };
  return ({ view, me, config }) => decide(view, me, config, options);
}

function decide(view: GameState, me: PlayerId, config: MatchConfig, o: SmartOptions): Order[] {
  const mine = Object.values(view.tiles).filter((tile) => tile.owner === me);
  if (mine.length === 0) return [];
  const army = mine.reduce((sum, tile) => sum + Math.max(0, tile.troops - 1), 0);

  const targets = findTargets(view, me, config, mine, o);
  let best: { target: Target; now: boolean; score: number } | null = null;
  for (const target of targets) {
    const now = target.stagers.some((tile) => tile.troops - 1 >= target.need);
    if (!now && target.need > army) continue;
    const score = target.score * (now ? 1 : GATHER_FACTOR);
    if (best === null || score > best.score) best = { target, now, score };
  }

  if (o.uncap) {
    const orders = useCappedArmy(view, me, config, mine, targets, best?.target ?? null, o);
    if (orders.length > 0) return orders;
  }
  if (!best) return [];
  if (best.now) return [attackFrom(best.target)];
  return gather(view, me, mine, stagingOf(best.target), o);
}

function attackFrom(target: Target): Order {
  // The smallest army that is enough, so the big ones stay together.
  const from = target.stagers
    .filter((tile) => tile.troops - 1 >= target.need)
    .reduce((a, b) => (b.troops < a.troops ? b : a));
  return move(from, target.tile);
}

/** The bot's tile next to the target with the most troops: where an army gathers. */
const stagingOf = (target: Target): Tile =>
  target.stagers.reduce((a, b) => (b.troops > a.troops ? b : a));

/**
 * Producers at their cap make no more troops until their army moves. The biggest such army goes
 * out: to attack if it can win something where it stands, otherwise toward where the best fight
 * is, otherwise just onto a neighboring tile so production can start again.
 */
function useCappedArmy(
  view: GameState,
  me: PlayerId,
  config: MatchConfig,
  mine: readonly Tile[],
  targets: readonly Target[],
  best: Target | null,
  o: SmartOptions,
): Order[] {
  const capped = mine
    .filter((tile) => {
      const generation = tileRules(config, tile.type).generation;
      return generation !== null && tile.troops >= 2 && tile.troops >= generation.cap - o.capMargin;
    })
    .sort((a, b) => b.troops - a.troops || hexKey(a).localeCompare(hexKey(b)));

  for (const tile of capped) {
    // A fight this army can win from where it stands.
    let win: Target | null = null;
    for (const target of targets) {
      if (!target.stagers.some((s) => hexKey(s) === hexKey(tile))) continue;
      if (tile.troops - 1 < target.need) continue;
      if (win === null || target.score > win.score) win = target;
    }
    if (win) return [move(tile, win.tile)];

    // Toward the best fight, if it is not already beside it.
    if (best) {
      const staging = stagingOf(best);
      if (hexKey(staging) !== hexKey(tile)) {
        const orders = gather(view, me, [tile], staging, o);
        if (orders.length > 0) return orders;
      }
    }

    // Anywhere nearby will do: the least crowded neighbor.
    let relief: Tile | null = null;
    for (const hex of hexNeighbors(tile)) {
      const next = view.tiles[hexKey(hex)];
      if (!next || next.owner !== me) continue;
      if (relief === null || next.troops < relief.troops) relief = next;
    }
    if (relief) return [move(tile, relief)];
  }
  return [];
}

function findTargets(
  view: GameState,
  me: PlayerId,
  config: MatchConfig,
  mine: readonly Tile[],
  o: SmartOptions,
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
    let value = TILE_VALUE[tile.type];
    if (tile.owner !== null) {
      // A skirmish over another player's farms is petty, when there are neutral producers to take.
      value += o.ignoreEnemyFarms && tile.type === 'farmland' ? 0 : ENEMY_BONUS;
    } else if (o.neutralFirst && tile.type !== 'farmland') {
      value *= o.neutralFactor;
    }
    if (tile.type === 'farmland') value += ringValue(view, me, config, tile, o);
    targets.push({ tile, stagers: from, need, score: value / (1 + need * COST_PER_TROOP) });
  }
  return targets.sort((a, b) => hexKey(a.tile).localeCompare(hexKey(b.tile)));
}

/** What owning this farm is worth for the bot's producers beside it. */
function ringValue(
  view: GameState,
  me: PlayerId,
  config: MatchConfig,
  farm: Tile,
  o: SmartOptions,
): number {
  let value = 0;
  for (const hex of hexNeighbors(farm)) {
    const producer = view.tiles[hexKey(hex)];
    if (!producer || producer.owner !== me || producer.type === 'farmland') continue;
    if (!o.ring) {
      value += FARM_RING_BONUS;
      continue;
    }
    // Troops per tick with one more farm around it, minus without: the speed-up this farm brings.
    const farms = ownedFarmNeighbors(view.tiles, producer);
    if (farms >= 6) continue;
    const now = generationInterval(config, producer.type, farms);
    const next = generationInterval(config, producer.type, farms + 1);
    if (now !== null && next !== null) value += o.ringScale * (1 / next - 1 / now);
  }
  return value;
}

/**
 * One step of an army toward `staging`: among `sources`, the tile with the most troops for its
 * distance walks one tile closer, over the bot's own territory. With `pickup`, the army counts
 * the troops it would gather on the way, and takes the route past the most of them.
 */
function gather(
  view: GameState,
  me: PlayerId,
  sources: readonly Tile[],
  staging: Tile,
  o: SmartOptions,
): Order[] {
  const parent = new Map<string, Tile>();
  const distance = new Map<string, number>([[hexKey(staging), 0]]);
  const queue: Tile[] = [staging];
  for (let i = 0; i < queue.length; i++) {
    const tile = queue[i]!;
    for (const hex of hexNeighbors(tile)) {
      const key = hexKey(hex);
      const other = view.tiles[key];
      if (!other || other.owner !== me || distance.has(key)) continue;
      distance.set(key, distance.get(hexKey(tile))! + 1);
      parent.set(key, tile);
      queue.push(other);
    }
  }

  // carry: the most troops an army can pick up between a tile and the staging tile, on a shortest route.
  const carry = new Map<string, number>([[hexKey(staging), 0]]);
  const gain = (tile: Tile): number =>
    hexKey(tile) === hexKey(staging) ? 0 : Math.max(0, tile.troops - 1);
  if (o.pickup) {
    for (const tile of queue) {
      if (hexKey(tile) === hexKey(staging)) continue;
      let most = 0;
      for (const hex of hexNeighbors(tile)) {
        const key = hexKey(hex);
        if (distance.get(key) !== distance.get(hexKey(tile))! - 1) continue;
        most = Math.max(most, gain(view.tiles[key]!) + (carry.get(key) ?? 0));
      }
      carry.set(hexKey(tile), most);
    }
  }

  let from: Tile | null = null;
  let bestWeight = 0;
  for (const tile of sources) {
    if (tile.troops < 2 || hexKey(tile) === hexKey(staging)) continue;
    const away = distance.get(hexKey(tile));
    if (away === undefined) continue;
    const weight = (tile.troops - 1 + (o.pickup ? (carry.get(hexKey(tile)) ?? 0) : 0)) / (1 + away);
    if (weight > bestWeight) {
      bestWeight = weight;
      from = tile;
    }
  }
  if (!from) return [];
  if (!o.pickup) {
    const to = parent.get(hexKey(from));
    return to ? [move(from, to)] : [];
  }

  // The next tile on a shortest route that is worth the most to walk through.
  const here = distance.get(hexKey(from))!;
  let to: Tile | null = null;
  let toValue = -1;
  for (const hex of hexNeighbors(from)) {
    const key = hexKey(hex);
    const next = view.tiles[key];
    if (!next || next.owner !== me || distance.get(key) !== here - 1) continue;
    const value = gain(next) + (carry.get(key) ?? 0);
    if (value > toValue) {
      to = next;
      toValue = value;
    }
  }
  if (o.detour > 0) {
    // Sideways, onto a tile with an army worth collecting, when the way ahead has less to offer.
    for (const hex of hexNeighbors(from)) {
      const key = hexKey(hex);
      const next = view.tiles[key];
      if (!next || next.owner !== me || distance.get(key) !== here) continue;
      if (hexKey(next) === hexKey(staging) || next.troops - 1 < o.detour) continue;
      if (next.troops - 1 > toValue) {
        to = next;
        toValue = next.troops - 1;
      }
    }
  }
  return to ? [move(from, to)] : [];
}

const move = (from: Hex, to: Hex): Order => ({
  type: 'move',
  from: { q: from.q, r: from.r },
  to: { q: to.q, r: to.r },
});
