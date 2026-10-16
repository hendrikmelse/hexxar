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

/** The most tabs one guest may have open at once. */
export const MAX_CONNECTIONS = 6;

/**
 * A guest. Survives reconnects (the token is the credential) for as long as it is in a
 * room. Accounts will replace the token later. All the tabs of one browser share the token, so
 * they are one guest, and each is one of its connections: what the guest is told goes to all of
 * them, and what any of them says counts as the guest saying it.
 */
export interface Session {
  readonly userId: string;
  readonly token: string;
  name: string;
  /** The guest's open connections, one per tab. Empty while the guest is away. */
  readonly connections: Set<Connection>;
  room: Room | null;
  /** Which browser and which page load this guest is, for analytics (unknown for an old page). */
  visitorId?: string;
  sessionId?: string;
  /** The numbers last sent to this guest's menu, so they are sent again once they differ. */
  statsSent?: string;
}

/** Is the guest here, on at least one connection? */
export const isConnected = (session: Session): boolean => session.connections.size > 0;

/** Tell the guest something, on every connection they have open. */
export function sendTo(session: Session, message: ServerMessage): void {
  for (const connection of session.connections) connection.send(message);
}
