import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventRecorder, type Analytics, type AnalyticsEvent } from './analytics.js';
import { createHttpHandler } from './http.js';
import { Lobby } from './lobby.js';
import { openTestDb } from './test-db.js';
import { FakeClient, options } from './test-helpers.js';

/** Collects what is reported, to look at. */
class Collected implements Analytics {
  readonly events: AnalyticsEvent[] = [];
  record(event: AnalyticsEvent): void {
    this.events.push(event);
  }
  named(name: string): AnalyticsEvent[] {
    return this.events.filter((event) => event.name === name);
  }
}

describe('what the game reports', () => {
  let lobby: Lobby;
  let analytics: Collected;

  beforeEach(() => {
    vi.useFakeTimers();
    analytics = new Collected();
    lobby = new Lobby({ ...options, analytics });
  });
  afterEach(() => {
    lobby.stop();
    vi.useRealTimers();
  });

  /** A guest who has said which visitor and page load they are. */
  const guest = (name: string, id = name.toLowerCase()): FakeClient => {
    const client = new FakeClient(lobby);
    client.say({
      type: 'hello',
      name,
      visitorId: `visitor-${id}`,
      sessionId: `session-${id}`,
    });
    return client;
  };

  it('reports nothing about a guest who has not said who they are', () => {
    const a = new FakeClient(lobby).hello('Ann');
    a.say({ type: 'quickPlay', mode: 'duel' });
    a.say({ type: 'leaveRoom' });
    a.disconnect();
    expect(analytics.events).toEqual([]);
  });

  it('ignores an id that is not well formed instead of refusing the guest', () => {
    const a = new FakeClient(lobby);
    a.say({ type: 'hello', name: 'Ann', visitorId: 'no good!', sessionId: 'x' });
    expect(a.last('welcome').token).toBeTruthy();
    a.say({ type: 'quickPlay', mode: 'duel' });
    expect(analytics.events).toEqual([]);
  });

  it('reports how long someone waited in a lobby before leaving it', () => {
    const a = guest('Ann');
    a.say({ type: 'quickPlay', mode: 'duel' });
    vi.advanceTimersByTime(5000);
    a.say({ type: 'leaveRoom' });
    const [join] = analytics.named('lobby_join');
    expect(join).toMatchObject({
      visitorId: 'visitor-ann',
      sessionId: 'session-ann',
      props: { via: 'quickplay', visibility: 'public', mode: 'duel', players: 1 },
    });
    expect(analytics.named('lobby_leave')[0]?.props).toMatchObject({
      how: 'left',
      role: 'player',
      waitedMs: 5000,
      players: 0,
    });
  });

  it('tells a dropped connection from a choice to leave', () => {
    const a = guest('Ann');
    a.say({ type: 'quickPlay', mode: 'duel' });
    a.disconnect();
    expect(analytics.named('lobby_leave')[0]?.props).toMatchObject({ how: 'disconnected' });
    expect(analytics.named('disconnect')[0]?.props).toMatchObject({
      inRoom: true,
      roomState: 'lobby',
    });
  });

  it('reports a player who drops out of a running match and comes back', () => {
    const a = guest('Ann');
    const b = guest('Bob');
    a.say({ type: 'createRoom' });
    b.say({ type: 'joinRoom', code: a.room!.code });
    a.say({ type: 'startGame' });
    const token = b.token;
    b.disconnect();
    expect(analytics.named('disconnect')[0]).toMatchObject({
      visitorId: 'visitor-bob',
      props: { inRoom: true, roomState: 'running' },
    });
    const back = new FakeClient(lobby);
    back.say({
      type: 'hello',
      name: 'Bob',
      token,
      visitorId: 'visitor-bob',
      sessionId: 'session-bob-again',
    });
    expect(analytics.named('reconnect')[0]).toMatchObject({
      visitorId: 'visitor-bob',
      sessionId: 'session-bob-again',
      props: { inRoom: true, roomState: 'running' },
    });
  });

  it('reports a duel for each player: how it began and how it ended for them', () => {
    const a = guest('Ann');
    const b = guest('Bob');
    a.say({ type: 'quickPlay', mode: 'duel' });
    vi.advanceTimersByTime(3000);
    b.say({ type: 'quickPlay', mode: 'duel' });
    const starts = analytics.named('match_start');
    expect(starts.map((e) => e.visitorId).sort()).toEqual(['visitor-ann', 'visitor-bob']);
    expect(starts[0]?.props).toMatchObject({
      players: 2,
      startReason: 'full',
      lobbyMs: 3000,
      belowMinMs: 3000,
    });
    const ann = starts.find((e) => e.visitorId === 'visitor-ann')!;
    const bob = starts.find((e) => e.visitorId === 'visitor-bob')!;
    expect(ann.props?.waitedMs).toBe(3000);
    expect(bob.props?.waitedMs).toBe(0);
    expect(ann.props?.matchId).toBe(bob.props?.matchId);

    vi.advanceTimersByTime(options.prepMs + 2000);
    b.say({ type: 'surrender' });
    const ends = analytics.named('match_end');
    expect(ends).toHaveLength(2);
    expect(ends.find((e) => e.visitorId === 'visitor-ann')?.props).toMatchObject({
      outcome: 'won',
      place: 1,
      players: 2,
      endedBy: 'surrendered',
    });
    expect(ends.find((e) => e.visitorId === 'visitor-bob')?.props).toMatchObject({
      outcome: 'surrendered',
      place: 2,
    });
  });

  it('says why a battle royale began: the wait ran out, or the players voted', () => {
    const lobbyOf = (names: string[]) => {
      const clients = names.map((name) => guest(name));
      clients.forEach((client) => client.say({ type: 'quickPlay', mode: 'ffa' }));
      return clients;
    };
    lobbyOf(['Ann', 'Bob', 'Cy']);
    expect(analytics.named('match_start')).toHaveLength(0);
    vi.advanceTimersByTime(options.earlyStartMs);
    expect(analytics.named('match_start')[0]?.props).toMatchObject({
      startReason: 'timer',
      players: 3,
    });

    const [d, e] = lobbyOf(['Dee', 'Eve', 'Fay']) as [FakeClient, FakeClient];
    d.say({ type: 'voteStart', vote: true });
    e.say({ type: 'voteStart', vote: true });
    vi.advanceTimersByTime(options.voteStartMs);
    const second = analytics.named('match_start').filter((s) => s.props?.startReason === 'vote');
    expect(second).toHaveLength(3);
    expect(analytics.named('vote_start').map((v) => v.props?.vote)).toEqual([true, true]);
  });

  it('counts the time a lobby has too few players, not the time it is waiting with enough', () => {
    const [a, b] = [guest('Ann'), guest('Bob')];
    a.say({ type: 'quickPlay', mode: 'ffa' });
    vi.advanceTimersByTime(4000);
    b.say({ type: 'quickPlay', mode: 'ffa' });
    vi.advanceTimersByTime(6000);
    const c = guest('Cy');
    c.say({ type: 'quickPlay', mode: 'ffa' });
    vi.advanceTimersByTime(options.earlyStartMs);
    expect(analytics.named('match_start')[0]?.props).toMatchObject({
      belowMinMs: 10_000,
      lobbyMs: 30_000,
    });
  });

  it('reports how long a spectator watched, and a player knocked out who then left', () => {
    const ann = guest('Ann');
    ann.say({ type: 'createRoom', settings: { mode: 'ffa' } });
    const code = ann.room!.code;
    const [bob] = ['Bob', 'Cy'].map((name) => {
      const client = guest(name);
      client.say({ type: 'joinRoom', code });
      return client;
    }) as [FakeClient, FakeClient];
    ann.say({ type: 'startGame' });
    expect(analytics.named('match_start')[0]?.props).toMatchObject({ startReason: 'host' });

    const dee = guest('Dee');
    dee.say({ type: 'joinRoom', code });
    expect(analytics.named('spectator_join')[0]).toMatchObject({
      visitorId: 'visitor-dee',
      props: { reason: 'started' },
    });
    vi.advanceTimersByTime(options.prepMs);

    bob.say({ type: 'surrender' });
    vi.advanceTimersByTime(2000);
    bob.say({ type: 'leaveRoom' });
    expect(analytics.named('spectate_end')[0]).toMatchObject({
      visitorId: 'visitor-bob',
      props: { role: 'out', how: 'left', matchOver: false, watchedMs: 2000 },
    });

    vi.advanceTimersByTime(1000);
    dee.say({ type: 'leaveRoom' });
    // Dee came in as the match began: the 3 seconds of planning, then the 3 seconds since.
    const watched = analytics.named('spectate_end').find((e) => e.visitorId === 'visitor-dee');
    expect(watched?.props).toMatchObject({ role: 'spectator', watchedMs: options.prepMs + 3000 });
  });

  it('reports a chat message with its length and channel, never its text', () => {
    const ann = guest('Ann');
    ann.say({ type: 'createRoom' });
    ann.say({ type: 'chat', text: 'secret words' });
    const [message] = analytics.named('chat_message');
    expect(message?.props).toMatchObject({ channel: 'lobby', length: 12 });
    expect(JSON.stringify(analytics.events)).not.toContain('secret');
  });
});

