import {
  parseMatchConfig,
  playTick,
  surrender,
  type ExecutedMove,
  type GameState,
  type MatchConfig,
  type Order,
  type PlayerId,
} from '@hexxar/shared';
import type { MatchSnapshot } from './snapshot.js';

/** Anti-abuse limit, not a game rule: the game itself has no queue size limit. */
export const MAX_QUEUE_LENGTH = 1000;

/**
 * One running game: the state and every player's queue. A match has no timers; whoever owns it
 * calls `step()`.
 */
export class Match {
  private _state: GameState;
  private readonly queues = new Map<PlayerId, Order[]>();

  constructor(
    readonly id: string,
    initialState: GameState,
    readonly config: MatchConfig,
  ) {
    this._state = initialState;
    for (const player of initialState.players) this.queues.set(player, []);
  }

  /** Everything needed to carry on this match later, as plain data. */
  snapshot(): MatchSnapshot {
    return {
      id: this.id,
      state: this._state,
      config: this.config,
      queues: Object.fromEntries([...this.queues].map(([player, queue]) => [player, [...queue]])),
    };
  }

  /** A match picked up where `snapshot()` left it. The settings are read afresh, so new ones get their defaults. */
  static restore(data: MatchSnapshot): Match {
    const match = new Match(data.id, data.state, parseMatchConfig(data.config));
    for (const player of data.state.players)
      match.queues.set(player, [...(data.queues[player] ?? [])]);
    return match;
  }

  get state(): GameState {
    return this._state;
  }

  get isOver(): boolean {
    return this._state.winner !== null;
  }

  queueOf(player: PlayerId): readonly Order[] {
    return this.queues.get(player) ?? [];
  }

  /** Append an order to a player's queue. Returns a reason if it was refused. */
  enqueue(player: PlayerId, order: Order): string | null {
    const queue = this.queues.get(player);
    if (!queue) return 'not a player in this match';
    if (this.isOver) return 'match is over';
    if (this._state.eliminated.includes(player)) return 'you are eliminated';
    if (queue.length >= MAX_QUEUE_LENGTH) return 'queue is full';
    queue.push(order);
    return null;
  }

  /** Resolve one tick: pop the head of every queue and apply them all at once. */
  step(): { previous: GameState; state: GameState; moves: ExecutedMove[] } {
    const previous = this._state;
    const orders: Record<PlayerId, Order> = {};
    for (const [player, queue] of this.queues) {
      const order = queue.shift();
      if (order) orders[player] = order;
    }
    const { state, moves } = playTick(previous, orders, this.config);
    this._state = state;
    return { previous, state: this._state, moves };
  }

  surrender(player: PlayerId): void {
    this._state = surrender(this._state, player);
    this.queues.set(player, []);
  }
}
