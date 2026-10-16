import { describe, expect, it } from 'vitest';
import { createEasyBot } from './bot.js';
import { parseMatchConfig } from './config.js';
import { createDuelMatch, createFreeForAllMatch } from './generate.js';
import { hexKey } from './hex.js';
import { checkOrder, type Order, type OrdersByPlayer } from './orders.js';
import { resolveTick } from './resolve.js';
import { createSmartBot, SMART_BEST, SMART_OFF } from './smartBot.js';
import type { GameState, Tile } from './state.js';
import { visibleState } from './visibility.js';

const config = parseMatchConfig({ fog: 'on' });

/**
 * Drive a game with the easy bots, and at every decision also ask `other` what it would do from
 * the same board. Returns how many decisions were compared and how many differed.
 */
function compareAlong(
  start: GameState,
  other: ReturnType<typeof createSmartBot>,
  ticks: number,
): { compared: number; differed: number; invalid: string[] } {
  const easy = createEasyBot();
  const queues = new Map<string, Order[]>(start.players.map((p) => [p, []]));
  let compared = 0;
  let differed = 0;
  const invalid: string[] = [];
  let state = start;
  while (state.tick < ticks && state.winner === null) {
    const orders: Record<string, Order | undefined> = {};
    for (const player of state.players) {
      if (state.eliminated.includes(player)) continue;
      const queue = queues.get(player)!;
      if (queue.length === 0) {
        const input = { view: visibleState(state, player, config), me: player, config };
        const a = easy(input);
        const b = other(input);
        compared++;
        if (JSON.stringify(a) !== JSON.stringify(b)) differed++;
        for (const order of b) {
          if (checkOrder(state, player, order) !== null) invalid.push(JSON.stringify(order));
        }
        queue.push(...a);
      }
      orders[player] = queue.shift();
    }
    state = resolveTick(state, orders as OrdersByPlayer, config);
  }
  return { compared, differed, invalid };
}

const at = (
  q: number,
  r: number,
  owner: string | null,
  troops: number,
  type: Tile['type'],
): [string, Tile] => [hexKey({ q, r }), { q, r, type, owner, troops, progress: 0 }];

const board = (tiles: [string, Tile][]): GameState => ({
  tick: 0,
  players: ['A', 'B'],
  eliminated: [],
  winner: null,
  tiles: Object.fromEntries(tiles),
});

describe('smart bot', () => {
  it('with every habit off decides exactly like the easy bot', () => {
    const duel = createDuelMatch({ players: ['P1', 'P2'], seed: 2, config });
    const result = compareAlong(duel.state, createSmartBot(SMART_OFF), 700);
    expect(result.compared).toBeGreaterThan(300);
    expect(result.differed).toBe(0);
    const ffa = createFreeForAllMatch({ players: ['P1', 'P2', 'P3', 'P4'], seed: 5, config });
    expect(compareAlong(ffa.state, createSmartBot(SMART_OFF), 500).differed).toBe(0);
  }, 60_000);

  it('only ever gives legal orders, with the best habits on', () => {
    const duel = createDuelMatch({ players: ['P1', 'P2'], seed: 3, config });
    const result = compareAlong(duel.state, createSmartBot(SMART_BEST), 900);
    expect(result.invalid).toEqual([]);
    // It is a different bot: it should not simply agree with the easy one.
    expect(result.differed).toBeGreaterThan(0);
  }, 60_000);

  it('moves the army off a producer that has stopped producing', () => {
    // A's city holds 50 (its cap); the only neighbor is its own farm.
    const state = board([at(0, 0, 'A', 50, 'city'), at(1, 0, 'A', 1, 'farmland')]);
    const input = { view: state, me: 'A', config };
    expect(createSmartBot({ uncap: false })(input)).toEqual([]);
    expect(createSmartBot({ uncap: true })(input)).toEqual([
      { type: 'move', from: { q: 0, r: 0 }, to: { q: 1, r: 0 } },
    ]);
  });

  it('takes the last farm of a city’s ring before a neutral village, because the ring is worth more', () => {
    // The city has five of its six farms; the sixth is neutral. A neutral village is up for grabs
    // from the farm at (1, 0), which holds 8 troops (enough for either).
    const state = board([
      at(0, 0, 'A', 12, 'city'),
      at(1, 0, 'A', 8, 'farmland'),
      at(1, -1, 'A', 1, 'farmland'),
      at(0, -1, 'A', 1, 'farmland'),
      at(-1, 0, 'A', 1, 'farmland'),
      at(-1, 1, 'A', 1, 'farmland'),
      at(0, 1, null, 1, 'farmland'),
      at(2, 0, null, 4, 'village'),
    ]);
    const input = { view: state, me: 'A', config };
    expect(createSmartBot({ ring: false })(input)).toEqual([
      { type: 'move', from: { q: 1, r: 0 }, to: { q: 2, r: 0 } },
    ]);
    expect(createSmartBot({ ring: true })(input)).toEqual([
      { type: 'move', from: { q: 1, r: 0 }, to: { q: 0, r: 1 } },
    ]);
  });

  it('marches by the route with the most troops to pick up', () => {
    // Two routes of equal length from (0, 0) to the tile beside the enemy, (1, 1): through (1, 0),
    // which holds nothing, or through (0, 1), which holds 8 troops.
    const state = board([
      at(0, 0, 'A', 10, 'farmland'),
      at(1, 0, 'A', 1, 'farmland'),
      at(0, 1, 'A', 8, 'farmland'),
      at(1, 1, 'A', 1, 'farmland'),
      at(2, 1, 'B', 12, 'farmland'),
    ]);
    const input = { view: state, me: 'A', config };
    expect(createSmartBot({ pickup: true })(input)).toEqual([
      { type: 'move', from: { q: 0, r: 0 }, to: { q: 0, r: 1 } },
    ]);
  });

  it('takes a neutral village before a skirmish over another player’s farm', () => {
    const state = board([
      at(0, 0, 'A', 12, 'farmland'),
      at(1, 0, null, 4, 'village'),
      at(-1, 0, 'B', 1, 'farmland'),
    ]);
    const input = { view: state, me: 'A', config };
    expect(createSmartBot({ neutralFirst: true })(input)).toEqual([
      { type: 'move', from: { q: 0, r: 0 }, to: { q: 1, r: 0 } },
    ]);
  });
});
