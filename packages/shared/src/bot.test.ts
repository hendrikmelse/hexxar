import { describe, expect, it } from 'vitest';
import { createEasyBot, type Bot } from './bot.js';
import { parseMatchConfig, type MatchConfig } from './config.js';
import { createDuelMatch, createFreeForAllMatch } from './generate.js';
import { hexKey } from './hex.js';
import { checkOrder, type Order, type OrdersByPlayer } from './orders.js';
import { resolveTick } from './resolve.js';
import type { GameState, Tile } from './state.js';
import { visibleState } from './visibility.js';

/** Play bots against each other, one order per bot per tick, until someone wins or time runs out. */
function play(
  start: GameState,
  config: MatchConfig,
  ticks: number,
  idle: readonly string[] = [],
): { state: GameState; invalid: string[] } {
  const bots = new Map<string, Bot>(
    start.players.filter((p) => !idle.includes(p)).map((p) => [p, createEasyBot()]),
  );
  const queues = new Map<string, Order[]>(start.players.map((p) => [p, []]));
  const invalid: string[] = [];
  let state = start;
  while (state.tick < ticks && state.winner === null) {
    for (const player of state.players) {
      if (state.eliminated.includes(player) || !bots.has(player)) continue;
      const queue = queues.get(player)!;
      if (queue.length === 0) {
        queue.push(
          ...bots.get(player)!({ view: visibleState(state, player, config), me: player, config }),
        );
      }
    }
    const orders: Record<string, Order | undefined> = {};
    for (const [player, queue] of queues) orders[player] = queue.shift();
    for (const player of state.players) {
      const order = orders[player];
      if (order && checkOrder(state, player, order) !== null) {
        invalid.push(`${player} tick ${state.tick}: ${JSON.stringify(order)}`);
      }
    }
    state = resolveTick(state, orders as OrdersByPlayer, config);
  }
  return { state, invalid };
}

const tile = (q: number, owner: string | null, troops: number): [string, Tile] => [
  hexKey({ q, r: 0 }),
  { q, r: 0, type: 'farmland', owner, troops, progress: 0 },
];

describe('easy bot', () => {
  const config = parseMatchConfig({});
  const view = (tiles: [string, Tile][]): GameState => ({
    tick: 0,
    players: ['A', 'B'],
    eliminated: [],
    winner: null,
    tiles: Object.fromEntries(tiles),
  });

  it('attacks a neutral tile it can beat', () => {
    const state = view([tile(0, 'A', 5), tile(1, null, 1), tile(5, 'B', 5)]);
    const orders = createEasyBot()({ view: state, me: 'A', config });
    expect(orders).toEqual([{ type: 'move', from: { q: 0, r: 0 }, to: { q: 1, r: 0 } }]);
  });

  it('does nothing when every target is out of reach', () => {
    const state = view([tile(0, 'A', 2), tile(1, 'B', 30)]);
    expect(createEasyBot()({ view: state, me: 'A', config })).toEqual([]);
  });

  it('marches a distant army toward a fight it cannot win from one tile', () => {
    // B's 6 troops on tile 3 need 8 to beat; A's only tile beside it (2) has 3, but tile 0 has 9.
    const state = view([tile(0, 'A', 9), tile(1, 'A', 1), tile(2, 'A', 3), tile(3, 'B', 6)]);
    const orders = createEasyBot()({ view: state, me: 'A', config });
    expect(orders).toEqual([{ type: 'move', from: { q: 0, r: 0 }, to: { q: 1, r: 0 } }]);
  });

  it('only ever sees what its player may see', () => {
    // Under fog it must still produce valid orders on every board it is handed.
    const fog = parseMatchConfig({ fog: 'on' });
    const { state } = createFreeForAllMatch({ players: ['P1', 'P2', 'P3'], seed: 7, config: fog });
    const orders = createEasyBot()({ view: visibleState(state, 'P1', fog), me: 'P1', config: fog });
    for (const order of orders) expect(checkOrder(state, 'P1', order)).toBeNull();
  });

  it('plays whole games with valid orders, under fog', () => {
    const fog = parseMatchConfig({ fog: 'on' });
    const duel = createDuelMatch({ players: ['P1', 'P2'], seed: 1, config: fog });
    // Two easy bots are evenly matched, so a duel between them can go on for a very long time:
    // it only has to stay legal.
    expect(play(duel.state, fog, 1500).invalid).toEqual([]);
    const ffa = createFreeForAllMatch({
      players: ['P1', 'P2', 'P3', 'P4', 'P5'],
      seed: 1,
      config: fog,
    });
    const { state, invalid } = play(ffa.state, fog, 4000);
    expect(invalid).toEqual([]);
    expect(state.winner).not.toBeNull();
  }, 60_000);

  it('beats someone who never plays', () => {
    const fog = parseMatchConfig({ fog: 'on' });
    const { state: start } = createDuelMatch({ players: ['P1', 'P2'], seed: 3, config: fog });
    const { state } = play(start, fog, 3000, ['P2']);
    expect(state.winner).toBe('P1');
  }, 60_000);
});
