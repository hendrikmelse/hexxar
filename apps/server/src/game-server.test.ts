import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serverMessageSchema, type ServerMessage } from '@hexxar/shared';
import { GameServer, type Connection, type ConnectionHandler } from './game-server.js';

class FakeClient implements Connection {
  readonly received: ServerMessage[] = [];
  closed = false;
  handler: ConnectionHandler;

  constructor(server: GameServer) {
    this.handler = server.connect(this);
  }

  send(message: ServerMessage): void {
    // Everything we send must be valid per the shared protocol.
    this.received.push(serverMessageSchema.parse(message));
  }

  close(): void {
    this.closed = true;
  }

  say(message: unknown): void {
    this.handler.onMessage(message);
  }

  last<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> {
    const found = [...this.received].reverse().find((m) => m.type === type);
    if (!found) throw new Error(`no ${type} message received`);
    return found as Extract<ServerMessage, { type: T }>;
  }

  of(type: ServerMessage['type']): ServerMessage[] {
    return this.received.filter((m) => m.type === type);
  }
}

const options = { players: 2, radius: 5, tickMs: 1000, restartMs: 5000 };

describe('GameServer', () => {
  let server: GameServer;

  beforeEach(() => {
    vi.useFakeTimers();
    server = new GameServer(options);
  });

  afterEach(() => {
    server.stop();
    vi.useRealTimers();
  });

  function twoPlayers() {
    const a = new FakeClient(server);
    const b = new FakeClient(server);
    a.say({ type: 'hello', name: 'Ann' });
    b.say({ type: 'hello', name: 'Bob' });
    return { a, b };
  }

  it('waits for players, then starts the match for everyone', () => {
    const a = new FakeClient(server);
    a.say({ type: 'hello', name: 'Ann' });
    expect(a.last('waiting')).toMatchObject({ joined: 1, needed: 2 });
    expect(a.of('snapshot')).toHaveLength(0);

    const b = new FakeClient(server);
    b.say({ type: 'hello', name: 'Bob' });
    expect(a.last('welcome').playerId).toBe('P1');
    expect(b.last('welcome').playerId).toBe('P2');
    expect(a.last('snapshot').state.players).toEqual(['P1', 'P2']);
    expect(b.last('snapshot').nextTickAt).not.toBeNull();
  });

  it('turns away extra players', () => {
    twoPlayers();
    const c = new FakeClient(server);
    c.say({ type: 'hello', name: 'Cy' });
    expect(c.last('rejected').reason).toMatch(/full/);
    expect(c.closed).toBe(true);
  });

  it('ticks on schedule and resolves queued orders for all players at once', () => {
    const { a, b } = twoPlayers();
    const snapshot = a.last('snapshot');
    const home = Object.values(snapshot.state.tiles).find((t) => t.owner === 'P1')!;
    // Walk one step toward any adjacent tile.
    const target = [
      { q: 1, r: 0 },
      { q: 1, r: -1 },
      { q: 0, r: -1 },
      { q: -1, r: 0 },
      { q: -1, r: 1 },
      { q: 0, r: 1 },
    ]
      .map((d) => ({ q: home.q + d.q, r: home.r + d.r }))
      .find((h) => snapshot.state.tiles[`${h.q},${h.r}`])!;

    a.say({ type: 'order', order: { type: 'move', from: home, to: target } });
    expect(a.last('queued')).toBeDefined();

    vi.advanceTimersByTime(999);
    expect(a.of('tick')).toHaveLength(0);
    vi.advanceTimersByTime(1);

    const tickA = a.last('tick');
    expect(tickA.tick).toBe(1);
    expect(tickA.queueLength).toBe(0);
    expect(tickA.changed.length).toBeGreaterThan(0);
    expect(b.last('tick').tick).toBe(1);

    vi.advanceTimersByTime(1000);
    expect(a.last('tick').tick).toBe(2);
  });

  it('reconnects a returning player into the running match', () => {
    const { a } = twoPlayers();
    const token = a.last('welcome').token;
    a.handler.onClose();

    const again = new FakeClient(server);
    again.say({ type: 'hello', name: 'Ann', token });
    expect(again.last('welcome').playerId).toBe('P1');
    expect(again.last('snapshot').matchId).toBe('match-1');
  });

  it('ends the match on surrender and starts a fresh one afterwards', () => {
    const { a, b } = twoPlayers();
    b.say({ type: 'surrender' });
    expect(a.last('snapshot').state.winner).toBe('P1');

    vi.advanceTimersByTime(5000);
    expect(a.last('snapshot').matchId).toBe('match-2');
    expect(a.last('snapshot').state.winner).toBeNull();
  });

  it('rejects malformed messages and orders before the match starts', () => {
    const a = new FakeClient(server);
    a.say({ nonsense: true });
    expect(a.last('rejected').reason).toMatch(/invalid/);
    a.say({ type: 'hello', name: 'Ann' });
    a.say({
      type: 'order',
      order: { type: 'move', from: { q: 0, r: 0 }, to: { q: 1, r: 0 } },
    });
    expect(a.last('rejected').reason).toMatch(/not started/);
  });
});
