import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Lobby } from './lobby.js';
import { FakeClient, TICK_MS, options } from './test-helpers.js';

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
    a.say({ type: 'quickPlay', mode: 'duel' });
    b.say({ type: 'quickPlay', mode: 'duel' });
    return { a, b };
  }

  describe('menu', () => {
    it('rejects messages before hello and malformed messages', () => {
      const a = new FakeClient(lobby);
      a.say({ type: 'quickPlay', mode: 'duel' });
      expect(a.last('rejected').reason).toMatch(/hello/);
      a.say({ nonsense: true });
      expect(a.last('rejected').reason).toMatch(/invalid/);
    });
  });

  describe('quick play', () => {
    it('puts the first player in a public room and waits', () => {
      const a = new FakeClient(lobby).hello('Ann');
      a.say({ type: 'quickPlay', mode: 'duel' });
      expect(a.room).toMatchObject({ state: 'lobby', visibility: 'public' });
      expect(a.room?.players).toHaveLength(1);
    });

    it('lets a full public room sit in the lobby for a moment before it starts', () => {
      lobby.stop();
      lobby = new Lobby({ ...options, fullWaitMs: 3000 });
      const a = new FakeClient(lobby).hello('Ann');
      const b = new FakeClient(lobby).hello('Bob');
      a.say({ type: 'quickPlay', mode: 'duel' });
      b.say({ type: 'quickPlay', mode: 'duel' });
      expect(a.room).toMatchObject({ state: 'lobby' });
      expect(b.room).toMatchObject({ state: 'lobby' });
      expect(a.room?.players).toHaveLength(2);
      expect(a.room?.earlyStartAt).toBeGreaterThan(Date.now());
      vi.advanceTimersByTime(2900);
      expect(a.room).toMatchObject({ state: 'lobby' });
      vi.advanceTimersByTime(200);
      expect(a.room).toMatchObject({ state: 'running' });
      expect(b.room).toMatchObject({ state: 'running' });
    });

    it('goes back to waiting if someone leaves during that moment', () => {
      lobby.stop();
      lobby = new Lobby({ ...options, fullWaitMs: 3000 });
      const a = new FakeClient(lobby).hello('Ann');
      const b = new FakeClient(lobby).hello('Bob');
      a.say({ type: 'quickPlay', mode: 'duel' });
      b.say({ type: 'quickPlay', mode: 'duel' });
      b.say({ type: 'leaveRoom' });
      vi.advanceTimersByTime(10_000);
      expect(a.room).toMatchObject({ state: 'lobby' });
      expect(a.room?.players).toHaveLength(1);
    });

    it('pairs two players and starts the match at once, with the first tick after the prep time', () => {
      const a = new FakeClient(lobby).hello('Ann');
      const b = new FakeClient(lobby).hello('Bob');
      a.say({ type: 'quickPlay', mode: 'duel' });
      b.say({ type: 'quickPlay', mode: 'duel' });

      expect(a.room?.id).toBe(b.room?.id);
      expect(a.room).toMatchObject({ state: 'running' });
      const snapshot = a.last('snapshot');
      expect(snapshot.state.tick).toBe(0);
      expect(snapshot.nextTickAt).toBe(Date.now() + options.prepMs);
      expect(snapshot.state.players).toHaveLength(2);
      expect([snapshot.you, b.last('snapshot').you].sort()).toEqual(['P1', 'P2']);
      expect(snapshot.matchId).toBe(a.room?.id);
    });

    it('does not put a third player into a full room', () => {
      const { a, b } = runningDuel();
      const c = new FakeClient(lobby).hello('Cy');
      c.say({ type: 'quickPlay', mode: 'duel' });
      expect(c.room?.id).not.toBe(a.room?.id);
      expect(c.room?.state).toBe('lobby');
      expect(b.room?.players).toHaveLength(2);
    });

    it('closes a room when its last player leaves', () => {
      const a = new FakeClient(lobby).hello('Ann');
      a.say({ type: 'quickPlay', mode: 'duel' });
      const first = a.room?.id;
      a.say({ type: 'leaveRoom' });
      expect(a.room).toBeNull();
      a.say({ type: 'quickPlay', mode: 'duel' });
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
      expect(stranger.last('rejected').reason).toBe('No game with code ZZZZZ');
      // A full private room takes a newcomer as a spectator instead.
      stranger.say({ type: 'joinRoom', code: host.room!.code });
      expect(stranger.room).toMatchObject({ spectating: true, state: 'lobby' });
      expect(host.room?.players.map((p) => p.name)).toEqual(['Hana', 'Gus']);
      expect(host.room?.spectators).toEqual(['Sam']);
    });

    it('does not start by itself: only the host starts it, once it is full', () => {
      const host = new FakeClient(lobby).hello('Hana');
      host.say({ type: 'createRoom' });
      host.say({ type: 'startGame' });
      expect(host.last('rejected').reason).toMatch(/more players/);

      const guest = new FakeClient(lobby).hello('Gus');
      guest.say({ type: 'joinRoom', code: host.room!.code });
      vi.advanceTimersByTime(options.prepMs * 2);
      expect(host.room?.state).toBe('lobby');

      guest.say({ type: 'startGame' });
      expect(guest.last('rejected').reason).toMatch(/only the host/);

      host.say({ type: 'startGame' });
      expect(host.room?.state).toBe('running');
      expect(host.room?.state).toBe('running');
      expect(guest.all('snapshot')).toHaveLength(1);
    });

    it('lets only the host change settings, and validates them', () => {
      const { host, guest } = hostWithGuest();
      expect(host.room?.settings).toMatchObject({ mapSize: 'normal' });
      expect(host.room?.settings.config.tickMs).toBe(TICK_MS);

      guest.say({ type: 'updateRoom', settings: { mapSize: 'large' } });
      expect(guest.last('rejected').reason).toMatch(/only the host/);

      host.say({ type: 'updateRoom', settings: { mapSize: 'large', config: { tickMs: 500 } } });
      expect(host.room?.settings.mapSize).toBe('large');
      expect(host.room?.settings.config.tickMs).toBe(500);
      expect(guest.room?.settings.mapSize).toBe('large');

      // Tick length can be set in tenths of a second.
      host.say({ type: 'updateRoom', settings: { config: { tickMs: 1300 } } });
      expect(guest.room?.settings.config.tickMs).toBe(1300);

      host.say({ type: 'updateRoom', settings: { mapSize: 'enormous' as never } });
      expect(host.last('rejected').reason).toMatch(/invalid/);
      host.say({ type: 'updateRoom', settings: { config: { tickMs: 1 } } });
      expect(host.last('rejected').reason).toMatch(/invalid/);
      // The limits the settings screen offers: tick length 0.2 to 5 seconds, starting troops 1 to 100.
      for (const config of [{ tickMs: 100 }, { tickMs: 5001 }, { startingTroops: 101 }]) {
        host.say({ type: 'updateRoom', settings: { config } });
        expect(host.last('rejected').reason).toMatch(/invalid/);
      }
      host.say({ type: 'updateRoom', settings: { config: { tickMs: 200, startingTroops: 100 } } });
      expect(host.room?.settings.config).toMatchObject({ tickMs: 200, startingTroops: 100 });
      host.say({ type: 'updateRoom', settings: { config: { tickMs: 5000, startingTroops: 1 } } });
      expect(host.room?.settings.config).toMatchObject({ tickMs: 5000, startingTroops: 1 });
      expect(host.room?.settings.mapSize).toBe('large');
    });

    it('starts the match with the chosen settings, and sizes the board by map size', () => {
      const tilesAt = (mapSize: 'small' | 'normal' | 'large') => {
        const { host } = hostWithGuest();
        host.say({
          type: 'updateRoom',
          settings: { mapSize, config: { tickMs: 250, startingTroops: 17 } },
        });
        host.say({ type: 'startGame' });
        const snapshot = host.last('snapshot');
        expect(snapshot.config).toMatchObject({ tickMs: 250, startingTroops: 17 });
        host.say({ type: 'leaveRoom' });
        return Object.keys(snapshot.state.tiles).length;
      };
      // Boards are random, and the sizes overlap: one board of each size is out of order about 1
      // time in 90. On average, though, a bigger map has clearly more tiles (the averages of 9
      // boards each were never out of order in 200,000 draws).
      const BOARDS = 9;
      const averageAt = (mapSize: 'small' | 'normal' | 'large') =>
        Array.from({ length: BOARDS }, () => tilesAt(mapSize)).reduce((a, b) => a + b, 0) / BOARDS;
      const [small, normal, large] = [averageAt('small'), averageAt('normal'), averageAt('large')];
      expect(small).toBeLessThan(normal);
      expect(normal).toBeLessThan(large);
    });

    it('passes the host to the next player when the host leaves', () => {
      const { host, guest } = hostWithGuest();
      host.say({ type: 'leaveRoom' });
      expect(host.room).toBeNull();
      expect(guest.room?.host).toBe(guest.last('welcome').userId);
    });

    it('has no settings changes for public rooms', () => {
      const a = new FakeClient(lobby).hello('Ann');
      a.say({ type: 'quickPlay', mode: 'duel' });
      a.say({ type: 'updateRoom', settings: { mapSize: 'large' } });
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

      // Orders can be queued during the prep time; the first tick comes when it ends.
      vi.advanceTimersByTime(options.prepMs - 1);
      expect(a.all('tick')).toHaveLength(0);
      vi.advanceTimersByTime(1);
      expect(a.last('tick')).toMatchObject({ tick: 1, queueLength: 0 });
      expect(a.last('tick').changed.length).toBeGreaterThan(0);
      expect(b.last('tick').tick).toBe(1);
    });

    it('turns away orders from outside the match', () => {
      const a = new FakeClient(lobby).hello('Ann');
      a.say({ type: 'quickPlay', mode: 'duel' });
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

    describe('a private game', () => {
      const finishedPrivate = () => {
        const host = new FakeClient(lobby).hello('Hana');
        host.say({ type: 'createRoom' });
        const guest = new FakeClient(lobby).hello('Gus');
        guest.say({ type: 'joinRoom', code: host.room!.code });
        host.say({ type: 'startGame' });
        guest.say({ type: 'surrender' });
        return { host, guest };
      };

      it('takes players back to the room for the next game, each when they choose', () => {
        const { host, guest } = finishedPrivate();
        expect(host.room?.state).toBe('finished');
        host.say({ type: 'returnToRoom' });
        expect(host.room).toMatchObject({ state: 'lobby', host: host.room!.you });
        expect(host.room?.players.map((p) => p.name)).toEqual(['Hana']);
        // Gus is still looking at the result, and is not pulled out of it.
        expect(guest.room?.state).toBe('finished');
        guest.say({ type: 'returnToRoom' });
        expect(guest.room?.state).toBe('lobby');
        expect(host.room?.players.map((p) => p.name).sort()).toEqual(['Gus', 'Hana']);
        // And the next game can be played from there.
        host.say({ type: 'startGame' });
        expect(host.room?.state).toBe('running');
        expect(guest.room?.state).toBe('running');
      });

      it('keeps everyone in the same color from game to game, gaps and all', () => {
        const host = new FakeClient(lobby).hello('Hana');
        host.say({ type: 'createRoom', settings: { mode: 'ffa' } });
        const [gus, tia, zed] = ['Gus', 'Tia', 'Zed'].map((name) => {
          const client = new FakeClient(lobby).hello(name);
          client.say({ type: 'joinRoom', code: host.room!.code });
          return client;
        }) as [FakeClient, FakeClient, FakeClient];
        const colorsOf = (client: FakeClient) => {
          const { colors, you } = client.last('snapshot');
          return { all: colors, mine: colors?.[you ?? ''] };
        };
        host.say({ type: 'startGame' });
        const first = { host: colorsOf(host), tia: colorsOf(tia), zed: colorsOf(zed) };
        // Four different colors, and everyone sees the same ones.
        expect(new Set(Object.values(first.host.all ?? {})).size).toBe(4);
        expect(first.tia.all).toEqual(first.host.all);
        gus.say({ type: 'surrender' });
        tia.say({ type: 'surrender' });
        zed.say({ type: 'surrender' });
        expect(host.room?.state).toBe('finished');
        // Gus is not coming back, so the next game has Hana, Tia and Zed: their colors do not shuffle.
        for (const client of [host, gus, tia, zed]) client.say({ type: 'returnToRoom' });
        gus.say({ type: 'leaveRoom' });
        host.say({ type: 'startGame' });
        expect(host.room?.state).toBe('running');
        expect(colorsOf(host).mine).toBe(first.host.mine);
        expect(colorsOf(tia).mine).toBe(first.tia.mine);
        expect(colorsOf(zed).mine).toBe(first.zed.mine);
      });

      it('counts a player who is out as a spectator for the others, right away', () => {
        const host = new FakeClient(lobby).hello('Hana');
        host.say({ type: 'createRoom', settings: { mode: 'ffa' } });
        const [gus, tia, zed] = ['Gus', 'Tia', 'Zed'].map((name) => {
          const client = new FakeClient(lobby).hello(name);
          client.say({ type: 'joinRoom', code: host.room!.code });
          return client;
        }) as [FakeClient, FakeClient, FakeClient];
        host.say({ type: 'startGame' });
        // Everyone is still in the game: nobody is watching.
        expect(host.room?.spectators).toEqual([]);
        gus.say({ type: 'surrender' });
        expect(host.room?.state).toBe('running');
        // Out is a spectator at once, without having to ask for it.
        expect(host.room?.spectators).toEqual(['Gus']);
        expect(zed.room?.spectators).toEqual(['Gus']);
        expect(tia.room?.spectators).toEqual(['Gus']);
      });

      it('keeps the host as host while they read the result, until they leave', () => {
        const { host, guest } = finishedPrivate();
        guest.say({ type: 'returnToRoom' });
        // The guest is back first, but the room is still the host's.
        expect(guest.room).toMatchObject({ state: 'lobby', host: host.room!.you });
        guest.say({ type: 'startGame' });
        expect(guest.last('rejected').reason).toMatch(/host/);
        host.say({ type: 'leaveRoom' });
        expect(guest.room?.host).toBe(guest.room?.you);
      });

      it('lets the next game start without someone who is still reading the result', () => {
        const { host, guest } = finishedPrivate();
        const third = new FakeClient(lobby).hello('Tia');
        host.say({ type: 'returnToRoom' });
        third.say({ type: 'joinRoom', code: host.room!.code });
        host.say({ type: 'startGame' });
        expect(host.room?.state).toBe('running');
        expect(guest.room?.state).toBe('finished');
        // Back too late, the guest carries on as a spectator of the game that is on.
        guest.say({ type: 'returnToRoom' });
        expect(guest.room).toMatchObject({ state: 'running', spectating: true });
        expect(guest.last('snapshot').you).toBeNull();
      });

      it('takes someone back as a spectator when the room has filled up without them', () => {
        const { host, guest } = finishedPrivate();
        const third = new FakeClient(lobby).hello('Tia');
        host.say({ type: 'returnToRoom' });
        third.say({ type: 'joinRoom', code: host.room!.code });
        // The room is full (the host and Tia), and the guest was away: no error, just watching.
        guest.say({ type: 'returnToRoom' });
        expect(guest.room).toMatchObject({ state: 'lobby', spectating: true });
        expect(host.room?.spectators).toEqual(['Gus']);
        expect(host.room?.players).toHaveLength(2);
      });

      it('includes someone who was knocked out but stayed to watch', () => {
        const host = new FakeClient(lobby).hello('Hana');
        host.say({ type: 'createRoom', settings: { mode: 'ffa' } });
        const [out, left] = ['Ola', 'Lex'].map((name) => {
          const client = new FakeClient(lobby).hello(name);
          client.say({ type: 'joinRoom', code: host.room!.code });
          return client;
        }) as [FakeClient, FakeClient];
        host.say({ type: 'startGame' });
        out.say({ type: 'surrender' });
        expect(host.room?.state).toBe('running');
        left.say({ type: 'surrender' });
        expect(out.room?.state).toBe('finished');
        out.say({ type: 'returnToRoom' });
        expect(out.room?.state).toBe('lobby');
        expect(out.room?.players.map((p) => p.name)).toEqual(['Ola']);
      });

      it('shows every queue to someone who is out, and to nobody still playing', () => {
        const host = new FakeClient(lobby).hello('Hana');
        host.say({ type: 'createRoom', settings: { mode: 'ffa' } });
        const [out, rival] = ['Ola', 'Rex'].map((name) => {
          const client = new FakeClient(lobby).hello(name);
          client.say({ type: 'joinRoom', code: host.room!.code });
          return client;
        }) as [FakeClient, FakeClient];
        host.say({ type: 'startGame' });
        const move = { type: 'move', from: { q: 0, r: 0 }, to: { q: 1, r: 0 } } as const;
        // While everyone is playing, nobody is told about anyone else's orders.
        rival.say({ type: 'order', order: move });
        expect(host.all('queued')).toHaveLength(0);
        expect(host.last('snapshot').queues).toBeUndefined();

        out.say({ type: 'surrender' });
        // The snapshot sent when someone is out carries every queue, for them alone.
        expect(out.last('snapshot').queues).toMatchObject({
          [rival.last('snapshot').you!]: [move],
        });
        expect(host.last('snapshot').queues).toBeUndefined();
        // From then on they hear of each order as it is given, and of none of their own kind.
        const before = out.all('queued').length;
        rival.say({ type: 'order', order: move });
        host.say({ type: 'order', order: move });
        expect(out.all('queued')).toHaveLength(before + 2);
        expect(out.last('queued').player).toBe(host.last('snapshot').you);
        expect(host.all('queued').every((message) => message.player === undefined)).toBe(true);
        expect(rival.all('queued').every((message) => message.player === undefined)).toBe(true);
        // Ticks keep them up to date.
        vi.advanceTimersByTime(options.prepMs + TICK_MS);
        expect(out.last('tick').queueLengths).toBeDefined();
        expect(host.last('tick').queueLengths).toBeUndefined();
      });
    });

    it('closes a finished room after a while', () => {
      const { a, b } = runningDuel();
      b.say({ type: 'surrender' });
      vi.advanceTimersByTime(options.finishedLingerMs);
      expect(a.room).toBeNull();
      expect(b.room).toBeNull();
    });
  });

  describe('connections', () => {
    it('keeps a disconnected player in the match and shows them as disconnected', () => {
      const { a, b } = runningDuel();
      b.disconnect();
      expect(a.room?.state).toBe('running');
      expect(a.room?.players.find((p) => p.name === 'Bob')?.connected).toBe(false);
      vi.advanceTimersByTime(options.prepMs + 2 * TICK_MS);
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
      a.say({ type: 'quickPlay', mode: 'duel' });
      a.disconnect();
      b.say({ type: 'quickPlay', mode: 'duel' });
      // Ann's room was empty and closed, so Bob has a room of his own.
      expect(b.room?.players).toHaveLength(1);
    });
  });
});

