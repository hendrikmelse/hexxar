import {
  BOT_NAMES,
  bowlRadiusFor,
  createSmartBot,
  SMART_BEST,
  createFreeForAllMatch,
  extraSetsFor,
  FAIR_BOWL_RADIUS,
  createRng,
  createDuelMatch,
  diffTiles,
  newlyEliminated,
  parseMatchConfig,
  roomCapacity,
  roomMinPlayers,
  roomSettingsSchema,
  CHAT_HISTORY,
  FFA_MAX_PLAYERS,
  type ChatChannel,
  type ChatMessage,
  scoresOf,
  visibleMoves,
  visibleState,
  type AdminRoom,
  type Bot,
  type EventProps,
  type ServerEventName,
  type Order,
  type Rng,
  type RoomMode,
  type RoomSettings,
  type RoomSettingsPatch,
  type RoomState,
  type RoomView,
  type ServerMessage,
} from '@hexxar/shared';
import type { Analytics } from './analytics.js';
import { Match } from './match.js';
import { isConnected, sendTo, type Session } from './types.js';

type Timer = ReturnType<typeof setTimeout>;

/**
 * How many seeds are tried for a board before the game is called off, and how long that may take
 * at most. Generation runs on the one thread that also ticks every other game, so a generator
 * that always fails must not be allowed to keep trying for long.
 */
const BOARD_ATTEMPTS = 100;
/** Most people who may watch one private game. */
const MAX_SPECTATORS = 20;
const BOARD_BUDGET_MS = 2000;
/** The least time between one person's chat messages. */
const CHAT_GAP_MS = 400;

/**
 * Apply a settings patch on top of the current settings. Returns the new settings, or a
 * message saying why the patch is not allowed.
 */
export function applySettingsPatch(
  current: RoomSettings,
  patch: RoomSettingsPatch,
): RoomSettings | string {
  const mode = patch.mode ?? current.mode;
  // The number of players is decided by the kind of game.
  const size = roomCapacity(mode);
  const mapSize = patch.mapSize ?? current.mapSize;
  const bots = Math.min(patch.bots ?? current.bots, size);
  const botLevel = patch.botLevel ?? current.botLevel;
  let config;
  try {
    config = parseMatchConfig({ ...current.config, ...patch.config });
  } catch {
    return 'invalid game settings';
  }
  const parsed = roomSettingsSchema.safeParse({ mode, size, mapSize, bots, botLevel, config });
  return parsed.success ? parsed.data : 'invalid game settings';
}

export interface RoomOptions {
  /** Never reused: replays will be saved under it. */
  readonly id: string;
  /** Short invite code, unique among open rooms. */
  readonly code: string;
  readonly visibility: 'public' | 'private';
  readonly host: Session;
  readonly settings: RoomSettings;
  /** Time between the match being created and its first tick: players look at the map and queue orders. */
  readonly prepMs: number;
  /**
   * In a public battle royale, how long the room waits for more players once it has enough
   * to start, before starting with whoever is there.
   */
  readonly earlyStartMs: number;
  /** A player joining tops the wait up to at least this long, so newcomers have time to settle in. */
  readonly joinWaitMs: number;
  /** A public room that has just filled up waits this long before starting (0: starts at once). */
  readonly fullWaitMs: number;
  /** Once enough players have voted to start early, how long until the match starts. */
  readonly voteStartMs: number;
  /** How long a disconnected player is given before their army surrenders. */
  readonly afkMs: number;
  /** How long a finished room stays open for people to look at the result. */
  readonly finishedLingerMs: number;
  /** Called once when the room has closed, so it can be forgotten. */
  readonly onClose: (room: Room) => void;
  /** Where what happens in the room is reported. */
  readonly analytics: Analytics;
}

/** How someone came to be in a room. */
export type JoinVia = 'quickplay' | 'create' | 'code';
/** Why a match began. */
type StartReason = 'full' | 'timer' | 'vote' | 'host';
/** How someone's part in a match ended, if they did not win it. */
type OutHow = 'eliminated' | 'surrendered' | 'left' | 'afk';

interface Member {
  readonly session: Session;
  /** Assigned when the match starts. */
  playerId: string | null;
  /** Has left the room (kept in the list for the result and the player list). */
  left: boolean;
  /**
   * Private rooms only: still looking at the result of the last match, and not yet back in the
   * room for the next one.
   */
  reviewing: boolean;
  /** Out of the match (or it is over), so allowed to see everyone's queue. */
  watching: boolean;
  /** Private rooms only: here to watch, not to play. Joined once the room was full or begun. */
  spectator: boolean;
  /** The color this person plays in, kept from match to match for as long as they are in the room. */
  colorSlot: number | null;
  /** Which chat this person has been sent the log of (and so gets new messages of), if any. */
  chatSent: ChatChannel | null;
  lastChatAt: number;
  afkTimer: Timer | null;
  /** When they came into the room (or back to it), for how long they waited. */
  joinedAt: number;
  /** How they went out of the running match, and when, and in what place. */
  outHow: OutHow | null;
  outAt: number | null;
  outPlace: number | null;
  /** Since when they have been watching the running match, if they are. */
  watchSince: number | null;
  /** Set for a computer-controlled player: what decides its orders. Its session has no connection to send to. */
  bot: Bot | null;
}

function newMember(session: Session, spectator: boolean): Member {
  return {
    session,
    playerId: null,
    left: false,
    reviewing: false,
    watching: spectator,
    spectator,
    colorSlot: null,
    chatSent: null,
    lastChatAt: 0,
    afkTimer: null,
    joinedAt: Date.now(),
    outHow: null,
    outAt: null,
    outPlace: null,
    watchSince: null,
    bot: null,
  };
}

function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/**
 * One game, from the people gathering for it through the match to the result. A room
 * owns its match and its timers; the lobby only creates, finds and forgets rooms.
 */
