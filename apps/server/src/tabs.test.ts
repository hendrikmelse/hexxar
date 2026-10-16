import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sweep, type Pingable } from './heartbeat.js';
import { Lobby } from './lobby.js';
import { MAX_CONNECTIONS } from './types.js';
import { FakeClient, options } from './test-helpers.js';

describe('Tabs of one guest', () => {
  let lobby: Lobby;

  beforeEach(() => {
    vi.useFakeTimers();
    lobby = new Lobby(options);
  });

  afterEach(() => {
    lobby.stop();
    vi.useRealTimers();
  });

  /** One guest with two tabs open, in a duel against Bob that has begun. */
  function twoTabsInADuel() {
    const tab1 = new FakeClient(lobby).hello('Ann');
    const tab2 = new FakeClient(lobby).hello('Ann', tab1.token);
    const bob = new FakeClient(lobby).hello('Bob');
    tab1.say({ type: 'quickPlay', mode: 'duel' });
    bob.say({ type: 'quickPlay', mode: 'duel' });
    return { tab1, tab2, bob };
  }

  const move = { type: 'move', from: { q: 0, r: 0 }, to: { q: 1, r: 0 } } as const;

  it('are one guest: both tabs see the room the other opened', () => {
    const tab1 = new FakeClient(lobby).hello('Ann');
    const tab2 = new FakeClient(lobby).hello('Ann', tab1.token);
    tab1.say({ type: 'createRoom' });
    expect(tab1.room?.code).toBeDefined();
    expect(tab2.room?.code).toBe(tab1.room?.code);
    // One player in the room, not two.
    expect(tab1.room?.players).toHaveLength(1);
  });

  it('a tab opened later is shown the game that is already on', () => {
    const { tab1, bob } = twoTabsInADuel();
    expect(bob.room?.state).toBe('running');
    const late = new FakeClient(lobby).hello('Ann', tab1.token);
    expect(late.room?.state).toBe('running');
    expect(late.last('snapshot').you).toBe(tab1.last('snapshot').you);
  });

  it('orders from either tab go into the same queue, and both tabs are told', () => {
    const { tab1, tab2 } = twoTabsInADuel();
    tab1.say({ type: 'order', order: move });
    tab2.say({ type: 'order', order: { ...move, to: { q: 0, r: 1 } } });
    // Each order was confirmed to both tabs.
    expect(tab1.all('queued')).toHaveLength(2);
    expect(tab2.all('queued')).toHaveLength(2);
    // And they run one per tick, in the order given.
    vi.advanceTimersByTime(options.prepMs + 100);
    expect(tab1.last('tick').queueLength).toBe(1);
    expect(tab2.last('tick').queueLength).toBe(1);
  });

  it('a refusal goes only to the tab that asked', () => {
    const { tab1, tab2 } = twoTabsInADuel();
    tab1.say({ type: 'order', order: { type: 'fly' } });
    expect(tab1.all('rejected').length).toBeGreaterThan(0);
    expect(tab2.all('rejected')).toHaveLength(0);
  });

  it('closing one tab does not take the guest away', () => {
    const { tab1, tab2, bob } = twoTabsInADuel();
    tab1.disconnect();
    expect(bob.room?.players.every((p) => p.connected)).toBe(true);
    // Their army is not left to surrender: the other tab is still here.
    vi.advanceTimersByTime(options.afkMs + 1000);
    expect(bob.room?.state).toBe('running');
    expect(tab2.room?.state).toBe('running');
    // The remaining tab can still give orders.
    tab2.say({ type: 'order', order: move });
    expect(tab2.all('queued')).toHaveLength(1);
  });

  it('closing the last tab starts the clock on the guest, as before', () => {
    const { tab1, tab2, bob } = twoTabsInADuel();
    tab1.disconnect();
    tab2.disconnect();
    expect(bob.room?.players.some((p) => !p.connected)).toBe(true);
    vi.advanceTimersByTime(options.afkMs + 1000);
    expect(bob.room?.state).toBe('finished');
  });

  it('leaving in one tab takes the guest out of the room in all of them', () => {
    const tab1 = new FakeClient(lobby).hello('Ann');
    const tab2 = new FakeClient(lobby).hello('Ann', tab1.token);
    tab1.say({ type: 'createRoom' });
    tab1.say({ type: 'leaveRoom' });
    expect(tab1.room).toBeNull();
    expect(tab2.room).toBeNull();
  });

  it('counts as one guest online', () => {
    const tab1 = new FakeClient(lobby).hello('Ann');
    new FakeClient(lobby).hello('Ann', tab1.token);
    expect(lobby.adminStats().connected).toBe(1);
  });

  it('allows only so many tabs', () => {
    const first = new FakeClient(lobby).hello('Ann');
    for (let i = 1; i < MAX_CONNECTIONS; i++) new FakeClient(lobby).hello('Ann', first.token);
    const extra = new FakeClient(lobby).hello('Ann', first.token);
    expect(extra.last('rejected').reason).toMatch(/too many tabs/);
    expect(extra.closed).toBe(true);
  });
});

describe('Heartbeat', () => {
  const socket = (alive: boolean): Pingable & { pings: number; terminated: boolean } => {
    const s = {
      alive,
      pings: 0,
      terminated: false,
      ping() {
        s.pings++;
      },
      terminate() {
        s.terminated = true;
      },
    };
    return s;
  };

  it('pings the sockets that answered, and expects an answer by the next round', () => {
    const a = socket(true);
    expect(sweep([a])).toBe(0);
    expect(a.pings).toBe(1);
    expect(a.alive).toBe(false);
    // It answers (a pong sets alive again): spared next time.
    a.alive = true;
    expect(sweep([a])).toBe(0);
    expect(a.terminated).toBe(false);
  });

  it('drops the sockets that did not answer', () => {
    const quiet = socket(true);
    const lively = socket(true);
    sweep([quiet, lively]);
    lively.alive = true;
    expect(sweep([quiet, lively])).toBe(1);
    expect(quiet.terminated).toBe(true);
    expect(lively.terminated).toBe(false);
  });

  it('drops a socket that cannot even be pinged', () => {
    const broken = socket(true);
    broken.ping = () => {
      throw new Error('not open');
    };
    expect(sweep([broken])).toBe(1);
    expect(broken.terminated).toBe(true);
  });
});
