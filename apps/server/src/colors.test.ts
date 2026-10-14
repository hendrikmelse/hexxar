import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Lobby } from './lobby.js';
import { FakeClient, options } from './test-helpers.js';

describe('player colors', () => {
  let lobby: Lobby;

  beforeEach(() => {
    vi.useFakeTimers();
    lobby = new Lobby(options);
  });

  afterEach(() => {
    lobby.stop();
    vi.useRealTimers();
  });

  /** A private battle royale with the host and these guests, all in the lobby. */
  function royale(...names: string[]) {
    const host = new FakeClient(lobby).hello('Host');
    host.say({ type: 'createRoom', settings: { mode: 'ffa' } });
    const guests = names.map((name) => {
      const client = new FakeClient(lobby).hello(name);
      client.say({ type: 'joinRoom', code: host.room!.code });
      return client;
    });
    return { host, guests };
  }

  /** The color each player has in the room, by name. */
  const colorsOf = (client: FakeClient): Record<string, number | null> =>
    Object.fromEntries(client.room!.players.map((p) => [p.name, p.color]));

  it('gives each player the lowest free color as they join', () => {
    const { host } = royale('Ann', 'Bob');
    expect(colorsOf(host)).toEqual({ Host: 0, Ann: 1, Bob: 2 });
  });

  it('frees the color of someone who leaves, without changing anyone else', () => {
    const { host, guests } = royale('Ann', 'Bob');
    guests[0]!.say({ type: 'leaveRoom' });
    expect(colorsOf(host)).toEqual({ Host: 0, Bob: 2 });
    const cy = new FakeClient(lobby).hello('Cy');
    cy.say({ type: 'joinRoom', code: host.room!.code });
    expect(colorsOf(host)).toEqual({ Host: 0, Bob: 2, Cy: 1 });
  });

  it('keeps the color of a spectator for when they come back', () => {
    const { host, guests } = royale('Ann', 'Bob');
    const [ann] = guests as [FakeClient, FakeClient];
    ann.say({ type: 'becomeSpectator' });
    expect(colorsOf(host)).toEqual({ Host: 0, Bob: 2 });
    // A newcomer does not get the reserved color while others are free.
    const cy = new FakeClient(lobby).hello('Cy');
    cy.say({ type: 'joinRoom', code: host.room!.code });
    expect(colorsOf(host)).toEqual({ Host: 0, Bob: 2, Cy: 3 });
    ann.say({ type: 'becomePlayer' });
    expect(colorsOf(host)).toEqual({ Host: 0, Ann: 1, Bob: 2, Cy: 3 });
  });

  it("hands out a spectator's color only when every other color is taken", () => {
    const names = Array.from({ length: 11 }, (_, i) => `P${i + 1}`);
    const { host, guests } = royale(...names);
    // Twelve players, so colors 0 to 11 are all in use. P6 has color 6.
    expect(colorsOf(host).P6).toBe(6);
    guests[5]!.say({ type: 'becomeSpectator' });
    const late = new FakeClient(lobby).hello('Late');
    late.say({ type: 'joinRoom', code: host.room!.code });
    expect(colorsOf(host).Late).toBe(6);
    // The spectator lost the reservation: they take whichever color is free when they return.
    guests[0]!.say({ type: 'leaveRoom' });
    guests[5]!.say({ type: 'becomePlayer' });
    expect(colorsOf(host).P6).toBe(1);
  });

  it('is the color the player has in the match', () => {
    const { host, guests } = royale('Ann', 'Bob');
    const lobbyColors = colorsOf(host);
    host.say({ type: 'startGame' });
    const snapshot = guests[0]!.last('snapshot');
    for (const player of host.room!.players) {
      expect(snapshot.colors?.[player.playerId!]).toBe(lobbyColors[player.name]);
    }
  });

  it('is on chat messages, and spectators have none', () => {
    const { host, guests } = royale('Ann');
    host.say({ type: 'chat', text: 'hi' });
    expect(guests[0]!.last('chat').messages[0]).toMatchObject({ name: 'Host', color: 0 });
    guests[0]!.say({ type: 'becomeSpectator' });
    vi.advanceTimersByTime(1000);
    guests[0]!.say({ type: 'chat', text: 'hello' });
    expect(host.last('chat').messages[0]).toMatchObject({ name: 'Ann', color: null });
  });

  it('stays with a player who is knocked out, who then chats with the spectators', () => {
    const { host, guests } = royale('Ann', 'Bob', 'Cy');
    const [ann, bob, cy] = guests as [FakeClient, FakeClient, FakeClient];
    const watcher = new FakeClient(lobby).hello('Watcher');
    watcher.say({ type: 'joinRoom', code: host.room!.code });
    // Ann has color 1; the watcher is a player here (the room is not full), so step out.
    watcher.say({ type: 'becomeSpectator' });
    host.say({ type: 'startGame' });
    expect(ann.room?.canChat).toBe(false);
    ann.say({ type: 'surrender' });
    expect(ann.room).toMatchObject({ state: 'running', canChat: true });
    vi.advanceTimersByTime(1000);
    ann.say({ type: 'chat', text: 'I am out' });
    // The watcher sees it in Ann's color; the players still in the match do not.
    expect(watcher.last('chat').messages[0]).toMatchObject({ name: 'Ann', color: 1 });
    expect(host.all('chat').flatMap((m) => m.messages.map((x) => x.text))).not.toContain(
      'I am out',
    );
    expect(bob.room?.canChat).toBe(false);
    expect(cy.room?.canChat).toBe(false);
    // A real spectator has no color.
    vi.advanceTimersByTime(1000);
    watcher.say({ type: 'chat', text: 'hello' });
    expect(ann.last('chat').messages[0]).toMatchObject({ name: 'Watcher', color: null });
  });
});
