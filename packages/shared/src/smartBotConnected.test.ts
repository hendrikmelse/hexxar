import { describe, expect, it } from 'vitest';
import { parseMatchConfig } from './config.js';
import { hexKey } from './hex.js';
import { createSmartBot, createSmartBotWithTrace, SMART_BEST } from './smartBot.js';
import type { GameState, Tile } from './state.js';

const config = parseMatchConfig({ fog: 'on' });

const at = (
  q: number,
  r: number,
  owner: string | null,
  troops: number,
  type: Tile['type'],
): [string, Tile] => [hexKey({ q, r }), { q, r, type, owner, troops, progress: 0 }];

const board = (tiles: [string, Tile][], players = ['A', 'B']): GameState => ({
  tick: 0,
  players,
  eliminated: [],
  winner: null,
  tiles: Object.fromEntries(tiles),
});

/**
 * A has 21 troops on a farm at (0, 0), and a lone tile of its own, far away at (5, 5), next to a
 * neutral city (garrison 10, so 16 troops take it). The city looks like the best target and the
 * army is big enough for it, but nothing can walk to that tile over A's own land. A neutral farm
 * beside the main army is the thing that can really be done.
 */
const cutOff = (players = ['A', 'B']): GameState =>
  board(
    [
      at(0, 0, 'A', 21, 'farmland'),
      at(1, 0, 'A', 1, 'farmland'),
      at(-1, 0, null, 1, 'farmland'),
      at(5, 5, 'A', 1, 'farmland'),
      at(6, 5, null, 10, 'city'),
    ],
    players,
  );

const farm = [{ type: 'move', from: { q: 0, r: 0 }, to: { q: -1, r: 0 } }];

describe('smart bot: troops that cannot get there', () => {
  const input = (state: GameState) => ({ view: state, me: 'A', config });

  it('without a fix, passes the tick: it gathers at the cut-off tile and nothing can reach it', () => {
    const { bot, trace } = createSmartBotWithTrace({});
    expect(bot(input(cutOff()))).toEqual([]);
    expect(trace().reason).toMatch(/no troops can reach the staging tile/);
  });

  it('with components, the city is out of reach and it takes the farm instead', () => {
    expect(createSmartBot({ components: true })(input(cutOff()))).toEqual(farm);
  });

  it('with idleRepair it also takes the farm, but only because it would have passed', () => {
    const { bot, trace } = createSmartBotWithTrace({ idleRepair: true });
    expect(bot(input(cutOff()))).toEqual(farm);
    expect(trace().reason).toBe('attack');
  });

  it('components only apply while few enough players are left', () => {
    const bot = createSmartBot({ components: true, componentsUntil: 2 });
    // Three players: the old behavior (it passes). Two: the fix.
    expect(bot(input(cutOff(['A', 'B', 'C'])))).toEqual([]);
    expect(bot(input(cutOff()))).toEqual(farm);
  });

  it('the best settings do not pass the tick in either case', () => {
    expect(createSmartBot(SMART_BEST)(input(cutOff()))).toEqual(farm);
    expect(createSmartBot(SMART_BEST)(input(cutOff(['A', 'B', 'C'])))).toEqual(farm);
  });
});
