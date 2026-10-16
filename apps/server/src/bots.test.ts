import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Lobby } from './lobby.js';
import { FakeClient, TICK_MS, options } from './test-helpers.js';

describe('Bots', () => {
  let lobby: Lobby;

  beforeEach(() => {
    vi.useFakeTimers();
    lobby = new Lobby(options);
  });

  afterEach(() => {
    lobby.stop();
    vi.useRealTimers();
  });

  /** A host who has opened a private game with some bots. */
  function hostWithBots(settings: Record<string, unknown>) {
    const host = new FakeClient(lobby).hello('Hanna');
    host.say({ type: 'createRoom', settings });
    return host;
  }

  it('fills a private duel with a labelled bot, and the host can start it', () => {
    const host = hostWithBots({ mode: 'duel', bots: 1 });
    const room = host.room!;
    expect(room.settings.bots).toBe(1);
    expect(room.players.map((p) => [p.name, p.bot])).toEqual([
      ['Hanna', false],
      [expect.stringMatching(/^[A-Z][a-z]+$/), true],
    ]);
    host.say({ type: 'startGame' });
    expect(host.room).toMatchObject({ state: 'running' });
  });

  it('gives every bot in a battle royale its own name and color', () => {
    const host = hostWithBots({ mode: 'ffa', bots: 5 });
    const { players } = host.room!;
    expect(players).toHaveLength(6);
    expect(players.filter((p) => p.bot)).toHaveLength(5);
    expect(new Set(players.map((p) => p.name)).size).toBe(6);
    expect(new Set(players.map((p) => p.color)).size).toBe(6);
    // Three players are enough for a battle royale, so a bot or two is a game.
    host.say({ type: 'startGame' });
    expect(host.room).toMatchObject({ state: 'running' });
  });

  it('never fills every place: there is always room for a person', () => {
    const duel = hostWithBots({ mode: 'duel', bots: 5 });
    expect(duel.room!.settings.bots).toBe(1);
    expect(duel.room!.players).toHaveLength(2);
  });

  it('lets the host change the number of bots, and the mode, in the lobby', () => {
    const host = hostWithBots({ mode: 'ffa', bots: 2 });
    expect(host.room!.players).toHaveLength(3);
    host.say({ type: 'updateRoom', settings: { bots: 4 } });
    expect(host.room!.players).toHaveLength(5);
    host.say({ type: 'updateRoom', settings: { bots: 0 } });
    expect(host.room!.players).toHaveLength(1);
    host.say({ type: 'updateRoom', settings: { bots: 3 } });
    // A duel only has the one place left.
    host.say({ type: 'updateRoom', settings: { mode: 'duel' } });
    expect(host.room!.players).toHaveLength(2);
    expect(host.room!.settings.bots).toBe(1);
  });

  it('has no bots in public games, and no way to add them', () => {
    const ann = new FakeClient(lobby).hello('Ann');
    ann.say({ type: 'quickPlay', mode: 'ffa' });
    expect(ann.room!.settings.bots).toBe(0);
    ann.say({ type: 'updateRoom', settings: { bots: 2 } });
    expect(ann.last('rejected').reason).toMatch(/fixed settings/);
    expect(ann.room!.players).toHaveLength(1);
  });

  it('gives a person who joins a full room the place of a bot', () => {
    const host = hostWithBots({ mode: 'duel', bots: 1 });
    const guest = new FakeClient(lobby).hello('Gus');
    guest.say({ type: 'joinRoom', code: host.room!.code });
    expect(guest.room!.spectating).toBe(false);
    expect(host.room!.players.map((p) => p.name)).toEqual(['Hanna', 'Gus']);
    expect(host.room!.settings.bots).toBe(0);
    // And the bot does not come back when the person goes.
    guest.say({ type: 'leaveRoom' });
    expect(host.room!.players).toHaveLength(1);
  });

  it('keeps the bots when the host starts a battle royale with fewer than twelve', () => {
    const host = hostWithBots({ mode: 'ffa', bots: 3 });
    const guest = new FakeClient(lobby).hello('Gus');
    guest.say({ type: 'joinRoom', code: host.room!.code });
    expect(host.room!.players).toHaveLength(5);
    expect(host.room!.settings.bots).toBe(3);
  });

  it('plays: the bot queues orders and takes territory', () => {
    const host = hostWithBots({ mode: 'duel', bots: 1 });
    host.say({ type: 'startGame' });
    const bot = host.last('snapshot').state.players.find((id) => id !== host.last('snapshot').you)!;
    const tilesOf = () => host.last('tick').scores.find((s) => s.player === bot)!.tiles;

    vi.advanceTimersByTime(options.prepMs + 40 * TICK_MS);
    expect(host.last('tick').tick).toBeGreaterThanOrEqual(30);
    expect(tilesOf()).toBeGreaterThan(2);
  });

  it('is told nothing, and a person who is out sees its orders', () => {
    const host = hostWithBots({ mode: 'ffa', bots: 3 });
    host.say({ type: 'startGame' });
    vi.advanceTimersByTime(options.prepMs + 5 * TICK_MS);
    host.say({ type: 'surrender' });
    const before = host.all('queued').length;
    vi.advanceTimersByTime(30 * TICK_MS);
    const later = host.all('queued').slice(before);
    expect(later.length).toBeGreaterThan(0);
    expect(later.every((message) => message.player !== undefined)).toBe(true);
  });

  it('finishes when the last person gives up and one bot is left standing', () => {
    const host = hostWithBots({ mode: 'duel', bots: 1 });
    host.say({ type: 'startGame' });
    vi.advanceTimersByTime(options.prepMs + 3 * TICK_MS);
    host.say({ type: 'surrender' });
    expect(host.room).toMatchObject({ state: 'finished' });
    // The bot has nothing to review, so going back to the room works and keeps it there.
    host.say({ type: 'returnToRoom' });
    expect(host.room).toMatchObject({ state: 'lobby' });
    expect(host.room!.players.map((p) => p.bot)).toEqual([false, true]);
    host.say({ type: 'startGame' });
    expect(host.room).toMatchObject({ state: 'running' });
  });

  it('closes the room when the last person leaves', () => {
    const host = hostWithBots({ mode: 'duel', bots: 1 });
    host.say({ type: 'startGame' });
    vi.advanceTimersByTime(options.prepMs + 3 * TICK_MS);
    expect(lobby.adminStats().rooms).toHaveLength(1);
    host.say({ type: 'leaveRoom' });
    expect(lobby.adminStats().rooms).toHaveLength(0);
  });

  it('does not count the bots as players on the admin panel', () => {
    hostWithBots({ mode: 'ffa', bots: 4 });
    expect(lobby.adminStats().rooms[0]).toMatchObject({ players: 1, names: ['Hanna'] });
  });
});
