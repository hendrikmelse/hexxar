import type { Bot, BotContext } from './bot.js';
import { tileRules, type MatchConfig } from './config.js';
import { generationInterval, ownedFarmNeighbors } from './generation.js';
import { hexKey, hexNeighbors, type Hex } from './hex.js';
import type { Order } from './orders.js';
import { resolveTick } from './resolve.js';
import type { PlayerScore } from './scores.js';
import type { GameState, PlayerId, Tile } from './state.js';

/**
 * The easy bot (`createEasyBot`) with the habits a player picks up, each one a switch so that
 * every one can be measured on its own. With every switch off it makes exactly the easy bot's
 * decisions (a test holds it to that), which keeps the easy bot honest as the one to beat.
 * docs/bots.md says what each does and how well it did.
 */
export interface SmartOptions {
  // -- Habits that won in the first round of experiments ------------------------------------------
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

  // -- Fewer wasted ticks ---------------------------------------------------------------------------
  /** With nothing to do, march spare troops toward the front instead of passing the tick. */
  readonly pool: boolean;

  // -- Using the whole army --------------------------------------------------------------------------
  /**
   * Count only the troops that can walk to a target over the bot's own land. Otherwise a target next
   * to a cut-off outpost looks within reach, no troop can get there, and the bot does nothing.
   */
  readonly components: boolean;
  /**
   * `components` only applies while this many players or fewer are still in the match. In 160
   * battle royales it did not help, and may have cost a few wins; in duels it won clearly.
   */
  readonly componentsUntil: number;
  /**
   * When `components` is not in force and the bot would pass the tick, look for something its
   * troops can walk to (the next best target, gathering inside the piece of land that has the
   * troops) instead. Every decision that was not a pass stays exactly as it was.
   */
  readonly idleRepair: boolean;
  /** A big pile of troops marches toward the front instead of sitting where it is. */
  readonly deploy: boolean;
  /** A big pile is the one that attacks when it is next to the target and enough for it. */
  readonly spendPiles: boolean;

  // -- Defence --------------------------------------------------------------------------------------
  /** A city or village an enemy army could take does not send its troops away. */
  readonly homeGuard: boolean;
  /** Troops walk to a threatened city or village to defend it (or its attacker is hit first). */
  readonly reinforce: boolean;

  // -- Fight accuracy -------------------------------------------------------------------------------
  /** Work out whether the defender will make a troop before the army arrives, from its production timer. */
  readonly exact: boolean;
  /** Before attacking, play the attack through the game's own rules, and only go if it takes the tile. */
  readonly sim: boolean;
  /** Tiles another player has just left (one or two troops) are worth more (by `strikeFactor`). */
  readonly strike: boolean;

  // -- Battle royale --------------------------------------------------------------------------------
  /** Other players' tiles are worth more when their owner is weak, and less when they are strong. */
  readonly weakest: boolean;

  // -- Steadiness -----------------------------------------------------------------------------------
  /** Keep going for the target it chose last time unless something is clearly better (`stickiness`). */
  readonly sticky: boolean;

  // -- Value of tiles -------------------------------------------------------------------------------
  /** Neutral producers with few open neighbors (at the edge of the board) are worth less. */
  readonly edge: boolean;

  // -- Settings -------------------------------------------------------------------------------------
  /** How much a producer's speed-up is worth in value (see `ring`). */
  readonly ringScale: number;
  /**
   * A pile beside a target it can win attacks it, instead of waiting while the army gathers for a
   * better target, when that target scores at least this share of the best one's (0 = never).
   */
  readonly pileFirst: number;
  /** The same share when the best target can already be attacked (0 = the pile waits for that). */
  readonly pileOverNow: number;
  /** With `deploy` or `spendPiles`: a stack of this many troops is a pile. */
  readonly pileSize: number;
  /** With `deploy`: an attack that is available now still goes first if its target scores at least this. */
  readonly deployBelow: number;
  /** A producer counts as capped when it is within this many troops of its cap. */
  readonly capMargin: number;
  /** What a neutral city or village's value is multiplied by (see `neutralFirst`). */
  readonly neutralFactor: number;
  /** With `pickup`: step sideways onto a tile holding at least this many spare troops (0: never). */
  readonly detour: number;
  /**
   * Defence (`homeGuard`, `reinforce`) only applies while this many players or fewer are still in
   * the match. In a duel there is one front to hold; in a battle royale a producer always has some
   * neighbor that could take it, and defending all of them stops the bot expanding.
   */
  readonly defendUntil: number;
  /** With `homeGuard` or `reinforce`: an enemy can send at least this share of a producer's defense. */
  readonly threatRatio: number;
  /** With `strike`: the multiplier on a weakly held enemy tile's value. */
  readonly strikeFactor: number;
  /** With `sticky`: how much better a new target must score than the old one to take over (0.25 = 25%). */
  readonly stickiness: number;
  /** What the tiles are worth before the cost of the fight. */
  readonly cityValue: number;
  readonly villageValue: number;
  readonly farmValue: number;
  /** What taking a tile from another player is worth on top. */
  readonly enemyBonus: number;
  /** A target's value is divided by `1 + troops needed * this`. */
  readonly costPerTroop: number;
  /** Waiting to gather a force is worth this much of a fight it could win now. */
  readonly gatherFactor: number;
}

