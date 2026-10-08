import {
  FFA_MAX_PLAYERS,
  DUEL_RADIUS,
  ROYALE_TILES_PER_PLAYER,
  createFreeForAllMatch,
  createRng,
  createSymmetricMatch,
  diffTiles,
  parseMatchConfig,
  roomCapacity,
  roomMinPlayers,
  roomSettingsSchema,
  visibleState,
  type Order,
  type Rng,
  type RoomMode,
  type RoomSettings,
  type RoomSettingsPatch,
  type RoomState,
  type RoomView,
  type ServerMessage,
} from '@hexxar/shared';
import { Match } from './match.js';
import type { Session } from './types.js';

type Timer = ReturnType<typeof setTimeout>;

/**
 * Apply a settings patch on top of the current settings. Returns the new settings, or a
 * message saying why the patch is not allowed.
 */
export function applySettingsPatch(
  current: RoomSettings,
  patch: RoomSettingsPatch,
  allowedModes: readonly RoomMode[],
): RoomSettings | string {
  const mode = patch.mode ?? current.mode;
  if (!allowedModes.includes(mode)) return 'that kind of game is not available';
  // The number of players is decided by the kind of game.
  const size = roomCapacity(mode);
  const mapSize = patch.mapSize ?? current.mapSize;
  let config;
  try {
    config = parseMatchConfig({ ...current.config, ...patch.config });
  } catch {
    return 'invalid game settings';
  }
  const parsed = roomSettingsSchema.safeParse({ mode, size, mapSize, config });
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
  readonly allowedModes: readonly RoomMode[];
  readonly countdownMs: number;
  /**
   * In a public battle royale, how long the room waits for more players once it has enough
   * to start, before starting with whoever is there.
   */
  readonly earlyStartMs: number;
  /** A player joining tops the wait up to at least this long, so newcomers have time to settle in. */
  readonly joinWaitMs: number;
  /** Once enough players have voted to start early, how long until the countdown begins. */
  readonly voteStartMs: number;
  /** How long a disconnected player is given before their army surrenders. */
  readonly afkMs: number;
  /** How long a finished room stays open for people to look at the result. */
  readonly finishedLingerMs: number;
  /** Called once when the room has closed, so it can be forgotten. */
  readonly onClose: (room: Room) => void;
}

interface Member {
  readonly session: Session;
  /** Assigned when the match starts. */
  playerId: string | null;
  /** Has left the room (kept in the list for the result and the player list). */
  left: boolean;
  afkTimer: Timer | null;
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
  private host: Session;
  private settings: RoomSettings;
  private state: RoomState = 'lobby';
  private readonly members: Member[] = [];
  private match: Match | null = null;
  private startsAt: number | null = null;
  private nextTickAt: number | null = null;
  private tickTimer: Timer | null = null;
  private countdownTimer: Timer | null = null;
  private lingerTimer: Timer | null = null;
  private earlyStartTimer: Timer | null = null;
  private earlyStartAt: number | null = null;
  /** Users who have voted to start early (public battle royale). */
  private readonly votes = new Set<string>();
  /** Enough votes are in: the wait has been cut short and the room takes no more players. */
  private lockedIn = false;
  private closed = false;

  constructor(private readonly options: RoomOptions) {
    this.id = options.id;
    this.code = options.code;
    this.visibility = options.visibility;
    this.host = options.host;
    this.settings = options.settings;
  }

  // -- Membership ----------------------------------------------------------

  join(session: Session): string | null {
    if (this.state !== 'lobby') return 'that game has already started';
    if (this.lockedIn) return 'that game is about to start';
    if (this.activeMembers().length >= this.capacity) return 'that game is full';
    this.members.push({ session, playerId: null, left: false, afkTimer: null });
    session.room = this;
    // Public games start by themselves as soon as they are full, or after a wait with nobody new.
    if (this.visibility === 'public' && this.activeMembers().length >= this.capacity) {
      this.startCountdown();
    } else {
      this.scheduleEarlyStart();
      this.topUpWaitForJoin();
      this.broadcastRoom();
    }
    return null;
  }

  /** The player chose to leave. During a match that is a surrender. */
  leave(session: Session): void {
    const member = this.memberOf(session);
    if (!member || member.left) return;
    if (this.state === 'lobby' || this.state === 'starting') {
      this.members.splice(this.members.indexOf(member), 1);
      this.votes.delete(session.userId);
      this.detach(session);
      if (this.members.length === 0) return this.close();
      if (this.host === session) this.host = this.members[0]!.session;
      if (this.state === 'starting' && this.members.length < this.minPlayers) {
        this.cancelCountdown();
      } else if (this.state === 'lobby') {
        this.scheduleEarlyStart();
        // With one fewer player, the votes already in may now be enough.
        this.checkVotes();
      }
      this.broadcastRoom();
      return;
    }
    if (this.state === 'running') this.surrenderMember(member);
    this.markLeft(member);
    this.broadcastRoom();
    this.closeIfEmpty();
  }