describe('Lobby battle royale', () => {
  let lobby: Lobby;

  beforeEach(() => {
    vi.useFakeTimers();
    lobby = new Lobby(options);
  });

  afterEach(() => {
    lobby.stop();
    vi.useRealTimers();
  });

  /** `count` guests, each in the same public battle royale (quick play). */
  function joinPublic(count: number): FakeClient[] {
    return Array.from({ length: count }, (_, i) => {
      const client = new FakeClient(lobby).hello(`Guest ${i + 1}`);
      client.say({ type: 'quickPlay', mode: 'ffa' });
      return client;
    });
  }

  function privateRoom(joiners: number) {
    const host = new FakeClient(lobby).hello('Hana');
    host.say({ type: 'createRoom', settings: { mode: 'ffa' } });
    const guests = Array.from({ length: joiners }, (_, i) => {
      const guest = new FakeClient(lobby).hello(`Gus ${i + 1}`);
      guest.say({ type: 'joinRoom', code: host.room!.code });
      return guest;
    });
    return { host, guests };
  }

  describe('public rooms', () => {
    it('holds 12 players and starts as soon as it is full', () => {
      const clients = joinPublic(12);
      expect(clients[0]!.room).toMatchObject({ state: 'running' });
      expect(clients[0]!.room?.state).toBe('running');
      expect(clients[0]!.last('snapshot').state.players).toHaveLength(12);
      const ids = clients.map((c) => c.last('snapshot').you);
      expect(new Set(ids).size).toBe(12);
    });

    it('never puts a 13th player in the room', () => {
      const clients = joinPublic(13);
      expect(clients[12]!.room?.id).not.toBe(clients[0]!.room?.id);
      expect(clients[12]!.room?.state).toBe('lobby');
      expect(clients[0]!.room?.players).toHaveLength(12);
    });

    it('does not start with fewer than 3 players, however long they wait', () => {
      const clients = joinPublic(2);
      vi.advanceTimersByTime(options.earlyStartMs * 10);
      expect(clients[0]!.room).toMatchObject({ state: 'lobby', earlyStartAt: null });
    });

    it('starts early once 3 or more players have waited with nobody new joining', () => {
      const clients = joinPublic(3);
      const early = clients[0]!.room?.earlyStartAt;
      expect(early).toBeGreaterThan(Date.now());
      vi.advanceTimersByTime(options.earlyStartMs - 1);
      expect(clients[0]!.room?.state).toBe('lobby');
      vi.advanceTimersByTime(1);
      expect(clients[0]!.room?.state).toBe('running');
      expect(clients[0]!.room?.state).toBe('running');
      expect(clients[0]!.last('snapshot').state.players).toHaveLength(3);
    });

    it('starts the wait when the room reaches 3 players, and a join does not reset it', () => {
      const clients = joinPublic(3);
      const end = clients[0]!.room?.earlyStartAt;
      expect(end).toBeGreaterThan(Date.now());
      vi.advanceTimersByTime(5000);
      const late = new FakeClient(lobby).hello('Late');
      late.say({ type: 'quickPlay', mode: 'ffa' });
      // Plenty of time left, so the end of the wait is unchanged.
      expect(clients[0]!.room?.earlyStartAt).toBe(end);
      vi.advanceTimersByTime(options.earlyStartMs - 5000);
      expect(clients[0]!.room?.state).toBe('running');
      expect(clients[0]!.last('snapshot').state.players).toHaveLength(4);
    });

    it('tops the wait up to the join minimum when someone joins near the end', () => {
      const clients = joinPublic(3);
      vi.advanceTimersByTime(options.earlyStartMs - 2000);
      const late = new FakeClient(lobby).hello('Late');
      late.say({ type: 'quickPlay', mode: 'ffa' });
      vi.advanceTimersByTime(options.joinWaitMs - 1);
      expect(clients[0]!.room?.state).toBe('lobby');
      vi.advanceTimersByTime(1);
      expect(clients[0]!.room?.state).toBe('running');
      expect(clients[0]!.last('snapshot').state.players).toHaveLength(4);
    });

    it('does not reset the wait when a player leaves, as long as 3 remain', () => {
      const clients = joinPublic(4);
      vi.advanceTimersByTime(8000);
      const end = clients[0]!.room?.earlyStartAt;
      clients[3]!.say({ type: 'leaveRoom' });
      expect(clients[0]!.room?.earlyStartAt).toBe(end);
      vi.advanceTimersByTime(options.earlyStartMs - 8000);
      expect(clients[0]!.room?.state).toBe('running');
    });

    it('starts the wait afresh if the room drops below 3 and gets back to 3', () => {
      const clients = joinPublic(3);
      vi.advanceTimersByTime(10_000);
      clients[2]!.say({ type: 'leaveRoom' });
      expect(clients[0]!.room?.earlyStartAt).toBeNull();
      const again = new FakeClient(lobby).hello('Again');
      again.say({ type: 'quickPlay', mode: 'ffa' });
      expect(clients[0]!.room?.earlyStartAt).toBeGreaterThanOrEqual(
        Date.now() + options.earlyStartMs - 1,
      );
    });

    it('stops the wait if players leave and too few are left', () => {
      const clients = joinPublic(3);
      clients[2]!.say({ type: 'leaveRoom' });
      expect(clients[0]!.room?.earlyStartAt).toBeNull();
      vi.advanceTimersByTime(options.earlyStartMs * 2);
      expect(clients[0]!.room?.state).toBe('lobby');
    });

    it('turns away late joiners once the match has begun', () => {
      const clients = joinPublic(12);
      expect(clients[0]!.room?.state).toBe('running');
      const late = new FakeClient(lobby).hello('Late');
      late.say({ type: 'quickPlay', mode: 'ffa' });
      expect(late.room?.id).not.toBe(clients[0]!.room?.id);
    });

    it('plays on when someone leaves a match that started with a full room', () => {
      const clients = joinPublic(12);
      clients[11]!.say({ type: 'leaveRoom' });
      expect(clients[0]!.room?.state).toBe('running');
      expect(clients[0]!.last('snapshot').state.players).toHaveLength(12);
    });

    it('does not mix duels and battle royales', () => {
      const duelist = new FakeClient(lobby).hello('Dee');
      duelist.say({ type: 'quickPlay', mode: 'duel' });
      const [ffa] = joinPublic(1);
      expect(ffa!.room?.id).not.toBe(duelist.room?.id);
    });
  });

  describe('private rooms', () => {
    it('has a room for 12, and the host starts it with whoever is there once there are 3', () => {
      const { host, guests } = privateRoom(1);
      expect(host.room?.settings).toMatchObject({ mode: 'ffa', size: 12 });
      host.say({ type: 'startGame' });
      expect(host.last('rejected').reason).toMatch(/more players/);

      const third = new FakeClient(lobby).hello('Third');
      third.say({ type: 'joinRoom', code: host.room!.code });
      guests[0]!.say({ type: 'startGame' });
      expect(guests[0]!.last('rejected').reason).toMatch(/only the host/);

      // No early start in a private room: the host decides.
      vi.advanceTimersByTime(options.earlyStartMs * 5);
      expect(host.room?.state).toBe('lobby');

      host.say({ type: 'startGame' });
      expect(host.room?.state).toBe('running');
      expect(host.last('snapshot').state.players).toHaveLength(3);
    });

    it('never takes more than 12 players', () => {
      const { host } = privateRoom(11);
      expect(host.room?.players).toHaveLength(12);
      const extra = new FakeClient(lobby).hello('Extra');
      extra.say({ type: 'joinRoom', code: host.room!.code });
      expect(extra.room?.spectating).toBe(true);
      expect(host.room?.players).toHaveLength(12);
      host.say({ type: 'startGame' });
      expect(host.last('snapshot').state.players).toHaveLength(12);
    });

    it('switches between duel and battle royale while gathering', () => {
      const host = new FakeClient(lobby).hello('Hana');
      host.say({ type: 'createRoom' });
      expect(host.room?.settings).toMatchObject({ mode: 'duel', size: 2 });
      host.say({ type: 'updateRoom', settings: { mode: 'ffa' } });
      expect(host.room?.settings).toMatchObject({ mode: 'ffa', size: 12 });
      expect(host.room?.minPlayers).toBe(3);
      host.say({ type: 'updateRoom', settings: { mode: 'duel' } });
      expect(host.room?.settings).toMatchObject({ mode: 'duel', size: 2 });
    });

    it('turns the latest players into spectators when switching to a duel', () => {
      const { host, guests } = privateRoom(2);
      const [second, third] = [guests[0]!, guests[1]!];
      host.say({ type: 'updateRoom', settings: { mode: 'duel' } });
      expect(host.room?.settings.mode).toBe('duel');
      // The host and the first to arrive stay; the others watch.
      expect(host.room?.players).toHaveLength(2);
      expect(second.room?.spectating).toBe(false);
      expect(third.room?.spectating).toBe(true);
      expect(host.room?.spectators).toEqual(['Gus 2']);
      host.say({ type: 'updateRoom', settings: { mode: 'ffa' } });
      // The place is open again, but not filled for them.
      expect(third.room?.spectating).toBe(true);
      third.say({ type: 'becomePlayer' });
      expect(third.room?.spectating).toBe(false);
      expect(host.room?.players).toHaveLength(3);
      expect(host.room?.spectators).toEqual([]);
    });

    it('leaves the new places empty when switching from a duel to a battle royale', () => {
      const host = new FakeClient(lobby).hello('Hana');
      host.say({ type: 'createRoom', settings: { mode: 'duel' } });
      const [guest, watcher] = ['Gus', 'Wes'].map((name) => {
        const client = new FakeClient(lobby).hello(name);
        client.say({ type: 'joinRoom', code: host.room!.code });
        return client;
      }) as [FakeClient, FakeClient];
      expect(watcher.room?.spectating).toBe(true);
      host.say({ type: 'updateRoom', settings: { mode: 'ffa' } });
      // Nobody is moved up: the spectator asks for the place.
      expect(watcher.room?.spectating).toBe(true);
      expect(host.room?.players).toHaveLength(2);
      watcher.say({ type: 'becomePlayer' });
      expect(watcher.room?.spectating).toBe(false);
      expect(host.room?.players.map((p) => p.name)).toEqual(['Hana', 'Gus', 'Wes']);
      expect(guest.room?.players).toHaveLength(3);
    });

    it('lets players step out to watch, and spectators step in, but only into a free place', () => {
      const host = new FakeClient(lobby).hello('Hana');
      host.say({ type: 'createRoom', settings: { mode: 'duel' } });
      const guest = new FakeClient(lobby).hello('Gus');
      guest.say({ type: 'joinRoom', code: host.room!.code });
      const watcher = new FakeClient(lobby).hello('Wes');
      watcher.say({ type: 'joinRoom', code: host.room!.code });
      // The room is full: no place to take.
      watcher.say({ type: 'becomePlayer' });
      expect(watcher.last('rejected').reason).toMatch(/full/);
      // A player steps out; the place stays empty until someone asks for it.
      guest.say({ type: 'becomeSpectator' });
      expect(guest.room?.spectating).toBe(true);
      expect(host.room?.players).toHaveLength(1);
      expect(watcher.room?.spectating).toBe(true);
      watcher.say({ type: 'becomePlayer' });
      expect(host.room?.players.map((p) => p.name)).toEqual(['Hana', 'Wes']);
      // The host can step out too, and stays the host, even with no one else playing.
      host.say({ type: 'becomeSpectator' });
      expect(host.room).toMatchObject({ spectating: true, host: host.room!.you });
      watcher.say({ type: 'becomeSpectator' });
      expect(host.room?.players).toHaveLength(0);
      expect(host.room?.host).toBe(host.room?.you);
      // A host who is only watching keeps the room open, and can take a place again.
      expect(guest.room).not.toBeNull();
      host.say({ type: 'becomePlayer' });
      expect(host.room?.players.map((p) => p.name)).toEqual(['Hana']);
    });
  });

  describe('voting to start early', () => {
    const vote = (client: FakeClient, value = true) =>
      client.say({ type: 'voteStart', vote: value });

    it('needs 3 players, and only exists in public battle royales', () => {
      const two = joinPublic(2);
      vote(two[0]!);
      expect(two[0]!.last('rejected').reason).toMatch(/at least 3/);

      const { host } = privateRoom(3);
      vote(host);
      expect(host.last('rejected').reason).toMatch(/nothing to vote on/);

      const duelist = new FakeClient(lobby).hello('Dee');
      duelist.say({ type: 'quickPlay', mode: 'duel' });
      vote(duelist);
      expect(duelist.last('rejected').reason).toMatch(/nothing to vote on/);
    });

    it('asks for two thirds of the room, rounded up', () => {
      for (const [players, needed] of [
        [3, 2],
        [4, 3],
        [6, 4],
        [7, 5],
        [11, 8],
      ] as const) {
        lobby.stop();
        lobby = new Lobby(options);
        const clients = joinPublic(players);
        expect(clients[0]!.room?.votesNeeded).toBe(needed);
      }
    });

    it('cuts the wait to 5 seconds once enough have voted, then counts down to the match', () => {
      const clients = joinPublic(3);
      vi.advanceTimersByTime(2000);
      vote(clients[0]!);
      expect(clients[0]!.room).toMatchObject({ startVotes: 1, votesNeeded: 2, youVoted: true });
      expect(clients[1]!.room).toMatchObject({ startVotes: 1, youVoted: false });
      // One vote is not enough: the wait carries on as before.
      expect(clients[0]!.room?.earlyStartAt).toBeGreaterThan(Date.now() + 10_000);

      vote(clients[1]!);
      const dropsTo = clients[0]!.room?.earlyStartAt ?? 0;
      expect(dropsTo - Date.now()).toBeLessThanOrEqual(options.voteStartMs);
      vi.advanceTimersByTime(options.voteStartMs - 1);
      expect(clients[0]!.room?.state).toBe('lobby');
      vi.advanceTimersByTime(1);
      expect(clients[0]!.room?.state).toBe('running');
      expect(clients[0]!.room?.state).toBe('running');
      expect(clients[0]!.last('snapshot').state.players).toHaveLength(3);
    });

    it('lets a vote be taken back before the vote passes', () => {
      const clients = joinPublic(3);
      vote(clients[0]!);
      vote(clients[0]!, false);
      expect(clients[0]!.room).toMatchObject({ startVotes: 0, youVoted: false });
      vote(clients[1]!);
      expect(clients[0]!.room?.startVotes).toBe(1);
    });

    it('does not shorten a wait that is already shorter than 5 seconds', () => {
      const clients = joinPublic(3);
      vi.advanceTimersByTime(options.earlyStartMs - 2000);
      vote(clients[0]!);
      vote(clients[1]!);
      vi.advanceTimersByTime(2000);
      expect(clients[0]!.room?.state).toBe('running');
    });

    it('closes the room to newcomers once the vote has passed', () => {
      const clients = joinPublic(3);
      vote(clients[0]!);
      vote(clients[1]!);
      const late = new FakeClient(lobby).hello('Late');
      late.say({ type: 'quickPlay', mode: 'ffa' });
      expect(late.room?.id).not.toBe(clients[0]!.room?.id);
      vi.advanceTimersByTime(options.voteStartMs);
      expect(clients[0]!.last('snapshot').state.players).toHaveLength(3);
    });

    it('keeps the early start if a player leaves and 3 or more remain', () => {
      const clients = joinPublic(4);
      vote(clients[0]!);
      vote(clients[1]!);
      vote(clients[2]!);
      expect(clients[0]!.room?.earlyStartAt).not.toBeNull();
      clients[3]!.say({ type: 'leaveRoom' });
      vi.advanceTimersByTime(options.voteStartMs);
      expect(clients[0]!.last('snapshot').state.players).toHaveLength(3);
    });

    it('calls the early start off if too few players are left', () => {
      const clients = joinPublic(3);
      vote(clients[0]!);
      vote(clients[1]!);
      clients[2]!.say({ type: 'leaveRoom' });
      expect(clients[0]!.room).toMatchObject({ earlyStartAt: null, startVotes: 0, state: 'lobby' });
      vi.advanceTimersByTime(options.earlyStartMs * 5);
      expect(clients[0]!.room?.state).toBe('lobby');
    });

    it('counts a leaving voter out, and a lowered bar can then be met', () => {
      const clients = joinPublic(6); // 4 votes needed
      vote(clients[0]!);
      vote(clients[1]!);
      vote(clients[2]!);
      expect(clients[0]!.room?.earlyStartAt).toBeGreaterThan(Date.now() + 10_000);
      // A non-voter leaves: 5 players need 4 votes, still not enough.
      clients[5]!.say({ type: 'leaveRoom' });
      expect(clients[0]!.room).toMatchObject({ votesNeeded: 4, startVotes: 3 });
      // Another non-voter leaves: 4 players need 3 votes, and there are 3.
      clients[4]!.say({ type: 'leaveRoom' });
      expect(clients[0]!.room?.votesNeeded).toBe(3);
      vi.advanceTimersByTime(options.voteStartMs);
      expect(clients[0]!.room?.state).toBe('running');
    });
  });

  it('plays a full battle royale: random shaped board, everyone gets a starting city', () => {
    // Without fog, a player is sent the whole board.
    const host = new FakeClient(lobby).hello('Hana');
    host.say({ type: 'createRoom', settings: { mode: 'ffa', config: { fog: 'off' } } });
    const guests = Array.from({ length: 11 }, (_, i) => {
      const guest = new FakeClient(lobby).hello(`Gus ${i + 1}`);
      guest.say({ type: 'joinRoom', code: host.room!.code });
      return guest;
    });
    host.say({ type: 'startGame' });
    const snapshot = host.last('snapshot');
    const starts = Object.values(snapshot.state.tiles).filter((t) => t.owner !== null);
    expect(starts).toHaveLength(12);
    expect(new Set(starts.map((t) => t.owner)).size).toBe(12);
    for (const start of starts) expect(start.type).toBe('city');
    // Ticks run, and the last player standing wins as in any match.
    vi.advanceTimersByTime(options.prepMs + 2 * TICK_MS);
    expect(host.last('tick').tick).toBe(3);
    for (const guest of guests) guest.say({ type: 'surrender' });
    expect(host.room?.state).toBe('finished');
    expect(host.last('snapshot').state.winner).toBe(snapshot.you);
  });

  describe('spectators in private games', () => {
    const fullRoom = () => {
      const host = new FakeClient(lobby).hello('Hana');
      host.say({ type: 'createRoom' });
      const guest = new FakeClient(lobby).hello('Gus');
      guest.say({ type: 'joinRoom', code: host.room!.code });
      const watcher = new FakeClient(lobby).hello('Wes');
      watcher.say({ type: 'joinRoom', code: host.room!.code });
      return { host, guest, watcher };
    };

    it('does not take a place, and cannot start or change the game', () => {
      const { host, guest, watcher } = fullRoom();
      expect(watcher.room).toMatchObject({ spectating: true, state: 'lobby' });
      expect(guest.room?.spectating).toBe(false);
      watcher.say({ type: 'startGame' });
      expect(watcher.last('rejected').reason).toMatch(/host/);
      watcher.say({ type: 'updateRoom', settings: { mapSize: 'large' } });
      expect(host.room?.settings.mapSize).not.toBe('large');
      // Leaving costs the players nothing.
      watcher.say({ type: 'leaveRoom' });
      expect(watcher.room).toBeNull();
      expect(host.room?.spectators).toEqual([]);
      expect(host.room?.players).toHaveLength(2);
    });

    it('sees the whole match, with every queue, but cannot give orders', () => {
      const { host, guest, watcher } = fullRoom();
      host.say({ type: 'startGame' });
      expect(watcher.room?.state).toBe('running');
      const snapshot = watcher.last('snapshot');
      expect(snapshot.you).toBeNull();
      expect(snapshot.queues).toBeDefined();
      const move = { type: 'move', from: { q: 0, r: 0 }, to: { q: 1, r: 0 } } as const;
      watcher.say({ type: 'order', order: move });
      expect(watcher.last('rejected').reason).toMatch(/not started/);
      guest.say({ type: 'order', order: move });
      expect(watcher.last('queued').player).toBe(guest.last('snapshot').you);
      vi.advanceTimersByTime(options.prepMs + TICK_MS);
      expect(watcher.last('tick').queueLengths ?? watcher.last('tick').queues).toBeDefined();
      // The players never hear of it.
      expect(host.all('queued')).toHaveLength(0);
    });

    it('lets people watch a game that has already begun', () => {
      const { host } = fullRoom();
      host.say({ type: 'startGame' });
      const late = new FakeClient(lobby).hello('Lou');
      late.say({ type: 'joinRoom', code: host.room!.code });
      expect(late.room).toMatchObject({ spectating: true, state: 'running' });
      expect(late.last('snapshot').you).toBeNull();
    });

    it('stays open for them to watch back in the room, and closes once no player is left', () => {
      const { host, guest, watcher } = fullRoom();
      host.say({ type: 'startGame' });
      guest.say({ type: 'surrender' });
      expect(watcher.room?.state).toBe('finished');
      watcher.say({ type: 'returnToRoom' });
      host.say({ type: 'returnToRoom' });
      expect(watcher.room).toMatchObject({ state: 'lobby', spectating: true });
      expect(host.room?.host).toBe(host.room?.you);
      guest.say({ type: 'leaveRoom' });
      host.say({ type: 'leaveRoom' });
      // No one is left to play: the room closes, spectators and all.
      expect(watcher.room).toBeNull();
    });
  });

  describe('fog of war', () => {
    it('shows a player their own surroundings only, and everybody the scoreboard', () => {
      const clients = joinPublic(12);
      const snapshot = clients[0]!.last('snapshot');
      const tiles = Object.values(snapshot.state.tiles);
      const mine = tiles.filter((t) => t.owner === snapshot.you);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ type: 'city', troops: 10 });
      // The other eleven cities are somewhere out of sight (some may be two steps away).
      const seenCities = tiles.filter((t) => t.type === 'city');
      expect(seenCities.length).toBeLessThan(12);
      // Out of sight means blank: the board is known, its contents are not.
      expect(tiles.filter((t) => t.owner === null && t.troops === 0).length).toBeGreaterThan(
        tiles.length / 2,
      );
      // The scoreboard is not fogged: all twelve players, each with their production.
      expect(snapshot.scores).toHaveLength(12);
      for (const score of snapshot.scores) {
        // 10 troops on the starting city, one of which stays behind.
        expect(score).toMatchObject({ tiles: 1, mobile: 9 });
        expect(score.capacity).toBeGreaterThan(0);
      }
    });

    it('can be switched off for a private game', () => {
      const host = new FakeClient(lobby).hello('Hana');
      host.say({ type: 'createRoom', settings: { config: { fog: 'off' } } });
      expect(host.room?.settings.config.fog).toBe('off');
      const guest = new FakeClient(lobby).hello('Gus');
      guest.say({ type: 'joinRoom', code: host.room!.code });
      host.say({ type: 'startGame' });
      const cities = Object.values(host.last('snapshot').state.tiles).filter(
        (t) => t.type === 'city',
      );
      expect(cities.length).toBeGreaterThan(2);
      // Both players' cities are in view, the other player's with their real troops.
      expect(cities.filter((t) => t.owner !== null && t.troops === 10)).toHaveLength(2);
    });

    it('is on by default, and sends other people their own view of each tick', () => {
      const a = new FakeClient(lobby).hello('Ann');
      const b = new FakeClient(lobby).hello('Bob');
      a.say({ type: 'quickPlay', mode: 'duel' });
      b.say({ type: 'quickPlay', mode: 'duel' });
      expect(a.last('snapshot').config.fog).toBe('on');
      expect(b.last('snapshot').config.fog).toBe('on');
      vi.advanceTimersByTime(options.prepMs);
      expect(a.last('tick').scores).toHaveLength(2);
    });
  });
});