export class Room {
  readonly id: string;
  readonly code: string;
  readonly visibility: 'public' | 'private';
  private readonly createdAt = Date.now();
  private host: Session;
  private settings: RoomSettings;
  private state: RoomState = 'lobby';
  private readonly members: Member[] = [];
  private match: Match | null = null;
  private nextTickAt: number | null = null;
  private tickTimer: Timer | null = null;
  private lingerTimer: Timer | null = null;
  private earlyStartTimer: Timer | null = null;
  private earlyStartAt: number | null = null;
  /** Users who have voted to start early (public battle royale). */
  private readonly votes = new Set<string>();
  /** Enough votes are in: the wait has been cut short and the room takes no more players. */
  private lockedIn = false;
  private closed = false;
  /** Who was in the last match, for those still looking at its result. */
  private resultPlayers: RoomView['players'] | null = null;
  /** The color slot of each player of the current match, by player id. */
  private matchColors: Record<string, number> = {};
  /** What was said in each chat. The lobby's is gone once the match starts; the spectators' ends with it. */
  private chatLogs: Record<ChatChannel, ChatMessage[]> = { lobby: [], spectators: [] };
  private chatSeq = 0;
  /** Why the wait was cut to its last seconds ('full' or 'vote'), if it was. */
  private lockReason: 'full' | 'vote' | null = null;
  /** For analytics: when the room (or its lobby, after a rematch) opened, and how long it was short of players. */
  private lobbyOpenedAt = Date.now();
  private belowMinSince: number | null = null;
  private belowMinMs = 0;
  /** For analytics: when the running match's first tick is, and how its last player went out. */
  private firstTickAt = 0;
  private lastOutHow: OutHow | null = null;

  constructor(private readonly options: RoomOptions) {
    this.id = options.id;
    this.code = options.code;
    this.visibility = options.visibility;
    this.host = options.host;
    this.settings = options.settings;
  }

  // -- Membership ----------------------------------------------------------

  join(session: Session, via: JoinVia = 'code'): string | null {
    // A game that has begun takes people as spectators, public or private; a private room that is
    // full does too. (A public lobby that is full, or about to start, just turns people away.)
    if (
      this.state !== 'lobby' ||
      (this.visibility === 'private' && this.humans().length >= this.capacity)
    ) {
      return this.watch(session);
    }
    if (this.lockedIn) return 'that game is about to start';
    if (this.humans().length >= this.capacity) return 'that game is full';
    this.members.push(newMember(session, false));
    this.claimColor(this.members[this.members.length - 1]!);
    session.room = this;
    // Bots only keep the places nobody else wants.
    this.syncBots();
    this.trackMin();
    this.track(session, 'lobby_join', { via, players: this.activeMembers().length });
    // Public games start by themselves as soon as they are full, or after a wait with nobody new.
    if (this.visibility === 'public' && this.activeMembers().length >= this.capacity) {
      if (this.options.fullWaitMs > 0) {
        // A short pause first, so everyone sees the full lobby before the match begins.
        this.lockedIn = true;
        this.lockReason = 'full';
        this.armEarlyStart(this.options.fullWaitMs);
        this.broadcastRoom();
      } else {
        this.begin('full');
      }
    } else {
      this.scheduleEarlyStart();
      this.topUpWaitForJoin();
      this.broadcastRoom();
    }
    return null;
  }

  /** Join as a spectator: see the room, and the match once it runs, without taking a place. */
  private watch(session: Session): string | null {
    if (this.state === 'finished') return 'that game is over';
    if (this.members.filter((m) => m.spectator && !m.left).length >= MAX_SPECTATORS) {
      return 'that game has too many spectators';
    }
    const member = newMember(session, true);
    this.members.push(member);
    session.room = this;
    this.track(session, 'spectator_join', { reason: this.state === 'lobby' ? 'full' : 'started' });
    this.noteWatching(member);
    this.broadcastRoom();
    if (this.state === 'running') this.sendSnapshot(member);
    return null;
  }

  /**
   * In a private room's lobby, move between playing and watching. Places are never filled for
   * anyone: a spectator takes a free one only by asking.
   */
  setSpectating(session: Session, spectating: boolean): string | null {
    const member = this.memberOf(session);
    if (!member || member.left) return 'you are not in this game';
    if (this.visibility !== 'private') return 'this game has no spectators';
    if (this.state !== 'lobby' || member.reviewing) return 'the game has already started';
    if (member.spectator === spectating) return null;
    if (spectating) {
      // The host stays the host, watching or not.
      member.spectator = true;
      member.watching = true;
      this.votes.delete(session.userId);
    } else {
      if (this.humans().length >= this.capacity) return 'that game is full';
      member.spectator = false;
      member.watching = false;
      this.claimColor(member);
    }
    this.syncBots();
    this.trackMin();
    this.broadcastRoom();
    return null;
  }

  /** The player chose to leave. During a match that is a surrender. */
  leave(session: Session, how: 'left' | 'disconnected' = 'left'): void {
    const member = this.memberOf(session);
    if (!member || member.left) return;
    if (this.state === 'lobby') {
      this.members.splice(this.members.indexOf(member), 1);
      this.votes.delete(session.userId);
      this.detach(session);
      this.trackMin();
      this.track(session, 'lobby_leave', {
        how,
        role: member.spectator ? 'spectator' : 'player',
        waitedMs: Date.now() - member.joinedAt,
        players: this.activeMembers().length,
      });
      // When the host goes, the next player takes over; with no one left to play, the room is
      // over, whoever is still watching. A host who is only watching keeps the room open.
      if (this.host === session) {
        const next = this.humans()[0] ?? this.members.find((m) => !m.spectator && !m.bot);
        if (!next) return this.close();
        this.host = next.session;
      }
      this.syncBots();
      this.scheduleEarlyStart();
      // With one fewer player, the votes already in may now be enough.
      this.checkVotes();
      this.broadcastRoom();
      return;
    }
    if (this.state === 'running') this.surrenderMember(member, 'left');
    this.markLeft(member, how);
    this.broadcastRoom();
    this.closeIfEmpty();
  }

