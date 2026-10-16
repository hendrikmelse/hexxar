import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  ChatMessage,
  GameState,
  MatchConfig,
  Order,
  PlayerId,
  RoomSettings,
  RoomView,
} from '@hexxar/shared';
import type { OutHow } from './room.js';

/**
 * What the server writes to disk when it is told to stop, so that a deploy can pick running
 * matches up where they were left. Only matches that are running are kept: a lobby, or a result
 * someone is reading, is not worth the trouble, and its people simply land in the menu.
 *
 * Change `SNAPSHOT_VERSION` only when an old file could no longer be read at all. New settings and
 * rules do not need it: the match carries on under the new code.
 */
export const SNAPSHOT_VERSION = 1;

/** A snapshot older than this is not used: the people in it will have given up and gone. */
export const SNAPSHOT_MAX_AGE_MS = 60_000;

export interface MatchSnapshot {
  readonly id: string;
  readonly state: GameState;
  readonly config: MatchConfig;
  readonly queues: Record<PlayerId, Order[]>;
}

export interface MemberSnapshot {
  readonly userId: string;
  readonly token: string;
  readonly name: string;
  readonly visitorId?: string;
  readonly sessionId?: string;
  /** A computer-controlled player: rebuilt as a new bot, which plays on without its short-term memory. */
  readonly bot?: boolean;
  readonly playerId: string | null;
  readonly left: boolean;
  readonly reviewing: boolean;
  readonly watching: boolean;
  readonly spectator: boolean;
  readonly colorSlot: number | null;
  readonly joinedAt: number;
  readonly outHow: OutHow | null;
  readonly outAt: number | null;
  readonly outPlace: number | null;
  readonly watchSince: number | null;
}

export interface RoomSnapshot {
  readonly id: string;
  readonly code: string;
  readonly visibility: 'public' | 'private';
  readonly settings: RoomSettings;
  readonly hostUserId: string;
  readonly createdAt: number;
  readonly members: MemberSnapshot[];
  readonly match: MatchSnapshot;
  readonly nextTickAt: number | null;
  readonly firstTickAt: number;
  readonly matchColors: Record<string, number>;
  readonly spectatorChat: ChatMessage[];
  readonly chatSeq: number;
  readonly resultPlayers: RoomView['players'] | null;
  readonly lobbyOpenedAt: number;
  readonly belowMinMs: number;
  readonly lastOutHow: OutHow | null;
}

export interface ServerSnapshot {
  readonly version: number;
  /** When it was written; the time since is how long the games were paused. */
  readonly savedAt: number;
  readonly rooms: RoomSnapshot[];
}

/** Write the snapshot so that a reader sees all of it or none of it. With no rooms, remove the file. */
export function writeSnapshot(file: string, snapshot: ServerSnapshot): void {
  if (snapshot.rooms.length === 0) {
    rmSync(file, { force: true });
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  const partial = `${file}.partial`;
  writeFileSync(partial, JSON.stringify(snapshot));
  renameSync(partial, file);
}

/**
 * Read the snapshot, if there is a usable one, and remove the file: it is used once, so a later
 * start (after a crash, say) never brings the same games back again.
 */
export function takeSnapshot(
  file: string,
  now = Date.now(),
  maxAgeMs = SNAPSHOT_MAX_AGE_MS,
): ServerSnapshot | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  rmSync(file, { force: true });
  let parsed: ServerSnapshot;
  try {
    parsed = JSON.parse(text) as ServerSnapshot;
  } catch {
    console.error('the saved games could not be read: starting empty');
    return null;
  }
  if (parsed.version !== SNAPSHOT_VERSION || !Array.isArray(parsed.rooms)) {
    console.warn('the saved games are from an incompatible version: starting empty');
    return null;
  }
  if (now - parsed.savedAt > maxAgeMs) {
    console.warn('the saved games are too old: starting empty');
    return null;
  }
  return parsed;
}