describe('Lobby activity counts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('tells people in the menu how many are playing each mode, as it changes', () => {
    const lobby = new Lobby({ ...options, statsMs: 1000 });
    const watcher = new FakeClient(lobby).hello('Watcher');
    expect(watcher.last('stats')).toMatchObject({ duel: 0, ffa: 0 });

    const a = new FakeClient(lobby).hello('Ann');
    a.say({ type: 'quickPlay', mode: 'duel' });
    const crowd = Array.from({ length: 3 }, (_, i) => new FakeClient(lobby).hello(`P${i}`));
    for (const c of crowd) c.say({ type: 'quickPlay', mode: 'ffa' });
    vi.advanceTimersByTime(1000);
    expect(watcher.last('stats')).toMatchObject({ duel: 1, ffa: 3 });

    // Leaving, or losing your connection, takes you out of the count.
    crowd[0]!.say({ type: 'leaveRoom' });
    crowd[1]!.disconnect();
    vi.advanceTimersByTime(1000);
    expect(watcher.last('stats')).toMatchObject({ duel: 1, ffa: 1 });

    // Private games are left out of the count.
    const host = new FakeClient(lobby).hello('Hana');
    host.say({ type: 'createRoom', settings: { mode: 'ffa' } });
    const friend = new FakeClient(lobby).hello('Fay');
    friend.say({ type: 'joinRoom', code: host.room!.code });
    vi.advanceTimersByTime(1000);
    expect(watcher.last('stats')).toMatchObject({ duel: 1, ffa: 1 });

    // People already in a game are not sent the menu's numbers.
    const before = a.all('stats').length;
    vi.advanceTimersByTime(5000);
    expect(a.all('stats').length).toBe(before);
    lobby.stop();
  });

  it('catches up someone who comes back to the menu after missing updates', () => {
    const lobby = new Lobby({ ...options, statsMs: 1000 });
    const a = new FakeClient(lobby).hello('Ann');
    a.say({ type: 'quickPlay', mode: 'duel' });
    const crowd = Array.from({ length: 2 }, (_, i) => new FakeClient(lobby).hello(`P${i}`));
    for (const c of crowd) c.say({ type: 'quickPlay', mode: 'ffa' });
    // Everyone else in the menu hears about the crowd; Ann, in a game, does not.
    vi.advanceTimersByTime(1000);
    // Back in the menu, the numbers have not changed since the others heard them, which used to
    // leave her looking at the old ones.
    a.say({ type: 'leaveRoom' });
    vi.advanceTimersByTime(1000);
    expect(a.last('stats')).toMatchObject({ duel: 0, ffa: 2 });
    lobby.stop();
  });
});

