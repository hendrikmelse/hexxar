import { randomBytes, randomUUID } from 'node:crypto';
import {
  clientMessageSchema,
  parseMatchConfig,
  roomCapacity,
  type AdminStats,
  type EventProps,
  type ClientMessage,
  type Order,
  type RoomMode,
  type RoomSettings,
  type RoomSettingsPatch,
} from '@hexxar/shared';
import { noAnalytics, type Analytics } from './analytics.js';
import { Room, applySettingsPatch } from './room.js';
import { SNAPSHOT_VERSION, type ServerSnapshot } from './snapshot.js';
import {
  MAX_CONNECTIONS,
  sendTo,
  type Connection,
  type ConnectionHandler,
  type Session,
} from './types.js';

export interface LobbyOptions {
  /** Time between a match being created and its first tick, for planning the opening. */
  prepMs: number;
  /** How long a public battle royale waits for more players, once it has enough, before starting anyway. */
  earlyStartMs: number;
  /** A player joining tops that wait up to at least this long. */
  joinWaitMs: number;
  /** How long a public room that has just filled up waits before it starts, so everyone sees the lobby. */
  fullWaitMs: number;
  /** Once enough players have voted to start early, how long until the match starts. */
  voteStartMs: number;
  /** How often to tell people in the menu how many are playing each mode (0 turns it off). */
  statsMs: number;
  /** How long a disconnected player is given before their army surrenders. */
  afkMs: number;
  /** How long a finished room stays open for people to look at the result. */
  finishedLingerMs: number;
  /** After a restart, how long matches wait before they tick again, for players to come back (default 5 seconds). */
  resumeMs?: number;
  /** Where what happens is reported. Without it, nothing is. */
  analytics?: Analytics;
}

/** Characters for room codes, leaving out the ones that are easy to confuse. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;

/**
 * Everyone who is connected and every open room. Handles the menu: quick play, creating a
 * private game, joining by code. Once someone is in a room, the room takes over.
 */