  /** The player's connection dropped. */
  disconnect(session: Session): void {
    const member = this.memberOf(session);
    if (!member || member.left) return;
    // Nothing to keep for a spectator who is gone.
    if (member.spectator || this.state === 'lobby') return this.leave(session, 'disconnected');
    if (this.state === 'running' && member.afkTimer === null) {
      // Their queue keeps running; if they stay away this long, their army surrenders.
      member.afkTimer = setTimeout(() => {
        member.afkTimer = null;
        this.surrenderMember(member, 'afk');
        this.broadcastRoom();
        this.endIfUnwatched();
      }, this.options.afkMs);
    }
    this.broadcastRoom();
    this.endIfUnwatched();
  }

  /** The player is back on a new connection. */
  reconnect(session: Session): void {
    const member = this.memberOf(session);
    if (!member || member.left) return;
    if (member.afkTimer) clearTimeout(member.afkTimer);
    member.afkTimer = null;
    // The new connection has seen no chat yet.
    member.chatSent = null;
    this.broadcastRoom();
    if (!member.reviewing) this.sendSnapshot(member);
  }

  /**
   * Private rooms: after a match, go back to the room to set up the next one. The room is a
   * lobby again from the first person who returns; the others keep their result until they do.
   */
  returnToRoom(session: Session): string | null {
    const member = this.memberOf(session);
    if (!member || member.left || !member.reviewing) return 'there is no game to go back to';
    this.endWatch(member, 'returned_to_room');
    // The next game is already on: carry on watching it.
    if (this.state === 'running') {
      member.spectator = true;
      member.watching = true;
      member.reviewing = false;
      this.broadcastRoom();
      this.sendSnapshot(member);
      return null;
    }
    if (this.state === 'finished') this.resetToLobby();
    // A room that filled up in the meantime takes you back as a spectator.
    if (!member.spectator && this.humans().length >= this.capacity) {
      member.spectator = true;
      member.watching = true;
    }
    member.reviewing = false;
    member.playerId = null;
    member.joinedAt = Date.now();
    if (!member.spectator) this.claimColor(member);
    // The host stays the host while they read the result: the role passes on only once they have
    // gone (back to the menu, or the tab closed).
    const hostMember = this.memberOf(this.host);
    if (!hostMember || hostMember.left) {
      this.host = (member.spectator ? this.humans()[0]?.session : undefined) ?? session;
    }
    this.syncBots();
    this.broadcastRoom();
    return null;
  }

  /** The finished match is put away and the room is open for the next one. */
  private resetToLobby(): void {
    if (this.lingerTimer) clearTimeout(this.lingerTimer);
    this.lingerTimer = null;
    this.resetEarlyStart();
    this.state = 'lobby';
    this.clearChat();
    this.match = null;
    this.nextTickAt = null;
    for (const member of this.members) this.endWatch(member, 'room_reset');
    this.lobbyOpenedAt = Date.now();
    this.belowMinMs = 0;
    this.belowMinSince = null;
    this.lastOutHow = null;
    for (let i = this.members.length - 1; i >= 0; i--) {
      if (this.members[i]!.left) this.members.splice(i, 1);
    }
    for (const member of this.members) {
      member.playerId = null;
      member.outHow = null;
      member.outAt = null;
      member.outPlace = null;
    }
    this.trackMin();
  }

  // -- Host controls -------------------------------------------------------

  updateSettings(session: Session, patch: RoomSettingsPatch): string | null {
    if (session !== this.host) return 'only the host can change the settings';
    if (this.visibility !== 'private') return 'public games have fixed settings';
    if (this.state !== 'lobby') return 'the game has already started';
    const next = applySettingsPatch(this.settings, patch);
    if (typeof next === 'string') return next;
    const levelChanged = next.botLevel !== this.settings.botLevel;
    this.settings = next;
    this.rebalance();
    if (levelChanged)
      for (const member of this.members) if (member.bot) member.bot = this.botOfLevel();
    this.syncBots();
    this.trackMin();
    this.broadcastRoom();
    return null;
  }

  /**
   * The kind of game decides how many players fit: players who no longer fit a smaller one (the
   * latest to arrive, never the host) become spectators. Places a bigger game opens up are left
   * empty, for spectators to take if they want them.
   */
  private rebalance(): void {
    const players = this.humans();
    if (players.length <= this.capacity) return;
    const keep = new Set(
      [...players]
        .sort((a, b) => Number(b.session === this.host) - Number(a.session === this.host))
        .slice(0, this.capacity),
    );
    for (const member of players) {
      if (keep.has(member)) continue;
      member.spectator = true;
      member.watching = true;
      this.votes.delete(member.session.userId);
    }
  }

  /** Host only: start the match, once there are enough players (never more than fit). */
  start(session: Session): string | null {
    if (session !== this.host) return 'only the host can start the game';
    if (this.state !== 'lobby') return 'the game has already started';
    if (this.activeMembers().length < this.minPlayers) return 'waiting for more players';
    this.begin('host');
    return null;
  }

  // -- Playing -------------------------------------------------------------

  enqueue(session: Session, order: Order): string | null {
    const member = this.memberOf(session);
    if (!member || member.left || !member.playerId || !this.match)
      return 'the match has not started';
    return this.queueOrder(member.playerId, order);
  }

  /** Add an order to a player's queue, and tell everyone watching. Returns a reason if it was refused. */
  private queueOrder(playerId: string, order: Order): string | null {
    if (!this.match) return 'the match has not started';
    const refused = this.match.enqueue(playerId, order);
    if (refused === null) {
      // Anyone watching sees every player's orders as they are given.
      for (const other of this.members) {
        if (other.watching && !other.left && !other.reviewing && !other.bot) {
          sendTo(other.session, { type: 'queued', order, player: playerId });
        }
      }
    }
    return refused;
  }