export const SMART_OFF: SmartOptions = {
  ring: false,
  uncap: false,
  pickup: false,
  neutralFirst: false,
  ignoreEnemyFarms: false,
  pool: false,
  components: false,
  componentsUntil: Number.POSITIVE_INFINITY,
  idleRepair: false,
  deploy: false,
  spendPiles: false,
  homeGuard: false,
  reinforce: false,
  exact: false,
  sim: false,
  strike: false,
  weakest: false,
  sticky: false,
  edge: false,
  pileFirst: 0,
  pileOverNow: 0,
  pileSize: 25,
  deployBelow: 3,
  ringScale: 60,
  capMargin: 1,
  neutralFactor: 1.5,
  detour: 0,
  defendUntil: Number.POSITIVE_INFINITY,
  threatRatio: 0.7,
  strikeFactor: 1.4,
  stickiness: 0.25,
  cityValue: 12,
  villageValue: 7,
  farmValue: 2,
  enemyBonus: 3,
  costPerTroop: 0.05,
  gatherFactor: 0.8,
};

/**
 * The first round's winners (docs/bots.md has the numbers): finishing rings, using capped armies
 * and picking up troops on the way. About 31 duels in 32 against the easy bot.
 */
export const SMART_V1: SmartOptions = { ...SMART_OFF, ring: true, uncap: true, pickup: true };

/**
 * The best combination found, which the rooms play: V1; defence once two players are left; and
 * only sending troops where they can walk (the army is counted by connected piece of land, in
 * duels and endgames, and a pass of the tick is repaired in a royale). Later habits are measured
 * against this. docs/bots.md has the numbers and what each part cost.
 */
export const SMART_BEST: SmartOptions = {
  ...SMART_V1,
  homeGuard: true,
  reinforce: true,
  defendUntil: 2,
  components: true,
  componentsUntil: 2,
  idleRepair: true,
};

const FARM_RING_BONUS = 1.5;

interface Target {
  readonly tile: Tile;
  /** The bot's own tiles next to it that are free to attack from. */
  readonly stagers: Tile[];
  /** Where an army gathers to attack it: the stager with the most troops (in the land with the most troops, with `components`). */
  readonly staging: Tile;
  readonly need: number;
  readonly score: number;
}

interface Choice {
  readonly target: Target;
  readonly now: boolean;
  readonly score: number;
}

/** What a bot remembers from one decision to the next. */
interface Memory {
  /** The target it went for last time (a tile key), for `sticky`. */
  lastTarget: string | null;
  /** Why the last decision came out as it did, for finding out why a bot does nothing. */
  trace: Trace;
}

/** What the last decision was based on. Only written, never read by the bot itself. */
export interface Trace {
  /** Which part of the bot gave the order (or why it gave none). */
  reason: string;
  /** How many tiles it could attack, and how many of those it could take with all its troops. */
  targets: number;
  reachable: number;
  /** All its troops that are free to march, and the most troops any target in reach would take. */
  army: number;
  /** The cost of the cheapest target that is out of reach, if any. */
  farNeed: number;
  /** What the bot decided to go for, e.g. "neutral village (now)". */
  best: string;
}

const NONE: ReadonlyMap<string, Tile> = new Map();

export function createSmartBot(overrides: Partial<SmartOptions> = {}): Bot {
  return createSmartBotWithTrace(overrides).bot;
}

/** The same bot, and a way to ask why it made its last decision (for experiments and debugging). */
export function createSmartBotWithTrace(overrides: Partial<SmartOptions> = {}): {
  bot: Bot;
  trace: () => Trace;
} {
  const options: SmartOptions = { ...SMART_OFF, ...overrides };
  const memory: Memory = {
    lastTarget: null,
    trace: { reason: '', targets: 0, reachable: 0, army: 0, farNeed: 0, best: '' },
  };
  return { bot: (context) => decide(context, options, memory), trace: () => memory.trace };
}

