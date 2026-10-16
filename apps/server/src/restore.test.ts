import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Lobby } from './lobby.js';
import { SNAPSHOT_MAX_AGE_MS, takeSnapshot, writeSnapshot } from './snapshot.js';
import { FakeClient, TICK_MS, options } from './test-helpers.js';

const RESUME_MS = 4000;

describe('resuming matches after a restart', () => {
  let old: Lobby;
  let next: Lobby;
  let dir: string;
  let file: string;

  beforeEach(() => {
    vi.useFakeTimers();
    old = new Lobby(options);
    next = new Lobby({ ...options, resumeMs: RESUME_MS });
    dir = mkdtempSync(join(tmpdir(), 'hexxar-state-'));
    file = join(dir, 'state.json');
  });

  afterEach(() => {
    old.stop();
    next.stop();
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  /** Two guests in a running duel on the old server. */
  function runningDuel() {
    const a = new FakeClient(old).hello('Ann');
    const b = new FakeClient(old).hello('Bob');
    a.say({ type: 'quickPlay', mode: 'duel' });
    b.say({ type: 'quickPlay', mode: 'duel' });
    return { a, b };
  }

  /** The server stops (writing the file) and a new one starts and reads it, `downMs` later. */
  function restart(downMs: number): number {
    writeSnapshot(file, old.snapshot());
    old.stop();
    vi.advanceTimersByTime(downMs);
    const saved = takeSnapshot(file);
    return saved ? next.restore(saved) : -1;
  }

  /** A browser that comes back to the new server with the token it had. */
  const reconnect = (client: FakeClient, name: string) =>
    new FakeClient(next).hello(name, client.token);

  it('puts players back in the same match when they reconnect', () => {
    const { a, b } = runningDuel();
    vi.advanceTimersByTime(options.prepMs + 3 * TICK_MS);
    const before = a.last('tick');
    const code = a.room!.code;

    expect(restart(2000)).toBe(1);
    const a2 = reconnect(a, 'Ann');
    const b2 = reconnect(b, 'Bob');

    expect(a2.room).toMatchObject({ code, state: 'running' });
    expect(a2.last('welcome').userId).toBe(a.last('welcome').userId);
    const after = a2.last('snapshot');
    expect(after.matchId).toBe(a.last('snapshot').matchId);
    expect(after.you).toBe(a.last('snapshot').you);
    expect(after.state.tick).toBe(before.tick);
    expect(b2.last('snapshot').you).toBe(b.last('snapshot').you);
  });

  it('keeps queued orders and plays them on the next ticks', () => {
    const { a } = runningDuel();
    const snap = a.last('snapshot');
    const home = Object.values(snap.state.tiles).find((t) => t.owner === snap.you)!;
    const target = [
      { q: home.q + 1, r: home.r },
      { q: home.q - 1, r: home.r },
    ].find((h) => snap.state.tiles[`${h.q},${h.r}`])!;
    a.say({ type: 'order', order: { type: 'move', from: home, to: target } });

    restart(1000);
    const a2 = reconnect(a, 'Ann');
    expect(a2.last('snapshot').queue).toHaveLength(1);
    vi.advanceTimersByTime(RESUME_MS);
    expect(a2.last('tick')).toMatchObject({ tick: 1, queueLength: 0 });
  });

  it('resumes after a countdown, not a burst of ticks to catch up', () => {
    const { a } = runningDuel();
    vi.advanceTimersByTime(options.prepMs + 3 * TICK_MS + 400);
    const tick = a.last('tick').tick;

    restart(20_000);
    const a2 = reconnect(a, 'Ann');
    const resume = a2.last('snapshot');
    // The snapshot says it is a resume, and its countdown is the grace period from the restart.
    expect(resume.resuming).toBe(true);
    expect(resume.nextTickAt! - Date.now()).toBe(RESUME_MS);
    expect(a2.all('tick')).toHaveLength(0);
    vi.advanceTimersByTime(RESUME_MS - 1);
    expect(a2.all('tick')).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(a2.last('tick').tick).toBe(tick + 1);
    expect(a2.all('tick')).toHaveLength(1);
    // Once play is back, a fresh snapshot is no longer a resume.
    expect(reconnect(a, 'Ann').last('snapshot').resuming).toBeUndefined();
  });

  it('keeps a longer wait than the grace period, such as the planning time before the first tick', () => {
    old.stop();
    old = new Lobby({ ...options, prepMs: 10_000 });
    const { a } = runningDuel();
    vi.advanceTimersByTime(100);
    restart(1000);
    const a2 = reconnect(a, 'Ann');
    expect(a2.last('snapshot').nextTickAt! - Date.now()).toBe(9900);
  });

  it('tells everyone connected that the server is restarting', () => {
    const { a, b } = runningDuel();
    const idle = new FakeClient(old).hello('Cy');
    old.announceRestart(12_000);
    for (const client of [a, b, idle]) {
      expect(client.last('restarting')).toEqual({ type: 'restarting', estimateMs: 12_000 });
    }
  });

  it('lets players who do not come back surrender after the usual time', () => {
    const { a } = runningDuel();
    restart(1000);
    const a2 = reconnect(a, 'Ann');
    expect(a2.room?.state).toBe('running');
    // Bob never returns.
    vi.advanceTimersByTime(options.afkMs + 1);
    expect(a2.room?.state).toBe('finished');
    expect(a2.last('snapshot').state.winner).toBe(a.last('snapshot').you);
  });

  it('brings back the bots in a match with the person playing against them', () => {
    const host = new FakeClient(old).hello('Hanna');
    host.say({ type: 'createRoom', settings: { mode: 'ffa', bots: 3 } });
    host.say({ type: 'startGame' });
    vi.advanceTimersByTime(options.prepMs + 5 * TICK_MS);
    const before = host.room!.players;
    expect(before.filter((p) => p.bot)).toHaveLength(3);

    expect(restart(2000)).toBe(1);
    const host2 = reconnect(host, 'Hanna');
    expect(host2.room?.state).toBe('running');
    expect(host2.room!.players.map((p) => [p.name, p.bot, p.playerId])).toEqual(
      before.map((p) => [p.name, p.bot, p.playerId]),
    );
    // The bots carry on playing once the countdown is over.
    const ticks = host2.all('tick').length;
    vi.advanceTimersByTime(RESUME_MS + 10 * TICK_MS);
    expect(host2.all('tick').length).toBeGreaterThan(ticks);
    expect(host2.room?.state).toBe('running');
  });

  it('does not bring back lobbies, and sends their players to the menu', () => {
    const a = new FakeClient(old).hello('Ann');
    a.say({ type: 'quickPlay', mode: 'duel' });
    expect(a.room?.state).toBe('lobby');
    writeSnapshot(file, old.snapshot());
    expect(existsSync(file)).toBe(false);
    const a2 = reconnect(a, 'Ann');
    expect(a2.room).toBeNull();
  });

  it('uses a file once, and not when it is stale or unreadable', () => {
    runningDuel();
    writeSnapshot(file, old.snapshot());
    expect(takeSnapshot(file)).not.toBeNull();
    expect(existsSync(file)).toBe(false);

    writeSnapshot(file, old.snapshot());
    vi.advanceTimersByTime(SNAPSHOT_MAX_AGE_MS + 1);
    expect(takeSnapshot(file)).toBeNull();
    expect(existsSync(file)).toBe(false);

    expect(takeSnapshot(join(dir, 'missing.json'))).toBeNull();
  });

  it('is not taken down by a room it cannot restore', () => {
    runningDuel();
    runningDuel();
    const saved = old.snapshot();
    expect(saved.rooms).toHaveLength(2);
    const broken = { ...saved, rooms: [{ ...saved.rooms[0]!, match: null }, saved.rooms[1]!] };
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(next.restore(JSON.parse(JSON.stringify(broken)))).toBe(1);
    expect(next.adminStats().rooms).toHaveLength(1);
    error.mockRestore();
  });
});
