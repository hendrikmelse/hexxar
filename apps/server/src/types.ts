import type { ServerMessage } from '@hexxar/shared';
import type { Room } from './room.js';

/** The transport-facing side of a client connection. */
export interface Connection {
  send(message: ServerMessage): void;
  close(): void;
}

export interface ConnectionHandler {
  onMessage(raw: unknown): void;
  onClose(): void;
}

/**
 * A guest. Survives reconnects (the token is the credential) for as long as it is in a
 * room. Accounts will replace the token later.
 */
export interface Session {
  readonly userId: string;
  readonly token: string;
  name: string;
  /** `null` while the guest's connection is down. */
  connection: Connection | null;
  room: Room | null;
}
