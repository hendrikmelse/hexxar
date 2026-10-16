import { describe, expect, it } from 'vitest';
import { parseMatchConfig } from './config.js';
import { hexKey } from './hex.js';
import { createSmartBot, SMART_BEST } from './smartBot.js';
import type { GameState, Tile } from './state.js';

const config = parseMatchConfig({ fog: 'on' });

const at = (
  q: number,
  r: number,
  owner: string | null,
  troops: number,
  type: Tile['type'],
  progress = 0,
): [string, Tile] => [hexKey({ q, r }), { q, r, type, owner, troops, progress }];

const board = (tiles: [string, Tile][], players = ['A', 'B']): GameState => ({
  tick: 0,
  players,
  eliminated: [],
  winner: null,
  tiles: Object.fromEntries(tiles),
});

describe('smart bot: defence', () => {
  // A's city has 10 troops (it defends like 15); an enemy army of 12 sits next to it, and a neutral
  // farm is up for grabs on the other side.
  const threatened = () =>
    board([
      at(0, 0, 'A', 10, 'city'),
      at(1, 0, null, 1, 'farmland'),
      at(0, 1, 'B', 12, 'farmland'),
    ]);
  const input = (state: GameState) => ({ view: state, me: 'A', config });

  it('without a home guard the city sends its army out to take the farm', () => {
    expect(createSmartBot({ ring: true, uncap: true })(input(threatened()))).toEqual([
      { type: 'move', from: { q: 0, r: 0 }, to: { q: 1, r: 0 } },
    ]);
  });

  it('with a home guard a city an enemy army could take stays full', () => {
    expect(createSmartBot({ homeGuard: true })(input(threatened()))).toEqual([]);
  });

  it('only defends once few enough players are left', () => {
    const crowded = { ...threatened(), players: ['A', 'B', 'C'] };
    const guarded = createSmartBot({ homeGuard: true, defendUntil: 2 });
    // Three players: no defence, so the city goes out like normal.
    expect(guarded(input(crowded))).toEqual([
      { type: 'move', from: { q: 0, r: 0 }, to: { q: 1, r: 0 } },
    ]);
    // Two players: it stays home.
    expect(guarded(input(threatened()))).toEqual([]);
  });

  it('sends help to the producer in danger', () => {
    // The city (6 troops, defends like 9) has an enemy army of 8 beside it; 10 troops wait two tiles away.
    const state = board([
      at(0, 0, 'A', 6, 'city'),
      at(0, 1, 'B', 8, 'farmland'),
      at(1, 0, 'A', 1, 'farmland'),
      at(2, 0, 'A', 10, 'farmland'),
    ]);
    expect(createSmartBot({ reinforce: true })(input(state))).toEqual([
      { type: 'move', from: { q: 2, r: 0 }, to: { q: 1, r: 0 } },
    ]);
  });

  it('the best settings only defend when two players are left', () => {
    expect(SMART_BEST.defendUntil).toBe(2);
    expect(SMART_BEST.homeGuard && SMART_BEST.reinforce).toBe(true);
  });
});

describe('smart bot: timing and idle ticks', () => {
  it('knows an enemy city will not make a troop this tick, from its timer', () => {
    // B's city holds 5 and has just made a troop (progress 0 of 8). Sending 9 is enough only if no
    // troop is counted for it.
    const state = board([at(0, 0, 'A', 10, 'farmland'), at(1, 0, 'B', 5, 'city', 0)]);
    const input = { view: state, me: 'A', config };
    expect(createSmartBot({})(input)).toEqual([]);
    expect(createSmartBot({ exact: true })(input)).toEqual([
      { type: 'move', from: { q: 0, r: 0 }, to: { q: 1, r: 0 } },
    ]);
  });

  it('does not count on that when the city is about to make a troop', () => {
    const state = board([at(0, 0, 'A', 10, 'farmland'), at(1, 0, 'B', 5, 'city', 7)]);
    expect(createSmartBot({ exact: true })({ view: state, me: 'A', config })).toEqual([]);
  });

  it('can fill a tick with marching spare troops toward a fight it cannot win yet', () => {
    const state = board([
      at(0, 0, 'A', 10, 'farmland'),
      at(1, 0, 'A', 1, 'farmland'),
      at(2, 0, 'B', 40, 'city'),
    ]);
    const input = { view: state, me: 'A', config };
    expect(createSmartBot({})(input)).toEqual([]);
    expect(createSmartBot({ pool: true })(input)).toEqual([
      { type: 'move', from: { q: 0, r: 0 }, to: { q: 1, r: 0 } },
    ]);
  });

  it('keeps going for the same target unless another is clearly better', () => {
    const bot = createSmartBot({ sticky: true });
    // First it chooses the village (value 7); then a slightly better target appears, and it stays.
    const first = board([
      at(0, 0, 'A', 12, 'farmland'),
      at(1, 0, null, 4, 'village'),
      at(-1, 0, null, 1, 'farmland'),
    ]);
    expect(bot({ view: first, me: 'A', config })).toEqual([
      { type: 'move', from: { q: 0, r: 0 }, to: { q: 1, r: 0 } },
    ]);
    const again = board([
      at(0, 0, 'A', 12, 'farmland'),
      at(1, 0, null, 4, 'village'),
      at(-1, 0, null, 1, 'farmland'),
    ]);
    expect(bot({ view: again, me: 'A', config })).toEqual([
      { type: 'move', from: { q: 0, r: 0 }, to: { q: 1, r: 0 } },
    ]);
  });
});
