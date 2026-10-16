import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createDuelMatch,
  createEasyBot,
  createFreeForAllMatch,
  createSmartBotWithTrace,
  parseMatchConfig,
  resolveTick,
  scoresOf,
  visibleState,
  type Bot,
  type GameState,
  type Order,
  type OrdersByPlayer,
  type SmartOptions,
  type Tile,
} from '@hexxar/shared';

/**
 * Finds out why a bot sits idle, and where its army is when it does. Plays the candidate against
 * the opponent and, at every decision, notes why the candidate decided as it did and what its
 * army looked like. Does nothing unless BOT_DIAGNOSE is set. Configure with:
 *
 *   BOT_VARIANT   JSON SmartOptions for the candidate (default `{}`)
 *   BOT_OPPONENT  `legacy` or JSON (default `legacy`)
 *   BOT_MODE      `duel` or `royale` (default duel)
 *   BOT_GAMES     how many games (default 8)
 *   BOT_TICKS     longest a game may go on (default 3000)
 *   BOT_OUT       where to write the report (default: print it)
 */
const enabled = process.env.BOT_DIAGNOSE !== undefined;
const config = parseMatchConfig({ fog: 'on' });

const makeOpponent = (spec: string): Bot =>
  spec === 'legacy'
    ? createEasyBot()
    : createSmartBotWithTrace(JSON.parse(spec) as Partial<SmartOptions>).bot;

/** A stack this big is "a pile": more than a moving army needs. */
const PILE = 25;

interface Tally {
  decisions: number;
  reasons: Map<string, number>;
  /** Over decisions made while the candidate is clearly winning (>= 65% of the production). */
  winning: {
    decisions: number;
    idle: number;
    pileTroops: number;
    mobile: number;
    pileTiles: number;
  };
  /** Over the rest. */
  other: { decisions: number; idle: number; pileTroops: number; mobile: number; pileTiles: number };
  examples: string[];
  /** What the candidate went for while winning: the best target's label, and for how many decisions. */
  spending: Map<string, number>;
  /** For each game the candidate won after taking a big lead: ticks from the lead to the end. */
  finishing: number[];
  /** While winning, where the biggest pile (if it is a pile) is. */
  pileLocation: {
    decisions: number;
    byType: Map<string, number>;
    nextToEnemy: number;
    frontDistance: number;
  };
}

function describeStacks(tiles: Tile[]): string {
  return [...tiles]
    .sort((a, b) => b.troops - a.troops)
    .slice(0, 4)
    .map((t) => `${t.type}(${t.q},${t.r})=${t.troops}`)
    .join(' ');
}

