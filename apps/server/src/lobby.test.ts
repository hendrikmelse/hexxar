import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serverMessageSchema, type ServerMessage } from '@hexxar/shared';
import { Lobby } from './lobby.js';
import type { Connection, ConnectionHandler } from './types.js';

class FakeClient implements Connection {
  readonly received: ServerMessage[] = [];
  closed = false;
  handler: ConnectionHandler;

  constructor(lobby: Lobby) {
    this.handler = lobby.connect(this);
  }

  send(message: ServerMessage): void {
    // Everything the server sends must be valid per the shared protocol.
    this.received.push(serverMessageSchema.parse(message));
  }

  close(): void {
    this.closed = true;
  }

  say(message: unknown): void {
    this.handler.onMessage(message);
  }

  hello(name: string, token?: string): this {
    this.say({ type: 'hello', name, token });
    return this;
  }

  disconnect(): void {
    this.handler.onClose();
  }

  last<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> {
    const found = [...this.received].reverse().find((m) => m.type === type);
    if (!found) throw new Error(`no ${type} message received`);
    return found as Extract<ServerMessage, { type: T }>;
  }

  all<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.received.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  }

  /** The room view from the latest `room` message (null in the menu). */
  get room() {
    return this.last('room').room;
  }

  get token(): string {
    return this.last('welcome').token;
  }
}

const options = {
  allowedSizes: [2],
  defaultRadius: 5,
  tickMs: 1000,
  countdownMs: 3000,
  afkMs: 120_000,
  finishedLingerMs: 60_000,
};

