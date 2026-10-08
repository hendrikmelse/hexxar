import { describe, expect, it } from 'vitest';
import { parseMatchConfig, type Order, type ServerMessage, type Tile } from '@hexxar/shared';
import { applyMessage, emptyGame, visionFor } from './game.js';

const move = (q: number): Order => ({
  type: 'move',
  from: { q, r: 0 },
  to: { q: q + 1, r: 0 },
});

const tile = (q: number, troops: number): Tile => ({
  q,
  r: 0,
  type: 'farmland',
  owner: 'P1',
  troops,
  progress: 0,
});

const snapshot = (queue: Order[] = []): ServerMessage => ({
  type: 'snapshot',
  matchId: 'm',
  config: parseMatchConfig({}),
  state: {
    tick: 0,
    players: ['P1', 'P2'],
    eliminated: [],
    winner: null,
    tiles: { '0,0': tile(0, 5), '1,0': tile(1, 5) },
  },
  you: 'P1',
  queue,
  nextTickAt: 1000,
  serverTime: 0,
  scores: [],
});

describe('applyMessage', () => {
  it('builds the view from a snapshot', () => {
    const game = emptyGame();
    expect(applyMessage(game, snapshot([move(0)]))).toEqual({ kind: 'all' });
    expect(game).toMatchObject({ status: 'playing', playerId: 'P1', nextTickAt: 1000 });
    expect(game.queue).toEqual([move(0)]);
  });

  it('merges tick diffs and drops consumed orders from the front of the queue', () => {
    const game = emptyGame();
    applyMessage(game, snapshot());
    for (const q of [0, 1, 2]) applyMessage(game, { type: 'queued', order: move(q) });
    applyMessage(game, {
      type: 'tick',
      tick: 1,
      nextTickAt: 3000,
      serverTime: 0,
      changed: [tile(1, 9)],
      eliminated: [],
      winner: null,
      queueLength: 2,
      scores: [],
    });
    expect(game.tiles['1,0']!.troops).toBe(9);
    expect(game.tiles['0,0']!.troops).toBe(5);
    expect(game.queue).toEqual([move(1), move(2)]);
    expect(game.tick).toBe(1);
  });

  it('empties the queue when the server says it is empty', () => {
    const game = emptyGame();
    applyMessage(game, snapshot([move(0)]));
    applyMessage(game, {
      type: 'tick',
      tick: 1,
      nextTickAt: 3000,
      serverTime: 0,
      changed: [],
      eliminated: [],
      winner: null,
      queueLength: 0,
      scores: [],
    });
    expect(game.queue).toEqual([]);
  });

  it('marks the game over when there is a winner', () => {
    const game = emptyGame();
    applyMessage(game, snapshot());
    applyMessage(game, {
      type: 'tick',
      tick: 1,
      nextTickAt: null,
      serverTime: 0,
      changed: [],
      eliminated: ['P2'],
      winner: 'P1',
      queueLength: 0,
      scores: [],
    });
    expect(game).toMatchObject({ status: 'over', winner: 'P1', nextTickAt: null });
  });
});

describe('visionFor', () => {
  const play = (fog: 'on' | 'off') => {
    const game = emptyGame();
    const message = snapshot();
    if (message.type === 'snapshot') message.config = parseMatchConfig({ fog });
    applyMessage(game, message);
    return game;
  };

  it('is everything (null) with no fog, and what is near your tiles with it', () => {
    expect(visionFor(play('off'))).toBeNull();
    const vision = visionFor(play('on'))!;
    expect(vision.get('0,0')).toBe('full');
    expect(vision.get('1,0')).toBe('full');
  });

  it('is everything once you are out of the game or it is over', () => {
    const game = play('on');
    game.eliminated = ['P1'];
    expect(visionFor(game)).toBeNull();
    const over = play('on');
    over.status = 'over';
    expect(visionFor(over)).toBeNull();
  });

  it('can treat a tile as it was before an army arrived on it', () => {
    const game = play('on');
    const stale = new Map<string, string | null>([
      ['0,0', null],
      ['1,0', null],
    ]);
    expect(visionFor(game, stale)?.size).toBe(0);
  });
});

describe('scores', () => {
  it('are kept from snapshots and ticks, for the scoreboard', () => {
    const game = emptyGame();
    const scores = [{ player: 'P1', tiles: 2, troops: 10, capacity: 0.125 }];
    const message = snapshot();
    if (message.type === 'snapshot') message.scores = scores;
    applyMessage(game, message);
    expect(game.scores).toEqual(scores);
  });
});