  // -- Bots ----------------------------------------------------------------

  /**
   * Make the bots in a private room match the setting: as many as asked for, but only in places no
   * person wants, so a person arriving in a full room pushes the last bot out (and the setting
   * follows, so it does not come back by itself). With nobody playing, every place can be a bot's.
   */
  private syncBots(): void {
    if (this.visibility !== 'private' || this.state !== 'lobby') return;
    const bots = this.members.filter((m) => m.bot);
    const want = Math.max(0, Math.min(this.settings.bots, this.capacity - this.humans().length));
    while (bots.length > want) {
      this.members.splice(this.members.indexOf(bots.pop()!), 1);
    }
    while (bots.length < want) {
      const bot = this.newBot();
      this.members.push(bot);
      this.claimColor(bot);
      bots.push(bot);
    }
    if (this.settings.bots !== want) this.settings = { ...this.settings, bots: want };
  }

  private newBot(): Member {
    const taken = new Set(this.members.filter((m) => m.bot).map((m) => m.session.name));
    const name = BOT_NAMES.find((n) => !taken.has(n)) ?? String(this.members.length);
    const session: Session = {
      userId: `bot-${name.toLowerCase()}`,
      token: '',
      name,
      // Nobody is listening: bots are told nothing.
      connections: new Set([{ send: () => undefined, close: () => undefined }]),
      room: this,
    };
    const member = newMember(session, false);
    member.bot = this.botOfLevel();
    return member;
  }

  /**
   * A bot as good as the room's setting says. Every level is the improved bot until the levels are
   * told apart (the original easy bot is still `createEasyBot`, the one new bots are measured against).
   */
  private botOfLevel(): Bot {
    return createSmartBot(SMART_BEST);
  }

  /** Every bot with nothing queued works out what to do next, from what its player can see. */
  private thinkBots(): void {
    const match = this.match;
    if (!match || match.isOver) return;
    for (const member of this.members) {
      const id = member.playerId;
      if (!member.bot || !id || match.state.eliminated.includes(id)) continue;
      if (match.queueOf(id).length > 0) continue;
      const orders = member.bot({
        view: visibleState(match.state, id, match.config),
        me: id,
        config: match.config,
      });
      for (const order of orders) this.queueOrder(id, order);
    }
  }

  surrender(session: Session): void {
    const member = this.memberOf(session);
    if (member && !member.left) this.surrenderMember(member, 'surrendered');
  }

  // -- Chat ----------------------------------------------------------------

  /**
   * Who can chat with whom. Everyone gathered in the room talks together until the match starts;
   * then the players are silent and only the spectators talk, among themselves, out of the
   * players' sight. Once the match is over there is nothing left to keep from anyone: everyone
   * still in the room joins that chat, which carries on while they read the result.
   */
  private chatChannelOf(member: Member): ChatChannel | null {
    if (member.left) return null;
    if (this.state === 'finished') return 'spectators';
    if (member.reviewing) return null;
    if (this.state === 'lobby') return 'lobby';
    // Someone knocked out of the match (or who gave up) is watching it from then on.
    if (this.state === 'running' && (member.spectator || this.isOut(member))) return 'spectators';
    return null;
  }

  chat(session: Session, raw: string): string | null {
    const member = this.memberOf(session);
    const channel = member ? this.chatChannelOf(member) : null;
    if (!member || !channel) return 'you cannot chat right now';
    // Line breaks and other control characters would only break the layout.
    const text = raw.replace(/\p{Cc}+/gu, ' ').trim();
    if (text === '') return null;
    const now = Date.now();
    if (now - member.lastChatAt < CHAT_GAP_MS) return 'you are chatting too fast';
    member.lastChatAt = now;
    const message: ChatMessage = {
      id: ++this.chatSeq,
      userId: session.userId,
      name: session.name,
      text,
      at: now,
    };
    this.publish(channel, message);
    this.track(session, 'chat_message', { channel, length: text.length });
    return null;
  }

  /** Add a message to a chat's log, and send it to everyone who reads that chat. */
  private publish(channel: ChatChannel, message: ChatMessage): void {
    const log = this.chatLogs[channel];
    log.push(message);
    if (log.length > CHAT_HISTORY) log.splice(0, log.length - CHAT_HISTORY);
    for (const other of this.members) {
      if (this.chatChannelOf(other) !== channel) continue;
      // Someone who has not been sent this chat yet gets all of it, this message included.
      if (other.chatSent !== channel) this.syncChat(other);
      else sendTo(other.session, { type: 'chat', messages: [message], replace: false });
    }
  }

  /** Tell the chat who won the match, if anyone did. */
  private announceWinner(): void {
    const winner = this.match?.state.winner;
    if (winner) this.announceOut(winner, 'won the match');
  }

  /** Tell the spectators' chat that a player is out of the match ("was eliminated", "surrendered"). */
  private announceOut(playerId: string, text: string): void {
    const member = this.members.find((m) => m.playerId === playerId);
    if (!member) return;
    this.publish('spectators', {
      id: ++this.chatSeq,
      userId: member.session.userId,
      name: member.session.name,
      ...(member.bot ? { bot: true } : {}),
      text,
      system: true,
      at: Date.now(),
    });
  }

  private canChat(session: Session): boolean {
    const member = this.memberOf(session);
    return member !== undefined && this.chatChannelOf(member) !== null;
  }

  /** Send this person the whole chat they may read, if what they may read has changed. */
  private syncChat(member: Member): void {
    const channel = this.chatChannelOf(member);
    if (channel === member.chatSent) return;
    member.chatSent = channel;
    sendTo(member.session, {
      type: 'chat',
      messages: channel ? [...this.chatLogs[channel]] : [],
      replace: true,
    });
  }

