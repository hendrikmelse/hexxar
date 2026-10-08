import {
  diffTiles,
  executedMoves,
  resolveTick,
  scoresOf,
  visibleMoves,
  visibleState,
  type ClientMessage,
  type GameState,
  type MatchConfig,
  type Order,
  type OrdersByPlayer,
  type PlayerId,
  type ServerMessage,
} from '@hexxar/shared';

export interface LocalMatchOptions {
  state: GameState;
  config: MatchConfig;
  /** The player at the keyboard. */
  you: PlayerId;
  /** What the other players do on each tick, given the state it starts from. */
  bot?: (state: GameState) => OrdersByPlayer;
  /** Receives what a server would have sent. */
  onMessage(message: ServerMessage): void;
  /** Told when the clock starts or stops: when the next tick is due, or `null` while it is paused. */
  onClock(nextTickAt: number | null): void;
}

/**
 * A small match that runs in the browser, for the tutorial: the same rules and the same messages
 * as a real one (it speaks the server's protocol), but with one human, scripted opponents, and a
 * clock the lesson can stop and start.
 */
export class LocalMatch {
  state: GameState;
  /** The player's queued orders, oldest first. */
  queue: Order[] = [];
  nextTickAt: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(private readonly options: LocalMatchOptions) {
    this.state = options.state;
  }

  get config(): MatchConfig {
    return this.options.config;
  }

  /** Send the opening snapshot. */
  start(): void {
    this.options.onMessage(this.snapshot());
  }

  /** What the player's queue and the tiles are now, as a snapshot message. */
  snapshot(): ServerMessage {
    const { config, you } = this.options;
    const visible = visibleState(this.state, you, config);
    return {
      type: 'snapshot',
      matchId: 'tutorial',
      config,
      state: { ...visible, players: [...visible.players], eliminated: [...visible.eliminated] },
      you,
      queue: [...this.queue],
      nextTickAt: this.nextTickAt,
      serverTime: Date.now(),
      scores: scoresOf(this.state, config),
    };
  }

  /** The player's side of the protocol: orders are queued, nothing else matters here. */
  handle(message: ClientMessage): void {
    if (message.type !== 'order' || this.state.winner !== null) return;
    this.queue.push(message.order);
    this.options.onMessage({ type: 'queued', order: message.order });
  }

  /** Start or stop the clock. Ticks happen on their own while it runs. */
  setRunning(running: boolean): void {
    if (this.running === running) return;
    this.running = running;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (running && this.state.winner === null) {
      this.nextTickAt = Date.now() + this.options.config.tickMs;
      this.timer = setTimeout(() => this.step(), this.options.config.tickMs);
    } else {
      this.nextTickAt = null;
    }
    this.options.onClock(this.nextTickAt);
  }

  /** Resolve one tick now. */
  step(): void {
    const { config, you, bot } = this.options;
    if (this.state.winner !== null) return;
    const previous = this.state;
    const orders: Record<PlayerId, Order | undefined> = { ...(bot?.(previous) ?? {}) };
    const mine = this.queue.shift();
    if (mine) orders[you] = mine;
    const moves = executedMoves(previous, orders, config);
    this.state = resolveTick(previous, orders, config);
    const next = this.state;

    if (this.running && next.winner === null) {
      this.nextTickAt = Date.now() + config.tickMs;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.step(), config.tickMs);
    } else {
      this.nextTickAt = null;
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
    }
    this.options.onMessage({
      type: 'tick',
      tick: next.tick,
      nextTickAt: this.nextTickAt,
      serverTime: Date.now(),
      changed: diffTiles(visibleState(previous, you, config), visibleState(next, you, config)),
      eliminated: [...next.eliminated],
      winner: next.winner,
      queueLength: this.queue.length,
      moves: visibleMoves(moves, you, previous, next, config),
      scores: scoresOf(next, config),
    });
  }

  /** Go back to an earlier state (a lesson step being retried or stepped back to). */
  restore(state: GameState, queue: readonly Order[]): void {
    this.state = state;
    this.queue = [...queue];
    this.options.onMessage(this.snapshot());
  }

  /** Change tiles in place (a lesson setting the scene), then show the result. */
  edit(change: (state: GameState) => GameState): void {
    this.state = change(this.state);
    this.options.onMessage(this.snapshot());
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.running = false;
  }
}