function decide(context: BotContext, o: SmartOptions, memory: Memory): Order[] {
  const { view, me, config } = context;
  const mine = Object.values(view.tiles).filter((tile) => tile.owner === me);
  const trace = memory.trace;
  trace.reason = 'nothing owned';
  trace.targets = trace.reachable = trace.army = trace.farNeed = 0;
  trace.best = '';
  if (mine.length === 0) return [];

  // Cities and villages an enemy army next door could take.
  const alive = view.players.length - view.eliminated.length;
  const defending = (o.homeGuard || o.reinforce) && alive <= o.defendUntil;
  const threatened = defending ? findThreatened(view, me, config, mine, o.threatRatio) : NONE;
  const guarded = o.homeGuard && defending ? threatened : NONE;
  // The tiles whose troops are free to go and fight.
  const free = guarded.size === 0 ? mine : mine.filter((tile) => !guarded.has(hexKey(tile)));
  const army = free.reduce((sum, tile) => sum + Math.max(0, tile.troops - 1), 0);

  // For each of the bot's tiles, which connected piece of its land it is in, and how many troops
  // each piece could send.
  const pieces = o.components && alive <= o.componentsUntil ? piecesOf(view, me, mine, free) : null;
  const strength = o.weakest && context.scores ? strengthOf(context.scores) : null;
  const targets = findTargets(view, me, config, mine, guarded, o, strength, pieces);
  trace.targets = targets.length;
  trace.army = army;

  let best: Choice | null = null;
  let bestFar: Target | null = null;
  const reachable: Choice[] = [];
  for (const target of targets) {
    const now = target.stagers.some((tile) => tile.troops - 1 >= target.need);
    if (!now && target.need > (pieces ? reachableArmy(pieces, target) : army)) {
      // Out of reach even with every troop it has: wait for production.
      if (!bestFar || target.score > bestFar.score) bestFar = target;
      if (trace.farNeed === 0 || target.need < trace.farNeed) trace.farNeed = target.need;
      continue;
    }
    const choice = { target, now, score: target.score * (now ? 1 : o.gatherFactor) };
    reachable.push(choice);
    trace.reachable++;
    if (best === null || choice.score > best.score) best = choice;
  }
  if (o.sim) {
    // An attack that the rules say would fail is not made: its target is something to gather for instead.
    for (let tries = 0; best?.now && tries < 3; tries++) {
      if (captures(view, me, config, attackFrom(best.target, o))) break;
      const failed = best;
      const index = reachable.indexOf(failed);
      reachable[index] = {
        target: failed.target,
        now: false,
        score: failed.target.score * o.gatherFactor,
      };
      best = reachable.reduce<Choice | null>(
        (a, b) => (a === null || b.score > a.score ? b : a),
        null,
      );
    }
  }
  if (o.sticky && best && memory.lastTarget !== null) {
    // Stay with the old target unless the new one is clearly better.
    const previous = reachable.find((c) => hexKey(c.target.tile) === memory.lastTarget);
    if (previous && best.score < previous.score * (1 + o.stickiness)) best = previous;
  }
  memory.lastTarget = best ? hexKey(best.target.tile) : null;
  if (best) {
    trace.best = `${best.target.tile.owner === null ? 'neutral' : 'enemy'} ${best.target.tile.type}${best.now ? ' (now)' : ''}`;
  }

  if (o.reinforce && defending && threatened.size > 0) {
    // Hit the army that threatens a producer if that can be done now.
    if (best?.now && nextToAny(best.target.tile, threatened)) {
      trace.reason = 'counter-attack';
      return [attackFrom(best.target, o)];
    }
    // Otherwise bring troops to the most valuable producer in danger.
    const [danger] = [...threatened.values()].sort(
      (a, b) => valueOf(o, b.type) - valueOf(o, a.type) || hexKey(a).localeCompare(hexKey(b)),
    );
    const helpers = mine.filter((tile) => !threatened.has(hexKey(tile)));
    const orders = gather(view, me, helpers, danger!, o);
    if (orders.length > 0) {
      trace.reason = 'reinforce';
      return orders;
    }
  }

  if (o.uncap) {
    const orders = useCappedArmy(view, me, config, free, targets, best?.target ?? null, o);
    if (orders.length > 0) {
      trace.reason = 'uncap';
      return orders;
    }
  }

  if (o.deploy && !(best?.now && best.score >= o.deployBelow)) {
    const orders = deployPile(view, me, free, targets, best, bestFar, o);
    if (orders.length > 0) {
      trace.reason = 'deploy';
      return orders;
    }
  }

  if (best && (best.now ? o.pileOverNow : o.pileFirst) > 0) {
    const orders = pileAttack(targets, best, best.now ? o.pileOverNow : o.pileFirst, o);
    if (orders.length > 0) {
      trace.reason = 'pile attack';
      return orders;
    }
  }

  const act = (choice: Choice): Order[] =>
    choice.now
      ? [attackFrom(choice.target, o)]
      : gather(view, me, free, stagingOf(choice.target), o);
  let orders: Order[] = [];
  if (best) {
    orders = act(best);
    if (orders.length === 0 && pieces) {
      // Nothing can walk to that one: the next best thing that can be done.
      const next = reachable
        .filter((c) => c !== best)
        .sort((a, b) => b.score - a.score)
        .slice(0, 4);
      for (const choice of next) {
        orders = act(choice);
        if (orders.length > 0) {
          best = choice;
          break;
        }
      }
    }
    if (orders.length === 0 && o.idleRepair && !pieces) {
      // The best target's gathering tile is a cut-off outpost. Try the others, with the troops that can get there.
      const repair = piecesOf(view, me, mine, free);
      const ranked = reachable
        .filter((c) => c !== best && (c.now || reachableArmy(repair, c.target) >= c.target.need))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      for (const choice of ranked) {
        orders = choice.now
          ? [attackFrom(choice.target, o)]
          : gather(view, me, free, stagingFor(choice.target.stagers, repair), o);
        if (orders.length > 0) {
          best = choice;
          break;
        }
      }
      // Even the best target, if its gathering tile can be chosen better.
      if (orders.length === 0) {
        orders = gather(view, me, free, stagingFor(best.target.stagers, repair), o);
      }
    }
    trace.reason =
      orders.length === 0
        ? `idle: no troops can reach the staging tile (${gatherNote})`
        : best.now
          ? 'attack'
          : 'gather';
  } else {
    trace.reason =
      targets.length === 0 ? 'idle: nothing next to my land' : 'idle: every target is out of reach';
  }
  if (orders.length === 0 && o.pool) {
    // Nothing to do this tick: march spare troops toward the next fight, so they are there when it comes.
    const goal = best?.target ?? bestFar;
    if (goal) orders = gather(view, me, free, stagingOf(goal), o);
  }
  return orders;
}

