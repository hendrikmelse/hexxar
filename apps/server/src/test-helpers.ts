import { DEFAULT_TICK_MS, serverMessageSchema, type ServerMessage } from '@hexxar/shared';
import type { Lobby } from './lobby.js';
import type { Connection, ConnectionHandler } from './types.js';

/** A connected browser, as the lobby sees it, that records everything it is sent. */
export class FakeClient implements Connection {
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

/** How long a tick lasts in a game with the default settings. */
export const TICK_MS = DEFAULT_TICK_MS;

/** Lobby settings for tests: short, round numbers. */
export const options = {
  prepMs: 3000,
  earlyStartMs: 20_000,
  joinWaitMs: 5000,
  fullWaitMs: 0,
  voteStartMs: 5000,
  statsMs: 0,
  afkMs: 120_000,
  finishedLingerMs: 60_000,
};