describe('Lobby beta code', () => {
  const closed = () => new Lobby({ ...options, betaCode: 'sesame' });

  it('lets nobody in without the code, and everybody in with it', () => {
    const lobby = closed();
    const guest = new FakeClient(lobby);
    guest.say({ type: 'hello', name: 'Ann' });
    expect(guest.last('denied').reason).toBe('code required');
    // Nothing works until the right code is sent.
    guest.say({ type: 'quickPlay', mode: 'duel' });
    expect(guest.last('rejected').reason).toMatch(/hello/);

    guest.say({ type: 'hello', name: 'Ann', code: 'nope' });
    expect(guest.last('denied').reason).toBe('wrong code');
    expect(guest.all('welcome')).toHaveLength(0);

    guest.say({ type: 'hello', name: 'Ann', code: 'sesame' });
    expect(guest.last('welcome').userId).toBeTruthy();
    guest.say({ type: 'quickPlay', mode: 'duel' });
    expect(guest.room).toMatchObject({ visibility: 'public' });
    lobby.stop();
  });

  it('drops a connection that keeps guessing', () => {
    const lobby = closed();
    const guest = new FakeClient(lobby);
    for (let i = 0; i < 5; i++) guest.say({ type: 'hello', name: 'Eve', code: `guess${i}` });
    expect(guest.closed).toBe(true);
    lobby.stop();
  });

  it('is open when no code is set', () => {
    const lobby = new Lobby(options);
    const guest = new FakeClient(lobby).hello('Ann');
    expect(guest.last('welcome').userId).toBeTruthy();
    lobby.stop();
  });
});