  /** Forget everything said, and tell everyone to empty their chat (whatever they may read now). */
  private clearChat(): void {
    this.chatLogs = { lobby: [], spectators: [] };
    for (const member of this.members) {
      member.chatSent = this.chatChannelOf(member);
      if (!member.left) sendTo(member.session, { type: 'chat', messages: [], replace: true });
    }
  }

  // -- Analytics -----------------------------------------------------------

  /** Report something that happened to this person in this room (if we know who they are). */
  private track(session: Session, name: ServerEventName, props: EventProps = {}): void {
    if (!session.visitorId || !session.sessionId) return;
    this.options.analytics.record({
      visitorId: session.visitorId,
      sessionId: session.sessionId,
      name,
      props: { roomId: this.id, visibility: this.visibility, mode: this.mode, ...props },
    });
  }

  /** Keep count of how long the lobby has had too few players for its match to start. */
  private trackMin(): void {
    const short = this.state === 'lobby' && this.activeMembers().length < this.minPlayers;
    const now = Date.now();
    if (short && this.belowMinSince === null) this.belowMinSince = now;
    else if (!short && this.belowMinSince !== null) {
      this.belowMinMs += now - this.belowMinSince;
      this.belowMinSince = null;
    }
  }

  /** A player is out of the match: remember how, when and in what place. */
  private markOut(playerId: string, how: OutHow, place: number): void {
    const member = this.members.find((m) => m.playerId === playerId);
    if (!member || member.outHow !== null) return;
    member.outHow = how;
    member.outAt = Date.now();
    member.outPlace = place;
    this.lastOutHow = how;
  }

  /** Start the clock on someone's time watching the running match, if they are watching it. */
  private noteWatching(member: Member): void {
    if (this.state === 'running' && member.watching && member.watchSince === null) {
      member.watchSince = Date.now();
    }
  }

  /** Report that someone's time watching a match is over (once). */
  private endWatch(member: Member, how: string): void {
    if (member.watchSince === null) return;
    this.track(member.session, 'spectate_end', {
      how,
      role: member.spectator ? 'spectator' : 'out',
      watchedMs: Date.now() - member.watchSince,
      matchOver: this.state === 'finished',
    });
    member.watchSince = null;
  }

  /** One report for every player of the match that has just ended, on how it went for them. */
  private trackMatchEnd(): void {
    const match = this.match;
    if (!match) return;
    const players = match.state.players.length;
    const now = Date.now();
    for (const member of this.members) {
      if (!member.playerId) continue;
      const won = match.state.winner === member.playerId;
      this.track(member.session, 'match_end', {
        matchId: match.id,
        players,
        durationMs: Math.max(0, now - this.firstTickAt),
        ticks: match.state.tick,
        outcome: won ? 'won' : (member.outHow ?? 'lost'),
        place: won ? 1 : (member.outPlace ?? players),
        ...(member.outAt === null ? {} : { outAtMs: Math.max(0, member.outAt - this.firstTickAt) }),
        endedBy: this.lastOutHow ?? 'eliminated',
      });
    }
  }

  // -- Views ---------------------------------------------------------------

  view(session: Session): RoomView {
    // Someone still looking at the result sees the result, whatever the room has moved on to.
    const reviewing = this.memberOf(session)?.reviewing === true && this.resultPlayers !== null;
    return {
      id: this.id,
      code: this.code,
      visibility: this.visibility,
      state: reviewing ? 'finished' : this.state,
      host: this.host.userId,
      settings: this.settings,
      players: reviewing
        ? this.resultPlayers!
        : this.listedPlayers().map((m) => ({
            userId: m.session.userId,
            name: m.session.name,
            connected: !m.left && isConnected(m.session),
            playerId: m.playerId,
            color: m.colorSlot,
            bot: m.bot !== null,
          })),
      minPlayers: this.minPlayers,
      // How long the wait on screen starts from: a battle royale's, or a duel's short pause.
      waitMs: this.votesApply ? this.options.earlyStartMs : this.options.fullWaitMs,
      earlyStartAt: this.earlyStartAt,
      startVotes: this.votes.size,
      votesNeeded: this.votesApply ? this.votesNeeded() : 0,
      youVoted: this.votes.has(session.userId),
      // Anyone out of the running match is watching it, as much as someone who came to watch. (A bot
      // that is out is not watching anything.)
      spectators: this.members
        .filter((m) => !m.left && !m.bot && (m.spectator || this.isOut(m)))
        .map((m) => m.session.name),
      spectating: this.memberOf(session)?.spectator === true,
      canChat: this.canChat(session),
      serverTime: Date.now(),
      you: session.userId,
    };
  }

  /** The players in the order they are shown in: people first, then the bots (the last one is the first to give way). */
  private listedPlayers(): Member[] {
    const players = this.members.filter((m) => !m.reviewing && !m.spectator);
    return [...players.filter((m) => !m.bot), ...players.filter((m) => m.bot)];
  }

  get isOpen(): boolean {
    return this.state === 'lobby' && !this.lockedIn && this.activeMembers().length < this.capacity;
  }

  /**
   * People currently playing in this game, lobby or match, and connected. People who only came to
   * watch do not count, and neither do finished games.
   */
  get activePlayers(): number {
    if (this.state === 'finished') return 0;
    return this.members.filter((m) => !m.left && !m.spectator && !m.bot && isConnected(m.session))
      .length;
  }

  /** Where the room is, for analytics. */
  get roomState(): RoomState {
    return this.state;
  }

  get mode(): RoomMode {
    return this.settings.mode;
  }

  /** What the admin panel shows about this room. */
  summary(): AdminRoom {
    const here = this.members.filter((m) => !m.left && !m.bot && isConnected(m.session));
    return {
      code: this.code,
      visibility: this.visibility,
      mode: this.mode,
      state: this.state,
      players: here.filter((m) => !m.spectator).length,
      spectators: here.filter((m) => m.spectator).length,
      names: here.map((m) => m.session.name),
      createdAt: this.createdAt,
    };
  }

