import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createDuelMatch,
  createEasyBot,
  createFreeForAllMatch,
  createSmartBot,
  parseMatchConfig,
  resolveTick,
  scoresOf,
  visibleState,
  type Bot,
  type GameState,
  type Order,
  type OrdersByPlayer,
  type SmartOptions,
} from '@hexxar/shared';

/**
 * A harness for finding out whether one bot is better than another: it plays them against each
 * other, in duels (both sides, many boards) and in four-player battle royales (one candidate
 * against three of the opponent). It does nothing unless BOT_EXPERIMENT is set, because it takes
 * minutes. Configure it with environment variables:
 *
 *   BOT_VARIANT   the candidate: `legacy` (the original easy bot), or JSON SmartOptions overrides
 *   BOT_OPPONENT  the opponent, the same way (default `legacy`)
 *   BOT_DUELS     boards to play duels on, each played from both sides (default 12)
 *   BOT_FFA       battle royales to play (default 12)
 *   BOT_TICKS     longest a game may go on (default 3000)
 *   BOT_OUT       a file to write the result to, as JSON (default: print it)
 *
 *   BOT_EXPERIMENT=1 BOT_VARIANT='{"ring":true}' pnpm --filter @hexxar/server exec vitest run botExperiment
 */
const enabled = process.env.BOT_EXPERIMENT !== undefined;

const makeBot = (spec: string): Bot =>
  spec === 'legacy' ? createEasyBot() : createSmartBot(JSON.parse(spec) as Partial<SmartOptions>);

/** What the candidate's decisions cost, and how often it let a tick go by with nothing to do. */
const stats = { decisions: 0, idle: 0, ms: 0, maxMs: 0 };

/** The candidate, timed. (The opponent is not measured.) */
function measured(bot: Bot): Bot {
  return (context) => {
    const started = performance.now();
    const orders = bot(context);
    const took = performance.now() - started;
    stats.decisions++;
    stats.ms += took;
    stats.maxMs = Math.max(stats.maxMs, took);
    if (orders.length === 0) stats.idle++;
    return orders;
  };
}

const config = parseMatchConfig({ fog: 'on' });

interface Played {
  state: GameState;
  /** Who is ahead on production at the end, for games that did not finish. */
  capacity: Record<string, number>;
}

/** Everyone queues one order at a time, just in time, as the room does. */
function play(start: GameState, bots: Record<string, Bot>, ticks: number): Played {
  const queues = new Map<string, Order[]>(start.players.map((p) => [p, []]));
  let state = start;
  while (state.tick < ticks && state.winner === null) {
    const orders: Record<string, Order | undefined> = {};
    // The scoreboard is public, so every bot may be told it.
    const scores = scoresOf(state, config);
    for (const player of state.players) {
      if (state.eliminated.includes(player)) continue;
      const queue = queues.get(player)!;
      if (queue.length === 0) {
        queue.push(
          ...bots[player]!({
            view: visibleState(state, player, config),
            me: player,
            config,
            scores,
          }),
        );
      }
      orders[player] = queue.shift();
    }
    state = resolveTick(state, orders as OrdersByPlayer, config);
  }
  const capacity: Record<string, number> = {};
  for (const score of scoresOf(state, config)) capacity[score.player] = score.capacity;
  return { state, capacity };
}