/**
 * The biggest pile of troops that is not already where the fight is marches a step toward it: to
 * the best city or village it could attack (or, failing that, the best target of any kind).
 */
function deployPile(
  view: GameState,
  me: PlayerId,
  free: readonly Tile[],
  targets: readonly Target[],
  best: Choice | null,
  bestFar: Target | null,
  o: SmartOptions,
): Order[] {
  const piles = free
    .filter((tile) => tile.troops >= o.pileSize)
    .sort((a, b) => b.troops - a.troops || hexKey(a).localeCompare(hexKey(b)));
  if (piles.length === 0) return [];
  // The producer worth the most, or else the best thing there is to go for.
  let front: Target | null = null;
  for (const target of targets) {
    if (target.tile.type === 'farmland') continue;
    if (front === null || target.score > front.score) front = target;
  }
  front ??= best?.target ?? bestFar;
  if (!front) return [];
  const staging = stagingOf(front);
  for (const pile of piles) {
    if (hexKey(pile) === hexKey(staging)) continue;
    const orders = gather(view, me, [pile], staging, o);
    if (orders.length > 0) return orders;
  }
  return [];
}

/** The pieces the bot's land falls into (tiles that touch), and the troops each could send. */
interface Pieces {
  readonly piece: ReadonlyMap<string, number>;
  readonly spare: readonly number[];
}

function piecesOf(
  view: GameState,
  me: PlayerId,
  mine: readonly Tile[],
  free: readonly Tile[],
): Pieces {
  const piece = new Map<string, number>();
  const spare: number[] = [];
  for (const start of mine) {
    if (piece.has(hexKey(start))) continue;
    const id = spare.length;
    spare.push(0);
    piece.set(hexKey(start), id);
    const queue: Tile[] = [start];
    for (let i = 0; i < queue.length; i++) {
      for (const hex of hexNeighbors(queue[i]!)) {
        const key = hexKey(hex);
        const next = view.tiles[key];
        if (!next || next.owner !== me || piece.has(key)) continue;
        piece.set(key, id);
        queue.push(next);
      }
    }
  }
  for (const tile of free) {
    const id = piece.get(hexKey(tile));
    if (id !== undefined) spare[id]! += Math.max(0, tile.troops - 1);
  }
  return { piece, spare };
}