describe('Lobby', () => {
  let lobby: Lobby;

  beforeEach(() => {
    vi.useFakeTimers();
    lobby = new Lobby(options);
  });

  afterEach(() => {
    lobby.stop();
    vi.useRealTimers();
  });

  /** Two guests matched through quick play, with the match running. */
  function runningDuel() {
    const a = new FakeClient(lobby).hello('Ann');
    const b = new FakeClient(lobby).hello('Bob');
    a.say({ type: 'quickPlay', size: 2 });
    b.say({ type: 'quickPlay', size: 2 });
    vi.advanceTimersByTime(options.countdownMs);
    return { a, b };
  }

  describe('menu', () => {
    it('welcomes a guest into the main menu', () => {
      const a = new FakeClient(lobby).hello('Ann');
      expect(a.last('welcome').userId).toBeTruthy();
      expect(a.room).toBeNull();
    });

    it('rejects messages before hello and malformed messages', () => {
      const a = new FakeClient(lobby);
      a.say({ type: 'quickPlay', size: 2 });
      expect(a.last('rejected').reason).toMatch(/hello/);
      a.say({ nonsense: true });
      expect(a.last('rejected').reason).toMatch(/invalid/);
    });

    it('rejects sizes that are not available yet', () => {
      const a = new FakeClient(lobby).hello('Ann');
      a.say({ type: 'quickPlay', size: 4 });
      expect(a.last('rejected').reason).toMatch(/not available/);
      a.say({ type: 'createRoom', settings: { size: 6 } });
      expect(a.last('rejected').reason).toMatch(/not available/);
    });

    it('rejects room commands from someone who is not in a room', () => {
      const a = new FakeClient(lobby).hello('Ann');
      a.say({ type: 'startGame' });
      expect(a.last('rejected').reason).toMatch(/not in a game/);
    });
  });

  describe('quick play', () => {
    it('puts the first player in a public room and waits', () => {
      const a = new FakeClient(lobby).hello('Ann');
      a.say({ type: 'quickPlay', size: 2 });
      expect(a.room).toMatchObject({ state: 'lobby', visibility: 'public' });
      expect(a.room?.players).toHaveLength(1);
    });

    it('pairs two players, counts down, then starts the match', () => {
      const a = new FakeClient(lobby).hello('Ann');
      const b = new FakeClient(lobby).hello('Bob');
      a.say({ type: 'quickPlay', size: 2 });
      b.say({ type: 'quickPlay', size: 2 });

      expect(a.room?.id).toBe(b.room?.id);
      expect(a.room).toMatchObject({ state: 'starting' });
      expect(a.room?.startsAt).toBeGreaterThan(Date.now());
      expect(a.all('snapshot')).toHaveLength(0);

      vi.advanceTimersByTime(options.countdownMs);
      expect(a.room?.state).toBe('running');
      const snapshot = a.last('snapshot');
      expect(snapshot.state.players).toHaveLength(2);
      expect([snapshot.you, b.last('snapshot').you].sort()).toEqual(['P1', 'P2']);
      expect(snapshot.matchId).toBe(a.room?.id);
    });

    it('does not put a third player into a full room', () => {
      const { a, b } = runningDuel();
      const c = new FakeClient(lobby).hello('Cy');
      c.say({ type: 'quickPlay', size: 2 });
      expect(c.room?.id).not.toBe(a.room?.id);
      expect(c.room?.state).toBe('lobby');
      expect(b.room?.players).toHaveLength(2);
    });

    it('cancels the countdown if someone leaves', () => {
      const a = new FakeClient(lobby).hello('Ann');
      const b = new FakeClient(lobby).hello('Bob');
      a.say({ type: 'quickPlay', size: 2 });
      b.say({ type: 'quickPlay', size: 2 });
      b.say({ type: 'leaveRoom' });
      expect(b.room).toBeNull();
      expect(a.room).toMatchObject({ state: 'lobby', startsAt: null });
      vi.advanceTimersByTime(options.countdownMs * 2);
      expect(a.all('snapshot')).toHaveLength(0);
    });

    it('closes a room when its last player leaves', () => {
      const a = new FakeClient(lobby).hello('Ann');
      a.say({ type: 'quickPlay', size: 2 });
      const first = a.room?.id;
      a.say({ type: 'leaveRoom' });
      expect(a.room).toBeNull();
      a.say({ type: 'quickPlay', size: 2 });
      expect(a.room?.id).not.toBe(first);
    });
  });

  describe('private games', () => {
    function hostWithGuest() {
      const host = new FakeClient(lobby).hello('Hana');
      host.say({ type: 'createRoom' });
      const guest = new FakeClient(lobby).hello('Gus');
      guest.say({ type: 'joinRoom', code: host.room!.code.toLowerCase() });
      return { host, guest };
    }

    it('creates a private room with a code, and the creator is host', () => {
      const host = new FakeClient(lobby).hello('Hana');
      host.say({ type: 'createRoom' });
      expect(host.room).toMatchObject({ visibility: 'private', state: 'lobby' });
      expect(host.room?.host).toBe(host.last('welcome').userId);
      expect(host.room?.code).toMatch(/^[A-Z2-9]{5}$/);
    });

    it('lets others join by code, ignoring case, and rejects unknown codes', () => {
      const { host, guest } = hostWithGuest();
      expect(guest.room?.id).toBe(host.room?.id);
      expect(host.room?.players.map((p) => p.name)).toEqual(['Hana', 'Gus']);
      const stranger = new FakeClient(lobby).hello('Sam');
      stranger.say({ type: 'joinRoom', code: 'ZZZZZ' });
      expect(stranger.last('rejected').reason).toMatch(/no game/);
      stranger.say({ type: 'joinRoom', code: host.room!.code });
      expect(stranger.last('rejected').reason).toMatch(/full/);
    });

    it('does not start by itself: only the host starts it, once it is full', () => {
      const host = new FakeClient(lobby).hello('Hana');
      host.say({ type: 'createRoom' });
      host.say({ type: 'startGame' });
      expect(host.last('rejected').reason).toMatch(/more players/);

      const guest = new FakeClient(lobby).hello('Gus');
      guest.say({ type: 'joinRoom', code: host.room!.code });
      vi.advanceTimersByTime(options.countdownMs * 2);
      expect(host.room?.state).toBe('lobby');

      guest.say({ type: 'startGame' });
      expect(guest.last('rejected').reason).toMatch(/only the host/);

      host.say({ type: 'startGame' });
      expect(host.room?.state).toBe('starting');
      vi.advanceTimersByTime(options.countdownMs);
      expect(host.room?.state).toBe('running');
      expect(guest.all('snapshot')).toHaveLength(1);
    });

    it('lets only the host change settings, and validates them', () => {
      const { host, guest } = hostWithGuest();
      guest.say({ type: 'updateRoom', settings: { radius: 8 } });
      expect(guest.last('rejected').reason).toMatch(/only the host/);

      host.say({ type: 'updateRoom', settings: { radius: 8, config: { tickMs: 500 } } });
      expect(host.room?.settings.radius).toBe(8);
      expect(host.room?.settings.config.tickMs).toBe(500);
      expect(guest.room?.settings.radius).toBe(8);

      host.say({ type: 'updateRoom', settings: { radius: 99 } });
      expect(host.last('rejected').reason).toMatch(/out of range/);
      host.say({ type: 'updateRoom', settings: { config: { tickMs: 1 } } });
      expect(host.last('rejected').reason).toMatch(/invalid/);
      expect(host.room?.settings.radius).toBe(8);
    });

    it('starts the match with the chosen settings', () => {
      const { host } = hostWithGuest();
      host.say({
        type: 'updateRoom',
        settings: { radius: 6, config: { tickMs: 250, startingTroops: 17 } },
      });
      host.say({ type: 'startGame' });
      vi.advanceTimersByTime(options.countdownMs);
      const snapshot = host.last('snapshot');
      expect(snapshot.config).toMatchObject({ tickMs: 250, startingTroops: 17 });
      const radius = Math.max(
        ...Object.values(snapshot.state.tiles).map((t) =>
          Math.max(Math.abs(t.q), Math.abs(t.r), Math.abs(t.q + t.r)),
        ),
      );
      expect(radius).toBe(6);
    });

    it('passes the host to the next player when the host leaves', () => {
      const { host, guest } = hostWithGuest();
      host.say({ type: 'leaveRoom' });
      expect(host.room).toBeNull();
      expect(guest.room?.host).toBe(guest.last('welcome').userId);
    });

    it('has no settings changes for public rooms', () => {
      const a = new FakeClient(lobby).hello('Ann');
      a.say({ type: 'quickPlay', size: 2 });
      a.say({ type: 'updateRoom', settings: { radius: 8 } });
      expect(a.last('rejected').reason).toMatch(/public/);
    });
  });

  describe('playing', () => {
    it('ticks on schedule and resolves queued orders for both players', () => {
      const { a, b } = runningDuel();
      const snapshot = a.last('snapshot');
      const home = Object.values(snapshot.state.tiles).find((t) => t.owner === snapshot.you)!;
      const target = [
        { q: 1, r: 0 },
        { q: -1, r: 0 },
      ]
        .map((d) => ({ q: home.q + d.q, r: home.r }))
        .find((h) => snapshot.state.tiles[`${h.q},${h.r}`])!;

      a.say({ type: 'order', order: { type: 'move', from: home, to: target } });
      expect(a.last('queued')).toBeDefined();

      vi.advanceTimersByTime(999);
      expect(a.all('tick')).toHaveLength(0);
      vi.advanceTimersByTime(1);
      expect(a.last('tick')).toMatchObject({ tick: 1, queueLength: 0 });
      expect(a.last('tick').changed.length).toBeGreaterThan(0);
      expect(b.last('tick').tick).toBe(1);
    });

    it('turns away orders from outside the match', () => {
      const a = new FakeClient(lobby).hello('Ann');
      a.say({ type: 'quickPlay', size: 2 });
      a.say({ type: 'order', order: { type: 'move', from: { q: 0, r: 0 }, to: { q: 1, r: 0 } } });
      expect(a.last('rejected').reason).toMatch(/not started/);
    });

    it('ends the match on surrender and shows the result until players leave', () => {
      const { a, b } = runningDuel();
      b.say({ type: 'surrender' });
      expect(a.room?.state).toBe('finished');
      const winner = a.last('snapshot').state.winner;
      expect(winner).toBe(a.last('snapshot').you);

      a.say({ type: 'leaveRoom' });
      expect(a.room).toBeNull();
      expect(b.room?.state).toBe('finished');
      b.say({ type: 'leaveRoom' });
      expect(b.room).toBeNull();
    });

    it('treats leaving a running match as a surrender', () => {
      const { a, b } = runningDuel();
      b.say({ type: 'leaveRoom' });
      expect(b.room).toBeNull();
      expect(a.room?.state).toBe('finished');
      expect(a.last('snapshot').state.winner).toBe(a.last('snapshot').you);
      expect(a.room?.players.find((p) => p.name === 'Bob')?.connected).toBe(false);
    });

    it('closes a finished room after a while', () => {
      const { a, b } = runningDuel();
      b.say({ type: 'surrender' });
      vi.advanceTimersByTime(options.finishedLingerMs);
      expect(a.room).toBeNull();
      expect(b.room).toBeNull();
    });

    it('never reuses room ids', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 5; i++) {
        const { a, b } = runningDuel();
        ids.add(a.room!.id);
        b.say({ type: 'surrender' });
        a.say({ type: 'leaveRoom' });
        b.say({ type: 'leaveRoom' });
      }
      expect(ids.size).toBe(5);
    });
  });

  describe('connections', () => {
    it('keeps a disconnected player in the match and shows them as disconnected', () => {
      const { a, b } = runningDuel();
      b.disconnect();
      expect(a.room?.state).toBe('running');
      expect(a.room?.players.find((p) => p.name === 'Bob')?.connected).toBe(false);
      vi.advanceTimersByTime(3000);
      expect(a.last('tick').tick).toBe(3);
    });

    it('brings a returning player back into the running match', () => {
      const { a, b } = runningDuel();
      const token = b.token;
      const playerId = b.last('snapshot').you;
      b.disconnect();
      vi.advanceTimersByTime(30_000);

      const again = new FakeClient(lobby).hello('Bob', token);
      expect(again.room?.state).toBe('running');
      expect(again.last('snapshot').you).toBe(playerId);
      expect(again.last('snapshot').state.tick).toBeGreaterThan(0);
      expect(a.room?.players.find((p) => p.name === 'Bob')?.connected).toBe(true);
    });

    it('surrenders a player who stays away for the full two minutes', () => {
      const { a, b } = runningDuel();
      b.disconnect();
      vi.advanceTimersByTime(options.afkMs - 1000);
      expect(a.room?.state).toBe('running');
      vi.advanceTimersByTime(1000);
      expect(a.room?.state).toBe('finished');
      expect(a.last('snapshot').state.winner).toBe(a.last('snapshot').you);
    });

    it('does not surrender a player who came back in time', () => {
      const { a, b } = runningDuel();
      const token = b.token;
      b.disconnect();
      vi.advanceTimersByTime(options.afkMs - 1000);
      new FakeClient(lobby).hello('Bob', token);
      vi.advanceTimersByTime(options.afkMs);
      expect(a.room?.state).toBe('running');
    });

    it('replaces an older connection when the same guest connects again', () => {
      const first = new FakeClient(lobby).hello('Ann');
      const second = new FakeClient(lobby).hello('Ann', first.token);
      expect(first.closed).toBe(true);
      expect(second.last('welcome').userId).toBe(first.last('welcome').userId);
    });

    it('removes a guest who drops out of a lobby', () => {
      const a = new FakeClient(lobby).hello('Ann');
      const b = new FakeClient(lobby).hello('Bob');
      a.say({ type: 'quickPlay', size: 2 });
      a.disconnect();
      b.say({ type: 'quickPlay', size: 2 });
      // Ann's room was empty and closed, so Bob has a room of his own.
      expect(b.room?.players).toHaveLength(1);
    });
  });
});
