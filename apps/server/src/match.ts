import {
  resolveTick,
  surrender,
  type GameState,
  type MatchConfig,
  type Order,
  type PlayerId,
} from '@hexxar/shared';

/** Anti-abuse limit, not a game rule: the game itself has no queue size limit. */
export const MAX_QUEUE_LENGTH = 1000;

export interface TickLogEntry {
  readonly tick: number;
  readonly orders: Readonly<Record<PlayerId, Order>>;
}

/**
 * One running game: the state, every player's queue, and a log of the orders
 * resolved each tick. Together with the initial state and config, the log is a
 * complete replay. A match has no timers; whoever owns it calls `step()`.
 */
export class Match {
  private _state: GameState;
  private readonly queues = new Map<PlayerId, Order[]>();
  /** Orders resolved on each tick so far, for replays. */
  readonly log: TickLogEntry[] = [];

  constructor(
    readonly id: string,
    initialState: GameState,
    readonly config: MatchConfig,
  ) {
    this._state = initialState;
    for (const player of initialState.players) this.queues.set(player, []);
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
  step(): { previous: GameState; state: GameState } {
    const previous = this._state;
    const orders: Record<PlayerId, Order> = {};
    for (const [player, queue] of this.queues) {
      const order = queue.shift();
      if (order) orders[player] = order;
    }
    this._state = resolveTick(previous, orders, this.config);
    this.log.push({ tick: this._state.tick, orders });
    return { previous, state: this._state };
  }

  surrender(player: PlayerId): void {
    this._state = surrender(this._state, player);
    this.queues.set(player, []);
  }
}