  /** The player's connection dropped. */
  disconnect(session: Session): void {
    const member = this.memberOf(session);
    if (!member || member.left) return;
    if (this.state === 'lobby' || this.state === 'starting') return this.leave(session);
    if (this.state === 'running' && member.afkTimer === null) {
      // Their queue keeps running; if they stay away this long, their army surrenders.
      member.afkTimer = setTimeout(() => {
        member.afkTimer = null;
        this.surrenderMember(member);
        this.broadcastRoom();
      }, this.options.afkMs);
    }
    this.broadcastRoom();
  }

  /** The player is back on a new connection. */
  reconnect(session: Session): void {
    const member = this.memberOf(session);
    if (!member || member.left) return;
    if (member.afkTimer) clearTimeout(member.afkTimer);
    member.afkTimer = null;
    this.broadcastRoom();
    this.sendSnapshot(member);
  }

  // -- Host controls -------------------------------------------------------

  updateSettings(session: Session, patch: RoomSettingsPatch): string | null {
    if (session !== this.host) return 'only the host can change the settings';
    if (this.visibility !== 'private') return 'public games have fixed settings';
    if (this.state !== 'lobby') return 'the game has already started';
    const next = applySettingsPatch(this.settings, patch, this.options.allowedModes);
    if (typeof next === 'string') return next;
    if (this.activeMembers().length > Math.min(next.size, FFA_MAX_PLAYERS)) {
      return 'there are too many players for that kind of game';
    }
    this.settings = next;
    this.broadcastRoom();
    return null;
  }

  /** Host only: start the countdown, once there are enough players (never more than fit). */
  start(session: Session): string | null {
    if (session !== this.host) return 'only the host can start the game';
    if (this.state !== 'lobby') return 'the game has already started';
    if (this.activeMembers().length < this.minPlayers) return 'waiting for more players';
    this.startCountdown();
    return null;
  }

  // -- Playing -------------------------------------------------------------

  enqueue(session: Session, order: Order): string | null {
    const member = this.memberOf(session);
    if (!member || member.left || !member.playerId || !this.match)
      return 'the match has not started';
    return this.match.enqueue(member.playerId, order);
  }

  surrender(session: Session): void {
    const member = this.memberOf(session);
    if (member && !member.left) this.surrenderMember(member);
  }

  // -- Views ---------------------------------------------------------------

  view(session: Session): RoomView {
    return {
      id: this.id,
      code: this.code,
      visibility: this.visibility,
      state: this.state,
      host: this.host.userId,
      settings: this.settings,
      players: this.members.map((m) => ({
        userId: m.session.userId,
        name: m.session.name,
        connected: !m.left && m.session.connection !== null,
        playerId: m.playerId,
      })),
      minPlayers: this.minPlayers,
      waitMs: this.options.earlyStartMs,
      startsAt: this.startsAt,
      earlyStartAt: this.earlyStartAt,
      startVotes: this.votes.size,
      votesNeeded: this.votesApply ? this.votesNeeded() : 0,
      youVoted: this.votes.has(session.userId),
      serverTime: Date.now(),
      you: session.userId,
    };
  }

  get isOpen(): boolean {
    return this.state === 'lobby' && !this.lockedIn && this.activeMembers().length < this.capacity;
  }

  /** People currently in this game, lobby or match, and connected. Finished games count for nobody. */
  get activePlayers(): number {
    if (this.state === 'finished') return 0;
    return this.members.filter((m) => !m.left && m.session.connection !== null).length;
  }

  get mode(): RoomMode {
    return this.settings.mode;
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
    for (const timer of [
      this.tickTimer,
      this.countdownTimer,
      this.lingerTimer,
      this.earlyStartTimer,
    ]) {
      if (timer) clearTimeout(timer);
    }
    for (const member of this.members) if (member.afkTimer) clearTimeout(member.afkTimer);
  }

  // -- Internals -----------------------------------------------------------

  private activeMembers(): Member[] {
    return this.members.filter((m) => !m.left);
  }

  private memberOf(session: Session): Member | undefined {
    return this.members.find((m) => m.session === session);
  }

  /** Take the session out of this room and send it back to the menu. */
  private detach(session: Session): void {
    if (session.room === this) session.room = null;
    session.connection?.send({ type: 'room', room: null });
  }

  private markLeft(member: Member): void {
    member.left = true;
    if (member.afkTimer) clearTimeout(member.afkTimer);
    member.afkTimer = null;
    this.detach(member.session);
  }

  private closeIfEmpty(): void {
    if (this.members.every((m) => m.left)) this.close();
  }