/** The troops that can walk to this target: those in the pieces of land it can be attacked from. */
function reachableArmy(pieces: Pieces, target: Target): number {
  const seen = new Set<number>();
  let total = 0;
  for (const tile of target.stagers) {
    const id = pieces.piece.get(hexKey(tile));
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    total += pieces.spare[id]!;
  }
  return total;
}

/**
 * A pile that is right beside a target it can win takes it now: the best of those, if it is worth
 * at least `ratio` times as much as the target the bot would otherwise go for.
 */
function pileAttack(
  targets: readonly Target[],
  best: Choice,
  ratio: number,
  o: SmartOptions,
): Order[] {
  let pick: { target: Target; from: Tile } | null = null;
  for (const target of targets) {
    if (target === best.target || target.score < best.score * ratio) continue;
    if (pick !== null && target.score <= pick.target.score) continue;
    const piles = target.stagers.filter(
      (t) => t.troops >= o.pileSize && t.troops - 1 >= target.need,
    );
    if (piles.length === 0) continue;
    pick = { target, from: piles.reduce((a, b) => (b.troops < a.troops ? b : a)) };
  }
  return pick ? [move(pick.from, pick.target.tile)] : [];
}

/** Would this order take the tile it attacks, if nobody else did anything? Plays the tick out. */
function captures(view: GameState, me: PlayerId, config: MatchConfig, order: Order): boolean {
  const after = resolveTick(view, { [me]: order }, config);
  return after.tiles[hexKey(order.to)]?.owner === me;
}

const valueOf = (o: SmartOptions, type: Tile['type']): number =>
  type === 'city' ? o.cityValue : type === 'village' ? o.villageValue : o.farmValue;

function attackFrom(target: Target, o?: SmartOptions): Order {
  const enough = target.stagers.filter((tile) => tile.troops - 1 >= target.need);
  // The smallest army that is enough, so the big ones stay together; or, with `spendPiles`, a pile
  // that is right there, so it does not sit.
  const smallest = enough.reduce((a, b) => (b.troops < a.troops ? b : a));
  const biggest = enough.reduce((a, b) => (b.troops > a.troops ? b : a));
  const from = o?.spendPiles && biggest.troops >= o.pileSize ? biggest : smallest;
  return move(from, target.tile);
}

/** The bot's tile next to the target with the most troops: where an army gathers. */
const stagingOf = (target: Target): Tile => target.staging;

/**
 * The tile to gather at: the stager with the most troops. With `components`, first the stagers in
 * the piece of the bot's land that has the most troops to send, so the army can walk there.
 */
function stagingFor(stagers: readonly Tile[], pieces: Pieces | null): Tile {
  const spare = (tile: Tile): number =>
    pieces ? (pieces.spare[pieces.piece.get(hexKey(tile)) ?? -1] ?? 0) : 0;
  return stagers.reduce((a, b) =>
    spare(b) > spare(a) || (spare(b) === spare(a) && b.troops > a.troops) ? b : a,
  );
}

const nextToAny = (tile: Tile, tiles: ReadonlyMap<string, Tile>): boolean =>
  hexNeighbors(tile).some((hex) => tiles.has(hexKey(hex)));

/**
 * The bot's cities and villages that another player's army next door could take: what it could
 * send is a large share of what the producer would defend with.
 */
function findThreatened(
  view: GameState,
  me: PlayerId,
  config: MatchConfig,
  mine: readonly Tile[],
  ratio: number,
): Map<string, Tile> {
  const threatened = new Map<string, Tile>();
  for (const tile of mine) {
    if (tile.type === 'farmland') continue;
    const defense = (tile.troops * tileRules(config, tile.type).defensePercent) / 100;
    for (const hex of hexNeighbors(tile)) {
      const other = view.tiles[hexKey(hex)];
      if (!other || other.owner === null || other.owner === me) continue;
      if (other.troops - 1 >= defense * ratio) {
        threatened.set(hexKey(tile), tile);
        break;
      }
    }
  }
  return threatened;
}