export class Lobby {
  private readonly analytics: Analytics;
  private readonly sessions = new Map<string, Session>();
  private readonly rooms = new Map<string, Room>();
  private readonly codes = new Map<string, Room>();
  private statsTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: LobbyOptions) {
    this.analytics = options.analytics ?? noAnalytics;
    if (options.statsMs > 0) {
      this.statsTimer = setInterval(() => this.broadcastStats(), options.statsMs);
    }
  }

  connect(connection: Connection): ConnectionHandler {
    let session: Session | null = null;
    return {
      onMessage: (raw) => {
        const parsed = clientMessageSchema.safeParse(raw);
        if (!parsed.success) {
          connection.send({ type: 'rejected', reason: 'invalid message' });
          return;
        }
        const message = parsed.data;
        if (message.type === 'hello') {
          if (session) return;
          session = this.hello(connection, message) ?? null;
          return;
        }
        if (!session) {
          connection.send({ type: 'rejected', reason: 'say hello first' });
          return;
        }
        const reason = this.handle(session, message);
        if (reason !== null) connection.send({ type: 'rejected', reason });
      },
      onClose: () => {
        if (session && session.connections.has(connection)) this.disconnected(session, connection);
      },
    };
  }

  /** Report something that happened to a guest (if we know who they are). */
  private track(session: Session, name: 'reconnect' | 'disconnect', props: EventProps): void {
    if (!session.visitorId || !session.sessionId) return;
    this.analytics.record({
      visitorId: session.visitorId,
      sessionId: session.sessionId,
      name,
      props,
    });
  }

  /** Tell everyone who is connected that the server is about to restart, and how long that takes. */
  announceRestart(estimateMs: number): void {
    for (const session of this.sessions.values()) {
      sendTo(session, { type: 'restarting', estimateMs });
    }
  }

  /** Stop all timers (for shutdown and tests). */
  stop(): void {
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
    for (const room of this.rooms.values()) room.dispose();
  }

  /** Every running match, as plain data, to be carried on by `restore` after a restart. */
  snapshot(): ServerSnapshot {
    return {
      version: SNAPSHOT_VERSION,
      savedAt: Date.now(),
      rooms: [...this.rooms.values()].flatMap((room) => room.snapshot() ?? []),
    };
  }

  /**
   * Bring back the matches in a snapshot, with nobody connected: their players find them again
   * when their browsers reconnect with the token they already hold. A room that cannot be
   * restored is skipped, so one bad room never keeps the others from coming back.
   */
  restore(saved: ServerSnapshot, now = Date.now()): number {
    const timing = { savedAt: saved.savedAt, now, resumeMs: this.options.resumeMs ?? 5000 };
    let restored = 0;
    for (const data of saved.rooms) {
      try {
        const sessions = new Map<string, Session>();
        for (const m of data.members) {
          // Bots are made again by the room; only people have a session to come back to.
          if (m.bot) continue;
          sessions.set(m.userId, {
            userId: m.userId,
            token: m.token,
            name: m.name,
            connections: new Set(),
            room: null,
            ...(m.visitorId ? { visitorId: m.visitorId } : {}),
            ...(m.sessionId ? { sessionId: m.sessionId } : {}),
          });
        }
        const host = sessions.get(data.hostUserId) ?? [...sessions.values()][0];
        if (!host) continue;
        const room = this.openRoom(host, data.visibility, data.settings, {
          id: data.id,
          code: data.code,
        });
        room.restore(data, sessions, timing);
        // Those who left are only kept for the result, they have no game to come back to.
        for (const m of data.members) {
          const session = sessions.get(m.userId)!;
          if (m.left || m.bot) continue;
          session.room = room;
          this.sessions.set(session.token, session);
        }
        restored++;
      } catch (error) {
        console.error(`room ${data.id} could not be restored`, error);
        this.forgetById(data.id, data.code);
      }
    }
    return restored;
  }

  private hello(
    connection: Connection,
    { name, token, visitorId, sessionId }: Extract<ClientMessage, { type: 'hello' }>,
  ): Session | undefined {
    let session = token ? this.sessions.get(token) : undefined;
    // A guest coming back after being away (not one more tab of a guest who is here).
    const returning = session !== undefined && session.connections.size === 0;
    if (session) {
      if (session.connections.size >= MAX_CONNECTIONS) {
        connection.send({ type: 'rejected', reason: 'too many tabs are open' });
        connection.close();
        return undefined;
      }
      // Another tab of the same guest joins the ones already open.
      session.connections.add(connection);
    } else {
      session = {
        userId: randomBytes(4).toString('hex'),
        token: randomUUID(),
        name,
        connections: new Set([connection]),
        room: null,
      };
      this.sessions.set(session.token, session);
    }
    // A reload keeps the guest but is a new page load.
    if (visitorId) session.visitorId = visitorId;
    if (sessionId) session.sessionId = sessionId;
    if (returning) {
      this.track(session, 'reconnect', {
        inRoom: session.room !== null,
        ...(session.room ? { roomState: session.room.roomState } : {}),
      });
    }
    connection.send({ type: 'welcome', token: session.token, userId: session.userId });
    if (session.room) session.room.reconnect(session);
    else {
      connection.send({ type: 'room', room: null });
      this.sendStats(session, this.stats());
    }
    return session;
  }

  /** How many people are in each kind of public game right now. Private games do not count. */
  private stats(): { duel: number; ffa: number } {
    const counts = { duel: 0, ffa: 0 };
    for (const room of this.rooms.values()) {
      if (room.visibility === 'public') counts[room.mode] += room.activePlayers;
    }
    return counts;
  }

  /** Live numbers for the admin panel (without the feedback counts, which the lobby does not know). */
  adminStats(): Omit<AdminStats, 'feedback' | 'serverTime' | 'startedAt'> {
    let connected = 0;
    let inMenu = 0;
    for (const session of this.sessions.values()) {
      if (session.connections.size === 0) continue;
      connected++;
      if (!session.room) inMenu++;
    }
    return {
      connected,
      inMenu,
      publicPlayers: this.stats(),
      rooms: [...this.rooms.values()].map((room) => room.summary()),
    };
  }

  private sendStats(session: Session, stats: { duel: number; ffa: number }): void {
    session.statsSent = `${stats.duel}/${stats.ffa}`;
    sendTo(session, { type: 'stats', ...stats });
  }

  /**
   * Tell everyone in the menu whose numbers are out of date. This is tracked per guest: someone who
   * was in a game (and so missed the updates) or who reconnected into one is caught up as soon as
   * they are back in the menu, even if the numbers have not changed since.
   */
  private broadcastStats(): void {
    const stats = this.stats();
    const key = `${stats.duel}/${stats.ffa}`;
    for (const session of this.sessions.values()) {
      if (!session.room && session.connections.size > 0 && session.statsSent !== key) {
        this.sendStats(session, stats);
      }
    }
  }

  private disconnected(session: Session, connection: Connection): void {
    session.connections.delete(connection);
    // Another tab is still open: the guest has not gone anywhere.
    if (session.connections.size > 0) return;
    this.track(session, 'disconnect', {
      inRoom: session.room !== null,
      ...(session.room ? { roomState: session.room.roomState } : {}),
    });
    if (session.room) session.room.disconnect(session);
    // Guests with nothing to come back to are forgotten.
    if (!session.room) this.sessions.delete(session.token);
  }

  /** Returns a reason if the message could not be carried out. */
  private handle(
    session: Session,
    message: Exclude<ClientMessage, { type: 'hello' }>,
  ): string | null {
    switch (message.type) {
      case 'setName':
        if (session.room) return 'you cannot change your name during a game';
        session.name = message.name;
        return null;
      case 'quickPlay':
        return this.quickPlay(session, message.mode);
      case 'createRoom':
        return this.createRoom(session, message.settings ?? {});
      case 'joinRoom':
        return this.joinByCode(session, message.code);
      default: {
        const room = session.room;
        if (!room) return 'you are not in a game';
        switch (message.type) {
          case 'updateRoom':
            return room.updateSettings(session, message.settings);
          case 'voteStart':
            return room.vote(session, message.vote);
          case 'startGame':
            return room.start(session);
          case 'leaveRoom':
            room.leave(session);
            return null;
          case 'returnToRoom':
            return room.returnToRoom(session);
          case 'becomeSpectator':
            return room.setSpectating(session, true);
          case 'becomePlayer':
            return room.setSpectating(session, false);
          case 'chat':
            return room.chat(session, message.text);
          case 'order':
            return this.reply(session, room.enqueue(session, message.order), message.order);
          case 'surrender':
            room.surrender(session);
            return null;
        }
      }
    }
  }

  /** Confirm an accepted order to its sender, or pass on the reason it was refused. */
  private reply(session: Session, reason: string | null, order: Order): string | null {
    // Every tab hears of it, so each shows the same queue.
    if (reason === null) sendTo(session, { type: 'queued', order });
    return reason;
  }

  private quickPlay(session: Session, mode: RoomMode): string | null {
    if (session.room) return 'you are already in a game';
    const open = [...this.rooms.values()].find(
      (room) => room.visibility === 'public' && room.mode === mode && room.isOpen,
    );
    if (open) return open.join(session, 'quickplay');
    const room = this.openRoom(session, 'public', this.defaultSettings(mode));
    return room.join(session, 'quickplay');
  }

  private createRoom(session: Session, patch: RoomSettingsPatch): string | null {
    if (session.room) return 'you are already in a game';
    const settings = applySettingsPatch(this.defaultSettings('duel'), patch);
    if (typeof settings === 'string') return settings;
    return this.openRoom(session, 'private', settings).join(session, 'create');
  }

  private joinByCode(session: Session, code: string): string | null {
    if (session.room) return 'you are already in a game';
    const room = this.codes.get(code.toUpperCase());
    if (!room) return `No game with code ${code.toUpperCase()}`;
    return room.join(session);
  }

  private defaultSettings(mode: RoomMode): RoomSettings {
    return {
      mode,
      size: roomCapacity(mode),
      mapSize: 'normal',
      bots: 0,
      config: parseMatchConfig(),
    };
  }

  private openRoom(
    host: Session,
    visibility: 'public' | 'private',
    settings: RoomSettings,
    restored?: { id: string; code: string },
  ): Room {
    const room = new Room({
      // Random, so ids are never reused, even across restarts. Replays will be saved under it.
      id: restored?.id ?? randomUUID(),
      code: restored?.code ?? this.newCode(),
      visibility,
      host,
      settings,
      prepMs: this.options.prepMs,
      earlyStartMs: this.options.earlyStartMs,
      joinWaitMs: this.options.joinWaitMs,
      fullWaitMs: this.options.fullWaitMs,
      voteStartMs: this.options.voteStartMs,
      afkMs: this.options.afkMs,
      finishedLingerMs: this.options.finishedLingerMs,
      onClose: (closed) => this.forget(closed),
      analytics: this.analytics,
    });
    this.rooms.set(room.id, room);
    this.codes.set(room.code, room);
    return room;
  }

  private forget(room: Room): void {
    this.rooms.delete(room.id);
    if (this.codes.get(room.code) === room) this.codes.delete(room.code);
    // Guests who were only here for this room have nothing to come back to.
    for (const [token, session] of this.sessions) {
      if (!session.room && session.connections.size === 0) this.sessions.delete(token);
    }
  }

  /** Drop a room that was only half restored. */
  private forgetById(id: string, code: string): void {
    this.rooms.get(id)?.dispose();
    this.rooms.delete(id);
    this.codes.delete(code);
  }

  private newCode(): string {
    for (;;) {
      let code = '';
      const bytes = randomBytes(CODE_LENGTH);
      for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      if (!this.codes.has(code)) return code;
    }
  }
}