describe.skipIf(!enabled)('bot diagnosis', () => {
  it('reports why the candidate sits idle', () => {
    const variant = JSON.parse(process.env.BOT_VARIANT ?? '{}') as Partial<SmartOptions>;
    const opponent = process.env.BOT_OPPONENT ?? 'legacy';
    const mode = process.env.BOT_MODE ?? 'duel';
    const games = Number(process.env.BOT_GAMES ?? 8);
    const ticks = Number(process.env.BOT_TICKS ?? 3000);

    const tally: Tally = {
      decisions: 0,
      reasons: new Map(),
      winning: { decisions: 0, idle: 0, pileTroops: 0, mobile: 0, pileTiles: 0 },
      other: { decisions: 0, idle: 0, pileTroops: 0, mobile: 0, pileTiles: 0 },
      examples: [],
      spending: new Map(),
      finishing: [],
      pileLocation: { decisions: 0, byType: new Map(), nextToEnemy: 0, frontDistance: 0 },
    };

    for (let seed = 1; seed <= games; seed++) {
      const players = mode === 'royale' ? ['P1', 'P2', 'P3', 'P4'] : ['P1', 'P2'];
      const us = players[(seed - 1) % players.length]!;
      const start: GameState =
        mode === 'royale'
          ? createFreeForAllMatch({ players, seed, config }).state
          : createDuelMatch({ players, seed, config }).state;
      const traced = createSmartBotWithTrace(variant);
      const bots: Record<string, Bot> = {};
      for (const p of players) bots[p] = p === us ? traced.bot : makeOpponent(opponent);
      const queues = new Map<string, Order[]>(players.map((p) => [p, []]));
      let state = start;
      let leadSince = -1;
      while (state.tick < ticks && state.winner === null) {
        const orders: Record<string, Order | undefined> = {};
        const scores = scoresOf(state, config);
        for (const player of state.players) {
          if (state.eliminated.includes(player)) continue;
          const queue = queues.get(player)!;
          if (queue.length === 0) {
            const view = visibleState(state, player, config);
            const made = bots[player]!({ view, me: player, config, scores });
            queue.push(...made);
            if (player === us) {
              const trace = traced.trace();
              const mine = Object.values(state.tiles).filter((t) => t.owner === us);
              const piles = mine.filter((t) => t.troops >= PILE);
              const mobile = mine.reduce((sum, t) => sum + Math.max(0, t.troops - 1), 0);
              const pileTroops = piles.reduce((sum, t) => sum + t.troops, 0);
              const mineCapacity = scores.find((s) => s.player === us)?.capacity ?? 0;
              const totalCapacity = scores.reduce((sum, s) => sum + s.capacity, 0);
              const winning = totalCapacity > 0 && mineCapacity / totalCapacity >= 0.65;
              if (winning && leadSince < 0) leadSince = state.tick;
              if (winning) {
                const what = trace.best || '(nothing)';
                tally.spending.set(what, (tally.spending.get(what) ?? 0) + 1);
              }
              if (winning) {
                const top = [...mine].sort((x, y) => y.troops - x.troops)[0];
                if (top && top.troops >= PILE) {
                  tally.pileLocation.decisions++;
                  tally.pileLocation.byType.set(
                    top.type,
                    (tally.pileLocation.byType.get(top.type) ?? 0) + 1,
                  );
                  const owned = new Set(mine.map((t) => `${t.q},${t.r}`));
                  const near = (t: Tile): Tile[] =>
                    [
                      [1, 0],
                      [1, -1],
                      [0, -1],
                      [-1, 0],
                      [-1, 1],
                      [0, 1],
                    ]
                      .map(([dq, dr]) => state.tiles[`${t.q + dq!},${t.r + dr!}`])
                      .filter((x): x is Tile => x !== undefined);
                  if (near(top).some((x) => x.owner !== null && x.owner !== us))
                    tally.pileLocation.nextToEnemy++;
                  // Steps over its own land to the nearest tile that touches land that is not its own.
                  const seen = new Map<string, number>([[`${top.q},${top.r}`, 0]]);
                  const queue = [top];
                  let front = -1;
                  for (let i = 0; i < queue.length && front < 0; i++) {
                    const t = queue[i]!;
                    if (near(t).some((x) => !owned.has(`${x.q},${x.r}`)))
                      front = seen.get(`${t.q},${t.r}`)!;
                    for (const x of near(t)) {
                      const k = `${x.q},${x.r}`;
                      if (owned.has(k) && !seen.has(k)) {
                        seen.set(k, seen.get(`${t.q},${t.r}`)! + 1);
                        queue.push(x);
                      }
                    }
                  }
                  tally.pileLocation.frontDistance += Math.max(0, front);
                }
              }
              const bucket = winning ? tally.winning : tally.other;
              const idle = made.length === 0;
              tally.decisions++;
              const group = trace.reason.split(' (')[0]!;
              tally.reasons.set(group, (tally.reasons.get(group) ?? 0) + 1);
              bucket.decisions++;
              if (idle) bucket.idle++;
              bucket.pileTroops += pileTroops;
              bucket.mobile += mobile;
              bucket.pileTiles += piles.length;
              if (idle && mobile >= 80 && tally.examples.length < 14) {
                tally.examples.push(
                  `seed ${seed} tick ${state.tick}: ${trace.reason}; mobile ${mobile}, free army ${trace.army}, ` +
                    `targets ${trace.targets} (${trace.reachable} in reach, cheapest out of reach needs ${trace.farNeed}); ` +
                    `stacks ${describeStacks(mine)}`,
                );
              }
            }
          }
          orders[player] = queue.shift();
        }
        state = resolveTick(state, orders as OrdersByPlayer, config);
      }
      if (state.winner === us && leadSince >= 0) tally.finishing.push(state.tick - leadSince);
    }

    const pct = (a: number, b: number) => (b === 0 ? '0' : ((100 * a) / b).toFixed(1));
    const lines: string[] = [
      `candidate ${JSON.stringify(variant)} vs ${opponent}, ${mode}, ${games} games`,
      `decisions ${tally.decisions}`,
      'reasons:',
      ...[...tally.reasons.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([reason, n]) => `  ${pct(n, tally.decisions).padStart(5)}%  ${reason}`),
    ];
    for (const [name, b] of [
      ['winning (>=65% of production)', tally.winning],
      ['not clearly winning', tally.other],
    ] as const) {
      lines.push(
        `${name}: ${b.decisions} decisions, idle ${pct(b.idle, b.decisions)}%, ` +
          `mobile troops avg ${(b.mobile / Math.max(1, b.decisions)).toFixed(0)}, ` +
          `in piles of ${PILE}+ avg ${(b.pileTroops / Math.max(1, b.decisions)).toFixed(0)} ` +
          `(${pct(b.pileTroops, b.mobile + b.pileTiles)}% of mobile) on ${(b.pileTiles / Math.max(1, b.decisions)).toFixed(1)} tiles`,
      );
    }
    const finishing = tally.finishing;
    const average = finishing.reduce((a, b) => a + b, 0) / Math.max(1, finishing.length);
    lines.push(
      `after taking a big lead, a game took ${average.toFixed(0)} more ticks to win (${finishing.length} games)`,
      'while winning it went for:',
      ...[...tally.spending.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([what, n]) => `  ${pct(n, tally.winning.decisions).padStart(5)}%  ${what}`),
    );
    const where = tally.pileLocation;
    lines.push(
      `while winning, the biggest stack was a pile in ${where.decisions} decisions: ` +
        [...where.byType.entries()]
          .map(([type, n]) => `${pct(n, where.decisions)}% on a ${type}`)
          .join(', ') +
        `; touching an enemy tile ${pct(where.nextToEnemy, where.decisions)}%; ` +
        `${(where.frontDistance / Math.max(1, where.decisions)).toFixed(1)} steps from the front on average`,
    );
    lines.push(
      'examples of idle decisions with 80+ troops:',
      ...tally.examples.map((e) => `  ${e}`),
    );
    const text = lines.join('\n');
    if (process.env.BOT_OUT) writeFileSync(process.env.BOT_OUT, text);
    else process.stdout.write(`${text}\n`);
    expect(tally.decisions).toBeGreaterThan(0);
  }, 3_600_000);
});