/** How strong each player is, in troops: what they can send now and what they will make in a while. */
function strengthOf(scores: readonly PlayerScore[]): Map<PlayerId, number> {
  const strength = new Map<PlayerId, number>();
  for (const score of scores) strength.set(score.player, score.mobile + score.capacity * 80);
  return strength;
}

/**
 * Troops an army must send to take `tile` with a little to spare. Defenders fight at their tile's
 * bonus, rounding favors them, and another player's tile may make a troop before the army arrives.
 * With `exact`, that troop is only counted if the tile's production timer says it will be made.
 */
function troopsNeeded(view: GameState, config: MatchConfig, tile: Tile, exact: boolean): number {
  const rules = tileRules(config, tile.type);
  let margin = tile.owner === null ? 0 : 1;
  if (exact && tile.owner !== null) {
    margin = 0;
    const generation = rules.generation;
    if (generation && tile.troops < generation.cap) {
      const every = generationInterval(config, tile.type, ownedFarmNeighbors(view.tiles, tile));
      if (every !== null && tile.progress + 1 >= every) margin = generation.amount;
    }
  }
  return Math.ceil(((tile.troops + margin) * rules.defensePercent) / 100) + 1;
}

function findTargets(
  view: GameState,
  me: PlayerId,
  config: MatchConfig,
  mine: readonly Tile[],
  guarded: ReadonlyMap<string, Tile>,
  o: SmartOptions,
  strength: ReadonlyMap<PlayerId, number> | null,
  pieces: Pieces | null,
): Target[] {
  const stagers = new Map<string, Tile[]>();
  for (const tile of mine) {
    for (const hex of hexNeighbors(tile)) {
      const other = view.tiles[hexKey(hex)];
      if (!other || other.owner === me) continue;
      const list = stagers.get(hexKey(other)) ?? [];
      // A guarded producer is not sent out to attack.
      if (!guarded.has(hexKey(tile))) list.push(tile);
      stagers.set(hexKey(other), list);
    }
  }
  const myStrength = strength?.get(me) ?? 0;
  const targets: Target[] = [];
  for (const [key, from] of stagers) {
    if (from.length === 0) continue;
    const tile = view.tiles[key]!;
    const need = troopsNeeded(view, config, tile, o.exact);
    let value = valueOf(o, tile.type);
    if (tile.owner !== null) {
      // A skirmish over another player's farms is petty, when there are neutral producers to take.
      value += o.ignoreEnemyFarms && tile.type === 'farmland' ? 0 : o.enemyBonus;
      if (o.strike && tile.troops <= 2) value *= o.strikeFactor;
      if (strength) {
        // Weak players are the ones to fight; a strong one is best left to the others.
        const ratio = (strength.get(tile.owner) ?? 0) / (myStrength + 1);
        value *= Math.min(1.5, Math.max(0.6, 1.5 - 0.5 * ratio));
      }
    } else if (tile.type !== 'farmland') {
      if (o.neutralFirst) value *= o.neutralFactor;
      if (o.edge) value *= 0.6 + 0.4 * (openNeighbors(view, tile) / 6);
    }
    if (tile.type === 'farmland') value += ringValue(view, me, config, tile, o);
    targets.push({
      tile,
      stagers: from,
      staging: stagingFor(from, pieces),
      need,
      score: value / (1 + need * o.costPerTroop),
    });
  }
  return targets.sort((a, b) => hexKey(a.tile).localeCompare(hexKey(b.tile)));
}

/** How many of a tile's six neighbors are on the board. */
function openNeighbors(view: GameState, tile: Tile): number {
  let open = 0;
  for (const hex of hexNeighbors(tile)) if (view.tiles[hexKey(hex)]) open++;
  return open;
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

/**
 * One step of an army toward `staging`: among `sources`, the tile with the most troops for its
 * distance walks one tile closer, over the bot's own territory. With `pickup`, the army counts
 * the troops it would gather on the way, and takes the route past the most of them.
 */
/** Why the last gather found nothing to move, for the trace. */
let gatherNote = '';

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
  if (!from) {
    const spare = sources.filter((t) => t.troops >= 2 && hexKey(t) !== hexKey(staging));
    const connected = spare.filter((t) => distance.has(hexKey(t)));
    gatherNote = `staging ${staging.type}(${staging.q},${staging.r})=${staging.troops}, ${spare.length} tiles with spare troops (${spare.reduce((n, t) => n + t.troops - 1, 0)}), ${connected.length} connected to it, ${distance.size} own tiles reach it`;
    return [];
  }
  gatherNote = '';
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