  private close(): void {
    if (this.closed) return;
    this.dispose();
    for (const member of this.members) {
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
  }

  /** Run the wait out in `waitMs`, after which the start countdown begins. */
  private armEarlyStart(waitMs: number): void {
    if (this.earlyStartTimer) clearTimeout(this.earlyStartTimer);
    this.earlyStartAt = Date.now() + waitMs;
    this.earlyStartTimer = setTimeout(() => {
      this.earlyStartTimer = null;
      this.startCountdown();
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
    const remaining = this.earlyStartAt === null ? Infinity : this.earlyStartAt - Date.now();
    this.armEarlyStart(Math.min(remaining, this.options.voteStartMs));
  }

  private startCountdown(): void {
    this.resetEarlyStart();
    this.state = 'starting';
    this.startsAt = Date.now() + this.options.countdownMs;
    this.countdownTimer = setTimeout(() => this.begin(), this.options.countdownMs);
    this.broadcastRoom();
  }

  private cancelCountdown(): void {
    if (this.countdownTimer) clearTimeout(this.countdownTimer);
    this.countdownTimer = null;
    this.startsAt = null;
    this.state = 'lobby';
    this.scheduleEarlyStart();
  }

  /** Create the match and start ticking. */
  private begin(): void {
    this.countdownTimer = null;
    const seed = Math.floor(Math.random() * 2 ** 32);
    // Who starts where is random, so nobody always gets the same side.
    const order = shuffle(this.members, createRng(seed));
    const players = order.map((_, i) => `P${i + 1}`);
    order.forEach((member, i) => (member.playerId = players[i] ?? null));
    // Battle Royales get a random board shape, sized by how many are playing.
    const { state, config } =
      this.settings.mode === 'ffa'
        ? createFreeForAllMatch({
            players,
            seed,
            shape: 'random',
            config: this.settings.config,
            params: { tilesPerPlayer: ROYALE_TILES_PER_PLAYER[this.settings.mapSize] },
          })
        : createSymmetricMatch({
            players,
            seed,
            radius: DUEL_RADIUS[this.settings.mapSize],
            config: this.settings.config,
          });
    this.match = new Match(this.id, state, config);
    this.state = 'running';
    this.startsAt = null;
    this.nextTickAt = Date.now() + config.tickMs;
    this.broadcastRoom();
    this.broadcastSnapshots();
    this.scheduleTick();
  }

  private scheduleTick(): void {
    if (this.nextTickAt === null) return;
    this.tickTimer = setTimeout(() => this.runTick(), Math.max(0, this.nextTickAt - Date.now()));
  }

  private runTick(): void {
    const match = this.match;
    if (!match || this.nextTickAt === null) return;
    const { previous, state } = match.step();
    this.nextTickAt = match.isOver ? null : this.nextTickAt + match.config.tickMs;

    for (const member of this.members) {
      if (!member.playerId) continue;
      const id = member.playerId;
      member.session.connection?.send({
        type: 'tick',
        tick: state.tick,
        nextTickAt: this.nextTickAt,
        serverTime: Date.now(),
        changed: diffTiles(visibleState(previous, id), visibleState(state, id)),
        eliminated: [...state.eliminated],
        winner: state.winner,
        queueLength: match.queueOf(id).length,
      });
    }

    if (match.isOver) this.finish();
    else this.scheduleTick();
  }

  private surrenderMember(member: Member): void {
    const match = this.match;
    if (this.state !== 'running' || !match || !member.playerId) return;
    match.surrender(member.playerId);
    this.broadcastSnapshots();
    if (match.isOver) this.finish();
  }

  /** The match is over: stop ticking and leave the room open for the result. */
  private finish(): void {
    if (this.tickTimer) clearTimeout(this.tickTimer);
    this.tickTimer = null;
    this.nextTickAt = null;
    this.state = 'finished';
    for (const member of this.members) {
      if (member.afkTimer) clearTimeout(member.afkTimer);
      member.afkTimer = null;
    }
    this.lingerTimer = setTimeout(() => this.close(), this.options.finishedLingerMs);
    this.broadcastRoom();
  }

  private snapshotFor(member: Member): ServerMessage | null {
    const match = this.match;
    if (!match) return null;
    const state = visibleState(match.state, member.playerId ?? '');
    return {
      type: 'snapshot',
      matchId: match.id,
      config: match.config,
      state: { ...state, players: [...state.players], eliminated: [...state.eliminated] },
      you: member.playerId,
      queue: member.playerId ? [...match.queueOf(member.playerId)] : [],
      nextTickAt: this.nextTickAt,
      serverTime: Date.now(),
    };
  }

  private sendSnapshot(member: Member): void {
    const snapshot = this.snapshotFor(member);
    if (snapshot) member.session.connection?.send(snapshot);
  }

  private broadcastSnapshots(): void {
    for (const member of this.members) if (!member.left) this.sendSnapshot(member);
  }

  private broadcastRoom(): void {
    for (const member of this.members) {
      if (!member.left)
        member.session.connection?.send({ type: 'room', room: this.view(member.session) });
    }
  }
}