describe('the page reporting events', () => {
  let analytics: Collected;
  let base: string;
  let server: ReturnType<typeof createServer>;

  beforeEach(async () => {
    analytics = new Collected();
    server = createServer(createHttpHandler({ analytics }));
    await new Promise<void>((done) => server.listen(0, done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => {
    server.close();
  });

  const send = (body: unknown) =>
    fetch(`${base}/api/event`, { method: 'POST', body: JSON.stringify(body) });
  const good = { visitorId: 'visitor-abc', sessionId: 'session-abc' };

  it('records what a page reports, for that visitor and page load', async () => {
    const response = await send({
      ...good,
      events: [{ name: 'tutorial_start' }, { name: 'menu_action', props: { action: 'duel' } }],
    });
    expect(response.status).toBe(200);
    expect(analytics.events).toEqual([
      { visitorId: 'visitor-abc', sessionId: 'session-abc', name: 'tutorial_start' },
      {
        visitorId: 'visitor-abc',
        sessionId: 'session-abc',
        name: 'menu_action',
        props: { action: 'duel' },
      },
    ]);
  });

  it('dates each event by how long ago the page says it happened', async () => {
    const before = Date.now();
    await send({
      ...good,
      events: [{ name: 'tutorial_complete', ago: 5000 }, { name: 'menu_action' }],
    });
    const [early, late] = analytics.events;
    expect(early?.at?.getTime()).toBeLessThanOrEqual(before - 4000);
    expect(late?.at).toBeUndefined();
  });

  it('turns away names it does not know, bad ids, and nonsense', async () => {
    expect((await send({ ...good, events: [{ name: 'lobby_join' }] })).status).toBe(400);
    expect((await send({ ...good, events: [{ name: 'made_up' }] })).status).toBe(400);
    expect((await send({ ...good, events: [] })).status).toBe(400);
    expect((await send({ ...good, visitorId: 'x', events: [{ name: 'visit' }] })).status).toBe(400);
    expect(
      (await send({ ...good, events: [{ name: 'visit', props: { a: { nested: 1 } } }] })).status,
    ).toBe(400);
    expect((await fetch(`${base}/api/event`, { method: 'POST', body: '{nope' })).status).toBe(400);
    expect(analytics.events).toEqual([]);
  });

  it('limits how many one address can send', async () => {
    for (let i = 0; i < 120; i++) await send({ ...good, events: [{ name: 'visit' }] });
    expect((await send({ ...good, events: [{ name: 'visit' }] })).status).toBe(429);
  });
});

const testDb = await openTestDb();
afterAll(() => testDb?.drop());

describe.skipIf(!testDb)('the event recorder', () => {
  const event = (name: string, props?: Record<string, string | number | boolean>) =>
    ({ visitorId: 'visitor-abc', sessionId: 'session-abc', name, props }) as AnalyticsEvent;

  beforeEach(async () => {
    await testDb!.db.query('TRUNCATE events');
  });

  it('writes what was recorded to the events table', async () => {
    const recorder = new EventRecorder(testDb!.db);
    recorder.record(event('visit', { returning: true, n: 3 }));
    recorder.record(event('tutorial_start'));
    await recorder.flush();
    const { rows } = await testDb!.db.query(
      'SELECT name, props, internal, visitor_id, session_id FROM events ORDER BY id',
    );
    expect(rows).toEqual([
      {
        name: 'visit',
        props: { returning: true, n: 3 },
        internal: false,
        visitor_id: 'visitor-abc',
        session_id: 'session-abc',
      },
      {
        name: 'tutorial_start',
        props: {},
        internal: false,
        visitor_id: 'visitor-abc',
        session_id: 'session-abc',
      },
    ]);
  });

  it('marks the events of a visitor as internal', async () => {
    const recorder = new EventRecorder(testDb!.db);
    recorder.markInternal('visitor-abc', true);
    recorder.record(event('visit'));
    await recorder.flush();
    const { rows } = await testDb!.db.query('SELECT internal FROM events');
    expect(rows).toEqual([{ internal: true }]);
  });

  it('writes by itself once enough are waiting, and when it is stopped', async () => {
    const recorder = new EventRecorder(testDb!.db, { batchSize: 3 });
    for (let i = 0; i < 3; i++) recorder.record(event('visit'));
    await recorder.flush();
    recorder.record(event('visit'));
    await recorder.stop();
    const { rows } = await testDb!.db.query('SELECT count(*)::int AS n FROM events');
    expect(rows[0]).toEqual({ n: 4 });
  });

  it('loses events instead of failing when the database is gone', async () => {
    const broken = new EventRecorder({
      query: () => Promise.reject(new Error('down')),
    } as never);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    broken.record(event('visit'));
    await expect(broken.flush()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('keeps only the newest when more are waiting than it holds', async () => {
    const recorder = new EventRecorder(testDb!.db, { batchSize: 1000, maxPending: 2 });
    for (let i = 0; i < 5; i++) recorder.record(event('visit', { i }));
    await recorder.flush();
    const { rows } = await testDb!.db.query("SELECT props->>'i' AS i FROM events ORDER BY id");
    expect(rows.map((r) => r.i)).toEqual(['3', '4']);
  });
});
