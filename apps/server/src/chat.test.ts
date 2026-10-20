import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Lobby } from './lobby.js';
import { FakeClient, options } from './test-helpers.js';

describe('chat', () => {
  let lobby: Lobby;

  beforeEach(() => {
    vi.useFakeTimers();
    lobby = new Lobby(options);
  });

  afterEach(() => {
    lobby.stop();
    vi.useRealTimers();
  });

  /** A private duel: Ann (host) and Bob play, Cy and Dee are watching. Still in the lobby. */
  function privateRoom() {
    const ann = new FakeClient(lobby).hello('Ann');
    ann.say({ type: 'createRoom' });
    const code = ann.room!.code;
    const [bob, cy, dee] = ['Bob', 'Cy', 'Dee'].map((name) => {
      const client = new FakeClient(lobby).hello(name);
      client.say({ type: 'joinRoom', code });
      return client;
    }) as [FakeClient, FakeClient, FakeClient];
    return { ann, bob, cy, dee };
  }

  /** What a guest can read right now: the last full log, plus whatever was added after it. */
  function readable(client: FakeClient): string[] {
    const texts: string[] = [];
    for (const message of client.all('chat')) {
      if (message.replace) texts.length = 0;
      texts.push(...message.messages.map((m) => m.text));
    }
    return texts;
  }

  /** Advance the clock past the limit on how fast one person may chat. */
  const wait = () => vi.advanceTimersByTime(1000);

  describe('in the lobby', () => {
    it('is read by everyone in the room, spectators included', () => {
      const { ann, bob, cy } = privateRoom();
      expect(cy.room).toMatchObject({ spectating: true, canChat: true });
      ann.say({ type: 'chat', text: 'hello all' });
      wait();
      cy.say({ type: 'chat', text: 'hi from the sidelines' });
      for (const client of [ann, bob, cy]) {
        expect(readable(client)).toEqual(['hello all', 'hi from the sidelines']);
      }
      expect(ann.last('chat').messages[0]).toMatchObject({ name: 'Cy', userId: cy.room!.you });
    });

    it('is not shown to people outside the room', () => {
      const { ann } = privateRoom();
      const outsider = new FakeClient(lobby).hello('Zed');
      ann.say({ type: 'chat', text: 'secret plans' });
      expect(outsider.all('chat')).toEqual([]);
    });

    it('is caught up on by someone who arrives later', () => {
      const { ann, bob } = privateRoom();
      ann.say({ type: 'chat', text: 'first' });
      wait();
      bob.say({ type: 'chat', text: 'second' });
      const late = new FakeClient(lobby).hello('Late');
      late.say({ type: 'joinRoom', code: ann.room!.code });
      expect(readable(late)).toEqual(['first', 'second']);
    });

    it('works in public lobbies too', () => {
      const a = new FakeClient(lobby).hello('Ann');
      a.say({ type: 'quickPlay', mode: 'ffa' });
      const b = new FakeClient(lobby).hello('Bob');
      b.say({ type: 'quickPlay', mode: 'ffa' });
      a.say({ type: 'chat', text: 'anyone here?' });
      expect(readable(b)).toEqual(['anyone here?']);
    });
  });

  describe('rules', () => {
    it('tidies the text and refuses empty messages', () => {
      const { ann, bob } = privateRoom();
      ann.say({ type: 'chat', text: '  line\none\u0007  ' });
      expect(readable(bob)).toEqual(['line one']);
      wait();
      ann.say({ type: 'chat', text: '   ' });
      expect(readable(bob)).toEqual(['line one']);
      expect(ann.all('rejected')).toEqual([]);
    });

    it('refuses messages that are too long', () => {
      const { ann, bob } = privateRoom();
      ann.say({ type: 'chat', text: 'x'.repeat(201) });
      expect(ann.last('rejected').reason).toMatch(/invalid/);
      expect(readable(bob)).toEqual([]);
    });

    it('slows down someone who floods the chat', () => {
      const { ann, bob } = privateRoom();
      ann.say({ type: 'chat', text: 'one' });
      ann.say({ type: 'chat', text: 'two' });
      expect(ann.last('rejected').reason).toMatch(/too fast/);
      wait();
      ann.say({ type: 'chat', text: 'three' });
      expect(readable(bob)).toEqual(['one', 'three']);
    });

    it('keeps only the latest messages', () => {
      const { ann, bob } = privateRoom();
      for (let i = 1; i <= 60; i++) {
        ann.say({ type: 'chat', text: `m${i}` });
        wait();
      }
      const late = new FakeClient(lobby).hello('Late');
      late.say({ type: 'joinRoom', code: bob.room!.code });
      const log = readable(late);
      expect(log).toHaveLength(50);
      expect(log[0]).toBe('m11');
      expect(log[49]).toBe('m60');
    });

    it('is not possible in the menu', () => {
      const lonely = new FakeClient(lobby).hello('Lonely');
      lonely.say({ type: 'chat', text: 'hello?' });
      expect(lonely.last('rejected').reason).toMatch(/not in a game/);
    });
  });

  describe('during a match', () => {
    function startedRoom() {
      const room = privateRoom();
      room.ann.say({ type: 'chat', text: 'lobby talk' });
      room.ann.say({ type: 'startGame' });
      return room;
    }

    it('is closed to the players, who are told they have no chat', () => {
      const { ann, bob } = startedRoom();
      expect(ann.room).toMatchObject({ state: 'running', canChat: false });
      bob.say({ type: 'chat', text: 'psst' });
      expect(bob.last('rejected').reason).toMatch(/cannot chat/);
      // Their lobby chat is taken away from them, too.
      expect(readable(ann)).toEqual([]);
    });

    it('is open to the spectators, among themselves, carrying on from the lobby talk', () => {
      const { cy, dee } = startedRoom();
      expect(cy.room).toMatchObject({ state: 'running', spectating: true, canChat: true });
      expect(readable(cy)).toEqual(['lobby talk']);
      cy.say({ type: 'chat', text: 'who will win?' });
      expect(readable(dee)).toEqual(['lobby talk', 'who will win?']);
    });

    it('never reaches the players', () => {
      const { ann, bob, cy } = startedRoom();
      const before = [ann.all('chat').length, bob.all('chat').length];
      cy.say({ type: 'chat', text: 'ann is going left' });
      expect([ann.all('chat').length, bob.all('chat').length]).toEqual(before);
      expect(readable(ann)).toEqual([]);
      expect(readable(bob)).toEqual([]);
    });

    it('is caught up on by a spectator who joins mid-match, and what the lobby said', () => {
      const { cy, ann } = startedRoom();
      cy.say({ type: 'chat', text: 'spectator talk' });
      const late = new FakeClient(lobby).hello('Late');
      late.say({ type: 'joinRoom', code: ann.room!.code });
      expect(late.room).toMatchObject({ spectating: true, canChat: true });
      expect(readable(late)).toEqual(['lobby talk', 'spectator talk']);
    });

    it('is open to everyone when the match is over, and goes on in the next lobby', () => {
      const { ann, bob, cy } = startedRoom();
      cy.say({ type: 'chat', text: 'spectator talk' });
      bob.say({ type: 'surrender' });
      // Nothing is left to keep from the players: the winner and the loser read it, and write in it.
      for (const client of [ann, bob, cy]) {
        expect(client.room).toMatchObject({ state: 'finished', canChat: true });
      }
      const texts = readable(ann);
      expect(texts).toEqual(['lobby talk', 'spectator talk', 'surrendered', 'won the match']);
      wait();
      ann.say({ type: 'chat', text: 'good game' });
      expect(readable(cy).at(-1)).toBe('good game');
      expect(readable(bob).at(-1)).toBe('good game');
      ann.say({ type: 'returnToRoom' });
      cy.say({ type: 'returnToRoom' });
      expect(cy.room).toMatchObject({ state: 'lobby', canChat: true });
      expect(readable(cy)).toEqual([...texts, 'good game']);
      wait();
      ann.say({ type: 'chat', text: 'round two' });
      expect(readable(cy).at(-1)).toBe('round two');
    });
  });
});
