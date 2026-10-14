import type { RoomMode, RoomState } from './protocol.js';

/** One open game, as the admin panel shows it. */
export interface AdminRoom {
  readonly code: string;
  readonly visibility: 'public' | 'private';
  readonly mode: RoomMode;
  readonly state: RoomState;
  /** Connected people taking part. */
  readonly players: number;
  readonly spectators: number;
  /** Names of the people in it. */
  readonly names: readonly string[];
  /** When the room was opened (milliseconds since the epoch). */
  readonly createdAt: number;
}

/** What GET /api/admin/stats answers. */
export interface AdminStats {
  readonly serverTime: number;
  readonly startedAt: number;
  /** People with a live connection right now. */
  readonly connected: number;
  /** People connected and not in any game. */
  readonly inMenu: number;
  /** People in public games, by mode (what the title screen shows). */
  readonly publicPlayers: { readonly duel: number; readonly ffa: number };
  readonly rooms: readonly AdminRoom[];
  readonly feedback: { readonly open: number; readonly total: number };
}