  /** The most players the room takes. A battle royale never starts with more than 12. */
  private get capacity(): number {
    return Math.min(this.settings.size, roomCapacity(this.settings.mode));
  }

  private get minPlayers(): number {
    return roomMinPlayers(this.settings.mode);
  }

  /** Stop all timers without telling anyone (shutdown and tests). */
  dispose(): void {
    this.closed = true;
    for (const timer of [this.tickTimer, this.lingerTimer, this.earlyStartTimer]) {
      if (timer) clearTimeout(timer);
    }
    for (const member of this.members) if (member.afkTimer) clearTimeout(member.afkTimer);
  }

  // -- Internals -----------------------------------------------------------

  /** Everyone who is in the room and ready for a match (not gone, not looking at the last result). */
  private activeMembers(): Member[] {
    return this.members.filter((m) => !m.left && !m.reviewing && !m.spectator);
  }

  /** The people in the room who play (not the bots): the ones who take places from the bots. */
  private humans(): Member[] {
    return this.activeMembers().filter((m) => !m.bot);
  }

  private memberOf(session: Session): Member | undefined {
    return this.members.find((m) => m.session === session);
  }

  /** Take the session out of this room and send it back to the menu. */
  private detach(session: Session): void {
    if (session.room === this) session.room = null;
    sendTo(session, { type: 'room', room: null });
  }

  private markLeft(member: Member, how: 'left' | 'disconnected'): void {
    this.endWatch(member, how);
    member.left = true;
    if (member.afkTimer) clearTimeout(member.afkTimer);
    member.afkTimer = null;
    this.detach(member.session);
  }

  private closeIfEmpty(): void {
    // A match with bots in it goes on for as long as anybody is looking at it, spectators included.
    if (this.state === 'running' && this.hasBots) return this.endIfUnwatched();
    if (this.members.every((m) => m.left || m.spectator || m.bot)) this.close();
  }

  private get hasBots(): boolean {
    return this.members.some((m) => m.bot);
  }

  /**
   * Is this person here for a match with bots in it? Someone watching is, if their connection is
   * up. Someone still playing is too, even while their connection is down, until they have been
   * away so long that their army surrenders (a page reload must not end the game).
   */
  private isPresent(member: Member): boolean {
    if (member.bot || member.left) return false;
    // Once the match is over there is only the result to look at.
    if (this.state === 'finished' || member.spectator || this.isOut(member)) {
      return isConnected(member.session);
    }
    return true;
  }

  /**
   * Bots will play on for ever, and nobody needs a game that nobody is watching: once no person is
   * left to see or play a match that has bots in it (or to look at its result), the room is closed
   * at once.
   */
  private endIfUnwatched(): void {
    if ((this.state !== 'running' && this.state !== 'finished') || !this.hasBots) return;
    if (!this.members.some((m) => this.isPresent(m))) this.close();
  }

  private close(): void {
    if (this.closed) return;
    this.dispose();
    for (const member of this.members) {
      this.endWatch(member, 'room_closed');
      if (!member.left) this.detach(member.session);
    }
    this.options.onClose(this);
  }

  /** Does a vote to start early apply here? Public battle royales only. */
  private get votesApply(): boolean {
    return this.visibility === 'public' && this.settings.mode === 'ffa';
  }

  /** Two thirds of the players in the room, rounded up, once there are enough to start. */
  private votesNeeded(): number {
    const players = this.activeMembers().length;
    return players >= this.minPlayers ? Math.ceil((players * 2) / 3) : 0;
  }

  /** Forget the wait: no timer, no votes, and the room is open again. */
  private resetEarlyStart(): void {
    if (this.earlyStartTimer) clearTimeout(this.earlyStartTimer);
    this.earlyStartTimer = null;
    this.earlyStartAt = null;
    this.votes.clear();
    this.lockedIn = false;
    this.lockReason = null;
  }

  /** Run the wait out in `waitMs`, after which the match starts. */
  private armEarlyStart(waitMs: number): void {
    if (this.earlyStartTimer) clearTimeout(this.earlyStartTimer);
    this.earlyStartAt = Date.now() + waitMs;
    this.earlyStartTimer = setTimeout(() => {
      this.earlyStartTimer = null;
      this.begin(this.lockedIn ? (this.lockReason ?? 'timer') : 'timer');
    }, waitMs);
  }

  /**
   * A public battle royale with enough players but not a full room waits for more, then starts
   * with whoever is there. The wait begins when the room reaches the minimum, and only a drop
   * below the minimum cancels it: players leaving do not reset it. A vote to start early cuts
   * it short for good. Joining never lengthens it beyond `topUpWaitForJoin`.
   */
  private scheduleEarlyStart(): void {
    const players = this.activeMembers().length;
    const applies =
      this.votesApply &&
      this.state === 'lobby' &&
      players >= this.minPlayers &&
      players < this.capacity;
    if (!applies) {
      this.resetEarlyStart();
      return;
    }
    if (this.lockedIn || this.earlyStartAt !== null) return;
    this.armEarlyStart(this.options.earlyStartMs);
  }

  /** Someone joined: make sure they get at least `joinWaitMs` before the match starts without more. */
  private topUpWaitForJoin(): void {
    if (this.lockedIn || this.earlyStartAt === null) return;
    if (this.earlyStartAt - Date.now() < this.options.joinWaitMs) {
      this.armEarlyStart(this.options.joinWaitMs);
    }
  }

  /** Players vote to skip the rest of the wait. */
  vote(session: Session, vote: boolean): string | null {
    if (!this.votesApply) return 'there is nothing to vote on in this game';
    if (this.state !== 'lobby') return 'the game has already started';
    if (this.activeMembers().length < this.minPlayers) {
      return `at least ${this.minPlayers} players are needed to start`;
    }
    if (!this.memberOf(session)) return 'you are not in this game';
    if (vote) this.votes.add(session.userId);
    else if (!this.lockedIn) this.votes.delete(session.userId);
    this.track(session, 'vote_start', {
      vote,
      votes: this.votes.size,
      needed: this.votesNeeded(),
    });
    this.checkVotes();
    this.broadcastRoom();
    return null;
  }