describe.skipIf(!enabled)('bot experiment', () => {
  it('plays the candidate against the opponent', () => {
    const candidate = process.env.BOT_VARIANT ?? '{}';
    const opponent = process.env.BOT_OPPONENT ?? 'legacy';
    const duelBoards = Number(process.env.BOT_DUELS ?? 12);
    const royales = Number(process.env.BOT_FFA ?? 12);
    const ticks = Number(process.env.BOT_TICKS ?? 3000);

    const duels = { won: 0, lost: 0, unfinishedAhead: 0, unfinishedBehind: 0, ticksWon: 0 };
    for (let seed = 1; seed <= duelBoards; seed++) {
      for (const swap of [false, true]) {
        const { state: start } = createDuelMatch({ players: ['P1', 'P2'], seed, config });
        const us = swap ? 'P2' : 'P1';
        const them = swap ? 'P1' : 'P2';
        const { state, capacity } = play(
          start,
          { [us]: measured(makeBot(candidate)), [them]: makeBot(opponent) },
          ticks,
        );
        if (state.winner === us) {
          duels.won++;
          duels.ticksWon += state.tick;
        } else if (state.winner === them) duels.lost++;
        else if ((capacity[us] ?? 0) >= (capacity[them] ?? 0)) duels.unfinishedAhead++;
        else duels.unfinishedBehind++;
      }
    }

    const royale = { won: 0, otherWon: 0, unfinished: 0, ticksWon: 0, surviving: 0 };
    for (let seed = 1; seed <= royales; seed++) {
      const players = ['P1', 'P2', 'P3', 'P4'];
      const us = players[(seed - 1) % 4]!;
      const { state: start } = createFreeForAllMatch({ players, seed, config });
      const bots: Record<string, Bot> = {};
      for (const p of players)
        bots[p] = p === us ? measured(makeBot(candidate)) : makeBot(opponent);
      const { state } = play(start, bots, ticks + 1000);
      if (state.winner === us) {
        royale.won++;
        royale.ticksWon += state.tick;
      } else if (state.winner !== null) royale.otherWon++;
      else royale.unfinished++;
      if (!state.eliminated.includes(us)) royale.surviving++;
    }

    const cost = {
      decisions: stats.decisions,
      idleShare: Number((stats.idle / Math.max(1, stats.decisions)).toFixed(3)),
      avgMs: Number((stats.ms / Math.max(1, stats.decisions)).toFixed(4)),
      maxMs: Number(stats.maxMs.toFixed(2)),
    };
    const result = { candidate, opponent, duelBoards, royales, ticks, duels, royale, cost };
    const text = JSON.stringify(result);
    if (process.env.BOT_OUT) writeFileSync(process.env.BOT_OUT, text);
    else process.stdout.write(`${text}\n`);
    expect(duels.won + duels.lost + duels.unfinishedAhead + duels.unfinishedBehind).toBe(
      duelBoards * 2,
    );
  }, 3_600_000);
});

/**
 * What twelve bots cost a server: a battle royale of twelve of the candidate, with the time of every
 * decision measured. BOT_BENCH=1 BOT_EXPERIMENT=1 turns it on (BOT_TICKS ticks, 600 by default).
 */
describe.skipIf(!enabled || process.env.BOT_BENCH === undefined)('bot cost', () => {
  it('twelve bots on one board', () => {
    const candidate = process.env.BOT_VARIANT ?? '{}';
    const ticks = Number(process.env.BOT_TICKS ?? 600);
    const players = Array.from({ length: 12 }, (_, i) => `P${i + 1}`);
    const { state: start } = createFreeForAllMatch({ players, seed: 4, config });
    const bot = makeBot(candidate);
    const samples: number[] = [];
    const perTick: number[] = [];
    const queues = new Map<string, Order[]>(players.map((p) => [p, []]));
    let state = start;
    while (state.tick < ticks && state.winner === null) {
      const orders: Record<string, Order | undefined> = {};
      const scores = scoresOf(state, config);
      let tickMs = 0;
      for (const player of state.players) {
        if (state.eliminated.includes(player)) continue;
        const queue = queues.get(player)!;
        if (queue.length === 0) {
          const view = visibleState(state, player, config);
          const started = performance.now();
          queue.push(...bot({ view, me: player, config, scores }));
          const took = performance.now() - started;
          samples.push(took);
          tickMs += took;
        }
        orders[player] = queue.shift();
      }
      perTick.push(tickMs);
      state = resolveTick(state, orders as OrdersByPlayer, config);
    }
    const at = (xs: number[], q: number) =>
      [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * q)] ?? 0;
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    // The first stretch is the engine warming up.
    const warm = samples.slice(200);
    const text = JSON.stringify({
      candidate,
      ticks: state.tick,
      decisions: samples.length,
      decisionMs: { avg: mean(warm), p99: at(warm, 0.99), max: Math.max(...warm) },
      tickMs: { avg: mean(perTick), p99: at(perTick, 0.99), max: Math.max(...perTick) },
    });
    if (process.env.BOT_OUT) writeFileSync(process.env.BOT_OUT, text);
    else process.stdout.write(`${text}\n`);
    expect(samples.length).toBeGreaterThan(0);
  }, 600_000);
});
