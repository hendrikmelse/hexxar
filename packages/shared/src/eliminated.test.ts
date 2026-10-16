import { describe, expect, it } from 'vitest';
import { newlyEliminated, settlePlayers, type GameState, type Tile } from './state.js';

describe('newlyEliminated', () => {
  it('names who went out, not who comes last in the list', () => {
    // `eliminated` is kept in player order: when P2 goes out after P5, P5 is still last.
    expect(newlyEliminated(['P5'], ['P2', 'P5'])).toEqual(['P2']);
    expect(newlyEliminated([], ['P1', 'P3'])).toEqual(['P1', 'P3']);
    expect(newlyEliminated(['P1'], ['P1'])).toEqual([]);
  });

  it('matches how the game really orders the list', () => {
    // P5 was already out; P2 loses its last producer. The game puts P2 before P5.
    const farm = (q: number, owner: string | null, troops: number): [string, Tile] => [
      `${q},0`,
      { q, r: 0, type: 'farmland', owner, troops, progress: 0 },
    ];
    const city = (q: number, owner: string | null): [string, Tile] => [
      `${q},0`,
      { q, r: 0, type: 'city', owner, troops: 5, progress: 0 },
    ];
    const state: GameState = {
      tick: 10,
      players: ['P1', 'P2', 'P3', 'P4', 'P5'],
      eliminated: ['P5'],
      winner: null,
      tiles: Object.fromEntries([
        city(0, 'P1'),
        farm(1, 'P2', 1),
        city(2, 'P3'),
        city(3, 'P4'),
        farm(4, 'P5', 1),
      ]),
    };
    const { eliminated } = settlePlayers(state);
    expect(eliminated).toEqual(['P2', 'P5']);
    expect(eliminated.slice(state.eliminated.length)).toEqual(['P5']); // the old way: wrong
    expect(newlyEliminated(state.eliminated, eliminated)).toEqual(['P2']);
  });
});