  /** With two thirds of the room in favor, the wait drops to a few seconds and the room closes to newcomers. */
  private checkVotes(): void {
    if (this.lockedIn || !this.votesApply || this.state !== 'lobby') return;
    const needed = this.votesNeeded();
    if (needed === 0 || this.votes.size < needed) return;
    this.lockedIn = true;
    this.lockReason = 'vote';
    const remaining = this.earlyStartAt === null ? Infinity : this.earlyStartAt - Date.now();
    this.armEarlyStart(Math.min(remaining, this.options.voteStartMs));
  }

  /**
   * Create the match. The first tick comes after `prepMs`, so everyone can plan their opening.
   * Board generation can fail (it is random, and its rules may change), which must never take the
   * server down: other seeds are tried, and if none works the room is closed with an apology.
   */
  private begin(reason: StartReason): void {
    this.resetEarlyStart();
    const seed = Math.floor(Math.random() * 2 ** 32);
    // Who starts where is random, so nobody always gets the same side.
    const order = shuffle(this.activeMembers(), createRng(seed));
    const players = order.map((_, i) => `P${i + 1}`);
    order.forEach((member, i) => (member.playerId = players[i] ?? null));
    this.assignColors(order);

    let board: ReturnType<Room['generateBoard']> | null = null;
    let failure: unknown = null;
    let attempts = 0;
    const started = Date.now();
    while (!board && attempts < BOARD_ATTEMPTS && Date.now() - started < BOARD_BUDGET_MS) {
      try {
        board = this.generateBoard(players, seed + attempts);
      } catch (error) {
        failure = error;
      }
      attempts++;
    }
    if (!board) {
      console.error(`room ${this.id}: no board after ${attempts} attempts`, failure);
      for (const member of this.members) {
        sendTo(member.session, {
          type: 'rejected',
          reason: 'the game could not be set up, please try again',
        });
      }
      this.close();
      return;
    }

    this.match = new Match(this.id, board.state, board.config);
    this.state = 'running';
    this.trackMin();
    this.lastOutHow = null;
    for (const member of this.members) {
      member.outHow = null;
      member.outAt = null;
      member.outPlace = null;
    }
    // What was said while gathering stays behind: the players must not read it again, and the
    // spectators start their own chat.
    this.clearChat();
    this.nextTickAt = Date.now() + this.options.prepMs;
    this.firstTickAt = this.nextTickAt;
    const spectators = this.members.filter((m) => !m.left && m.spectator).length;
    for (const member of order) {
      this.track(member.session, 'match_start', {
        matchId: this.match.id,
        players: order.length,
        spectators,
        bots: order.filter((m) => m.bot).length,
        mapSize: this.settings.mapSize,
        startReason: reason,
        lobbyMs: Date.now() - this.lobbyOpenedAt,
        belowMinMs: this.belowMinMs,
        waitedMs: Date.now() - member.joinedAt,
      });
    }
    for (const member of this.members) this.noteWatching(member);
    this.broadcastRoom();
    this.broadcastSnapshots();
    // The bots get to plan their opening during the planning period, like everyone else.
    this.thinkBots();
    this.scheduleTick();
  }

  /**
   * Give a new player their color, which they keep for as long as they are in the room, so it is
   * the same in the lobby, the chat and the match. A spectator keeps the color they had as a
   * player in reserve for if they come back, so it goes to someone else only when every other
   * color is taken; then it is the lowest reserved one, and its spectator will get a new color
   * when they come back.
   */
  private claimColor(member: Member): void {
    if (member.colorSlot !== null) return;
    const others = this.members.filter((m) => m !== member && !m.left && m.colorSlot !== null);
    const playing = new Set(others.filter((m) => !m.spectator).map((m) => m.colorSlot));
    const reserved = new Set(others.filter((m) => m.spectator).map((m) => m.colorSlot));
    let slot = 0;
    while (playing.has(slot) || reserved.has(slot)) slot++;
    if (slot >= FFA_MAX_PLAYERS) {
      // Nothing unreserved is left (there are never more players than colors, so a reserved one is).
      slot = 0;
      while (playing.has(slot)) slot++;
      const holder = others.find((m) => m.spectator && m.colorSlot === slot);
      if (holder) holder.colorSlot = null;
    }
    member.colorSlot = slot;
  }

  /**
   * Everyone in the match keeps the color they had, so the same people have the same colors from
   * game to game, even when that means the first colors are not used. A newcomer takes the lowest
   * color nobody else here has.
   */
  private assignColors(players: readonly Member[]): void {
    const taken = new Set<number>();
    for (const member of players) {
      if (member.colorSlot !== null && !taken.has(member.colorSlot)) taken.add(member.colorSlot);
      else member.colorSlot = null;
    }
    for (const member of players) {
      if (member.colorSlot !== null) continue;
      let slot = 0;
      while (taken.has(slot)) slot++;
      member.colorSlot = slot;
      taken.add(slot);
    }
    this.matchColors = Object.fromEntries(
      players.flatMap((member) =>
        member.playerId !== null && member.colorSlot !== null
          ? [[member.playerId, member.colorSlot] as const]
          : [],
      ),
    );
  }

  /** The board for this room's settings: a battle royale sized by its players, or a duel by map size. */
  private generateBoard(players: string[], seed: number) {
    const { mode, mapSize, config } = this.settings;
    return mode === 'ffa'
      ? createFreeForAllMatch({
          players,
          seed,
          config,
          params: {
            bowlRadius: bowlRadiusFor(mapSize, players.length),
          },
        })
      : createDuelMatch({
          players,
          seed,
          config,
          params: { bowlRadius: FAIR_BOWL_RADIUS[mapSize], extraSets: extraSetsFor(mapSize, 2) },
        });
  }

