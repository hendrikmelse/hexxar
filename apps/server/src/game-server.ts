import { randomUUID } from 'node:crypto';
import {
  clientMessageSchema,
  createSymmetricMatch,
  diffTiles,
  visibleState,
  type PlayerId,
  type ServerMessage,
} from '@hexxar/shared';
import { Match } from './match.js';

/** The transport-facing side of a client connection. */
export interface Connection {
  send(message: ServerMessage): void;
  close(): void;
}

export interface ConnectionHandler {
  onMessage(raw: unknown): void;
  onClose(): void;
}

export interface GameServerOptions {
  /** Players per match: 2, 3, 4 or 6. */
  players: number;
  radius: number;
  tickMs: number;
  /** How long to show the result before the next match starts. */
  restartMs: number;
}

interface Participant {
  readonly token: string;
  readonly playerId: PlayerId;
  readonly name: string;
  connection: Connection | null;
}

/**
 * Temporary single-lobby server: players join in order, the match starts when
 * every slot is filled, and a fresh match begins a few seconds after one ends.
 * Real lobbies and matchmaking replace this in a later milestone.
 */
export class GameServer {
  private readonly participants = new Map<string, Participant>();
  private match: Match | null = null;
  private matchCount = 0;
  private nextTickAt: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: GameServerOptions) {}

  connect(connection: Connection): ConnectionHandler {
    let participant: Participant | null = null;
    return {
      onMessage: (raw) => {
        const parsed = clientMessageSchema.safeParse(raw);
        if (!parsed.success) {
          connection.send({ type: 'rejected', reason: 'invalid message' });
          return;
        }
        const message = parsed.data;
        if (message.type === 'hello') {
          if (participant) return;
          participant = this.join(connection, message.name, message.token);
          return;
        }
        if (!participant || !this.match) {
          connection.send({ type: 'rejected', reason: 'match has not started' });
          return;
        }
        if (message.type === 'order') {
          const reason = this.match.enqueue(participant.playerId, message.order);
          connection.send(
            reason === null
              ? { type: 'queued', order: message.order }
              : { type: 'rejected', reason },
          );
        } else {
          this.match.surrender(participant.playerId);
          this.broadcastSnapshots();
          if (this.match.isOver) this.finishMatch();
        }
      },
      onClose: () => {
        if (participant && participant.connection === connection) participant.connection = null;
      },
    };
  }

  /** Stop timers (for shutdown and tests). */
  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private join(
    connection: Connection,
    name: string,
    token: string | undefined,
  ): Participant | null {
    let participant = token ? this.participants.get(token) : undefined;
    if (!participant) {
      if (this.participants.size >= this.options.players) {
        connection.send({ type: 'rejected', reason: 'match is full' });
        connection.close();
        return null;
      }
      participant = {
        token: randomUUID(),
        playerId: `P${this.participants.size + 1}`,
        name,
        connection: null,
      };
      this.participants.set(participant.token, participant);
    }
    // A newer connection replaces an older one for the same player.
    if (participant.connection && participant.connection !== connection) {
      participant.connection.close();
    }
    participant.connection = connection;
    connection.send({ type: 'welcome', token: participant.token, playerId: participant.playerId });

    if (this.match) {
      this.sendSnapshot(participant);
    } else if (this.participants.size === this.options.players) {
      this.startMatch();
    } else {
      this.broadcast({
        type: 'waiting',
        joined: this.participants.size,
        needed: this.options.players,
      });
    }
    return participant;
  }

  private startMatch(): void {
    const players = [...this.participants.values()].map((p) => p.playerId);
    const seed = Math.floor(Math.random() * 2 ** 32);
    const { state, config } = createSymmetricMatch({
      players,
      seed,
      radius: this.options.radius,
      config: { tickMs: this.options.tickMs },
    });
    this.match = new Match(`match-${++this.matchCount}`, state, config);
    this.nextTickAt = Date.now() + config.tickMs;
    this.broadcastSnapshots();
    this.scheduleTick();
  }

  private scheduleTick(): void {
    if (this.nextTickAt === null) return;
    this.timer = setTimeout(() => this.runTick(), Math.max(0, this.nextTickAt - Date.now()));
  }

  private runTick(): void {
    const match = this.match;
    if (!match || this.nextTickAt === null) return;
    const { previous, state } = match.step();
    this.nextTickAt = match.isOver ? null : this.nextTickAt + match.config.tickMs;

    for (const participant of this.participants.values()) {
      const id = participant.playerId;
      participant.connection?.send({
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

    if (match.isOver) this.finishMatch();
    else this.scheduleTick();
  }

  /** Stop ticking and queue up the next match. */
  private finishMatch(): void {
    this.stop();
    this.nextTickAt = null;
    this.timer = setTimeout(() => this.startMatch(), this.options.restartMs);
  }

  private sendSnapshot(participant: Participant): void {
    const match = this.match;
    if (!match || !participant.connection) return;
    const state = visibleState(match.state, participant.playerId);
    participant.connection.send({
      type: 'snapshot',
      matchId: match.id,
      config: match.config,
      state: { ...state, players: [...state.players], eliminated: [...state.eliminated] },
      queue: [...match.queueOf(participant.playerId)],
      nextTickAt: this.nextTickAt,
      serverTime: Date.now(),
    });
  }

  private broadcastSnapshots(): void {
    for (const participant of this.participants.values()) this.sendSnapshot(participant);
  }

  private broadcast(message: ServerMessage): void {
    for (const participant of this.participants.values()) participant.connection?.send(message);
  }
}
