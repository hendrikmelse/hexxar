import { describe, expect, it } from 'vitest';
import { hexKey, parseMatchConfig, type GameState, type Order, type Tile } from '@hexxar/shared';
import { MAX_QUEUE_LENGTH, Match } from './match.js';

/** A row of tiles along q: A owns tile 0, B owns the last tile. */
function lineState(): GameState {
  const tiles: Record<string, Tile> = {};
  const owners = ['A', null, null, 'B'] as const;
  owners.forEach((owner, q) => {
    tiles[hexKey({ q, r: 0 })] = {
      q,
      r: 0,
      type: 'farmland',
      owner,
      troops: owner ? 20 : 1,
    };
  });
  return { tick: 0, players: ['A', 'B'], eliminated: [], winner: null, tiles };
}

const move = (from: number, to: number): Order => ({
  type: 'move',
  from: { q: from, r: 0 },
  to: { q: to, r: 0 },
});

const newMatch = () => new Match('m1', lineState(), parseMatchConfig({}));

describe('Match', () => {
  it('executes one queued order per player per tick, oldest first', () => {
    const match = newMatch();
    expect(match.enqueue('A', move(0, 1))).toBeNull();
    expect(match.enqueue('A', move(1, 2))).toBeNull();
    match.enqueue('B', move(3, 2));

    const { state } = match.step();
    expect(match.queueOf('A')).toEqual([move(1, 2)]);
    expect(match.queueOf('B')).toEqual([]);
    expect(state.tick).toBe(1);
    // A moved 19 troops onto neutral tile 1 and captured it.
    expect(state.tiles[hexKey({ q: 1, r: 0 })]).toMatchObject({ owner: 'A' });

    match.step();
    expect(match.queueOf('A')).toEqual([]);
  });

  it('keeps queues in order and drops invalid orders without stalling the queue', () => {
    const match = newMatch();
    match.enqueue('A', move(0, 3)); // not adjacent: dropped when executed
    match.enqueue('A', move(0, 1));
    match.step();
    expect(match.state.tiles[hexKey({ q: 1, r: 0 })]!.owner).toBeNull();
    match.step();
    expect(match.state.tiles[hexKey({ q: 1, r: 0 })]!.owner).toBe('A');
  });

  it('refuses orders from strangers and past the anti-abuse cap', () => {
    const match = newMatch();
    expect(match.enqueue('Z', move(0, 1))).toMatch(/not a player/);
    for (let i = 0; i < MAX_QUEUE_LENGTH; i++) expect(match.enqueue('A', move(0, 1))).toBeNull();
    expect(match.enqueue('A', move(0, 1))).toMatch(/full/);
  });

  it('logs the orders resolved each tick so the match can be replayed', () => {
    const match = newMatch();
    match.enqueue('A', move(0, 1));
    match.step();
    match.step();
    expect(match.log).toEqual([
      { tick: 1, orders: { A: move(0, 1) } },
      { tick: 2, orders: {} },
    ]);
  });

  it('ends when one player surrenders', () => {
    const match = newMatch();
    match.surrender('B');
    expect(match.isOver).toBe(true);
    expect(match.state.winner).toBe('A');
    expect(match.enqueue('A', move(0, 1))).toMatch(/over/);
  });
});