  private scheduleTick(): void {
    if (this.nextTickAt === null) return;
    this.tickTimer = setTimeout(() => this.runTick(), Math.max(0, this.nextTickAt - Date.now()));
  }

  /** Knocked out of the match that is running (or surrendered from it), and still in the room. */
  private isOut(member: Member): boolean {
    return (
      this.state === 'running' &&
      member.playerId !== null &&
      this.match?.state.eliminated.includes(member.playerId) === true
    );
  }

  private runTick(): void {
    const match = this.match;
    if (!match || this.nextTickAt === null) return;
    const { previous, state, moves } = match.step();
    const outBefore = previous.eliminated.length;
    this.nextTickAt = match.isOver ? null : this.nextTickAt + match.config.tickMs;
    const { config } = match;
    const scores = scoresOf(state, config);

    for (const member of this.members) {
      // Players and spectators get the ticks; people who have gone, or are reading a result, do not.
      if (member.left || member.reviewing || member.bot) continue;
      if (!member.playerId && !member.spectator) continue;
      const id = member.playerId ?? '';
      // Out of the match, or the match over, or only here to watch: this person sees everyone's
      // queue, from now on.
      const watching = member.spectator || state.eliminated.includes(id) || state.winner !== null;
      const firstWatch = watching && !member.watching;
      member.watching = watching;
      this.noteWatching(member);
      sendTo(member.session, {
        type: 'tick',
        tick: state.tick,
        nextTickAt: this.nextTickAt,
        serverTime: Date.now(),
        changed: diffTiles(visibleState(previous, id, config), visibleState(state, id, config)),
        eliminated: [...state.eliminated],
        winner: state.winner,
        queueLength: match.queueOf(id).length,
        ...(firstWatch ? { queues: this.allQueues(match) } : {}),
        ...(watching && !firstWatch ? { queueLengths: this.queueLengths(match) } : {}),
        moves: visibleMoves(moves, id, previous, state, config),
        scores,
      });
    }

    // The spectators' chat says who is out, and, if that ends the match, who won.
    const newlyOut = newlyEliminated(previous.eliminated, state.eliminated);
    for (const id of newlyOut) {
      this.markOut(id, 'eliminated', state.players.length - outBefore);
      this.announceOut(id, 'was eliminated');
    }
    if (match.isOver) {
      this.announceWinner();
      this.finish();
    } else {
      // Someone who is out is now a spectator, for everyone to see.
      if (newlyOut.length > 0) this.broadcastRoom();
      this.thinkBots();
      this.scheduleTick();
    }
  }

  private surrenderMember(member: Member, how: 'surrendered' | 'left' | 'afk'): void {
    const match = this.match;
    if (this.state !== 'running' || !match || !member.playerId) return;
    const alive = match.state.players.length - match.state.eliminated.length;
    const wasOut = match.state.eliminated.includes(member.playerId);
    match.surrender(member.playerId);
    if (!wasOut) this.markOut(member.playerId, how, alive);
    this.noteWatching(member);
    this.broadcastSnapshots();
    this.announceOut(member.playerId, 'surrendered');
    if (match.isOver) {
      this.announceWinner();
      this.finish();
    } else {
      this.broadcastRoom();
    }
  }

  /** The match is over: stop ticking and leave the room open for the result. */
  private finish(): void {
    if (this.tickTimer) clearTimeout(this.tickTimer);
    this.tickTimer = null;
    this.nextTickAt = null;
    this.state = 'finished';
    this.trackMatchEnd();
    if (this.visibility === 'private') {
      this.resultPlayers = this.view(this.host).players;
      for (const member of this.members) member.reviewing = !member.left && !member.bot;
    }
    for (const member of this.members) {
      if (member.afkTimer) clearTimeout(member.afkTimer);
      member.afkTimer = null;
    }
    this.lingerTimer = setTimeout(() => this.close(), this.options.finishedLingerMs);
    this.broadcastRoom();
  }

  private allQueues(match: Match): Record<string, Order[]> {
    return Object.fromEntries(match.state.players.map((id) => [id, [...match.queueOf(id)]]));
  }

  private queueLengths(match: Match): Record<string, number> {
    return Object.fromEntries(match.state.players.map((id) => [id, match.queueOf(id).length]));
  }

  private snapshotFor(member: Member): ServerMessage | null {
    const match = this.match;
    if (!match) return null;
    const id = member.playerId ?? '';
    // Out of the match, or it is over: then everyone's queue may be seen.
    member.watching =
      member.spectator || match.state.eliminated.includes(id) || match.state.winner !== null;
    this.noteWatching(member);
    const state = visibleState(match.state, id, match.config);
    return {
      type: 'snapshot',
      matchId: match.id,
      config: match.config,
      state: { ...state, players: [...state.players], eliminated: [...state.eliminated] },
      you: member.playerId,
      queue: member.playerId ? [...match.queueOf(member.playerId)] : [],
      ...(member.watching ? { queues: this.allQueues(match) } : {}),
      nextTickAt: this.nextTickAt,
      serverTime: Date.now(),
      scores: scoresOf(match.state, match.config),
      colors: this.matchColors,
    };
  }
  private sendSnapshot(member: Member): void {
    if (member.bot) return;
    const snapshot = this.snapshotFor(member);
    if (snapshot) sendTo(member.session, snapshot);
  }

  private broadcastSnapshots(): void {
    for (const member of this.members)
      if (!member.left && !member.reviewing) this.sendSnapshot(member);
  }

  private broadcastRoom(): void {
    for (const member of this.members) {
      if (member.left || member.bot) continue;
      sendTo(member.session, { type: 'room', room: this.view(member.session) });
      this.syncChat(member);
    }
  }
}
